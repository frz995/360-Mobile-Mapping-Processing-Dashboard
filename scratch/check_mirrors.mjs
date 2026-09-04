const mirrors = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.openstreetmap.ru/cgi/interpreter'
];

for (const url of mirrors) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent('[out:json][timeout:5];node(1);out;'),
      signal: controller.signal
    });
    clearTimeout(timer);
    console.log(url, '=> Status:', res.status, 'CORS:', res.headers.get('access-control-allow-origin'));
  } catch (e) {
    console.log(url, '=> Error:', e.message);
  }
}
