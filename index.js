const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// --- INSERT YOUR API KEYS HERE ---
const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;

/**
 * 1. DYNAMIC GEOCODING
 * Converts text locations into exact [longitude, latitude] coordinates.
 * Locked to India (country=IN). Uses proximityCoords if provided to keep searches local.
 */
async function getCoordinates(query, proximityCoords = null) {
    let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=IN&access_token=${MAPBOX_TOKEN}&limit=1`;

    // If we have a start location, tell Mapbox to prioritize results near it
    if (proximityCoords) {
        url += `&proximity=${proximityCoords[0]},${proximityCoords[1]}`;
    }

    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.features || data.features.length === 0) {
        throw new Error(`Location not found: ${query}. Try adding more specific details.`);
    }

    // Console log to help you debug and verify it found the right place
    console.log(`Geocoded '${query}' to: ${data.features[0].place_name}`);
    
    return data.features[0].center; // Returns [longitude, latitude]
}

/**
 * 2. ENVIRONMENTAL DATA
 * Fetches exactly what we need for the health score: PM2.5 and Temperature in Celsius.
 */
async function getEnvironmentalData(lon, lat) {
    const pollutionUrl = `http://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_KEY}`;
    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${OPENWEATHER_KEY}`;

    // Fetch both simultaneously for a faster backend
    const [pollutionRes, weatherRes] = await Promise.all([
        fetch(pollutionUrl),
        fetch(weatherUrl)
    ]);

    const pollutionData = await pollutionRes.json();
    const weatherData = await weatherRes.json();

    return {
        pm25: pollutionData.list[0].components.pm2_5, // Particulate matter
        tempCelsius: weatherData.main.temp            // Real-time temp
    };
}

app.post('/api/routes', async (req, res) => {
    const { start, end } = req.body;

    if (!start || !end) {
        return res.status(400).json({ error: "Start and end locations required." });
    }

    try {
        // 1. Get Start Coordinates (General search inside India)
        const startCoords = await getCoordinates(start);

        // 2. Get End Coordinates (Biased to the area of the Start Coordinates)
        const endCoords = await getCoordinates(end, startCoords);

        // 3. Fetch Routes from Mapbox
        const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${startCoords[0]},${startCoords[1]};${endCoords[0]},${endCoords[1]}?alternatives=true&geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;
        const routeRes = await fetch(directionsUrl);
        const routeData = await routeRes.json();

        if (!routeData.routes || routeData.routes.length === 0) {
            return res.status(404).json({ error: "No driving routes found between these locations." });
        }

        // 4. Fetch Advanced Environmental Data for the destination
        const { pm25, tempCelsius } = await getEnvironmentalData(endCoords[0], endCoords[1]);

        // 5. Advanced Scoring Algorithm
        let processedRoutes = routeData.routes.map((route, index) => {
            const durationMins = Math.round(route.duration / 60);
            const distanceKm = (route.distance / 1000).toFixed(1);
            
            let healthScore = 100;

            // Penalty A: Air Quality (PM2.5)
            const pm25Penalty = pm25 * 0.4; 
            healthScore -= pm25Penalty;

            // Penalty B: Extreme Heat (> 32°C)
            if (tempCelsius > 32) {
                const heatPenalty = (tempCelsius - 32) * 1.5;
                healthScore -= heatPenalty;
            }

            // Penalty C: Exposure time to the elements
            const durationPenalty = durationMins * 0.2;
            healthScore -= durationPenalty;

            // Ensure score stays cleanly between 0 and 100
            healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

            return {
                id: `route-${index}`,
                name: route.legs[0].summary || `Alternative Route ${index + 1}`,
                durationMins,
                distanceKm,
                healthScore,
                metrics: { pm25, tempCelsius }, 
                geometry: route.geometry
            };
        });

        // 6. Sort and assign the 3 specific routes
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
        console.error(error);
        res.status(500).json({ error: error.message || "Failed to fetch route data." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));