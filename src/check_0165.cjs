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
  const res = await queryTable('panoramas_view', 'filename=ilike.*0165*');
  console.log('0165 in panoramas_view:', res);

  const res2 = await queryTable('panoramas', 'filename=ilike.*0165*');
  console.log('0165 in panoramas:', res2);

  const res3 = await queryTable('staging_panoramas', 'filename=ilike.*0165*');
  console.log('0165 in staging_panoramas:', res3);
}

run();
