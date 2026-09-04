const DEFAULT_UPSTREAMS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

const DRIVABLE_HIGHWAY = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'service', 'motorway_link', 'trunk_link', 'primary_link',
  'secondary_link', 'tertiary_link', 'living_street', 'road'
]);

function buildOverpassQuery(bbox) {
  const b = `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}`;
  return [
    '[out:json][timeout:20];(',
    `way["highway"="motorway"](${b});`,
    `way["highway"="trunk"](${b});`,
    `way["highway"="primary"](${b});`,
    `way["highway"="secondary"](${b});`,
    `way["highway"="tertiary"](${b});`,
    `way["highway"="unclassified"](${b});`,
    `way["highway"="residential"](${b});`,
    `way["highway"="service"](${b});`,
    ');out geom qt;'
  ].join('');
}

function decodeElementsToLines(payload) {
  const elements = payload && Array.isArray(payload.elements) ? payload.elements : [];
  const lines = [];
  for (const el of elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const h = (el.tags?.highway || '').toLowerCase();
    if (h && !DRIVABLE_HIGHWAY.has(h)) continue;
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

async function testExtraction() {
  const bbox = { minLng: 102.01169, minLat: 2.42012, maxLng: 102.21166, maxLat: 2.70917 };
  const query = buildOverpassQuery(bbox);
  console.log('Testing query:', query.slice(0, 100) + '...');
  let lastError = null;

  for (const upstream of DEFAULT_UPSTREAMS) {
    console.log('Trying upstream:', upstream);
    const t0 = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(upstream, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!res.ok) {
        console.warn(`Upstream ${upstream} returned ${res.status}`);
        lastError = new Error(`Status ${res.status}`);
        continue;
      }
      const data = await res.json();
      const lines = decodeElementsToLines(data);
      console.log(`Success with ${upstream}! Took ${Date.now() - t0}ms, extracted ${lines.length} lines.`);
      return lines;
    } catch (e) {
      console.warn(`Upstream ${upstream} failed:`, e.message);
      lastError = e;
    }
  }
  throw lastError;
}

testExtraction().then(l => console.log('Extracted lines preview:', l.slice(0, 2))).catch(e => console.error('All failed:', e));
