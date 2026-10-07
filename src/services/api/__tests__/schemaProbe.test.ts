import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn()
}))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client');
  return {
    ...actual,
    supabase: { from: fromMock },
    scoped: (q: unknown) => q,
    getServiceProjectId: () => 'project-1'
  };
})

import {
  checkSchemaExpectations,
  SCHEMA_EXPECTATIONS,
  type SchemaCheckResult
} from '../admin'

/**
 * The schema probe added for v26 §4.
 *
 * Migrations 0032 and 0033 each added a column the app reads on every load.
 * Each shipped to a pilot-bound client, each was absent there, and neither
 * produced an error — a missing `run_id` made the `qa_defects` select fail, the
 * failure was swallowed, and every survey run reported zero defects. A system
 * that looks healthy and is quietly wrong.
 *
 * The probe's contract is that it must never report healthy when it did not
 * check. Every test below is a variation on that.
 */

function installTables(results: Record<string, { data?: unknown; error?: { message: string } | null }>) {
  fromMock.mockImplementation((table: string) => {
    const columns: string[] = [];
    const builder: Record<string, unknown> = {
      select: (cols: string) => {
        columns.push(...cols.split(',').map((c) => c.trim()));
        return builder;
      },
      limit: () => builder,
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) => {
        const entry = results[table];
        if (!entry) {
          // A relation the mock was never told about behaves like one that does
          // not exist, which is the condition under test.
          return Promise.resolve({
            data: null,
            error: { message: `relation "public.${table}" does not exist` }
          }).then(resolve, reject);
        }
        if (entry.error) {
          return Promise.resolve({ data: null, error: entry.error }).then(resolve, reject);
        }
        // PostgREST returns objects carrying exactly the requested columns.
        const row: Record<string, unknown> = {};
        for (const c of columns) row[c] = null;
        return Promise.resolve({ data: [row], error: null }).then(resolve, reject);
      }
    };
    return builder;
  });
}

/** Every table present with every column the app reads. */
function healthyTables(): Record<string, { data?: unknown; error?: null }> {
  const tables: Record<string, { data?: unknown; error?: null }> = {};
  for (const expectation of SCHEMA_EXPECTATIONS) {
    tables[expectation.relation] = { error: null };
  }
  return tables;
}

describe('checkSchemaExpectations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports every expectation, so a partial answer is visible as partial', async () => {
    installTables(healthyTables());

    const results = await checkSchemaExpectations();

    expect(results).toHaveLength(SCHEMA_EXPECTATIONS.length);
    expect(results.every((r) => r.status === 'ok')).toBe(true);
  });

  it('names 0032 and 0033, the two that shipped broken', async () => {
    // If a future migration adds a required column and forgets this list, the
    // probe is a false comfort. These two are the known history.
    const migrations = SCHEMA_EXPECTATIONS.map((e) => e.migration);
    expect(migrations).toContain('0032_qa_defects_run_scope.sql');
    expect(migrations).toContain('0033_qa_defects_item_key.sql');
  });

  it('flags a missing column rather than reporting healthy', async () => {
    // THE 0032 CASE. Postgres rejects a select naming an absent column; the
    // probe must surface that, not treat an error response as a pass.
    installTables({
      qa_defects: { error: { message: 'column qa_defects.run_id does not exist' } },
      panoramas: { error: null }
    });

    const results = await checkSchemaExpectations();
    const runScope = results.find((r) => r.migration.startsWith('0032'));

    expect(runScope).toBeDefined();
    expect(runScope!.status).not.toBe('ok');
    expect(runScope!.detail).toContain('0032_qa_defects_run_scope.sql');
  });

  it('distinguishes a missing relation from a missing column', async () => {
    installTables({
      qa_defects: { error: { message: 'relation "public.qa_defects" does not exist' } },
      panoramas: { error: null }
    });

    const results = await checkSchemaExpectations();
    const defects = results.filter((r) => r.relation === 'qa_defects');

    expect(defects.every((r) => r.status === 'missing_relation')).toBe(true);
  });

  it('never reports healthy when the query throws', async () => {
    // A probe that catches a network failure and returns "ok" would be the same
    // silent-failure class it exists to detect.
    fromMock.mockImplementation(() => ({
      select: () => ({
        limit: () => ({
          then: (_resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.reject(new Error('Failed to fetch')).then(_resolve, reject)
        })
      })
    }));

    const results = await checkSchemaExpectations();

    expect(results).toHaveLength(SCHEMA_EXPECTATIONS.length);
    expect(results.every((r) => r.status === 'unreachable')).toBe(true);
  });

  it('treats an empty table as proof the column exists', async () => {
    // A fresh install can have the column and zero rows. "No data" is not
    // "no column" — conflating them would put a false alarm on every new project.
    fromMock.mockImplementation(() => ({
      select: () => ({
        limit: () => ({
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(resolve)
        })
      })
    }));

    const results = await checkSchemaExpectations();

    expect(results.every((r) => r.status === 'ok')).toBe(true);
  });

  it('checks each relation once, not once per column', async () => {
    // Two expectations share `qa_defects`. Three round trips where one suffices
    // would be slower and, on a metered connection, noisier.
    installTables(healthyTables());

    await checkSchemaExpectations();

    const qaDefectsCalls = fromMock.mock.calls.filter((c) => c[0] === 'qa_defects');
    expect(qaDefectsCalls).toHaveLength(1);
    // Both columns requested together.
    expect(qaDefectsCalls[0][0]).toBeDefined();
  });

  it('labels each result so an operator knows what to apply', async () => {
    installTables({
      qa_defects: { error: { message: 'column qa_defects.run_id does not exist' } },
      panoramas: { error: null }
    });

    const results = await checkSchemaExpectations();
    const broken = results.filter((r) => r.status !== 'ok') as SchemaCheckResult[];

    expect(broken.length).toBeGreaterThan(0);
    for (const r of broken) {
      expect(r.migration).not.toBe('');
      expect(r.label.length).toBeGreaterThan(0);
    }
  });
});