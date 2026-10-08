import { describe, it, expect } from 'vitest'
import {
  loadMigrations,
  analyse,
  splitStatements,
  maskLiterals,
  referencedRelations,
  createdRelations
} from '../../scripts/bootstrap-migrations.mjs'

/**
 * Guards the install-time bootstrap generator.
 *
 * `scripts/bootstrap-migrations.mjs` builds `supabase/bootstrap.sql` by
 * concatenating migrations and excising the statements that cannot run yet. Its
 * output is what a client applies to a fresh database, and a mistake in it is a
 * schema that installs incompletely — which is exactly what happened before:
 * 0004's first statement enabled RLS on public.panoramas, a table 0012 creates,
 * so the file aborted there and took 0007, 0010 and 0030's policies with it.
 *
 * That defect shipped and was only found by reading 33 files by hand. These
 * tests exist so the next ordering defect is caught automatically.
 *
 * Placed under `src/` rather than `scripts/` because vitest's `include` is
 * `src/**` — one test root beats a second include pattern to argue about.
 */

const migrations = loadMigrations()
const report = analyse(migrations)

describe('migration files load and parse', () => {
  it('loads every migration except the security test script', () => {
    // 35 files on disk, 0011 excluded because it asserts on a schema that does
    // not exist yet and is run separately after install.
    //
    // The count is an assertion, not a snapshot: adding a migration surfaces
    // here as a one-line diff rather than as a silently unvalidated install.
    // v27 section 3 updated this from 32 to 33 for migration 0034; 0035 makes 34.
    expect(migrations).toHaveLength(34)
    expect(migrations.some((m) => m.name.startsWith('0011'))).toBe(false)
  })

  it('includes the metadata filename table from 0034', () => {
    // Asserted by name so that dropping or renaming the migration fails loudly
    // rather than leaving the panel with three permanently "not captured at
    // import" rows.
    const m0034 = migrations.find((x) => x.name.startsWith('0034'))
    expect(m0034).toBeDefined()
    const creates = new Set(m0034!.statements.flatMap((s) => [...s.creates]))
    expect(creates).toContain('public.survey_metadata_filenames')
  })

  it('includes the privilege repair from 0035', () => {
    const m0035 = migrations.find((x) => x.name.startsWith('0035'))
    expect(m0035).toBeDefined()
  })

  it('loads them in filename order', () => {
    // Order is the entire mechanism: the generator's correctness depends on
    // prefix order, not on directory enumeration order.
    const names = migrations.map((m) => m.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')))
  })

  it('parses at least one statement from every migration', () => {
    // A file that yields zero statements is either empty or entirely
    // mis-parsed, and would silently vanish from bootstrap.sql.
    const unparsed = migrations.filter((m) => m.statements.length === 0)
    expect(unparsed.map((m) => m.name)).toEqual([])
  })

  it('drops no statement when a file ends in a comment', () => {
    // The lexer only emits a statement when it saw content, so trailing
    // comment blocks must not swallow the last real statement. 0001 ends with a
    // commented-out teardown section; its final CREATE must still be parsed.
    const m = migrations.find((x) => x.name.startsWith('0001'))!
    const lastStatement = m.statements[m.statements.length - 1]
    // The trailing comment is ~600 chars past where the last statement ends.
    expect(lastStatement.end).toBeLessThan(m.sql.length - 100)
    expect(lastStatement.text).not.toContain('--')
  })

  it('emits statements in non-decreasing, non-overlapping start order', () => {
    // Offsets drive the generator's splice, so a lexer returning them out of
    // order would excise the wrong bytes while every per-statement assertion
    // still passed.
    for (const m of migrations) {
      for (let i = 1; i < m.statements.length; i++) {
        expect(m.statements[i].start, `${m.name} order at ${i}`).toBeGreaterThan(
          m.statements[i - 1].start
        )
      }
    }
  })
})

describe('statement splitting', () => {
  it('does not split inside a dollar-quoted function body', () => {
    // The reason this module exists. A naive split on `;` cuts every
    // CREATE FUNCTION in half, and a migration set full of them would produce a
    // bootstrap.sql that cannot run at all.
    const sql = `CREATE FUNCTION f() RETURNS int AS $$
    BEGIN
      RETURN 1;
    END;
  $$ LANGUAGE plpgsql;`
    const statements = splitStatements(sql)
    expect(statements).toHaveLength(1)
    expect(statements[0].text).toContain('RETURN 1;')
  })

  it('does not split inside a string literal', () => {
    const sql = `INSERT INTO t (v) VALUES ('a; b; c');`
    expect(splitStatements(sql)).toHaveLength(1)
  })

  it('does not split inside a line comment', () => {
    const sql = `-- a comment; with a semicolon\nSELECT 1;\nSELECT 2;`
    expect(splitStatements(sql)).toHaveLength(2)
  })

  it('tracks the starting line of each statement', () => {
    // The generator reports skip locations by line, so a lexer that lost line
    // tracking would make its own diagnostics point at the wrong place.
    const statements = splitStatements('SELECT 1;\n\nSELECT 2;')
    expect(statements[0].startLine).toBe(1)
    expect(statements[1].startLine).toBe(3)
  })

  it('is not confused by a dollar tag that is not $$, e.g. $function$', () => {
    const sql = `CREATE FUNCTION g() RETURNS int AS $function$
    BEGIN RETURN 2; END;
  $function$ LANGUAGE plpgsql;`
    expect(splitStatements(sql)).toHaveLength(1)
  })
})

describe('literal masking', () => {
  it('neutralises a semicolon inside a literal so parsing cannot split there', () => {
    // maskLiterals is what lets the relation scanners ignore table names that
    // appear inside a string, e.g. an error message or a comment-as-data.
    const masked = maskLiterals("SELECT 'DROP TABLE x; --' FROM t")
    expect(masked).not.toContain(';')
  })

  it('leaves identifiers intact', () => {
    expect(maskLiterals('SELECT defect_count FROM qa_defects')).toBe(
      'SELECT defect_count FROM qa_defects'
    )
  })

  it('neutralises dollar-quoted bodies entirely', () => {
    const masked = maskLiterals('CREATE FUNCTION f() AS $$ SELECT 1; $$ LANGUAGE plpgsql')
    expect(masked).not.toContain('SELECT 1')
  })
})

describe('relation extraction', () => {
  it('finds a created relation', () => {
    const created = createdRelations('CREATE TABLE public.qa_defects (id uuid);')
    expect(created).toContain('public.qa_defects')
  })

  it('does not split inside a block comment', () => {
  // The parser masks /* ... */, so a semicolon inside one cannot end a statement.
  const sql = 'SELECT 1;\n/* a note; with a semicolon */\nSELECT 2;'
  expect(splitStatements(sql)).toHaveLength(2)
})

it('does not treat a comment as a created relation', () => {
    // A false positive here creates a bogus `createdAnywhere` entry, which
    // would mask a genuine later ordering defect.
    expect(createdRelations('-- CREATE TABLE public.ghost (id uuid);')).not.toContain(
      'public.ghost'
    )
  })

  it('finds a referenced relation', () => {
    const referenced = referencedRelations('ALTER TABLE public.panoramas ENABLE ROW LEVEL SECURITY;')
    expect(referenced).toContain('public.panoramas')
  })

  it('does not treat a relation named in a block comment as referenced', () => {
  expect(referencedRelations('/* see also public.old_table */ SELECT 1')).not.toContain(
    'public.old_table'
  )
})

it('ignores a relation that appears only inside a string literal', () => {
    expect(referencedRelations("SELECT 'public.fake_table'")).not.toContain('public.fake_table')
  })

  it('recognises an index creation as touching its table', () => {
    expect(referencedRelations('CREATE INDEX idx ON public.panoramas (subgrid);')).toContain(
      'public.panoramas'
    )
  })
})

describe('order analysis', () => {
  it('defers exactly the seven statements in 0004 and nothing else', () => {
    // 0004 is the only file that reaches for tables created later. The count is
    // an assertion, not a snapshot: adding a migration with a genuine ordering
    // defect surfaces as a failure here rather than as a broken install.
    expect(report.skipped).toHaveLength(7)
    expect(new Set(report.skipped.map((s) => s.file))).toEqual(
      new Set(['0004_rls_application_tables.sql'])
    )
  })

  it('defers only statements touching the tables 0012 creates', () => {
    // All seven are policies on panoramas / staging_panoramas, which 0012
    // creates and then re-policies more strictly. Nothing may be dropped that
    // 0012 does not cover.
    const deferred = new Set(report.skipped.flatMap((s) => s.relations))
    expect([...deferred].sort()).toEqual(['public.panoramas', 'public.staging_panoramas'])
  })

  it('reports an applied count and a deferred count for every file', () => {
    expect(report.files).toHaveLength(migrations.length)
    for (const f of report.files) {
      expect(f.applied + f.deferred, `${f.name} accounting`).toBe(f.total)
    }
  })

  it('defers nothing from any migration after 0004', () => {
    // The generalisation that matters: if a future migration reintroduces the
    // 0004->0012 class, this fails. That is the point of the whole file.
    const later = report.files.filter((f) => f.name > '0004_rls_application_tables.sql')
    const offenders = later.filter((f) => f.deferred > 0)
    expect(offenders.map((f) => f.name)).toEqual([])
  })

  it('reports 0011 as absent rather than as a deferred file', () => {
    expect(report.files.some((f) => f.name.startsWith('0011'))).toBe(false)
  })

  it('does not treat platform-owned relations as order violations', () => {
    // auth.users and storage.objects exist before any migration runs. Flagging
    // them would excise working statements from the bootstrap.
    const reported = new Set(report.skipped.flatMap((s) => s.relations))
    for (const external of ['auth.users', 'storage.objects', 'auth.uid']) {
      expect(reported.has(external)).toBe(false)
    }
  })

  it('applies every statement in 0012, the file that creates the deferred tables', () => {
    const file0012 = report.files.find((f) => f.name.startsWith('0012'))
    expect(file0012).toBeDefined()
    expect(file0012!.deferred).toBe(0)
    expect(file0012!.applied).toBe(file0012!.total)
  })

  it('locates every deferred statement in 0004 by a line number', () => {
    // The generator splices by offset and reports by line; a missing line would
    // make a failure report point at the wrong statement.
    for (const s of report.skipped) {
      expect(s.line).toBeGreaterThan(0)
      expect(s.text.length).toBeGreaterThan(0)
    }
  })
})