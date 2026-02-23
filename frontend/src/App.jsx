import React, { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';

// ── Custom map markers ────────────────────────────────────────────────
function makePin(color, label) {
  return L.divIcon({
    className: '',
    html: `
      <div class="map-pin" style="--pin-color:${color}">
        <span class="map-pin__label">${label}</span>
        <div class="map-pin__caret"></div>
      </div>`,
    iconAnchor: [40, 42],
    popupAnchor: [0, -44],
  });
}

function makeUserDot() {
  return L.divIcon({
    className: '',
    html: `<div class="user-dot"><div class="user-dot__ring"></div><div class="user-dot__core"></div></div>`,
    iconAnchor: [10, 10],
  });
}

// ── Constants ─────────────────────────────────────────────────────────
const ROUTE_CONFIG = [
  { key: 'fastest',          label: 'Fastest',    icon: '⚡', color: '#3B7FF5', bg: 'fastest'    },
  { key: 'healthiest',       label: 'Healthiest', icon: '🌿', color: '#0EA874', bg: 'healthiest' },
  { key: 'secondHealthiest', label: 'Alt Route',  icon: '🍃', color: '#E8930A', bg: 'alt'        },
];

const PM_LABEL = (v) => {
  if (v <= 12)  return { text: 'Good',      cls: 'good'      };
  if (v <= 35)  return { text: 'Moderate',  cls: 'moderate'  };
  if (v <= 55)  return { text: 'Sensitive', cls: 'sensitive' };
  return              { text: 'Hazardous', cls: 'hazardous' };
};

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// ── App ───────────────────────────────────────────────────────────────
export default function App() {
  const [start, setStart]       = useState('');
  const [end, setEnd]           = useState('');
  const [routes, setRoutes]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [activeKey, setActiveKey] = useState('healthiest');
  const [progress, setProgress] = useState(0);
  const [locating, setLocating] = useState(false); // GPS button state

  const mapRef        = useRef(null);
  const routeLayerRef = useRef(null);
  const startPinRef   = useRef(null);
  const endPinRef     = useRef(null);
  const userDotRef    = useRef(null);
  const progressTimer = useRef(null);

  // ── Initialise Leaflet ────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return;

    mapRef.current = L.map('map-container', { zoomControl: false })
      .setView([25.2023, 75.8333], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
      maxZoom: 19,
    }).addTo(mapRef.current);

    L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);

    // Fly to user location on load (just moves map, doesn't fill input)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(({ coords }) => {
        const { latitude: lat, longitude: lng } = coords;
        mapRef.current.flyTo([lat, lng], 14, { duration: 1.4 });
        if (userDotRef.current) mapRef.current.removeLayer(userDotRef.current);
        userDotRef.current = L.marker([lat, lng], {
          icon: makeUserDot(),
          zIndexOffset: 1000,
        }).addTo(mapRef.current);
      }, () => {});
    }
  }, []);

  // ── Use My Location ───────────────────────────────────────────────
  // Gets GPS coords, reverse-geocodes to a readable address via Mapbox,
  // then fills the start input and flies the map there.
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.');
      return;
    }
    setLocating(true);
    setError('');

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const { latitude: lat, longitude: lng } = coords;

        // Fly map to user
        mapRef.current?.flyTo([lat, lng], 15, { duration: 1.2 });

        // Update user dot
        if (userDotRef.current) mapRef.current?.removeLayer(userDotRef.current);
        userDotRef.current = L.marker([lat, lng], {
          icon: makeUserDot(),
          zIndexOffset: 1000,
        }).addTo(mapRef.current);

        // Reverse geocode to get a human-readable address
        try {
          const res = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address,neighborhood,locality,place`
          );
          const data = await res.json();
          const placeName = data.features?.[0]?.place_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          setStart(placeName);
        } catch {
          // Fallback to raw coords if reverse geocoding fails
          setStart(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        if (err.code === 1) setError('Location access denied. Please allow location in your browser.');
        else setError('Could not get your location. Try again.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // ── Progress bar ──────────────────────────────────────────────────
  const startProgress = () => {
    setProgress(0);
    let p = 0;
    progressTimer.current = setInterval(() => {
      p += Math.random() * 8;
      if (p >= 90) { clearInterval(progressTimer.current); p = 90; }
      setProgress(p);
    }, 400);
  };
  const finishProgress = () => {
    clearInterval(progressTimer.current);
    setProgress(100);
    setTimeout(() => setProgress(0), 600);
  };

  // ── Map helpers ───────────────────────────────────────────────────
  const clearPins = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (startPinRef.current) { map.removeLayer(startPinRef.current); startPinRef.current = null; }
    if (endPinRef.current)   { map.removeLayer(endPinRef.current);   endPinRef.current   = null; }
  }, []);

  const getEndpoints = (geometry) => {
    try {
      const coords = geometry.type === 'LineString'
        ? geometry.coordinates
        : geometry.features.flatMap(f => f.geometry.coordinates);
      return [
        [coords[0][1], coords[0][0]],
        [coords[coords.length - 1][1], coords[coords.length - 1][0]],
      ];
    } catch { return [null, null]; }
  };

  const drawRoute = useCallback((geometry, color, startLabel, endLabel) => {
    const map = mapRef.current;
    if (!map) return;

    if (routeLayerRef.current) map.removeLayer(routeLayerRef.current);
    routeLayerRef.current = L.geoJSON(geometry, {
      style: { color, weight: 5, opacity: 0.92, lineCap: 'round', lineJoin: 'round' },
    }).addTo(map);
    map.fitBounds(routeLayerRef.current.getBounds(), { padding: [60, 80] });

    clearPins();
    const [s, e] = getEndpoints(geometry);
    if (s) startPinRef.current = L.marker(s, { icon: makePin('#0EA874', startLabel || 'Start') }).addTo(map);
    if (e) endPinRef.current   = L.marker(e, { icon: makePin('#EF4444', endLabel   || 'End')   }).addTo(map);
  }, [clearPins]);

  // ── Fetch routes ──────────────────────────────────────────────────
  const fetchRoutes = async () => {
    if (!start.trim() || !end.trim()) { setError('Enter both start and destination.'); return; }
    setLoading(true);
    setError('');
    setRoutes(null);
    clearPins();
    if (routeLayerRef.current && mapRef.current) {
      mapRef.current.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }
    startProgress();

    try {
      const res  = await fetch('http://localhost:3000/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start, end }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      finishProgress();
      setRoutes(data);
      setActiveKey('healthiest');
      drawRoute(data.healthiest.geometry, '#0EA874', start, end);
    } catch (err) {
      finishProgress();
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCardClick = (key) => {
    const cfg = ROUTE_CONFIG.find(c => c.key === key);
    if (!cfg || !routes?.[key]?.geometry) return;
    setActiveKey(key);
    drawRoute(routes[key].geometry, cfg.color, start, end);
  };

  const handleSwap = () => {
    setStart(end);
    setEnd(start);
    setRoutes(null);
    clearPins();
    if (routeLayerRef.current && mapRef.current) {
      mapRef.current.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="shell">

      {/* ── Sidebar ── */}
      <aside className="sidebar">

        {/* Brand */}
        <header className="sidebar__head">
          <div className="brand">
            <div className="brand__dot" />
            <span className="brand__name">Commute</span>
          </div>
          <p className="brand__tagline">Breathe-aware routing · India</p>
        </header>

        {/* Loading bar */}
        <div className="progress-track" style={{ opacity: progress > 0 ? 1 : 0 }}>
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>

        {/* Input group */}
        <div className="input-card">

          {/* Start row */}
          <div className="input-row">
            <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="9" strokeOpacity=".25"/>
            </svg>
            <input
              className="route-input"
              placeholder="Starting point…"
              value={start}
              onChange={e => setStart(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchRoutes()}
            />
            {/* GPS button */}
            <button
              className={`gps-btn ${locating ? 'gps-btn--loading' : ''}`}
              onClick={useMyLocation}
              disabled={locating}
              title="Use my current location"
            >
              {locating
                ? <span className="gps-spinner" />
                : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="14" height="14">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                    <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z" strokeOpacity=".2"/>
                  </svg>
                )
              }
            </button>
          </div>

          {/* Divider + swap */}
          <div className="input-divider">
            <span className="input-divider__line" />
            <button className="swap-btn" onClick={handleSwap} title="Swap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13">
                <path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4" />
              </svg>
            </button>
          </div>

          {/* End row */}
          <div className="input-row">
            <svg className="input-icon input-icon--dest" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
              <circle cx="12" cy="9" r="2.5" fill="currentColor" stroke="none"/>
            </svg>
            <input
              className="route-input"
              placeholder="Destination…"
              value={end}
              onChange={e => setEnd(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchRoutes()}
            />
          </div>
        </div>

        {/* CTA */}
        <button className="analyze-btn" onClick={fetchRoutes} disabled={loading || locating}>
          {loading
            ? <><span className="spinner" /> Sampling every 300 m…</>
            : 'Analyze Routes'}
        </button>

        {/* Error */}
        {error && <div className="error-pill">⚠ {error}</div>}

        {/* Route result cards */}
        {routes && (
          <div className="cards-section">
            <p className="section-label">Routes found</p>
            {ROUTE_CONFIG.map(({ key, label, icon, color, bg }) => {
              const r = routes[key];
              if (!r) return null;
              const isActive = activeKey === key;
              const pm = PM_LABEL(r.metrics?.pm25 ?? 0);
              return (
                <div
                  key={key}
                  className={`rcard rcard--${bg} ${isActive ? 'rcard--active' : ''}`}
                  style={{ '--c': color }}
                  onClick={() => handleCardClick(key)}
                >
                  {isActive && <div className="rcard__activebar" />}

                  <div className="rcard__head">
                    <span className="rcard__badge">{icon} {label}</span>
                    <span className="rcard__score">{r.healthScore}<sup>/100</sup></span>
                  </div>

                  <p className="rcard__via">{r.name}</p>

                  <div className="rcard__stats">
                    <div className="rcard__stat">
                      <b>{r.durationMins}</b><small>min</small>
                    </div>
                    <div className="rcard__divider" />
                    <div className="rcard__stat">
                      <b>{r.distanceKm}</b><small>km</small>
                    </div>
                  </div>

                  {r.metrics && (
                    <div className="rcard__env">
                      <span className="env-tag">🌡 {Math.round(r.metrics.tempCelsius)}°C</span>
                      <span className={`env-tag env-tag--pm env-tag--${pm.cls}`}>
                        💨 {r.metrics.pm25} <em>{pm.text}</em>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer chips */}
        <footer className="sidebar__footer">
          <div className="chip"><span>India</span><small>Region</small></div>
          <div className="chip"><span>Live AQI</span><small>Google API</small></div>
          <div className="chip"><span>300 m</span><small>Intervals</small></div>
        </footer>
      </aside>

      {/* ── Map ── */}
      <main className="map-wrap">
        <div id="map-container" style={{ width: '100%', height: '100vh' }} />

        {/* Floating legend */}
        {routes && (
          <div className="legend">
            {ROUTE_CONFIG.map(({ key, label, icon, color }) => routes[key] && (
              <button
                key={key}
                className={`legend__item ${activeKey === key ? 'legend__item--active' : ''}`}
                style={{ '--c': color }}
                onClick={() => handleCardClick(key)}
              >
                <span className="legend__dot" />
                {icon} {label}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}