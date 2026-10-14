#!/usr/bin/env node
/**
 * Apply the migration bundle to a throwaway Postgres and run the cross-tenant
 * security gate.
 *
 * WHY THIS IS A SCRIPT AND NOT A CI STEP
 *   The gate in `supabase/migrations/0011_security_tests.sql` is the only
 *   executable proof that the tenant boundary holds. Every other test in this
 *   repository mocks Supabase, which is precisely why a policy that could not
 *   execute (0036), a nullable column whose NULL meant world-readable, two
 *   unwired role vocabularies, four `USING (true)` anon grants, and a
 *   SECURITY DEFINER RPC any Viewer could call all shipped green.
 *
 *   It ran by hand for a long time, which means it only ran when someone
 *   remembered. This makes it a command, so CI can run it on every push.
 *
 * WHAT IT PROVES BEYOND THE GATE
 *   That `supabase/bootstrap.sql` — the file the contract lists as the buyer's
 *   turnkey deliverable, and which is gitignored and therefore generated — can
 *   actually be applied by a stranger with no other context. It did not, before
 *   this existed: migration 0033 aborted the bundle halfway through.
 *
 * USAGE
 *   node scripts/run-db-gate.mjs            # boot a container, run, tear down
 *   KEEP_DB=1 node scripts/run-db-gate.mjs  # leave it up to poke at
 *   DB_URL=postgres://... node scripts/run-db-gate.mjs   # use an existing server
 *
 * EXIT CODES
 *   0  bundle applied and every gate passed
 *   1  the bundle or a gate failed
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not `new URL('..', import.meta.url).pathname`: the latter is
// percent-encoded, and this repo path contains a space, which psql then cannot
// open.
const REPO = fileURLToPath(new URL('..', import.meta.url));
const CONTAINER = 'geosphere-db-gate';
const IMAGE = 'supabase/postgres:17.6.1.136';

const STUB = join(REPO, 'supabase', 'tests', 'local_supabase_stub.sql');
const GATE = join(REPO, 'supabase', 'migrations', '0011_security_tests.sql');
const BUNDLE = join(REPO, 'supabase', 'bootstrap.sql');

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...opts });

function fail(message, detail) {
  console.error(`\n  DB GATE FAILED: ${message}\n`);
  if (detail) console.error(detail.split('\n').map((l) => `    ${l}`).join('\n'));
  console.error('');
  process.exit(1);
}

function hasDocker() {
  return run('docker', ['info']).status === 0;
}

/**
 * Run a SQL file inside the container.
 *
 * The file is copied in first: `docker exec` runs in the container's own
 * filesystem, so a host path — even a correct one — is not visible to it.
 */
function psqlInContainer(hostPath, label) {
  const inContainer = `/tmp/${label}.sql`;
  const copy = run('docker', ['cp', hostPath, `${CONTAINER}:${inContainer}`]);
  if (copy.status !== 0) fail(`could not copy ${label} into the container`, copy.stderr);

  return run('docker', [
    'exec', '-i', CONTAINER,
    'psql', '-U', 'supabase_admin', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1',
    '-f', inContainer
  ]);
}

// ---------------------------------------------------------------------------

let dbUrl = process.env.DB_URL;
let started = false;

if (!dbUrl) {
  if (!hasDocker()) {
    fail(
      'Docker is not available and DB_URL was not set.',
      'Start Docker, or point DB_URL at a Postgres you are willing to have modified.'
    );
  }

  run('docker', ['rm', '-f', CONTAINER]);
  // No published port: every psql call goes through `docker exec`, so binding
  // a host port would only create a way for this job to fail on an unrelated
  // conflict with whatever else is running locally.
  const boot = run('docker', [
    'run', '-d', '--name', CONTAINER,
    '-e', 'POSTGRES_PASSWORD=gatepass',
    '-e', 'POSTGRES_DB=postgres',
    IMAGE
  ]);
  if (boot.status !== 0) fail('could not start the Postgres container', boot.stderr);
  started = true;
  console.log(`  booted ${IMAGE} as "${CONTAINER}"`);

  // The base image needs a moment before it accepts connections.
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    const ping = run('docker', ['exec', CONTAINER, 'pg_isready', '-U', 'postgres']);
    ready = ping.status === 0;
    if (!ready) spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
  }
  if (!ready) fail('the Postgres container never became ready');
}

const psqlTo = (file, label) => (dbUrl ? psqlUrl(file, label) : psqlInContainer(file, label));

function psqlUrl(file) {
  // External server: no container to copy into, so psql reads the host path.
  const res = run('psql', ['-v', 'ON_ERROR_STOP=1', '-f', file, dbUrl]);
  if (res.status !== 0) fail(`psql failed on ${file}`, res.stderr);
  return res;
}

function step(label, result) {
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  const notices = out
    .split('\n')
    .filter((l) => /^(NOTICE|WARNING)/.test(l))
    .map((l) => l.replace(/^psql[^ ]* /, ''));
  for (const n of notices) console.log(`    ${n}`);
  if (result.status !== 0) fail(`${label} failed`, out);
  console.log(`    ok — ${label}`);
}

try {
  console.log('\n  GeoSphere 360 — cross-tenant security gate\n');

  // 0. Neutralise the base image's service event triggers BEFORE anything else.
  //
  //    `supabase/postgres` installs six event triggers for services this schema
  //    does not use — pgrst, pg_cron, pg_net and GraphQL. Two of them are broken
  //    in the bare image: `issue_graphql_placeholder` (sql_drop) and
  //    `issue_pg_graphql_access` (ddl_command_end) both reach into an EMPTY
  //    `graphql` schema, so the first DROP or CREATE in the bundle aborts with
  //    "could not open relation with OID ...".
  //
  //    `pgrst_ddl_watch` is the third one, and this loop used to EXCLUDE it
  //    (`evtname NOT LIKE 'pgrst%'`). It fails the same way — it resolves a
  //    relation that does not exist in the bare image — which made the gate fail
  //    non-deterministically at a random line of the bundle. Every run I saw
  //    before 2026-10-14 died at a different offset, which is the signature of
  //    an event trigger rather than of a migration. Confirmed by running the
  //    gate with all six disabled: the full 0001-0044 bundle then applies and
  //    every assertion passes.
  //
  //    Disabling them is safe: nothing in this container listens on the pgrst
  //    channel, so the NOTIFY statements at the end of each migration go to a
  //    channel with no subscriber. The gate is testing tenant isolation, not
  //    PostgREST's schema cache.
  //
  //    It has to be a standalone statement: issuing the ALTER from inside a SQL
  //    file trips the same broken dependency it is meant to avoid.
  //
  //    pg_isready reports ready before the image's init script has finished
  //    creating its triggers, so this retries rather than assuming.
  if (!dbUrl) {
    // `armed` is the live count of enabled triggers; the loop finishes when it
    // reaches zero. Counting successful ALTERs instead would read as a failure
    // on the success path, because the loop exits before the last increment.
    let armed = -1;
    for (let attempt = 0; attempt < 30 && armed !== 0; attempt++) {
      const res = run('docker', [
        'exec', CONTAINER, 'psql', '-U', 'supabase_admin', '-d', 'postgres',
        '-tAq', '-c',
        "SELECT count(*) FROM pg_event_trigger WHERE evtenabled <> 'D';"
      ]);
      armed = Number((res.stdout || '').trim() || -1);
      if (res.status === 0 && armed === 0) break;
      run('docker', [
        'exec', CONTAINER, 'psql', '-U', 'supabase_admin', '-d', 'postgres',
        '-tAq', '-c',
        "DO $$ DECLARE r record; BEGIN FOR r IN SELECT evtname FROM pg_event_trigger WHERE evtenabled <> 'D' LOOP EXECUTE 'ALTER EVENT TRIGGER ' || quote_ident(r.evtname) || ' DISABLE'; END LOOP; END $$;"
      ]);
      if (armed > 0) spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1500)']);
    }

    if (armed !== 0) {
      fail(
        `could not neutralise the base image event triggers (${armed} still armed); ` +
          'the bundle would abort on a broken service dependency'
      );
    }
  }

  // 1. Storage/Auth scaffolding the bare image lacks. NOT product schema.
  step('apply local Supabase scaffolding', psqlTo(STUB, 'stub'));

  // 2. Regenerate the bundle rather than trusting a checked-in copy. It is
  //    gitignored, so this is also a check that the generator works.
  console.log('    regenerating supabase/bootstrap.sql …');
  const gen = run(process.execPath, [join(REPO, 'scripts', 'bootstrap-migrations.mjs'), '--emit'], {
    cwd: REPO
  });
  if (gen.status !== 0) fail('could not regenerate bootstrap.sql', gen.stderr);

  const tmp = join(mkdtempSync(join(tmpdir(), 'geosphere-db-')), 'bundle.sql');
  writeFileSync(tmp, readFileSync(BUNDLE, 'utf8'));
  step('apply the full migration bundle (0001-0044)', psqlTo(tmp, 'bundle'));

  // 3. auth.jwt() again: the scaffolding must be present BEFORE the migrations
  //    that reference it in policy bodies, but the bundle also creates objects
  //    that re-check grants, so applying it twice is the documented order.
  step('re-apply scaffolding (auth.jwt resolution)', psqlTo(STUB, 'stub2'));

  // 4. The gate itself.
  step('run the cross-tenant gate', psqlTo(GATE, 'gate'));

  rmSync(tmp, { force: true, recursive: true });

  console.log('\n  DB GATE PASSED — bundle applies cleanly and every tenant boundary holds.\n');
} catch (err) {
  fail(err?.message || String(err));
} finally {
  if (started && !process.env.KEEP_DB) run('docker', ['rm', '-f', CONTAINER]);
  else if (started) console.log(`  left "${CONTAINER}" running (KEEP_DB=1)\n`);
}