import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  fromMock,
  scopedMock,
  scopedIncludingUnassignedMock,
  getServiceProjectIdMock,
  resolveStorageFilesMock,
  ensureManifestSettingsMock
} = vi.hoisted(() => ({
  fromMock: vi.fn(),
  scopedMock: vi.fn(),
  scopedIncludingUnassignedMock: vi.fn(),
  getServiceProjectIdMock: vi.fn(),
  resolveStorageFilesMock: vi.fn(),
  ensureManifestSettingsMock: vi.fn()
}))

vi.mock('../client', async () => {
  // Spreads the real module so `toQueryResult` keeps its behaviour. Mocking the
  // whole module would mean hand-rolling the discrimination the module under
  // test now depends on, which would let these tests pass against a broken
  // toQueryResult.
  const actual = await vi.importActual<typeof import('../client')>('../client');
  return {
    ...actual,
    supabase: { from: fromMock },
    scoped: scopedMock,
    scopedIncludingUnassigned: scopedIncludingUnassignedMock,
    getServiceProjectId: getServiceProjectIdMock
  };
});

vi.mock('../storage', () => ({
  resolveStorageFiles: resolveStorageFilesMock,
  ensureManifestSettings: ensureManifestSettingsMock
}))

import { fetchSupabaseData, saveToStagingSupabase } from '../datasets'

/**
 * The defect aggregate is what migration 0032 broke, and what this suite exists
 * to protect.
 *
 * 0032 added `qa_defects.run_id`. Before it, the select failed outright on an
 * un-migrated database, the failure was caught and discarded, and every survey
 * run rendered "0 defects" — a clean, healthy, entirely fictional tally. Both
 * the unreadable-source case and the wrong-attribution case need covering,
 * because they are different bugs with the same visible symptom.
 */

type PanickingTable = 'qa_defects' | 'qaqc_audit_runs' | 'panoramas_view' | 'subgrids'

interface PanoramaRow {
  [key: string]: unknown
}

/**
 * Install a table-driven Supabase mock.
 *
 * A table named in `panics` rejects rather than returning `{ error }`. That is
 * deliberate: PostgREST signals a missing column in the response body, but a
 * network-level failure rejects the promise, and both reach the caller's catch.
 * Testing the rejection path is what proves the catch no longer swallows.
 */
function installTables(
  rows: Record<string, PanoramaRow[]>,
  panics: PanickingTable[] = []
) {
  const upsert = vi.fn().mockResolvedValue({ error: null, data: null })

  fromMock.mockImplementation((table: string) => {
    // A minimal PostgREST builder: every chain method returns itself, and the
    // table is captured by closure so `then` knows what is being read.
    const builder: Record<string, unknown> = {};
    const chainMethods = ['select', 'order', 'limit', 'eq', 'ilike', 'is', 'in', 'or'];
    for (const method of chainMethods) {
      builder[method] = () => builder;
    }
    builder.upsert = upsert;
    builder.then = (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown
    ) => {
      if (panics.includes(table as PanickingTable)) {
        return Promise.reject(
          new Error(`column "${table}.run_id" does not exist`)
        ).then(resolve, reject);
      }
      return Promise.resolve({ data: rows[table] ?? [], error: null }).then(
        resolve,
        reject
      );
    };
    return builder;
  });

  return { upsert };
}

/**
 * The run key the loader builds for a published row is `sp-d-<subgrid>_<run>`, so
 * a `qa_defects.run_id` only matches if the test uses the same shape. Matching
 * the raw `run_id` used on the panorama row would make every tally read 0 and
 * these tests would pass for the wrong reason.
 */
const RUN_A = 'sp-d-N93E70_run-a';

/**
 * A panorama row. `frames` produces that many distinct frame rows so the run's
 * frame ceiling is high enough to hold the defect count under test — the loader
 * clamps a defect count to `max(poiCount, verifiedImages)`, so a single-frame
 * run would silently cap any assertion above 1 and let a broken tally pass.
 */
function panoramaRow(overrides: PanoramaRow = {}, frames = 8): PanoramaRow[] {
  return Array.from({ length: frames }, (_, i) => ({
    subgrid: 'N93E70',
    image_url: `N93E70-000${i + 1}.jpg`,
    description: '2026-09-25.csv',
    lat: 1.25 + i * 0.0001,
    lon: 103.5 + i * 0.0001,
    date_created: '2026-09-25',
    is_synced_with_supabase: true,
    publish_to_webgis: 'yes',
    ...overrides
  }));
}

function makeSettings() {
  return {
    panoramasTable: 'panoramas',
    qaDefectsTable: 'qa_defects',
    qaqcRunsTable: 'qaqc_audit_runs',
    supabaseBucket: 'mms-test',
    stagingTable: 'data_staging'
  } as any;
}

describe('fetchSupabaseData — defect aggregate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServiceProjectIdMock.mockReturnValue('project-1');
    ensureManifestSettingsMock.mockResolvedValue(true);
    // Storage unreachable: the loader then falls back to database filenames and
    // marks them unverified. Unrelated to the defect tally, and it keeps these
    // tests off the storage path. The shape must match what the loader reads —
    // `countsBySubgrid`, `fileSet` and `listingOk` are all destructured, so a
    // partial mock throws inside the load and yields an empty result.
    resolveStorageFilesMock.mockResolvedValue({
      countsBySubgrid: new Map<string, number>(),
      fileSet: new Set<string>(),
      listingOk: false
    });
    scopedMock.mockImplementation((q: unknown) => q);
    scopedIncludingUnassignedMock.mockImplementation((q: unknown) => q);
  });

  it('reads as UNKNOWN, not 0, when the qa_defects select fails', async () => {
    // THE 0032 CASE. The select rejects because `run_id` does not exist on an
    // un-migrated database. Every run must report a null count, not 0.
    installTables(
      { panoramas_view: panoramaRow({ run_id: 'run-a' }), subgrids: [] },
      ['qa_defects']
    );

    const { dailyData } = await fetchSupabaseData(makeSettings());

    expect(dailyData.length).toBeGreaterThan(0);
    for (const row of dailyData) {
      // `0` would be a claim the data does not support. `null` is the truth.
      expect(row.defectCount).toBeNull();
      expect(row.imagesDefected).toBeNull();
      expect(String(row.qaqcStatus)).toContain('Unverified');
    }
  });

  it('reads 0 when the table is readable and the run is genuinely clean', async () => {
    // The other half of the contract, and the one a naive fix breaks: returning
    // 0 whenever a source is absent would pass the test above while lying here.
    installTables({
      panoramas_view: panoramaRow({ run_id: 'run-a' }),
      subgrids: [],
      qa_defects: []
    });

    const { dailyData } = await fetchSupabaseData(makeSettings());

    expect(dailyData.length).toBeGreaterThan(0);
    for (const row of dailyData) {
      expect(row.defectCount).toBe(0);
    }
  });

  it('prefers a run-scoped count over the subgrid-wide tally', async () => {
    // One subgrid surveyed twice. Run A has 2 run-scoped rows; a legacy
    // run-less row speaks for the whole subgrid. Run A must read 2, not 3.
    installTables({
      panoramas_view: panoramaRow({ run_id: 'run-a' }),
      subgrids: [],
      qa_defects: [
        { point_id: 'N93E70-0001.jpg', subgrid: 'N93E70', run_id: RUN_A, qa_status: 'flagged' },
        { point_id: 'N93E70-0002.jpg', subgrid: 'N93E70', run_id: RUN_A, qa_status: 'flagged' },
        { point_id: 'N93E70-0003.jpg', subgrid: 'N93E70', run_id: null, qa_status: 'flagged' }
      ]
    });

    const { dailyData } = await fetchSupabaseData(makeSettings());

    expect(dailyData).toHaveLength(1);
    expect(dailyData[0].defectCount).toBe(2);
  });

  it('does not leak one run defect count into a sibling run', async () => {
    // The original cross-run bleed 0032 was written to stop: one filename can
    // carry a defect in several runs of the same subgrid.
    installTables({
      panoramas_view: panoramaRow({ run_id: 'run-b' }),
      subgrids: [],
      qa_defects: [
        { point_id: 'N93E70-0001.jpg', subgrid: 'N93E70', run_id: RUN_A, qa_status: 'flagged' }
      ]
    });

    const { dailyData } = await fetchSupabaseData(makeSettings());

    expect(dailyData).toHaveLength(1);
    // Run B has no run-scoped rows of its own. It must read 0, not run A's 1.
    expect(dailyData[0].defectCount).toBe(0);
  });

  it('falls back to the run audit summary when the row-level table is unreadable', async () => {
    // `qaqc_audit_runs` is a different table and may well have been read
    // successfully. An audit summary is a real measurement, so it still answers
    // the question — an unreadable qa_defects must not force "unknown" when a
    // better source is in hand.
    installTables(
      {
        panoramas_view: panoramaRow({ run_id: 'run-a' }),
        subgrids: [],
        qaqc_audit_runs: [
          { subgrid: 'N93E70', run_id: RUN_A, total_stations: 10, defect_count: 4, pass_rate: 60 }
        ]
      },
      ['qa_defects']
    );

    const { dailyData } = await fetchSupabaseData(makeSettings());

    expect(dailyData).toHaveLength(1);
    expect(dailyData[0].defectCount).toBe(4);
  });

  it('persists an unknown count as SQL NULL rather than 0', async () => {
    // The other direction of the same lie: publishing a run whose defects were
    // never measured must not write 0 into the staging table, or the unknown
    // becomes a permanent clean bill of health on the next read.
    const { upsert } = installTables({ panoramas_view: [], subgrids: [] });

    await saveToStagingSupabase({
      subgrid: 'N93E70',
      defects: null,
      csvFileName: '20260925.csv',
      panoramas: [
        { filename: 'N93E70-0001.jpg', latitude: 1.25, longitude: 103.5, bearing: 90 }
      ]
    } as any);

    expect(upsert).toHaveBeenCalled();
    // upsert() receives a chunk (array of rows), not a single row.
    const [chunk] = upsert.mock.calls[0];
    expect(Array.isArray(chunk)).toBe(true);
    for (const row of chunk) {
      expect(row.defect_count).toBeNull();
    }
  });

  it('persists a measured count unchanged', async () => {
    // Guards the guard: the previous test must not pass because defect_count is
    // always null.
    const { upsert } = installTables({ panoramas_view: [], subgrids: [] });

    await saveToStagingSupabase({
      subgrid: 'N93E70',
      defects: 7,
      csvFileName: '20260925.csv',
      panoramas: [
        { filename: 'N93E70-0001.jpg', latitude: 1.25, longitude: 103.5, bearing: 90 }
      ]
    } as any);

    expect(upsert).toHaveBeenCalled();
    const [chunk] = upsert.mock.calls[0];
    for (const row of chunk) {
      expect(row.defect_count).toBe(7);
    }
  });
});
