const fs = require('fs');

const DRIVABLE_HIGHWAY = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'service', 'motorway_link', 'trunk_link', 'primary_link',
  'secondary_link', 'tertiary_link', 'living_street', 'road'
]);

function isDrivable(tags) {
  if (!tags) return true;
  const h = (tags.highway || '').toLowerCase();
  if (!h) return false;
  return DRIVABLE_HIGHWAY.has(h);
}

function decodeOverpassPayload(payload) {
  const elements = payload && Array.isArray(payload.elements) ? payload.elements : [];
  const lines = [];
  for (const el of elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    if (!isDrivable(el.tags)) continue;
    const coords = [];
    for (const g of el.geometry) {
      const lng = Number(g?.lon);
      const lat = Number(g?.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      coords.push([Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
    }
    if (coords.length < 2) continue;
    lines.push({
      id: el.id != null ? `overpass-${el.id}` : undefined,
      coordinates: coords,
      highway: el.tags?.highway,
      name: el.tags?.name
    });
  }
  return lines;
}

const bbox = '2.42012,102.01169,2.70917,102.21166';
const q = `[out:json][timeout:25];(
  way["highway"="motorway"](${bbox});
  way["highway"="trunk"](${bbox});
  way["highway"="primary"](${bbox});
  way["highway"="secondary"](${bbox});
  way["highway"="tertiary"](${bbox});
  way["highway"="unclassified"](${bbox});
  way["highway"="residential"](${bbox});
  way["highway"="service"](${bbox});
);out geom qt;`;

async function run() {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(q)
  });
  const data = await res.json();
  const rawSize = JSON.stringify(data).length;
  const decoded = decodeOverpassPayload(data);
  const compactPayload = JSON.stringify({ lines: decoded });
  console.log('Raw JSON size:', (rawSize / 1024 / 1024).toFixed(2), 'MB');
  console.log('Decoded lines count:', decoded.length);
  console.log('Compacted payload size:', (compactPayload.length / 1024).toFixed(2), 'KB');
}

run();
