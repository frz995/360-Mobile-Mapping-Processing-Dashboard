const url = 'https://tqqybumedywzylujjkqa.supabase.co';
const key = 'sb_publishable_Nf52vHR8rCpvoj-w77ZehQ_QniT4-EV';

async function query(table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  });
  return res.json();
}

async function run() {
  const staging = await query('staging_panoramas');
  console.log('Staging panoramas count:', staging?.length);

  const daily = await query('daily_time_series');
  console.log('daily_time_series count:', daily?.length);
  if (Array.isArray(daily)) {
    let totalDailyFrames = 0;
    daily.forEach(d => {
      const fCount = Number(d.available_images_count ?? d.images_processed ?? d.images ?? 0);
      totalDailyFrames += fCount;
      console.log('DAILY:', d.id, d.subgrid, 'poi:', d.poi_count, 'images:', d.images_processed, 'avail:', d.available_images_count, 'panos:', d.panoramas?.length, 'pub:', d.publish_to_webgis);
    });
    console.log('Total Daily Frames sum:', totalDailyFrames);
  }

  const batches = await query('batch_logs');
  console.log('batch_logs count:', batches?.length);
  if (Array.isArray(batches)) {
    let totalBatchFrames = 0;
    batches.forEach(b => {
      const fCount = Number(b.available_images_count ?? b.images ?? 0);
      totalBatchFrames += fCount;
      console.log('BATCH:', b.id, b.subgrid, 'poi:', b.poi_count, 'images:', b.images, 'avail:', b.available_images_count, 'status:', b.status);
    });
    console.log('Total Batch Frames sum:', totalBatchFrames);
  }
}

run();
