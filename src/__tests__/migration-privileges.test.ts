import { describe, it, expect } from 'vitest'
import { loadMigrations } from '../../scripts/bootstrap-migrations.mjs'

/**
 * Every application table must be reachable by `authenticated`.
 *
 * WHY THIS FILE EXISTS
 *
 * Three tables created by migrations 0023, 0026 and 0034 shipped with NO
 * `authenticated` grant. They installed cleanly, their RLS policies were
 * correct, and every table looked present. But every application read and write
 * failed with:
 *
 *   ERROR:  permission denied for table survey_metadata_filenames
 *
 * It stayed invisible because RLS POLICIES FILTER ROWS, THEY DO NOT GRANT
 * ACCESS, so a correct policy made the table look wired up. The callers then
 * swallowed the failure: the integrity panel reported "not captured at import"
 * for every run forever, and `hub_session_state` / `station_board_items` quietly
 * served a `localStorage` mirror.
 *
 * Nothing in CI checked for this, and no unit test could have: it is a
 * whole-database invariant rather than a local one. This file is that check.
 *
 * WHY THE 0022 BOUNDARY
 *
 * The working tables (`qa_defects`, `staging_panoramas`, `audit_logs`,
 * `project_settings`, `user_accounts`, `file_inventory`) carry the full Supabase
 * bootstrap grant set and no migration ever granted them one: they inherited
 * privileges from the database's initial state. Tables created by later,
 * hand-applied migrations fall outside that, which is exactly where all three
 * omissions sit. So the boundary marks where hand-applied table creation begins,
 * and the rule from there on is: if a migration creates a table in `public`,
 * some migration must grant it to `authenticated`.
 */

const migrations = loadMigrations()

/**
 * Executable SQL only, with comments removed.
 *
 * 0035's header deliberately NAMES the things it does not do, because a
 * migration whose job is to explain a defect should say so. Scanning the raw
 * text therefore matches the documentation and fails every negative assertion.
 * Stripping comments first makes these assertions about statements.
 */
function codeOf(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

/** 0035's executable SQL, failing loudly if the migration went missing. */
function m0035Code(): string {
  const m = migrations.find((x) => x.name.startsWith('0035'))
  if (!m) throw new Error('migration 0035 is missing')
  return codeOf(m.sql)
}

/** `public.foo` as normalised by the loader's `normaliseRelation`. */
function createdTables(): Map<string, string> {
  const created = new Map<string, string>()
  for (const m of migrations) {
    for (const stmt of m.statements) {
      for (const rel of stmt.creates) {
        // First creator wins: a later `create table if not exists` against an
        // existing table is a no-op, not a redefinition.
        if (!created.has(rel)) created.set(rel, m.prefix)
      }
    }
  }
  return created
}

/**
 * Tables some migration grants to `authenticated`.
 *
 * Matched on raw SQL rather than parsed statements because the useful signal is
 * simply "does `grant ... on table public.X ... authenticated` appear", and
 * multi-target grants (`to authenticated, service_role`) are handled by
 * requiring `authenticated` in the target list.
 */
function grantedTables(): Set<string> {
  const granted = new Set<string>()
  const re = /grant\s+[^;]*?\bon\s+(?:table\s+)?(public\.)?(\w+)\s+to\s+([^;]+);/gi
  for (const m of migrations) {
    let match: RegExpExecArray | null
    while ((match = re.exec(codeOf(m.sql))) !== null) {
      if (!/\bauthenticated\b/i.test(match[3] ?? '')) continue
      granted.add(`public.${(match[2] ?? '').toLowerCase()}`)
    }
  }
  return granted
}

/** Hand-applied table creation starts here; earlier tables are bootstrap-granted. */
const FIRST_HAND_APPLIED_PREFIX = '0022'

describe('every application table is reachable by authenticated', () => {
  const created = createdTables()
  const granted = grantedTables()

  it('finds the tables migrations create', () => {
    // A silent zero here would make the assertion below vacuously pass, which
    // is the failure mode this file most needs to avoid.
    expect(created.size).toBeGreaterThan(10)
    expect(granted.size).toBeGreaterThan(0)
    expect(created.has('public.survey_metadata_filenames')).toBe(true)
  })

  it('grants every table created from 0022 onward', () => {
    const uncovered: string[] = []
    for (const [table, prefix] of created) {
      if (prefix < FIRST_HAND_APPLIED_PREFIX) continue
      if (!granted.has(table)) uncovered.push(`${table} (created by ${prefix})`)
    }
    // Named per table rather than as a count, so a regression produces a message
    // a reader can act on.
    expect(uncovered).toEqual([])
  })

  it('keeps the metadata evidence append-only', () => {
    // The Duplicate check measures how often a filename was recorded. Granting
    // UPDATE or DELETE would let an operator erase the evidence it reads, so the
    // privilege set here is deliberately narrower than every other table's.
    const grant =
      m0035Code().match(
        /grant\s+[^;]*?\bon\s+table\s+public\.survey_metadata_filenames\s+to[^;]+;/i
      ) ?? []

    expect(grant.length).toBe(1)
    expect(grant[0]).toMatch(/select/i)
    expect(grant[0]).toMatch(/insert/i)
    expect(grant[0]).not.toMatch(/\bupdate\b/i)
    expect(grant[0]).not.toMatch(/\bdelete\b/i)
    expect(grant[0]).not.toMatch(/\ball\b/i)
  })

  it('repairs the metadata insert policy onto a capability sec.can grants', () => {
    // 0034 gated INSERT on `sec.can('editData')`, a capability that exists in
    // neither src/lib/authz.ts nor sec.can's SQL CASE. Measured against the
    // live database:
    //
    //   Survey Operator -> sec.can('editData')   = false
    //   Survey Operator -> sec.can('deleteData') = true
    //
    // so the grant alone would still have left operators unable to capture
    // anything. `deleteData` is the only data-mutating capability sec.can
    // grants an operator.
    const sql = m0035Code()

    expect(sql).toMatch(/drop\s+policy\s+if\s+exists\s+survey_metadata_filenames_insert/i)
    expect(sql).toMatch(/sec\.can\('deleteData'\)/)
    expect(sql).not.toMatch(/sec\.can\('editData'\)/)
  })

  it('leaves the metadata read policy alone', () => {
    // `sec.can('viewAll') or project_id = auth.uid()` is correct; replacing it
    // would be a silent loosening.
    expect(m0035Code()).not.toMatch(
      /drop\s+policy\s+if\s+exists\s+survey_metadata_filenames_select/i
    )
  })

  it('does not restate the recycle bin policy', () => {
    // 0031 already owns survey_recycle_bin. Two migrations granting the same
    // thing is how they drift, so 0035 must not duplicate it.
    expect(m0035Code()).not.toMatch(/survey_recycle_bin/i)
  })

  it('does not add blanket default privileges', () => {
    // `ALTER DEFAULT PRIVILEGES ... TO authenticated` would apply to every
    // future table, so a migration that forgot `enable row level security`
    // would be auto-exposed to all authenticated users. survey_recycle_bin was
    // already missing RLS, so that is a live hazard rather than a hypothetical.
    expect(m0035Code()).not.toMatch(/alter\s+default\s+privileges/i)
  })

  it('checks for missing grants so the class stays visible', () => {
    // The 0035 sweep is the runtime counterpart to this file: it raises a notice
    // on a live database, this asserts the intent in CI.
    const sql = m0035Code()
    expect(sql).toMatch(/missing authenticated grant/i)
    expect(sql).toMatch(/rls not enabled/i)
  })
})