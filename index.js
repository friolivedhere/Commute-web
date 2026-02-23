const express = require('express');
const cors = require('cors');
const turf = require('@turf/turf'); 
const app = express();

app.use(cors());
app.use(express.json());

// --- INSERT YOUR API KEYS HERE ---
const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// 1. GEOCODING (Mapbox with Dynamic Proximity)
async function getCoordinates(query, proximityCoords = null) {
    let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=IN&access_token=${MAPBOX_TOKEN}&limit=1`;
    if (proximityCoords) {
        url += `&proximity=${proximityCoords[0]},${proximityCoords[1]}`;
    }

    const response = await fetch(url);
    const data = await response.json();
    
    if (data.message) throw new Error(`Mapbox API Error: ${data.message}`);
    if (!data.features || data.features.length === 0) throw new Error(`Location not found: ${query}.`);

    console.log(`Geocoded to: ${data.features[0].place_name}`);
    return data.features[0].center; 
}

// 2. GOOGLE AIR QUALITY API (Every 300m)
async function getGoogleAirQuality(lon, lat) {
    const url = `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${GOOGLE_API_KEY}`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            location: { latitude: lat, longitude: lon }
        })
    });
    
    const data = await response.json();
    let pm25 = 15; // Safe default fallback
    
    // Extract exact PM2.5 concentration from Google's response
    if (data.pollutants) {
        const pm25Data = data.pollutants.find(p => p.code === 'pm25');
        if (pm25Data && pm25Data.concentration) {
            pm25 = pm25Data.concentration.value;
        }
    }
    
    return pm25;
}

// 3. GOOGLE WEATHER API (Once per route)
async function getGoogleWeather(lon, lat) {
    // Note: The Google Weather API uses the METRIC system by default (Celsius)
    const url = `https://weather.googleapis.com/v1/currentConditions:lookup?key=${GOOGLE_API_KEY}&location.latitude=${lat}&location.longitude=${lon}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    // Safely extract the temperature, fallback to 25°C if unavailable
    return data.temperature || 25;
}

app.post('/api/routes', async (req, res) => {
    const { start, end } = req.body;
    if (!start || !end) return res.status(400).json({ error: "Start and end locations required." });

    try {
        const startCoords = await getCoordinates(start);
        const endCoords = await getCoordinates(end, startCoords);

        const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${startCoords[0]},${startCoords[1]};${endCoords[0]},${endCoords[1]}?alternatives=true&geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;
        const routeRes = await fetch(directionsUrl);
        const routeData = await routeRes.json();

        if (!routeData.routes || routeData.routes.length === 0) {
            return res.status(404).json({ error: "No driving routes found." });
        }

        // Get the baseline temperature for the destination once using Google Weather
        const routeTemp = await getGoogleWeather(endCoords[0], endCoords[1]);

        /**
         * HIGH-RES SPATIAL CACHE: 
         * Using .toFixed(3) creates ~110m grid cells. 
         * This perfectly matches Google's high-resolution AI tracking.
         */
        const aqiCache = new Map();
        
        async function getCachedAQI(lon, lat) {
            const gridKey = `${lon.toFixed(3)},${lat.toFixed(3)}`;
            if (aqiCache.has(gridKey)) {
                return aqiCache.get(gridKey); 
            }
            const pm25 = await getGoogleAirQuality(lon, lat);
            aqiCache.set(gridKey, pm25);
            return pm25;
        }

        let processedRoutes = await Promise.all(routeData.routes.map(async (route, index) => {
            const durationMins = Math.round(route.duration / 60);
            const distanceKm = (route.distance / 1000).toFixed(1);
            
            const routeLength = turf.length(route.geometry, { units: 'kilometers' });
            const samplePoints = [];

            // Extract a coordinate every 0.3 km
            for (let d = 0; d <= routeLength; d += 0.3) {
                const pt = turf.along(route.geometry, d, { units: 'kilometers' });
                samplePoints.push(pt.geometry.coordinates);
            }

            // Fetch Google Air Quality for every 300m point
            const aqiPromises = samplePoints.map(coords => getCachedAQI(coords[0], coords[1]));
            const pm25Results = await Promise.all(aqiPromises);

            // Calculate the exact average pollution exposure across the entire route
            const avgPm25 = pm25Results.reduce((sum, val) => sum + val, 0) / pm25Results.length;

            // Health Algorithm
            let healthScore = 100;
            healthScore -= (avgPm25 * 0.4); 
            if (routeTemp > 32) healthScore -= ((routeTemp - 32) * 1.5);
            healthScore -= (durationMins * 0.2);
            healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

            return {
                id: `route-${index}`,
                name: route.legs[0].summary || `Alternative Route ${index + 1}`,
                durationMins,
                distanceKm,
                healthScore,
                metrics: { pm25: Math.round(avgPm25), tempCelsius: routeTemp }, 
                geometry: route.geometry
            };
        }));

        const fastestRoute = [...processedRoutes].sort((a, b) => a.durationMins - b.durationMins)[0];
        const healthSortedRoutes = [...processedRoutes].sort((a, b) => b.healthScore - a.healthScore);
        
        const healthiestRoute = healthSortedRoutes[0] || fastestRoute;
        const secondHealthiestRoute = healthSortedRoutes[1] || healthiestRoute;

        res.json({
            fastest: fastestRoute,
            healthiest: healthiestRoute,
            secondHealthiest: secondHealthiestRoute
        });

    } catch (error) {
        console.error("Backend Error:", error);
        res.status(500).json({ error: error.message || "Failed to fetch route data." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));