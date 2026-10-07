#!/usr/bin/env node
/**
 * bootstrap-migrations — install-safe migration runner.
 *
 * WHY THIS EXISTS
 *
 * `0004_rls_application_tables.sql:41` is its first executable statement:
 *
 *     ALTER TABLE public.panoramas ENABLE ROW LEVEL SECURITY;
 *
 * but `panoramas` is created by `0012_core_tables_and_rls.sql` — eight files
 * later. On a fresh database `0004` therefore aborts on statement one, and the
 * failure cascades: `0007` needs `deletion_requests` and `0010` / `0030` need
 * `user_accounts`, all of which `0004` is the file that creates them. `0030` is
 * the one that matters — it is what makes Disable revoke access.
 *
 * `0004` is deliberately NOT edited here. Guarding ~55 statements across three
 * historical migrations is a larger change than it looks, and rewriting them
 * would put existing installs at risk for no gain. This script neutralises the
 * defect for NEW installs and leaves every migration byte-identical.
 *
 * WHAT IT DOES DIFFERENTLY
 *
 * 0004's statements for `panoramas` and `staging_panoramas` are DROPPED, not
 * deferred and re-applied. This is the important part. `0012` does not recreate
 * what `0004` would have: it drops `0004`'s policy names and installs a
 * stricter role-guarded set
 *
 *     CREATE POLICY "panoramas_select" ON public.panoramas
 *       FOR SELECT USING (sec.can('viewAll'));
 *
 * Postgres OR's multiple PERMISSIVE policies for the same command. Re-applying
 * `0004`'s `"Allow public read on panoramas" USING (true)` after `0012` would
 * therefore make the table readable by anon users *in spite of* the role guard.
 * `0012`'s own sweep is the correct and stricter answer, so the `0004`
 * statements are skipped and recorded.
 *
 * The set of skipped statements is derived by analysis, not hardcoded: every
 * file is scanned for the relations it creates, then each statement is checked
 * against the relations that exist at its ordinal position.
 *
 * MODES
 *
 *   node scripts/bootstrap-migrations.mjs --emit
 *     Writes a single bootstrap.sql for the Supabase SQL Editor. No credentials
 *     needed, works on any host. This is the primary path.
 *
 *   DATABASE_URL=postgres://... node scripts/bootstrap-migrations.mjs
 *     Executes over `pg` if it is installed. Degrades with a clear message when
 *     it is not.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

/**
 * 0011_security_tests.sql is a verification script, not a migration: it asserts
 * on privilege boundaries and would fail on an empty database. Run it
 * separately, after the schema exists.
 */
const SKIP_FILES = new Set(['0011_security_tests.sql']);

/**
 * Supabase-owned relations that exist before any migration runs. These are not
 * order violations: a fresh project already has them.
 */
const EXTERNAL_RELATIONS = new Set([
  'auth.users',
  'auth.uid',
  'auth.role',
  'storage.buckets',
  'storage.objects',
  'storage.objects_acl',
  'storage.usage'
]);

// ---------------------------------------------------------------------------
// SQL lexing: split a file into statements without cutting inside a dollar
// quote, a quoted string, an identifier, or a comment.
// ---------------------------------------------------------------------------

/**
 * @param {string} sql
 * @returns {{ text: string, startLine: number, start: number, end: number }[]}
 */
export function splitStatements(sql) {
  const out = [];
  let buf = '';
  let line = 1;
  let startLine = 1;
  let startOffset = 0;
  let i = 0;
  let sawContent = false;

  const dollarTag = () => {
    const m = /^(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/.exec(sql.slice(i));
    return m ? m[1] : null;
  };

  while (i < sql.length) {
    const rest = sql.slice(i);

    if (rest.startsWith('--')) {
      const nl = sql.indexOf('\n', i);
      const end = nl === -1 ? sql.length : nl;
      if (sawContent) buf += rest.slice(0, end - i);
      i = end;
      continue;
    }

    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      const chunk = sql.slice(i, stop);
      if (sawContent) buf += chunk;
      line += (chunk.match(/\n/g) || []).length;
      i = stop;
      continue;
    }

    if (rest[0] === "'" || rest[0] === '"') {
      const quote = rest[0];
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\' && quote === "'") { j += 2; continue; }
        if (sql[j] === quote) {
          // Doubled quote is an escape, not a terminator.
          if (sql[j + 1] === quote) { j += 2; continue; }
          j += 1;
          break;
        }
        j += 1;
      }
      const chunk = sql.slice(i, j);
      if (sawContent) buf += chunk;
      line += (chunk.match(/\n/g) || []).length;
      i = j;
      continue;
    }

    const tag = dollarTag();
    if (tag) {
      const close = sql.indexOf(tag, i + tag.length);
      const stop = close === -1 ? sql.length : close + tag.length;
      const chunk = sql.slice(i, stop);
      if (sawContent) buf += chunk;
      line += (chunk.match(/\n/g) || []).length;
      i = stop;
      continue;
    }

    if (rest[0] === ';') {
      if (sawContent) {
        const end = i + 1;
        out.push({ text: buf.trim(), startLine, start: startOffset, end });
      }
      buf = '';
      sawContent = false;
      i += 1;
      continue;
    }

    if (!sawContent && !/\s/.test(rest[0])) {
      sawContent = true;
      startLine = line;
      startOffset = i;
    }
    buf += rest[0];
    if (rest[0] === '\n') line += 1;
    i += 1;
  }

  if (sawContent && buf.trim()) {
    out.push({ text: buf.trim(), startLine, start: startOffset, end: sql.length });
  }
  return out;
}

/**
 * Blank out string literals, quoted identifiers, dollar-quoted bodies and SQL
 * comments, preserving length and line structure so offsets still line up.
 *
 * Without this, relation detection matches prose inside literals: the policy
 * name `"Allow authenticated update on panoramas"` reads as an UPDATE of a
 * table called `on`. Masking first is what makes the regexes below trustworthy.
 *
 * Comments are masked for the same reason, and the cost of not doing so is
 * concrete rather than theoretical. A commented-out
 * `-- CREATE TABLE public.old_thing (id uuid);` would register `public.old_thing`
 * as a relation this set CREATES, and a later statement reaching for that name
 * would then be treated as in-order when it is not. That is precisely the
 * order defect this module exists to detect, hidden by a line of prose. No
 * migration in the set currently has such a line; the masking is here so the
 * guarantee survives the next one that does.
 */
export function maskLiterals(stmt) {
  let out = '';
  let i = 0;
  while (i < stmt.length) {
    const rest = stmt.slice(i);

    // `-- ...` to end of line.
    if (rest.startsWith('--')) {
      const nl = stmt.indexOf('\n', i);
      const stop = nl === -1 ? stmt.length : nl;
      out += stmt.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }

    // `/* ... */`, which may span lines.
    if (rest.startsWith('/*')) {
      const close = stmt.indexOf('*/', i + 2);
      const stop = close === -1 ? stmt.length : close + 2;
      out += stmt.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }

    if (rest[0] === "'" || rest[0] === '"') {
      const quote = rest[0];
      let j = i + 1;
      while (j < stmt.length) {
        if (stmt[j] === '\\' && quote === "'") { j += 2; continue; }
        if (stmt[j] === quote) {
          if (stmt[j + 1] === quote) { j += 2; continue; }
          j += 1;
          break;
        }
        j += 1;
      }
      const chunk = stmt.slice(i, j);
      out += chunk.replace(/[^\n]/g, ' ');
      i = j;
      continue;
    }

    const m = /^(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/.exec(rest);
    if (m) {
      const tag = m[1];
      const close = stmt.indexOf(tag, i + tag.length);
      const stop = close === -1 ? stmt.length : close + tag.length;
      const chunk = stmt.slice(i, stop);
      // The tag itself survives so a $view$ body is still masked.
      out += tag + chunk.slice(tag.length, close === -1 ? chunk.length : stop - i - tag.length)
        .replace(/[^\n]/g, ' ') + (close === -1 ? '' : tag);
      i = stop;
      continue;
    }

    out += rest[0];
    i += 1;
  }
  return out;
}

/** Normalise a relation name, refusing to guess a schema it does not carry. */
function normaliseRelation(raw) {
  const name = raw.replace(/(::[\w\s[\]]+)+$/, '').toLowerCase();
  if (!name || name.startsWith('$')) return null;
  if (name.includes('.')) return name;
  return `public.${name}`;
}

/**
 * Relations a statement reads or writes.
 *
 * Two cases need care beyond plain masking:
 *
 * 1. Policy statements. `CREATE POLICY "name" ON tbl` masks the quoted name to
 *    spaces, so the pattern must tolerate arbitrary filler between the verb and
 *    `ON` rather than requiring a name.
 *
 * 2. `DO $$ ... $$` blocks. These appear in two shapes here: bodies wrapped in
 *    `EXCEPTION WHEN OTHERS`, which swallow a missing-relation error and are
 *    therefore safe on a fresh database regardless of what they reference; and
 *    bare bodies, which will fail. The former are analysed as inert, the latter
 *    have their bodies unmasked and read normally.
 */
export function referencedRelations(stmt) {
  let sql = maskLiterals(stmt);
  let skipBody = false;

  const isDoBlock = /^\s*do\s+\$\$/i.test(sql.trim());
  if (isDoBlock) {
    const body = extractDollarBody(stmt);
    if (body && /\bexception\b/i.test(body)) {
      // Self-guarding: this block cannot fail on a missing relation.
      skipBody = true;
    } else if (body) {
      sql = maskLiterals(body);
    }
  }
  if (skipBody) sql = '';

  const found = new Set();
  // Case-insensitive throughout: every migration here mixes upper and lower
  // case inconsistently (0012 writes CREATE TABLE, 0006 writes
  // "create table if not exists").
  const patterns = [
    /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w.]+)/gi,
    /\bcreate\s+(?:unique\s+)?index(?:\s+concurrently)?\s+(?:if\s+not\s+exists\s+)?[\w"]+\s+on\s+([\w.]+)/gi,
    /\bcreate\s+policy\b[\s\S]*?\bon\s+(?:only\s+)?([\w.]+)/gi,
    /\bdrop\s+policy\b[\s\S]*?\bon\s+(?:only\s+)?([\w.]+)/gi,
    /\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+(?:only\s+)?([\w.]+)/gi,
    /\bselect\s+[\s\S]*?\bfrom\s+(?:only\s+)?([\w.]+)/gi,
    /\breferences\s+([\w.]+)/gi,
    /\bfrom\s+(?:only\s+)?([\w.]+)\s+(?:where|group|order|join|limit|offset|having|union|except|intersect|\)|;|$)/gi,
    /\bjoin\s+([\w.]+)\s+on\b/gi
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(sql)) !== null) {
      const name = normaliseRelation(m[1]);
      if (name) found.add(name);
    }
  }
  return found;
}

/** Inner text of the first dollar-quoted block, or '' when there is none. */
function extractDollarBody(stmt) {
  const open = stmt.indexOf('$$');
  if (open === -1) return '';
  const close = stmt.indexOf('$$', open + 2);
  return close === -1 ? '' : stmt.slice(open + 2, close);
}

/** Relations a statement brings into existence. */
export function createdRelations(stmt) {
  const sql = maskLiterals(stmt);
  const found = new Set();
  const re = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const name = normaliseRelation(m[1]);
    if (name) found.add(name);
  }
  return found;
}

/** Schemas this set of migrations brings into existence. */
function createdSchemas(stmt) {
  const sql = maskLiterals(stmt);
  const found = new Set();
  const re = /\bcreate\s+schema\s+(?:if\s+not\s+exists\s+)?([\w]+)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) found.add(m[1].toLowerCase());
  return found;
}

// ---------------------------------------------------------------------------
// Load and analyse
// ---------------------------------------------------------------------------

export function loadMigrations() {
  const names = readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith('.sql') && !SKIP_FILES.has(n))
    .sort((a, b) => a.localeCompare(b, 'en'));

  return names.map((name) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    return {
      name,
      prefix: name.slice(0, 4),
      sql,
      statements: splitStatements(sql).map((s) => ({
        ...s,
        creates: createdRelations(s.text),
        references: referencedRelations(s.text)
      }))
    };
  });
}

/**
 * Walk the ordered migrations, tracking which relations exist at each point,
 * and flag statements that can only run AFTER a later file.
 *
 * A statement is order-invalid only when the relation it touches is created by a
 * LATER file in this same set. That condition is what distinguishes the real
 * defect (0004 reaching for a table 0012 creates) from a relation that simply
 * belongs to the platform — `auth.users`, `storage.objects`,
 * `information_schema.columns` — which are never created by any migration and
 * must therefore be left alone.
 */
export function analyse(migrations) {
  const createdAnywhere = new Set();
  for (const m of migrations) {
    for (const s of m.statements) for (const r of s.creates) createdAnywhere.add(r);
  }

  const existing = new Set();
  const files = [];
  const skipped = [];

  for (const m of migrations) {
    let applied = 0;
    let deferred = 0;

    for (const s of m.statements) {
      // A statement may depend on its own file's earlier statements.
      for (const r of s.creates) existing.add(r);

      const notYet = [...s.references].filter(
        (r) => !existing.has(r) && !EXTERNAL_RELATIONS.has(r) && createdAnywhere.has(r)
      );

      if (notYet.length > 0) {
        deferred += 1;
        skipped.push({
          file: m.name,
          line: s.startLine,
          relations: notYet,
          text: s.text,
          start: s.start,
          end: s.end
        });
        continue;
      }

      applied += 1;
    }

    files.push({ name: m.name, prefix: m.prefix, total: m.statements.length, applied, deferred });
  }

  return { files, skipped };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const HEAD = `-- =====================================================================
-- GeoSphere 360 — bootstrap schema
--
-- GENERATED FILE. Do not edit; regenerate with:
--     node scripts/bootstrap-migrations.mjs --emit
--
-- Apply this whole file ONCE in the Supabase SQL Editor of a FRESH project,
-- with PostGIS enabled first (see docs/Production Setup/01-Infrastructure.md
-- section 3.2).
--
-- Why this file exists: 0004's first statement enables RLS on public.panoramas,
-- which is not created until 0012. On a fresh database 0004 aborts there, and
-- with it goes 0007's deletion_requests indexes, 0010 and 0030's user_accounts
-- policies, and therefore Disable-revokes-access. Statements like that are
-- REMOVED from this file rather than reordered. 0012 installs its own, stricter
-- role-guarded policies for those tables, so nothing is lost by dropping them.
--
-- 0011_security_tests.sql is excluded: it is a privilege-assertion script, not
-- a schema change. Run it separately after this file, as verification.
-- =====================================================================

`;

const FOOTER = `
-- =====================================================================
-- POST-APPLY VERIFICATION
--
-- Every block below should return zero rows or a 'true'. Anything else means
-- the apply did not finish, and the application will misbehave silently.
-- =====================================================================

-- 1. Tier 1: no table may have RLS enabled with no policy (deny-all traps).
SELECT c.relname AS rls_enabled_without_policy
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind = 'r'
   AND c.relrowsecurity
   AND NOT EXISTS (
         SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
       )
 ORDER BY 1;

-- 2. 0032 applied: qa_defects carries run_id. Without it every survey run
--    silently reports 0 defects.
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'qa_defects'
   AND column_name = 'run_id';

-- 3. 0033 applied: qa_defects carries item_key, NOT NULL. Without it every
--    QA/QC write is rejected and results vanish on refresh.
SELECT column_name, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'qa_defects'
   AND column_name = 'item_key';

-- 4. 0032 applied: the run-scoped unique key exists.
SELECT conname
  FROM pg_constraint
 WHERE conname = 'qa_defects_project_subgrid_run_point_unique';

-- 5. 0030 applied: the role resolver exists, so Disable revokes access.
SELECT to_regprocedure('sec.get_app_role()') IS NOT NULL AS role_resolver_present;

-- 6. Containerised PostgREST caches its schema; without this a freshly added
--    column reads as missing until the container restarts. Harmless on hosted
--    Supabase, which ignores it.
NOTIFY pgrst, 'reload schema';
`;

/**
 * Emit one migration VERBATIM, minus the excised statements.
 *
 * The migrations carry long WHY comments that are the only record of why each
 * file exists. Re-serialising parsed statements would strip them and make the
 * generated file unauditable against its source, so instead the original bytes
 * are cut with the removed statements' exact offsets. Everything else — every
 * comment, every blank line — survives byte-for-byte.
 */
function renderMigration(m, dropped) {
  let sql = m.sql;
  for (const d of [...dropped].sort((a, b) => b.start - a.start)) {
    // Swallow the trailing newline too, so the excision leaves no blank seam.
    let end = d.end;
    if (sql[end] === '\r') end += 1;
    if (sql[end] === '\n') end += 1;
    sql = sql.slice(0, d.start) + sql.slice(end);
  }
  return sql;
}

function render(files, skipped, outPath) {
  const parts = [HEAD];

  parts.push(`-- ---------------------------------------------------------------------
-- ORDER-INVALID STATEMENTS REMOVED (${skipped.length})
--
-- Each of these touches a relation that no migration creates before it reaches
-- this position. They are REMOVED, not deferred: the later migration installs
-- stricter, role-guarded policies for the same tables, and Postgres OR's
-- multiple permissive policies, so re-applying the early ones would widen
-- access rather than restore it. Everything else is reproduced verbatim.
-- ---------------------------------------------------------------------
`);
  if (skipped.length === 0) {
    parts.push('-- none\n');
  } else {
    const byFile = new Map();
    for (const s of skipped) {
      if (!byFile.has(s.file)) byFile.set(s.file, []);
      byFile.get(s.file).push(s);
    }
    for (const [file, items] of byFile) {
      parts.push(`-- ${file} — ${items.length} statement(s)\n`);
      for (const s of items) {
        parts.push(
          `--   line ${s.line}: ${s.relations.join(', ')}\n` +
            `--     ${s.text.replace(/\s+/g, ' ').slice(0, 160)}\n`
        );
      }
    }
  }

  parts.push(`\n-- =====================================================================\n`);
  parts.push(`-- MIGRATIONS, VERBATIM AND IN ORDER (0011 excluded)\n`);
  parts.push(`-- =====================================================================\n`);

  const byName = new Map(loadMigrations().map((m) => [m.name, m]));
  for (const f of files) {
    const m = byName.get(f.name);
    const dropped = skipped.filter((s) => s.file === f.name);
    parts.push(`\n-- ####################################################################\n`);
    parts.push(`-- ${f.name}${dropped.length ? `  (${dropped.length} statement(s) removed — see above)` : ''}\n`);
    parts.push(`-- ####################################################################\n`);
    parts.push(renderMigration(m, dropped));
  }

  parts.push(FOOTER);

  const body = parts.join('');
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, body, 'utf8');
  }
  return body;
}

function printSummary(files, skipped, outPath) {
  const pad = (v, n) => String(v).padEnd(n);
  console.log('');
  console.log(`  ${pad('file', 44)}${pad('stmts', 7)}${pad('applied', 9)}removed`);
  console.log(`  ${'-'.repeat(69)}`);
  for (const f of files) {
    console.log(`  ${pad(f.name, 44)}${pad(f.total, 7)}${pad(f.applied, 9)}${f.deferred}`);
  }
  console.log(`  ${'-'.repeat(69)}`);
  console.log(
    `  ${pad(`${files.length} migrations, 0011 excluded`, 44)}${pad(
      files.reduce((n, f) => n + f.total, 0), 7
    )}${pad(files.reduce((n, f) => n + f.applied, 0), 9)}${skipped.length}`
  );
  console.log('');
  if (skipped.length > 0) {
    console.log('  Order-invalid statements removed (created by a later migration):');
    for (const s of skipped) {
      console.log(`    ${s.file}:${s.line}  -> ${s.relations.join(', ')}`);
    }
    console.log('');
    console.log('  These are dropped, not deferred: 0012 installs stricter role-guarded');
    console.log('  policies for the same tables, and Postgres ORs permissive policies, so');
    console.log('  re-applying 0004 here would make panoramas readable by anon users.');
    console.log('');
  }
  if (outPath) {
    console.log(`  written: ${outPath}`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function defaultOutPath() {
  const arg = process.argv.indexOf('--out');
  if (arg !== -1 && process.argv[arg + 1]) return resolve(process.argv[arg + 1]);
  return join(ROOT, 'supabase', 'bootstrap.sql');
}

async function main() {
  if (!existsSync(MIGRATIONS_DIR)) {
    console.error(`migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  const migrations = loadMigrations();
  const { files, skipped } = analyse(migrations);
  const emit = process.argv.includes('--emit');

  if (emit) {
    const outPath = defaultOutPath();
    render(files, skipped, outPath);
    printSummary(files, skipped, outPath);
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error(
      'No DATABASE_URL set.\n\n' +
        '  This script has two modes:\n' +
        '    node scripts/bootstrap-migrations.mjs --emit          (no credentials needed)\n' +
        '    DATABASE_URL=postgres://... node scripts/bootstrap-migrations.mjs\n\n' +
        'The Supabase SQL Editor cannot run Node, so --emit is the normal path:\n' +
        'it writes a single bootstrap.sql to paste into the editor.'
    );
    process.exit(1);
  }

  let pg;
  try {
    // Loaded through createRequire rather than a bare `import('pg')`. `pg` is
    // deliberately NOT a project dependency — the SQL Editor path needs no
    // credentials and no install, which is what makes self-installing work — so
    // a static specifier makes every bundler that analyses this file fail to
    // load it at all, including Vitest via
    // src/__tests__/bootstrap-migrations.test.ts. createRequire is a Node API
    // and is resolved at run time, so an absent `pg` throws here and is handled
    // by the catch below rather than at module load.
    const require = createRequire(import.meta.url);
    pg = require('pg');
  } catch {
    console.error(
      'Direct mode needs the `pg` package, which is not installed.\n\n' +
        'Either:\n' +
        '  npm install pg          (then re-run), or\n' +
        '  node scripts/bootstrap-migrations.mjs --emit   and paste into the SQL Editor\n\n' +
        '`pg` is deliberately not a project dependency — the SQL Editor path needs\n' +
        'no credentials and no install, which is what a self-installing reseller has.'
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const results = [];
  let dropped = 0;
  try {
    for (const m of migrations) {
      const skipLines = new Set(skipped.filter((s) => s.file === m.name).map((s) => s.line));
      let ok = 0;
      let failed = 0;
      for (const s of m.statements) {
        if (skipLines.has(s.startLine)) { dropped += 1; continue; }
        try {
          // Executed verbatim, not re-serialised: comments are inert to the
          // server and keeping them makes a failure line up with its source.
          await client.query(s.text);
          ok += 1;
        } catch (err) {
          failed += 1;
          console.error(`  FAIL ${m.name}:${s.startLine}  ${err.message}`);
        }
      }
      results.push({ name: m.name, total: m.statements.length, applied: ok, failed });
    }
    await client.query("NOTIFY pgrst, 'reload schema';");
  } finally {
    await client.end();
  }

  printSummary(
    results.map((r) => ({ ...r, deferred: r.failed })),
    skipped,
    null
  );

  const failures = results.reduce((n, r) => n + r.failed, 0);
  console.log(`  dropped (order-invalid): ${dropped}`);
  if (failures > 0) {
    console.error(`\n  ${failures} statement(s) failed. The schema is incomplete.`);
    process.exit(1);
  }
  console.log('\n  All migrations applied. Run the verification queries at the end of bootstrap.sql.');
}

// Only run when invoked directly, so the lexers above stay importable by tests.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}