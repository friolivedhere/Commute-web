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

  // Initialize Map centered on Kota
  useEffect(() => {
    if (!mapRef.current) {
      mapRef.current = L.map('map-container', {
        zoomControl: false // Hide default zoom to keep UI clean, can add custom later
      }).setView([25.2023, 75.8333], 13);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(mapRef.current);
      
      L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);
    }
  }, []);

  const swapLocations = () => {
    setStart(end);
    setEnd(start);
    setRoutes(null);
    if (routeLayerRef.current && mapRef.current) {
      mapRef.current.removeLayer(routeLayerRef.current);
    }
  };

  const fetchRoutes = async () => {
    if (!start || !end) {
      alert("Please enter both locations.");
      return;
    }

    setLoading(true);
    setError('');
    setRoutes(null);

    try {
      const response = await fetch('http://localhost:3000/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start, end })
      });
      
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setRoutes(data);
      // Auto-draw the healthiest route first
      drawRoute(data.healthiest.geometry, "#10b981"); 

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

    // Draw the new route with the selected color
    routeLayerRef.current = L.geoJSON(geoJsonData, {
      style: { color: color, weight: 6, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }
    }).addTo(map);

    map.fitBounds(routeLayerRef.current.getBounds(), { padding: [50, 50] });
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <h2>Smart Route Finder</h2>
        
        <div className="input-group">
          <input 
            type="text" 
            value={start} 
            onChange={(e) => setStart(e.target.value)} 
            placeholder="Start (e.g., Kishore Sagar)" 
          />
          <button className="swap-btn" onClick={swapLocations} title="Swap Locations">⇅</button>
          <input 
            type="text" 
            value={end} 
            onChange={(e) => setEnd(e.target.value)} 
            placeholder="End (e.g., City Mall)" 
          />
        </div>

        <button className="submit-btn" onClick={fetchRoutes} disabled={loading}>
          {loading ? 'Analyzing 300m Intervals...' : 'Get Live Routes'}
        </button>

        {error && <p className="error">{error}</p>}

        {routes && (
          <div className="results">
            <div className="route-card fastest" onClick={() => drawRoute(routes.fastest.geometry, "#3b82f6")}>
              <h3>⚡ Fastest Route</h3>
              <p><strong>Via:</strong> {routes.fastest.name}</p>
              <p>{routes.fastest.durationMins} mins | {routes.fastest.distanceKm} km</p>
              {routes.fastest.metrics && (
                 <p className="metrics-row">
                   <span>🌡️ {Math.round(routes.fastest.metrics.tempCelsius)}°C</span>
                   <span>💨 PM2.5: {routes.fastest.metrics.pm25}</span>
                 </p>
              )}
            </div>

            <div className="route-card healthiest" onClick={() => drawRoute(routes.healthiest.geometry, "#10b981")}>
              <h3>🌿 Healthiest Route</h3>
              <p><strong>Via:</strong> {routes.healthiest.name}</p>
              <p>{routes.healthiest.durationMins} mins | Score: {routes.healthiest.healthScore}/100</p>
              {routes.healthiest.metrics && (
                 <p className="metrics-row">
                   <span>🌡️ {Math.round(routes.healthiest.metrics.tempCelsius)}°C</span>
                   <span>💨 PM2.5: {routes.healthiest.metrics.pm25}</span>
                 </p>
              )}
            </div>

            <div className="route-card second-healthiest" onClick={() => drawRoute(routes.secondHealthiest.geometry, "#f59e0b")}>
              <h3>🍃 Second Healthiest</h3>
              <p><strong>Via:</strong> {routes.secondHealthiest.name}</p>
              <p>{routes.secondHealthiest.durationMins} mins | Score: {routes.secondHealthiest.healthScore}/100</p>
              {routes.secondHealthiest.metrics && (
                 <p className="metrics-row">
                   <span>🌡️ {Math.round(routes.secondHealthiest.metrics.tempCelsius)}°C</span>
                   <span>💨 PM2.5: {routes.secondHealthiest.metrics.pm25}</span>
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