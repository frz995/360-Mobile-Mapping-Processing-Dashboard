#!/usr/bin/env node
/**
 * Clean Wipe Utility: Clears all staging, published, and QAQC survey data from Supabase
 * Usage:
 *   node scripts/clear_all_survey_data.cjs
 *   node scripts/clear_all_survey_data.cjs --force
 *   npm run clean-db
 */

const https = require('https');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// 1. Resolve Supabase credentials from .env or defaults
let supabaseUrl = 'https://tqqybumedywzylujjkqa.supabase.co';
let supabaseKey = 'sb_publishable_Nf52vHR8rCpvoj-w77ZehQ_QniT4-EV';

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const urlMatch = envContent.match(/VITE_SUPABASE_URL\s*=\s*(.+)/);
  const keyMatch = envContent.match(/VITE_SUPABASE_ANON_KEY\s*=\s*(.+)/);
  if (urlMatch) supabaseUrl = urlMatch[1].trim();
  if (keyMatch) supabaseKey = keyMatch[1].trim();
}

const parsedUrl = new URL(supabaseUrl);
const hostname = parsedUrl.hostname;

function makeRequest(method, endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path: `/rest/v1/${endpoint}`,
      method: method,
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function getCount(table) {
  try {
    const res = await makeRequest('GET', `${table}?select=count`);
    if (Array.isArray(res.data) && res.data[0] && typeof res.data[0].count === 'number') {
      return res.data[0].count;
    }
    const all = await makeRequest('GET', `${table}?select=id`);
    return Array.isArray(all.data) ? all.data.length : 0;
  } catch {
    return 0;
  }
}

async function clearTable(table) {
  try {
    // Delete all rows where id is not a dummy negative number
    const res = await makeRequest('DELETE', `${table}?id=neq.-999999`);
    const count = Array.isArray(res.data) ? res.data.length : 0;
    return { table, count, success: res.status >= 200 && res.status < 300 };
  } catch (err) {
    return { table, count: 0, success: false, error: err.message };
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('   360 Mobile Mapping — Clean Wipe Database Script    ');
  console.log('======================================================\n');
  console.log(`Connecting to Supabase: ${supabaseUrl}\n`);

  console.log('Scanning current database records...');
  const stagingCount = await getCount('staging_panoramas');
  const publishedCount = await getCount('panoramas');
  const defectCount = await getCount('qa_defects');

  console.log(`- staging_panoramas : ${stagingCount} records`);
  console.log(`- panoramas (published): ${publishedCount} records`);
  console.log(`- qa_defects        : ${defectCount} records\n`);

  const total = stagingCount + publishedCount + defectCount;
  if (total === 0) {
    console.log('✅ Database is already completely empty. No action needed.\n');
    process.exit(0);
  }

  const isForce = process.argv.includes('--force') || process.argv.includes('-y');
  if (!isForce) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(r => {
      rl.question('⚠️  Are you sure you want to PERMANENTLY DELETE all survey data? (y/N): ', r);
    });
    rl.close();

    if (answer.trim().toLowerCase() !== 'y' && answer.trim().toLowerCase() !== 'yes') {
      console.log('\n❌ Operation cancelled by user. Database was not modified.\n');
      process.exit(0);
    }
  }

  console.log('\n🗑️  Deleting survey data...');

  const results = await Promise.all([
    clearTable('staging_panoramas'),
    clearTable('panoramas'),
    clearTable('qa_defects')
  ]);

  console.log('\nSummary:');
  results.forEach(r => {
    if (r.success) {
      console.log(`  ✅ ${r.table.padEnd(20)}: Cleared (${r.count} deleted)`);
    } else {
      console.log(`  ❌ ${r.table.padEnd(20)}: Failed (${r.error || 'Check RLS permissions'})`);
    }
  });

  console.log('\n🎉 Clean wipe complete! You can now import a fresh survey CSV.\n');
}

main().catch(err => {
  console.error('\n❌ Fatal error during clean wipe:', err);
  process.exit(1);
});
