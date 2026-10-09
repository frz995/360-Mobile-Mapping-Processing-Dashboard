#!/usr/bin/env node
/**
 * GeoSphere 360 — Production Deployment Doctor & System Diagnostics CLI
 *
 * Automated verification of system readiness for commercial deployments:
 * 1. Runtime environment (Node, npm, Python)
 * 2. Configuration & environment variables (.env / .env.production)
 * 3. Supabase connectivity, PostGIS schema & application tables
 * 4. Administrator account existence
 * 5. Cloud & object storage configuration
 * 6. Local Station Agent connectivity
 *
 * Usage:
 *   node scripts/doctor.mjs
 *   npm run doctor
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

// Node.js < 22 WebSocket compatibility shim for CLI scripts
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class DummyWebSocket {};
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Terminal ANSI colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function logHeader(text) {
  console.log(`\n${colors.bold}${colors.cyan}=== ${text} ===${colors.reset}`);
}

function logPass(title, details = '') {
  console.log(`  ${colors.green}✔ PASS${colors.reset}  ${title}${details ? ` ${colors.gray}(${details})${colors.reset}` : ''}`);
}

function logWarn(title, advice = '') {
  console.log(`  ${colors.yellow}▲ WARN${colors.reset}  ${title}`);
  if (advice) console.log(`         ${colors.gray}→ ${advice}${colors.reset}`);
}

function logFail(title, error = '', remediation = '') {
  console.log(`  ${colors.red}✖ FAIL${colors.reset}  ${title}`);
  if (error) console.log(`         ${colors.red}Error: ${error}${colors.reset}`);
  if (remediation) console.log(`         ${colors.yellow}Fix:   ${remediation}${colors.reset}`);
}

/** Helper: load simple .env key-value pairs */
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  try {
    const content = readFileSync(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    /* ignore unreadable file */
  }
}

// Load env cascade
loadEnvFile(join(ROOT, '.env'));
loadEnvFile(join(ROOT, '.env.local'));
loadEnvFile(join(ROOT, '.env.production'));

let fatalFailures = 0;
let warnings = 0;

// =========================================================================
// 1. Runtime Environment Checks
// =========================================================================
logHeader('1. Runtime Environment');

const nodeVersion = process.versions.node;
const [majorNode] = nodeVersion.split('.').map(Number);
if (majorNode >= 18) {
  logPass(`Node.js Runtime v${nodeVersion}`, '>= 18 required');
} else {
  fatalFailures++;
  logFail(`Node.js Runtime v${nodeVersion}`, 'Node 18 or higher is required', 'Upgrade Node.js to LTS 20+');
}

const nodeModulesExist = existsSync(join(ROOT, 'node_modules'));
if (nodeModulesExist) {
  logPass('Node Modules Installed');
} else {
  fatalFailures++;
  logFail('Node Modules Missing', 'node_modules directory not found', 'Run "npm install"');
}

// The services target Python 3.10+ (CI matrix: 3.10 and 3.11). Reporting any
// version as a pass let 3.8 through even though station-agent/app.py and
// worker/app.py use 3.10-only syntax (PEP 604 unions in annotations).
const MIN_PYTHON = [3, 10];
const pythonVersionOk = (ver) => {
  const m = String(ver || '').match(/(\d+)\.(\d+)/);
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > MIN_PYTHON[0] || (maj === MIN_PYTHON[0] && min >= MIN_PYTHON[1]);
};

let pythonFound = false;
try {
  const pyVer = execSync('python --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  if (pythonVersionOk(pyVer)) {
    logPass(`Python Environment (${pyVer})`, 'Required for Station Agent & Worker');
    pythonFound = true;
  } else {
    warnings++;
    logWarn(`Python ${pyVer.replace(/^Python\s*/i, '')} is older than the required ${MIN_PYTHON.join('.')}`, 'Station Agent and Worker services require Python 3.10+');
  }
} catch {
  try {
    const pyVer = execSync('py -3 --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (pythonVersionOk(pyVer)) {
      logPass(`Python Environment (${pyVer})`, 'via Windows py launcher');
      pythonFound = true;
    } else {
      warnings++;
      logWarn(`Python ${pyVer.replace(/^Python\s*/i, '')} is older than the required ${MIN_PYTHON.join('.')}`, 'Station Agent and Worker services require Python 3.10+');
    }
  } catch {
    warnings++;
    logWarn('Python runtime not found in PATH', 'Station Agent and Worker services require Python 3.10+');
  }
}

// =========================================================================
// 2. Configuration & Environment Variables
// =========================================================================
logHeader('2. Environment & Configuration');

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const storageProvider = (process.env.VITE_STORAGE_PROVIDER || 'cloudflare_r2').toLowerCase();

if (supabaseUrl && supabaseUrl.startsWith('http')) {
  logPass(`Supabase URL configured: ${supabaseUrl}`);
} else {
  fatalFailures++;
  logFail('Supabase URL missing or invalid', 'VITE_SUPABASE_URL must be a valid HTTP(S) URL', 'Set VITE_SUPABASE_URL in .env');
}

if (supabaseAnonKey && supabaseAnonKey.split('.').length === 3) {
  logPass('Supabase Anon Public Key configured', 'Valid JWT token structure');
} else {
  fatalFailures++;
  logFail('Supabase Anon Key missing or invalid', 'VITE_SUPABASE_ANON_KEY must be a valid JWT', 'Set VITE_SUPABASE_ANON_KEY in .env');
}

if (supabaseServiceKey && supabaseServiceKey.split('.').length === 3) {
  logPass('Supabase Service Role Key available', 'Privileged backend/seeding access ready');
} else {
  warnings++;
  logWarn('Supabase Service Role Key not set in environment', 'Needed for "npm run admin:seed" and background workers. Safe to omit for public frontend.');
}

logPass(`Active Storage Provider: ${storageProvider.toUpperCase()}`);

// =========================================================================
// 3. Database Connectivity, Schema & PostGIS
// =========================================================================
logHeader('3. Database Connectivity & PostGIS Schema');

if (supabaseUrl && supabaseAnonKey) {
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  try {
    // 3a. Test connectivity with basic query
    const { error: pingError } = await client.from('projects').select('id').limit(1);

    if (pingError && pingError.code !== 'PGRST116') {
      fatalFailures++;
      logFail('Supabase Database Connection', pingError.message, 'Ensure Supabase container/service is running and accessible.');
    } else {
      logPass('Supabase Database Connection Successful');

      // 3b. Verify core tables exist
      const coreTables = ['projects', 'subgrids', 'panoramas', 'user_accounts'];
      for (const table of coreTables) {
        const { error: tblError } = await client.from(table).select('*').limit(0);
        if (tblError) {
          fatalFailures++;
          logFail(`Table "public.${table}" check`, tblError.message, 'Execute "supabase/bootstrap.sql" in your Supabase SQL Editor.');
        } else {
          logPass(`Schema Table "public.${table}" verified`);
        }
      }

      // 3c. Check administrator presence.
      // Column and value names come from supabase/migrations/0004: user_accounts
      // carries `status VARCHAR(20) DEFAULT 'Active'` (Active | Disabled |
      // Pending) — there is no `is_active` column — and roles are the four
      // capitalized strings in src/lib/authz.ts. Querying `is_active` / 'admin'
      // errored on every run, so this check could never pass.
      const { data: admins, error: adminError } = await client
        .from('user_accounts')
        .select('id, email, role, status')
        .eq('role', 'Administrator')
        .eq('status', 'Active')
        .limit(5);

      if (adminError) {
        warnings++;
        logWarn('Unable to query user_accounts for administrator', adminError.message);
      } else if (admins && admins.length > 0) {
        logPass(`Active Administrator Found (${admins.length} registered)`, admins.map(a => a.email).join(', '));
      } else {
        warnings++;
        logWarn('No active Administrator accounts detected in database', 'Run "npm run admin:seed" to create the initial admin user.');
      }
    }
  } catch (err) {
    fatalFailures++;
    logFail('Database unreachable', String(err), 'Check network routing, firewall, and Supabase host.');
  }
}

// =========================================================================
// 4. Cloud Object Storage Verification
// =========================================================================
logHeader('4. Cloud Storage Infrastructure');

switch (storageProvider) {
  case 'cloudflare_r2': {
    const r2Domain = process.env.VITE_R2_DOMAIN || process.env.VITE_IMAGE_CDN_URL;
    if (r2Domain) {
      logPass(`Cloudflare R2 Public Domain: ${r2Domain}`);
    } else {
      warnings++;
      logWarn('Cloudflare R2 domain not set in .env', 'Set VITE_R2_DOMAIN=pub-xxx.r2.dev or configure in Admin Settings');
    }
    break;
  }
  case 'aws_s3': {
    const s3Bucket = process.env.VITE_S3_BUCKET;
    const s3Region = process.env.VITE_S3_REGION;
    if (s3Bucket) {
      logPass(`AWS S3 Bucket: ${s3Bucket} (${s3Region || 'default region'})`);
    } else {
      warnings++;
      logWarn('AWS S3 Bucket not configured in .env', 'Set VITE_S3_BUCKET and VITE_S3_REGION');
    }
    break;
  }
  case 'wasabi': {
    const wasabiBucket = process.env.VITE_WASABI_BUCKET;
    if (wasabiBucket) {
      logPass(`Wasabi Storage Bucket: ${wasabiBucket}`);
    } else {
      warnings++;
      logWarn('Wasabi Bucket not configured in .env', 'Set VITE_WASABI_BUCKET');
    }
    break;
  }
  case 'nas_local': {
    const nasUrl = process.env.VITE_NAS_SERVER_URL || process.env.VITE_PRODUCTION_API_URL;
    if (nasUrl) {
      logPass(`Local NAS Server URL: ${nasUrl}`);
    } else {
      warnings++;
      logWarn('NAS Server URL not configured', 'Set VITE_NAS_SERVER_URL in .env');
    }
    break;
  }
  case 'supabase':
  default: {
    const bucket = process.env.VITE_SUPABASE_BUCKET || 'MMS_PIC';
    logPass(`Supabase Storage Bucket: ${bucket}`);
    break;
  }
}

// Workstation Cloud CLI Tool Detection (for Station Agent direct sync acceleration)
if (storageProvider !== 'supabase' && storageProvider !== 'nas_local') {
  let cliFound = null;
  try {
    const rcloneVer = execSync('rclone --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).split('\n')[0].trim();
    cliFound = `rclone (${rcloneVer})`;
  } catch {
    try {
      const awsVer = execSync('aws --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).split('\n')[0].trim();
      cliFound = `aws CLI (${awsVer})`;
    } catch {
      // Neither found
    }
  }

  if (cliFound) {
    logPass(`Workstation Cloud CLI Detected: ${cliFound}`, 'Available for Station Agent direct upload sync');
  } else {
    warnings++;
    logWarn(`No CLI sync tool (rclone / aws) found in PATH for provider "${storageProvider}"`, 'Station Agent multi-cloud acceleration requires rclone or aws CLI installed on workstation.');
  }
}

// =========================================================================
// 5. Station Agent Connectivity (Optional Service)
// =========================================================================
logHeader('5. Local Station Agent (Edge Ingestion)');

const stationUrl = process.env.VITE_STATION_AGENT_URL || 'http://127.0.0.1:8765';
try {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1500);
  const resp = await fetch(`${stationUrl}/health`, { signal: controller.signal });
  clearTimeout(timeoutId);
  if (resp.ok) {
    logPass(`Station Agent active and responding at ${stationUrl}`);
  } else {
    logWarn(`Station Agent at ${stationUrl} returned HTTP ${resp.status}`);
  }
} catch {
  logWarn('Station Agent service is not running locally', 'Start via "python station-agent/app.py" when performing high-speed SD card field ingestion.');
}

// =========================================================================
// 6. Final Diagnostic Verdict
// =========================================================================
logHeader('Diagnostic Summary');

if (fatalFailures === 0 && warnings === 0) {
  console.log(`\n${colors.bold}${colors.green}✔ ALL CHECKS PASSED — GeoSphere 360 platform is 100% production ready!${colors.reset}\n`);
  process.exit(0);
} else if (fatalFailures === 0 && warnings > 0) {
  console.log(`\n${colors.bold}${colors.yellow}▲ SYSTEM OPERATIONAL with ${warnings} advisory warning(s). Review recommendations above.${colors.reset}\n`);
  process.exit(0);
} else {
  console.log(`\n${colors.bold}${colors.red}✖ FAILED: ${fatalFailures} critical issue(s) and ${warnings} warning(s) detected.${colors.reset}`);
  console.log(`${colors.bold}Please review the remediation guidance above before launching to production.${colors.reset}\n`);
  process.exit(1);
}
