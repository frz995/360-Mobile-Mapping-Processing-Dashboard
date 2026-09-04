const bbox = '2.42012,102.01169,2.70917,102.21166';
const q = `[out:json][timeout:25];(
  way["highway"="motorway"](${bbox});
  way["highway"="trunk"](${bbox});
  way["highway"="primary"](${bbox});
  way["highway"="secondary"](${bbox});
  way["highway"="tertiary"](${bbox});
  way["highway"="unclassified"](${bbox});
  way["highway"="residential"](${bbox});
);out geom qt;`;

console.log('Querying union Overpass...');
const t0 = Date.now();
try {
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(q)
  });
  console.log('Status:', r.status, 'Time:', Date.now() - t0, 'ms');
  const text = await r.text();
  console.log('Union Length:', text.length, 'preview:', text.slice(0, 300));
} catch (e) {
  console.error('Error:', e);
}
