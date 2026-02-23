import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';

// ── Custom marker factory ────────────────────────────────────────────
function makePin(color, label) {
  return L.divIcon({
    className: '',
    html: `
      <div style="
        display:flex;flex-direction:column;align-items:center;
        filter: drop-shadow(0 3px 6px rgba(0,0,0,0.25));
      ">
        <div style="
          background:${color};color:white;
          font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;
          padding:4px 10px;border-radius:20px;white-space:nowrap;
          box-shadow:0 2px 8px rgba(0,0,0,0.18);
        ">${label}</div>
        <div style="
          width:12px;height:12px;background:${color};
          clip-path:polygon(0 0,100% 0,50% 100%);
          margin-top:-1px;
        "></div>
      </div>`,
    iconAnchor: [30, 38],
    popupAnchor: [0, -40],
  });
}

function makeUserDot() {
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:20px;height:20px;">
        <div style="
          position:absolute;inset:0;border-radius:50%;
          background:rgba(37,99,235,0.2);
          animation:pulse-ring 1.8s ease-out infinite;
        "></div>
        <div style="
          position:absolute;inset:4px;border-radius:50%;
          background:#2563eb;border:2.5px solid white;
          box-shadow:0 2px 6px rgba(37,99,235,0.5);
        "></div>
      </div>`,
    iconAnchor: [10, 10],
  });
}

// ── Component ────────────────────────────────────────────────────────
function App() {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [routes, setRoutes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeRoute, setActiveRoute] = useState('healthiest');

  const mapRef        = useRef(null);
  const routeLayerRef = useRef(null);
  const startPinRef   = useRef(null);
  const endPinRef     = useRef(null);
  const userDotRef    = useRef(null);

  // ── Init map + geolocation ──────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return;

    mapRef.current = L.map('map-container', { zoomControl: false })
      .setView([25.2023, 75.8333], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
    }).addTo(mapRef.current);

    L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);

    // Fly to user location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const { latitude: lat, longitude: lng } = coords;
          mapRef.current.flyTo([lat, lng], 14, { duration: 1.4 });
          if (userDotRef.current) mapRef.current.removeLayer(userDotRef.current);
          userDotRef.current = L.marker([lat, lng], { icon: makeUserDot(), zIndexOffset: 1000 })
            .addTo(mapRef.current);
        },
        () => {} // silently ignore denial
      );
    }
  }, []);

  // ── Helpers ─────────────────────────────────────────────────────
  const clearPins = () => {
    if (startPinRef.current) { mapRef.current?.removeLayer(startPinRef.current); startPinRef.current = null; }
    if (endPinRef.current)   { mapRef.current?.removeLayer(endPinRef.current);   endPinRef.current   = null; }
  };

  const drawRoute = (geoJsonData, color, startCoord, endCoord) => {
    const map = mapRef.current;
    if (!map) return;

    if (routeLayerRef.current) map.removeLayer(routeLayerRef.current);
    routeLayerRef.current = L.geoJSON(geoJsonData, {
      style: { color, weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' },
    }).addTo(map);

    map.fitBounds(routeLayerRef.current.getBounds(), { padding: [60, 80] });

    // Place start / end pins
    clearPins();
    if (startCoord) {
      startPinRef.current = L.marker(startCoord, { icon: makePin('#16a34a', start || 'Start') })
        .addTo(map);
    }
    if (endCoord) {
      endPinRef.current = L.marker(endCoord, { icon: makePin('#ef4444', end || 'End') })
        .addTo(map);
    }
  };

  // Extract first & last coordinate from GeoJSON
  const getEndpoints = (geometry) => {
    try {
      if (geometry.type === 'LineString') {
        const coords = geometry.coordinates;
        return [
          [coords[0][1], coords[0][0]],
          [coords[coords.length - 1][1], coords[coords.length - 1][0]],
        ];
      }
      if (geometry.type === 'FeatureCollection') {
        const all = geometry.features.flatMap(f => f.geometry.coordinates);
        return [
          [all[0][1], all[0][0]],
          [all[all.length - 1][1], all[all.length - 1][0]],
        ];
      }
    } catch (_) {}
    return [null, null];
  };

  const swapLocations = () => {
    setStart(end);
    setEnd(start);
    setRoutes(null);
    clearPins();
    if (routeLayerRef.current && mapRef.current) {
      mapRef.current.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }
  };

  const fetchRoutes = async () => {
    if (!start || !end) { setError('Please enter both start and end locations.'); return; }
    setLoading(true);
    setError('');
    setRoutes(null);
    clearPins();

    try {
      const res  = await fetch('http://localhost:3000/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start, end }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRoutes(data);
      setActiveRoute('healthiest');
      const [s, e] = getEndpoints(data.healthiest.geometry);
      drawRoute(data.healthiest.geometry, '#16a34a', s, e);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRouteClick = (key, color) => {
    setActiveRoute(key);
    if (routes?.[key]?.geometry) {
      const [s, e] = getEndpoints(routes[key].geometry);
      drawRoute(routes[key].geometry, color, s, e);
    }
  };

  const routeConfig = [
    { key: 'fastest',          label: 'Fastest',    icon: '⚡', color: '#2563eb', accent: 'card-fastest'    },
    { key: 'healthiest',       label: 'Healthiest', icon: '🌿', color: '#16a34a', accent: 'card-healthiest' },
    { key: 'secondHealthiest', label: 'Alt Route',  icon: '🍃', color: '#d97706', accent: 'card-alt'        },
  ];

  return (
    <div className="app-shell">

      {/* ── Nav Rail ── */}
      <nav className="nav-rail">
        <div className="nav-logo"><span className="logo-mark">C</span></div>
        <div className="nav-icons">
          <button className="nav-icon active" title="Map">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 11l19-9-9 19-2-8-8-2z" />
            </svg>
          </button>
          <button className="nav-icon" title="History">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          <button className="nav-icon" title="Stats">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6"  y1="20" x2="6"  y2="14" />
            </svg>
          </button>
          <button className="nav-icon" title="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </nav>

      {/* ── Sidebar ── */}
      <aside className="sidebar-panel">
        <div className="sidebar-header">
          <p className="sidebar-subtitle">Clean Commute</p>
          <h1 className="sidebar-title">Route Finder</h1>
        </div>

        <div className="input-section">
          <div className="input-field-wrap">
            <span className="input-dot dot-green" />
            <input className="location-input" type="text" value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder="Starting point..."
              onKeyDown={(e) => e.key === 'Enter' && fetchRoutes()} />
          </div>
          <div className="connector-line">
            <button className="swap-btn" onClick={swapLocations} title="Swap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>
          <div className="input-field-wrap">
            <span className="input-dot dot-red" />
            <input className="location-input" type="text" value={end}
              onChange={(e) => setEnd(e.target.value)}
              placeholder="Destination..."
              onKeyDown={(e) => e.key === 'Enter' && fetchRoutes()} />
          </div>
        </div>

        <button className="find-btn" onClick={fetchRoutes} disabled={loading}>
          {loading
            ? <span className="btn-loading"><span className="spinner" />Analyzing routes…</span>
            : 'Find Best Routes'}
        </button>

        {error && <div className="error-msg">{error}</div>}

        <div className="bottom-chips">
          <div className="chip"><span className="chip-val">Kota</span><span className="chip-lbl">City</span></div>
          <div className="chip"><span className="chip-val">Live</span><span className="chip-lbl">AQI Data</span></div>
          <div className="chip"><span className="chip-val">300m</span><span className="chip-lbl">Intervals</span></div>
        </div>
      </aside>

      {/* ── Map ── */}
      <main className="map-area">
        <div id="map-container" style={{ height: '100%', width: '100%' }} />

        {/* Floating legend */}
        {routes && (
          <div className="map-legend">
            <span className="legend-dot" style={{ background: '#2563eb' }} /> Fastest
            <span className="legend-dot" style={{ background: '#16a34a' }} /> Healthiest
            <span className="legend-dot" style={{ background: '#d97706' }} /> Alt
          </div>
        )}

        {/* ── Bottom Route Bar ── */}
        {routes && (
          <div className="route-bar">
            {routeConfig.map(({ key, label, icon, color, accent }) => {
              const r = routes[key];
              if (!r) return null;
              const isActive = activeRoute === key;
              return (
                <div
                  key={key}
                  className={`rb-card ${accent} ${isActive ? 'rb-card--active' : ''}`}
                  onClick={() => handleRouteClick(key, color)}
                >
                  {isActive && <div className="rb-active-bar" style={{ background: color }} />}
                  <div className="rb-top">
                    <span className="rb-icon">{icon}</span>
                    <span className="rb-label">{label}</span>
                    {isActive && <span className="rb-badge" style={{ background: color }}>Active</span>}
                  </div>
                  <p className="rb-via">{r.name}</p>
                  <div className="rb-stats">
                    <div className="rb-stat">
                      <span className="rb-stat-val">{r.durationMins}</span>
                      <span className="rb-stat-unit">min</span>
                    </div>
                    {r.distanceKm && (
                      <div className="rb-stat">
                        <span className="rb-stat-val">{r.distanceKm}</span>
                        <span className="rb-stat-unit">km</span>
                      </div>
                    )}
                    {r.healthScore && (
                      <div className="rb-stat">
                        <span className="rb-stat-val">{r.healthScore}</span>
                        <span className="rb-stat-unit">/100</span>
                      </div>
                    )}
                  </div>
                  {r.metrics && (
                    <div className="rb-metrics">
                      <span>🌡️ {Math.round(r.metrics.tempCelsius)}°C</span>
                      <span>💨 {r.metrics.pm25} PM2.5</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;