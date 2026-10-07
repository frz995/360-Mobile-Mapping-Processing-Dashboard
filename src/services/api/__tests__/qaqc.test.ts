import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock, scopedMock, getServiceProjectIdMock, saveAuditLogMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  scopedMock: vi.fn(),
  getServiceProjectIdMock: vi.fn(),
  saveAuditLogMock: vi.fn()
}))

vi.mock('../client', async () => {
  // Spreads the real module so `toQueryResult` keeps its behaviour. Hand-rolling
  // it here would let these tests pass against a broken implementation.
  const actual = await vi.importActual<typeof import('../client')>('../client');
  return {
    ...actual,
    supabase: { from: fromMock },
    scoped: scopedMock,
    getServiceProjectId: getServiceProjectIdMock
  };
});

vi.mock('../admin', () => ({
  saveAuditLogToSupabase: saveAuditLogMock
}))

import { updateDefectStatusInSupabase, resolveQADefectInSupabase } from '../qaqc'
import { getWriteFailures, clearWriteFailures } from '../../../lib/writeFailures'

/**
 * Migration 0033's failure mode, and the write-failure wiring from v26 §1.2.
 *
 * `0033_qa_defects_item_key.sql` records the cause exactly: "every qa_defects
 * write was rejected … and because the failing path only console.warn'd, QA/QC
 * results appeared to save and then vanished on refresh."
 *
 * An `upsert()` that Postgres rejects RESOLVES — it does not throw — returning
 * `{ error }`. So the check has to be explicit, and its absence is invisible
 * without a test.
 */

interface UpsertResult {
  data?: unknown;
  error: { message: string } | null;
}

/**
 * `upsert` resolves with `{ error }` when Postgres rejects the write, and
 * rejects only for a transport-level failure. Both are covered, because the
 * original code guarded them differently and inconsistently.
 */
function installTables(
  opts: {
    upsert?: Partial<UpsertResult>;
    update?: Partial<UpsertResult>;
    upsertThrows?: boolean;
    updateThrows?: boolean;
  } = {}
) {
  // The recorder and the value the builder resolves with are separate on
  // purpose: `await` on a chain must settle with the RESULT, while the spy is
  // there to assert the payload shape.
  const upsert = vi.fn();
  const update = vi.fn();

  const upsertResult = opts.upsertThrows
    ? Promise.reject(new Error('network down'))
    : Promise.resolve({ data: null, error: null, ...opts.upsert });
  const updateResult = opts.updateThrows
    ? Promise.reject(new Error('network down'))
    : Promise.resolve({ data: null, error: null, ...opts.update });

// `qa_defects` is written by BOTH an upsert (recording a defect) and an update
  // (dismissing one), so its builder has to settle with whichever result
  // matches the verb actually used. Keying on the verb rather than the table is
  // what lets one suite cover both writes.
  let pendingWrite: () => unknown = () => upsertResult;

  const makeBuilder = () => {
    const builder: Record<string, unknown> = {};
    builder.then = (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(pendingWrite()).then(resolve, reject);
    for (const method of ['select', 'eq', 'ilike', 'or', 'in', 'order', 'limit', 'is']) {
      builder[method] = () => builder;
    }
    builder.upsert = (payload: unknown, opts?: unknown) => {
      upsert(payload, opts);
      pendingWrite = () => upsertResult;
      return builder;
    };
    builder.update = (payload: unknown) => {
      update(payload);
      pendingWrite = () => updateResult;
      return builder;
    };
    return builder;
  };

  fromMock.mockImplementation(() => makeBuilder());

  return { upsert, update };
}

describe('updateDefectStatusInSupabase — rejected writes must surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearWriteFailures();
    getServiceProjectIdMock.mockReturnValue('project-1');
    scopedMock.mockImplementation((q: unknown) => q);
    saveAuditLogMock.mockResolvedValue(undefined);
  });

  it('writes item_key on every defect upsert', async () => {
    // 0033: `item_key` is NOT NULL on installs where it exists. Omitting it
    // makes every qa_defects write fail, which is what 0033 was written to fix.
    const { upsert } = installTables();

    await updateDefectStatusInSupabase(
      'N93E70-0001.jpg',
      3,
      'flagged',
      { subgrid: 'N93E70', point_id: 'N93E70-0001.jpg' },
      { id: 'u1', email: 'op@example.com', name: 'Operator' }
    );

    expect(upsert).toHaveBeenCalled();
    const [payload] = upsert.mock.calls[0];
    expect(payload.item_key).toBe('N93E70-0001.jpg');
    expect(payload.item_key).not.toBeNull();
    expect(payload.subgrid).toBe('N93E70');
  });

  it('falls back to point_id when no item_key is supplied', async () => {
    // A defect raised from the workbench carries no item_key. The constraint
    // still has to be satisfied or the write is rejected wholesale.
    const { upsert } = installTables();

    await updateDefectStatusInSupabase(
      'N93E70-0007.jpg',
      1,
      'flagged',
      { subgrid: 'N93E70', point_id: 'N93E70-0007.jpg' }
    );

    const [payload] = upsert.mock.calls[0];
    expect(payload.item_key).toBe('N93E70-0007.jpg');
  });

  it('reports a defect write Postgres rejects instead of only logging it', async () => {
    // upsert() resolves with { error } on rejection. Nothing throws, so without
    // the explicit check the caller sees a clean success.
    installTables({ upsert: { error: { message: 'null value in column "item_key"' } } });

    const result = await updateDefectStatusInSupabase(
      'N93E70-0001.jpg',
      3,
      'flagged',
      { subgrid: 'N93E70', point_id: 'N93E70-0001.jpg' }
    );

    const failures = getWriteFailures();
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f) => f.op === 'qaqc.defect_row')).toBe(true);
    expect(failures.some((f) => (f.detail || '').includes('item_key'))).toBe(true);
    // The banner is the signal; the caller still gets its result object.
    expect(result.success).toBe(true);
  });

  it('reports a defect write that throws rather than only logging it', async () => {
    // The other failure shape. Previously this reached console.warn and the
    // function returned success:true.
    installTables({ upsertThrows: true });

    await updateDefectStatusInSupabase(
      'N93E70-0001.jpg',
      3,
      'flagged',
      { subgrid: 'N93E70', point_id: 'N93E70-0001.jpg' }
    );

    const failures = getWriteFailures();
    expect(failures.some((f) => f.op === 'qaqc.defect_row')).toBe(true);
  });

  it('does not report a failure when both writes succeed', async () => {
    // Guards the guard: a banner that always shows is as useless as none.
    installTables();

    await updateDefectStatusInSupabase(
      'N93E70-0001.jpg',
      3,
      'flagged',
      { subgrid: 'N93E70', point_id: 'N93E70-0001.jpg' }
    );

    expect(getWriteFailures()).toHaveLength(0);
  });

  it('reports a rejected panorama rollup instead of losing it', async () => {
    // A PostgREST builder is thenable: `await query` RESOLVES with
    // { data, error } and does not throw. The original try/catch around
    // `await query` was therefore dead code for a rejection, and the function
    // returned { success: true } with the rollup silently unwritten.
    installTables({ update: { error: { message: 'permission denied for table panoramas' } } });

    const result = await updateDefectStatusInSupabase(
      'N93E70-0001.jpg',
      3,
      'flagged',
      { subgrid: 'N93E70', point_id: 'N93E70-0001.jpg' }
    );

    const failures = getWriteFailures();
    expect(failures.some((f) => f.op === 'qaqc.panorama_rollup')).toBe(true);
    expect(failures.some((f) => (f.detail || '').includes('permission denied'))).toBe(true);
    expect(result.success).toBe(true);
  });

  it('still writes the durable defect row when the rollup is rejected', async () => {
    // The rollup is a convenience aggregate; `qa_defects` is the record. One
    // failing must not prevent the other.
    const { upsert } = installTables({
      update: { error: { message: 'permission denied for table panoramas' } }
    });

    await updateDefectStatusInSupabase(
      'N93E70-0001.jpg',
      3,
      'flagged',
      { subgrid: 'N93E70', point_id: 'N93E70-0001.jpg' }
    );

    expect(upsert).toHaveBeenCalled();
    const [payload] = upsert.mock.calls[0];
    expect(payload.point_id).toBe('N93E70-0001.jpg');
  });

  it('reports a rejected defect dismissal', async () => {
    installTables({ update: { error: { message: 'row-level security violation' } } });

    const resolved = await resolveQADefectInSupabase('N93E70', 'N93E70-0001.jpg');

    expect(resolved).toBe(false);
    const failures = getWriteFailures();
    expect(failures.some((f) => f.op === 'qaqc.defect_resolve')).toBe(true);
  });

  it('reports a failed audit-log write rather than discarding it', async () => {
    // saveAuditLogToSupabase was called with `.catch(() => {})`. The dismissal
    // has already committed, so this is genuinely best-effort, but an audit
    // trail that never wrote is exactly the gap this suite exists to close.
installTables();
    saveAuditLogMock.mockRejectedValue(new Error('audit log insert failed'));

    await resolveQADefectInSupabase('N93E70', 'N93E70-0001.jpg');

    // The audit-log write is deliberately not awaited by the caller — the
    // dismissal has already committed and must not block on a log entry — so its
    // rejection settles a microtask later. Flush before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const failures = getWriteFailures();
    expect(failures.some((f) => f.op === 'qaqc.audit_log')).toBe(true);
  });
});
