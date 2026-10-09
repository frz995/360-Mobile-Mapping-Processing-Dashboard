#!/usr/bin/env node
/**
 * seed-admin — Automated first administrator provisioning script.
 *
 * GeoSphere 360 Mobile Mapping processing platform.
 *
 * Creates or elevates the initial Administrator account in both Supabase Auth
 * and public.user_accounts so that the new deployment is immediately operable.
 *
 * Usage:
 *   node scripts/seed-admin.mjs --email admin@example.com --password "SecurePass123!" --name "Lead Administrator"
 *   node scripts/seed-admin.mjs --help
 *
 * Environment variables (or loaded from .env / .env.production):
 *   SUPABASE_URL (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Helper: load simple .env key-value pairs without adding an external dependency */
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

// Load .env and .env.production as fallbacks
loadEnvFile(join(ROOT, '.env'));
loadEnvFile(join(ROOT, '.env.production'));

function printHelp() {
  console.log(`
GeoSphere 360 — Seed First Administrator

Usage:
  node scripts/seed-admin.mjs [options]

Options:
  --email <email>         Administrator email address (required or prompt)
  --password <password>   Administrator password (required or prompt)
  --name <name>           Display name (default: "System Administrator")
  --url <url>             Supabase project URL (defaults to SUPABASE_URL from env)
  --service-key <key>     Supabase service_role key (defaults to SUPABASE_SERVICE_ROLE_KEY)
  --help                  Show this help text

Examples:
  node scripts/seed-admin.mjs --email admin@domain.com --password "YourPass123!"
  node scripts/seed-admin.mjs
`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const getArg = (flag) => {
    const idx = argv.indexOf(flag);
    return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : null;
  };

  let email = getArg('--email') || process.env.SEED_ADMIN_EMAIL;
  let password = getArg('--password') || process.env.SEED_ADMIN_PASSWORD;
  const name = getArg('--name') || process.env.SEED_ADMIN_NAME || 'System Administrator';

  const supabaseUrl =
    getArg('--url') ||
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;

  const serviceRoleKey =
    getArg('--service-key') ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    console.error('Error: SUPABASE_URL is not set. Provide --url <url> or set SUPABASE_URL in .env');
    process.exit(1);
  }

  if (!serviceRoleKey) {
    console.error(
      'Error: SUPABASE_SERVICE_ROLE_KEY is not set.\n' +
        'Seeding an administrator requires the service_role key (from Supabase -> Project Settings -> API).\n' +
        'Provide --service-key <key> or set SUPABASE_SERVICE_ROLE_KEY in .env.'
    );
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (!email) {
      email = (await rl.question('Enter Administrator Email: ')).trim();
    }
    if (!password) {
      password = (await rl.question('Enter Administrator Password: ')).trim();
    }
  } finally {
    rl.close();
  }

  if (!email || !email.includes('@')) {
    console.error('Error: Valid email address is required.');
    process.exit(1);
  }

  if (!password || password.length < 6) {
    console.error('Error: Password must be at least 6 characters long.');
    process.exit(1);
  }

  console.log(`\nConnecting to Supabase at: ${supabaseUrl}`);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  console.log(`Checking existing account for: ${email}...`);
  const { data: userList, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error(`Failed to query users via Admin API: ${listError.message}`);
    process.exit(1);
  }

  const existingUser = userList.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );

  let userId;
  if (existingUser) {
    console.log(`Existing user found (UUID: ${existingUser.id}). Elevating to Administrator...`);
    const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(
      existingUser.id,
      {
        password,
        email_confirm: true,
        user_metadata: {
          ...existingUser.user_metadata,
          role: 'Administrator',
          full_name: name,
        },
        app_metadata: {
          ...existingUser.app_metadata,
          role: 'Administrator',
        },
      }
    );

    if (updateError) {
      console.error(`Failed to update auth user: ${updateError.message}`);
      process.exit(1);
    }
    userId = updated.user.id;
    console.log('✓ Auth user updated and role set to Administrator.');
  } else {
    console.log(`Creating new auth user for ${email}...`);
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role: 'Administrator',
        full_name: name,
      },
      app_metadata: {
        role: 'Administrator',
      },
    });

    if (createError) {
      console.error(`Failed to create auth user: ${createError.message}`);
      process.exit(1);
    }
    userId = created.user.id;
    console.log(`✓ Auth user created successfully (UUID: ${userId}).`);
  }

  console.log(`Upserting public.user_accounts record for ${email}...`);
  const { error: dirError } = await supabase.from('user_accounts').upsert(
    {
      email,
      name,
      role: 'Administrator',
      status: 'Active',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'email' }
  );

  if (dirError) {
    console.warn(
      `⚠️ Warning: Could not update public.user_accounts: ${dirError.message}\n` +
        'Ensure migration 0004 or 0035 has been applied.'
    );
  } else {
    console.log('✓ Directory row upserted in public.user_accounts (Role: Administrator, Status: Active).');
  }

  console.log(`
=====================================================================
🎉 SUCCESS! Administrator account is ready:
   Email:    ${email}
   Role:     Administrator
   Status:   Active
   User ID:  ${userId}

You can now sign in to the GeoSphere 360 Processing Dashboard!
=====================================================================
`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
