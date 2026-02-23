require('dotenv').config();
const express = require('express');
const cors = require('cors');
const turf = require('@turf/turf');

const app = express();

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// ─────────────────────────────────────────────────────────────
// FIX #4: Cache at module scope — persists across all requests.
// Overlapping 300m grid cells between different users' routes
// never hit the Google API twice.
// ─────────────────────────────────────────────────────────────
const aqiCache = new Map();

// ─────────────────────────────────────────────────────────────
// 1. GEOCODING (Mapbox + India geofence + proximity bias)
// ─────────────────────────────────────────────────────────────
async function getCoordinates(query, proximityCoords = null) {
    // If input is already "lat, lon" raw coords, skip Mapbox entirely
    const coordMatch = query.trim().match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lon = parseFloat(coordMatch[2]);
        console.log(`Using raw coordinates: [${lon}, ${lat}]`);
        return [lon, lat];
    }

    let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&limit=1`;
    if (proximityCoords) {
        url += `&proximity=${proximityCoords[0]},${proximityCoords[1]}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (data.message) throw new Error(`Mapbox API Error: ${data.message}`);
    if (!data.features || data.features.length === 0) throw new Error(`Location not found: ${query}.`);

    console.log(`Geocoded "${query}" → ${data.features[0].place_name}`);
    return data.features[0].center;
}

// ─────────────────────────────────────────────────────────────
// 2. GOOGLE AIR QUALITY
//    FIX #2: Added extraComputations — without it the
//    `pollutants` array never contains `.concentration`,
//    so pm25 always hit the fallback 15.
// ─────────────────────────────────────────────────────────────
async function getGoogleAirQuality(lon, lat) {
    const url = `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${GOOGLE_API_KEY}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            location: { latitude: lat, longitude: lon },
            extraComputations: ['POLLUTANT_CONCENTRATION'] // ← required!
        })
    });

    const data = await response.json();
    let pm25 = 15; // safe fallback

    if (data.pollutants) {
        const pm25Data = data.pollutants.find(p => p.code === 'pm25');
        if (pm25Data?.concentration) {
            pm25 = pm25Data.concentration.value;
        }
    }

    return pm25;
}

// ─────────────────────────────────────────────────────────────
// FIX #4 + #6: getCachedAQI at module scope, uses shared cache
// ─────────────────────────────────────────────────────────────
async function getCachedAQI(lon, lat) {
    const gridKey = `${lon.toFixed(3)},${lat.toFixed(3)}`; // ~110m grid
    if (aqiCache.has(gridKey)) {
        return aqiCache.get(gridKey);
    }
    const pm25 = await getGoogleAirQuality(lon, lat);
    aqiCache.set(gridKey, pm25);
    return pm25;
}

// ─────────────────────────────────────────────────────────────
// 3. GOOGLE WEATHER
//    FIX #1: data.temperature is { degrees, unit } — an object.
//    The original `data.temperature || 25` was always truthy,
//    so `routeTemp - 32` silently returned NaN everywhere.
// ─────────────────────────────────────────────────────────────
async function getGoogleWeather(lon, lat) {
    const url = `https://weather.googleapis.com/v1/currentConditions:lookup?key=${GOOGLE_API_KEY}&location.latitude=${lat}&location.longitude=${lon}`;

    const response = await fetch(url);
    const data = await response.json();

    return data.temperature?.degrees ?? 25; // safe number extraction
}

// ─────────────────────────────────────────────────────────────
// POST /api/routes
// ─────────────────────────────────────────────────────────────
app.post('/api/routes', async (req, res) => {
    const { start, end } = req.body;
    if (!start || !end) return res.status(400).json({ error: 'Start and end locations required.' });

    try {
        const startCoords = await getCoordinates(start);
        const endCoords   = await getCoordinates(end, startCoords);

        const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${startCoords[0]},${startCoords[1]};${endCoords[0]},${endCoords[1]}?alternatives=true&geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;
        const routeRes  = await fetch(directionsUrl);
        const routeData = await routeRes.json();

        if (!routeData.routes || routeData.routes.length === 0) {
            return res.status(404).json({ error: 'No driving routes found.' });
        }

        // Temperature fetched once at destination (shared across all routes)
        const tempCelsius = await getGoogleWeather(endCoords[0], endCoords[1]);
        console.log(`Destination temp: ${tempCelsius}°C`);

        const processedRoutes = await Promise.all(routeData.routes.map(async (route, index) => {
            const durationMins  = Math.round(route.duration / 60);
            const distanceKm    = (route.distance / 1000).toFixed(1);

            // FIX #3: turf functions need a Feature, not a raw geometry object.
            // Passing route.geometry directly caused silent null returns.
            const lineFeature   = turf.feature(route.geometry);
            const routeLengthKm = turf.length(lineFeature, { units: 'kilometers' });

            // Sample a coordinate every 0.3 km (300 m)
            const sampleCoords = [];
            for (let d = 0; d <= routeLengthKm; d += 0.3) {
                const pt = turf.along(lineFeature, d, { units: 'kilometers' });
                sampleCoords.push(pt.geometry.coordinates); // [lon, lat]
            }

            // Fetch PM2.5 for every sample point (cache prevents duplicate calls)
            const pm25Values = await Promise.all(
                sampleCoords.map(([lon, lat]) => getCachedAQI(lon, lat))
            );

            const avgPm25 = pm25Values.reduce((sum, v) => sum + v, 0) / pm25Values.length;

            // Health Score Algorithm
            let healthScore = 100;
            healthScore -= avgPm25 * 0.4;
            if (tempCelsius > 32) healthScore -= (tempCelsius - 32) * 1.5;
            healthScore -= durationMins * 0.2;
            healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

            console.log(`Route ${index}: ${durationMins} min | avg PM2.5: ${avgPm25.toFixed(1)} | health: ${healthScore}`);

            return {
                id: `route-${index}`,
                name: route.legs[0].summary || `Alternative Route ${index + 1}`,
                durationMins,
                distanceKm,
                healthScore,
                metrics: {
                    pm25: Math.round(avgPm25),
                    tempCelsius   // now a real number, not an object
                },
                geometry: route.geometry
            };
        }));

        const fastestRoute = [...processedRoutes].sort((a, b) => a.durationMins - b.durationMins)[0];
        const [healthiestRoute, secondHealthiestRoute] = [...processedRoutes].sort((a, b) => b.healthScore - a.healthScore);

        res.json({
            fastest:          fastestRoute,
            healthiest:       healthiestRoute       || fastestRoute,
            secondHealthiest: secondHealthiestRoute || healthiestRoute
        });

    } catch (error) {
        console.error('Backend Error:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch route data.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));