const https = require('https');

function queryTable(table, query) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'tqqybumedywzylujjkqa.supabase.co',
      path: `/rest/v1/${table}?${query}`,
      method: 'GET',
      headers: {
        'apikey': 'sb_publishable_Nf52vHR8rCpvoj-w77ZehQ_QniT4-EV',
        'Authorization': 'Bearer sb_publishable_Nf52vHR8rCpvoj-w77ZehQ_QniT4-EV'
      }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
      });
    });
    req.end();
  });
}

async function run() {
  const pans = await queryTable('panoramas', 'select=*&limit=200');
  if (Array.isArray(pans)) {
    console.log('Total panoramas:', pans.length);
    pans.forEach(p => {
      let lat = p.lat ?? p.latitude;
      let lon = p.lon ?? p.longitude;
      if (p.geom && p.geom.coordinates) {
        lon = p.geom.coordinates[0];
        lat = p.geom.coordinates[1];
      }
      console.log(`id: ${p.id} | fn: ${p.filename} | lat: ${lat} | lon: ${lon} | date: ${p.captured_at} | desc: ${p.description}`);
    });
  } else {
    console.log('Error:', pans);
  }
}

run();
