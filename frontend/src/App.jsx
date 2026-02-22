import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';

function App() {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [routes, setRoutes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const mapRef = useRef(null);
  const routeLayerRef = useRef(null);

  useEffect(() => {
    if (!mapRef.current) {
      mapRef.current = L.map('map-container').setView([25.2023, 75.8333], 13);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(mapRef.current);
    }
  }, []);

  const fetchRoutes = async () => {
    if (!start || !end) {
      alert("Please enter both locations.");
      return;
    }

    setLoading(true);
    setError('');
    setRoutes(null);

    try {
      // Remember: Ensure your index.js backend is running on port 3000
      const response = await fetch('http://localhost:3000/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start, end })
      });
      
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setRoutes(data);
      drawRoute(data.healthiest.geometry, "#52c41a");

    } catch (err) {
      console.error("Routing Error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const drawRoute = (geoJsonData, color) => {
    const map = mapRef.current;
    if (!map) return;

    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current);
    }

    routeLayerRef.current = L.geoJSON(geoJsonData, {
      style: { color: color, weight: 6, opacity: 0.8 }
    }).addTo(map);

    map.fitBounds(routeLayerRef.current.getBounds(), { padding: [50, 50] });
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <h2>Smart Route Finder</h2>
        <input 
          type="text" 
          value={start} 
          onChange={(e) => setStart(e.target.value)} 
          placeholder="Start (e.g., Kishore Sagar)" 
        />
        <input 
          type="text" 
          value={end} 
          onChange={(e) => setEnd(e.target.value)} 
          placeholder="End (e.g., City Mall)" 
        />
        <button onClick={fetchRoutes} disabled={loading}>
          {loading ? 'Fetching...' : 'Get Live Routes'}
        </button>

        {error && <p className="error">{error}</p>}

        {routes && (
          <div className="results">
            <div className="route-card fastest" onClick={() => drawRoute(routes.fastest.geometry, "#1890ff")}>
              <h3>⚡ Fastest Route</h3>
              <p><strong>Via:</strong> {routes.fastest.name}</p>
              <p>{routes.fastest.durationMins} mins | {routes.fastest.distanceKm} km</p>
            </div>

            <div className="route-card healthiest" onClick={() => drawRoute(routes.healthiest.geometry, "#52c41a")}>
              <h3>🌿 Healthiest Route</h3>
              <p><strong>Via:</strong> {routes.healthiest.name}</p>
              <p>{routes.healthiest.durationMins} mins | Score: {routes.healthiest.healthScore}/100</p>
              {routes.healthiest.metrics && (
                 <p style={{ fontSize: '13px', color: '#555', marginTop: '8px' }}>
                   🌡️ {Math.round(routes.healthiest.metrics.tempCelsius)}°C | 💨 PM2.5: {routes.healthiest.metrics.pm25}
                 </p>
              )}
            </div>

            <div className="route-card second-healthiest" onClick={() => drawRoute(routes.secondHealthiest.geometry, "#faad14")}>
              <h3>🍃 Second Healthiest</h3>
              <p><strong>Via:</strong> {routes.secondHealthiest.name}</p>
              <p>{routes.secondHealthiest.durationMins} mins | Score: {routes.secondHealthiest.healthScore}/100</p>
              {routes.secondHealthiest.metrics && (
                 <p style={{ fontSize: '13px', color: '#555', marginTop: '8px' }}>
                   🌡️ {Math.round(routes.secondHealthiest.metrics.tempCelsius)}°C | 💨 PM2.5: {routes.secondHealthiest.metrics.pm25}
                 </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="map-container">
        <div id="map-container" style={{ height: '100%', width: '100%' }}></div>
      </div>
    </div>
  );
}

export default App;