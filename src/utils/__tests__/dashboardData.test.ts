import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  formatBatchIdDisplay,
  getPOICount,
  getImagesProcessedCount,
  resolveRunCounts,
  parseFlexibleDate,
  formatDisplayDate,
  toISODateString,
  reconcileBatchLogs,
  applyBatchLogOverrides,
  batchLogToDbRow
} from '../dashboardData'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('formatBatchIdDisplay', () => {
  it('returns a default id when log is missing', () => {
    expect(formatBatchIdDisplay(undefined, 0)).toBe('2123S-1001')
  })

  it('uses fallback subgrid-based id when no raw id present', () => {
    expect(formatBatchIdDisplay({ subgrid: 'N93E70' })).toBe('2123S-N93E70')
  })

  it('strips 2123S and sp-b- prefixes and zero pads numeric ids', () => {
    expect(formatBatchIdDisplay({ id: '2123S-5' })).toBe('2123S-0005')
    expect(formatBatchIdDisplay({ id: 'sp-b-42' })).toBe('2123S-0042')
  })

  it('keeps non-numeric clean ids as-is', () => {
    expect(formatBatchIdDisplay({ id: 'N93E70' })).toBe('2123S-N93E70')
  })
})

describe('getPOICount', () => {
  it('returns 0 for empty input', () => {
    expect(getPOICount(undefined)).toBe(0)
  })

  it('prefers explicit poiCount', () => {
    expect(getPOICount({ poiCount: 5, panoramas: [{ filename: 'a' }] })).toBe(5)
  })

  it('falls back to panoramas length', () => {
    expect(getPOICount({ panoramas: [{ filename: 'a' }, { filename: 'b' }] })).toBe(2)
  })

  it('falls back to imagesProcessed / images count', () => {
    expect(getPOICount({ imagesProcessed: 7 })).toBe(7)
    expect(getPOICount({ images: 3 })).toBe(3)
  })
})

describe('resolveRunCounts', () => {
  it('never sources the frame count from the POI count', () => {
    // A run with POIs but no frame evidence at all must report 0 frames, not
    // the POI total. This is the exact bug the `preserve_runs` row mapping had.
    expect(resolveRunCounts({ poiCount: 42 })).toEqual({ images: 0, poiCount: 42 })
  })

  it('never sources the POI count from the frame count', () => {
    expect(resolveRunCounts({ imagesProcessed: 17 })).toEqual({ images: 17, poiCount: undefined })
  })

  it('prefers the storage-verified count over the declared one', () => {
    expect(resolveRunCounts({ availableImagesCount: 15, imagesProcessed: 12, poiCount: 20 })).toEqual({
      images: 15,
      poiCount: 20
    })
  })

  it('keeps a verified zero rather than falling back to the declared count', () => {
    expect(resolveRunCounts({ availableImagesCount: 0, imagesProcessed: 99 })).toEqual({
      images: 0,
      poiCount: undefined
    })
  })

  it('reports both independently when both are present', () => {
    expect(resolveRunCounts({ availableImagesCount: 30, poiCount: 28 })).toEqual({
      images: 30,
      poiCount: 28
    })
  })
})

describe('getImagesProcessedCount', () => {
  it('returns 0 for empty input', () => {
    expect(getImagesProcessedCount(undefined)).toBe(0)
  })

  it('prefers explicit availableImagesCount and never caps it at the POI count', () => {
    expect(getImagesProcessedCount({ availableImagesCount: 10, poiCount: 12 })).toBe(10)
    // The decisive case: storage verified 15 files for a 12-POI run. The POI
    // count is a different measurement and must not truncate a verified figure.
    expect(getImagesProcessedCount({ availableImagesCount: 15, poiCount: 12 })).toBe(15)
    // Nor the other way round — a verified 0 stays 0.
    expect(getImagesProcessedCount({ availableImagesCount: 0, poiCount: 40 })).toBe(0)
  })

  it('uses availableFilenames length when present', () => {
    expect(
      getImagesProcessedCount({ availableFilenames: ['a.jpg', 'b.jpg'], poiCount: 5 })
    ).toBe(2)
  })

  it('counts only available panoramas', () => {
    expect(
      getImagesProcessedCount({
        panoramas: [
          { filename: 'a', isAvailable: true },
          { filename: 'b', isAvailable: false },
          { filename: 'c', isAvailable: true }
        ]
      })
    ).toBe(2)
  })

  it('uses a declared imagesProcessed as declared, not capped at the POI count', () => {
    expect(getImagesProcessedCount({ imagesProcessed: 8, poiCount: 10 })).toBe(8)
    // A declared count above the POI count is over-reporting, but it is still a
    // measurement about frames — silently rewriting it to the POI number would
    // make a frames KPI that can never exceed a POI KPI, which is the exact
    // conflation the frame-count rule forbids.
    expect(getImagesProcessedCount({ imagesProcessed: 20, poiCount: 10 })).toBe(20)
  })

  it('returns 0 when nothing matches', () => {
    expect(getImagesProcessedCount({})).toBe(0)
  })
})

describe('parseFlexibleDate', () => {
  it('returns null for empty input', () => {
    expect(parseFlexibleDate(undefined)).toBeNull()
    expect(parseFlexibleDate('')).toBeNull()
    expect(parseFlexibleDate(null)).toBeNull()
  })

  it('accepts a valid Date object', () => {
    const d = new Date(2026, 0, 15)
    expect(parseFlexibleDate(d)).toEqual(d)
  })

  it('accepts a numeric timestamp', () => {
    const ts = new Date(2026, 5, 1).getTime()
    expect(parseFlexibleDate(ts)?.getTime()).toBe(ts)
  })

  it('parses ISO strings', () => {
    expect(parseFlexibleDate('2026-08-19T10:00:00Z')?.getUTCFullYear()).toBe(2026)
  })

  it('parses DD/MM/YYYY as day-first', () => {
    const d = parseFlexibleDate('19/08/2026')
    expect(d).not.toBeNull()
    expect(d!.getDate()).toBe(19)
    expect(d!.getMonth()).toBe(7) // August
    expect(d!.getFullYear()).toBe(2026)
  })

  it('parses DD-MM-YYYY', () => {
    const d = parseFlexibleDate('08-04-2022')
    expect(d!.getDate()).toBe(8)
    expect(d!.getMonth()).toBe(3)
  })

  it('parses YYYY-MM-DD', () => {
    const d = parseFlexibleDate('2026-01-02')
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(0)
    expect(d!.getDate()).toBe(2)
  })

  it('parses word month names', () => {
    const d = parseFlexibleDate('19 August 2026')
    expect(d!.getMonth()).toBe(7)
    expect(d!.getDate()).toBe(19)
  })

  it('returns null for garbage input', () => {
    expect(parseFlexibleDate('not a date')).toBeNull()
    expect(parseFlexibleDate(123 as any)).not.toBeNull() // numeric works
  })
})

describe('formatDisplayDate', () => {
  it('returns N/A for empty input', () => {
    expect(formatDisplayDate('')).toBe('N/A')
    expect(formatDisplayDate(undefined)).toBe('N/A')
  })

  it('formats a parseable date to Day Mon Year', () => {
    expect(formatDisplayDate('2026-08-19')).toMatch(/19 Aug 2026/)
  })

  it('returns raw string when unparseable', () => {
    expect(formatDisplayDate('garbage')).toBe('garbage')
  })
})

describe('toISODateString', () => {
  it('returns today for empty input', () => {
    expect(toISODateString('')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('converts parseable dates to YYYY-MM-DD', () => {
    expect(toISODateString('19/08/2026')).toBe('2026-08-19')
  })
})

describe('reconcileBatchLogs', () => {
  it('returns empty array for empty input', () => {
    expect(reconcileBatchLogs([])).toEqual([])
  })

  it('groups daily records by normalized subgrid', () => {
    const logs = reconcileBatchLogs([
      {
        date: '2026-08-19',
        grid: '1',
        subgrid: 'N93E70',
        kmProcessed: 10,
        imagesProcessed: 3,
        poiCount: 3,
        defectCount: 1,
        captureEquipment: 'MMS',
        imagesDefected: 1,
        publishToWebGIS: 'yes',
        action: ''
      },
      {
        date: '2026-08-19',
        grid: '1',
        subgrid: 'N93e70',
        kmProcessed: 5,
        imagesProcessed: 2,
        poiCount: 2,
        defectCount: 0,
        captureEquipment: 'MMS',
        imagesDefected: 0,
        publishToWebGIS: 'yes',
        action: ''
      }
    ])
    expect(logs).toHaveLength(1)
    expect(logs[0].subgrid).toBe('N93E70')
    expect(logs[0].runsCount).toBe(2)
    expect(logs[0].kmProcessed).toBe(15)
  })

  it('returns Ongoing status when not all runs published', () => {
    const logs = reconcileBatchLogs([
      {
        date: '2026-08-19',
        grid: '1',
        subgrid: 'N93E70',
        kmProcessed: 5,
        imagesProcessed: 2,
        poiCount: 2,
        defectCount: 0,
        captureEquipment: 'MMS',
        imagesDefected: 0,
        publishToWebGIS: 'no',
        action: ''
      }
    ])
    expect(logs[0].status).toBe('Ongoing')
    expect(logs[0].publishToWebGIS).toBe('in process')
  })

  it('preserves user-defined Ongoing status even when all runs are published', () => {
    const logs = reconcileBatchLogs(
      [
        {
          date: '2026-08-19',
          grid: '1',
          subgrid: 'N93E70',
          kmProcessed: 5,
          imagesProcessed: 3,
          poiCount: 3,
          defectCount: 0,
          captureEquipment: 'MMS',
          imagesDefected: 0,
          publishToWebGIS: 'yes',
          action: ''
        }
      ],
      [
        {
          id: 'BATCH-N93E70',
          date: '2026-08-19 00:42',
          grid: '1',
          subgrid: 'N93E70',
          imageFilename: 'N93E70-0001.jpg',
          images: 3,
          poiCount: 3,
          defects: 0,
          kmProcessed: 5,
          status: 'Ongoing',
          pic: 'Operator',
          publishToWebGIS: 'in process',
          isSyncedWithSupabase: false
        }
      ]
    )
    expect(logs).toHaveLength(1)
    expect(logs[0].status).toBe('Ongoing')
    expect(logs[0].publishToWebGIS).toBe('in process')
  })

  it('preserves user-defined Complete status when nothing is published yet', () => {
    const logs = reconcileBatchLogs(
      [
        {
          date: '2026-08-19',
          grid: '1',
          subgrid: 'N93E70',
          kmProcessed: 5,
          imagesProcessed: 3,
          poiCount: 3,
          defectCount: 0,
          captureEquipment: 'MMS',
          imagesDefected: 0,
          publishToWebGIS: 'no',
          action: ''
        }
      ],
      [
        {
          id: 'BATCH-N93E70',
          date: '2026-08-19 00:42',
          grid: '1',
          subgrid: 'N93E70',
          imageFilename: 'N93E70-0001.jpg',
          images: 3,
          poiCount: 3,
          defects: 0,
          kmProcessed: 5,
          status: 'Complete',
          pic: 'Operator',
          publishToWebGIS: 'yes',
          isSyncedWithSupabase: true
        }
      ]
    )
    expect(logs[0].status).toBe('Complete')
    expect(logs[0].publishToWebGIS).toBe('yes')
  })
})

describe('applyBatchLogOverrides', () => {
  const base = {
    id: 'BATCH-N93E70',
    date: '2026-08-19',
    grid: '1',
    subgrid: 'N93E70',
    imageFilename: 'N93E70-0001.jpg',
    images: 3,
    defects: 0,
    kmProcessed: 5,
    status: 'Ongoing' as const,
    pic: 'Admin',
    publishToWebGIS: 'no'
  }

  it('applies user-defined status override keyed by normalized subgrid', () => {
    const next = applyBatchLogOverrides(base, { N93E70: { status: 'Complete' } })
    expect(next.status).toBe('Complete')
    expect(next.defects).toBe(0)
    expect(next.pic).toBe('Admin')
  })

  it('matches image-filename based subgrids and applies pic override', () => {
    const next = applyBatchLogOverrides(base, { N93E70: { pic: 'Farah' } })
    expect(next.pic).toBe('Farah')
    expect(next.status).toBe('Ongoing')
  })

  it('never clobbers derived metrics (defects/km) from overrides', () => {
    const next = applyBatchLogOverrides(base, { N93E70: { status: 'Complete', isSyncedWithSupabase: true } })
    expect(next.defects).toBe(0)
    expect(next.kmProcessed).toBe(5)
    expect(next.isSyncedWithSupabase).toBe(true)
  })

  it('applies no overrides when the subgrid is missing from the map', () => {
    const next = applyBatchLogOverrides(base, { N94E71: { status: 'Complete' } })
    expect(next.status).toBe('Ongoing')
  })

  it('ignores override maps without a matching normalized subgrid', () => {
    const next = applyBatchLogOverrides(base, { n93e70x: { status: 'Complete' } })
    expect(next.status).toBe('Ongoing')
  })
})

describe('batchLogToDbRow', () => {
  it('maps user fields with snake_case column names and normalized subgrid', () => {
    const row = batchLogToDbRow({
      id: 'BATCH-N93E70',
      date: '2026-08-19',
      grid: '1',
      subgrid: 'n93e70-0002',
      imageFilename: 'N93E70-0001.jpg',
      images: 3,
      defects: 4,
      kmProcessed: 5,
      status: 'Ongoing',
      pic: 'Farah',
      publishToWebGIS: 'in process',
      isSyncedWithSupabase: true
    })
    expect(row.subgrid).toBe('N93E70')
    expect(row.status).toBe('Ongoing')
    expect(row.pic).toBe('Farah')
    expect(row.publish_to_webgis).toBe('in process')
    expect(row.is_synced_with_supabase).toBe(true)
    expect(row.updated_at).toBeTruthy()
  })

  it('derives publish_to_webgis from isSyncedWithSupabase when unset', () => {
    expect(batchLogToDbRow({ date: '2026-01-01', grid: '1', subgrid: 'N92E71', imageFilename: 'N92E71-0001.jpg', images: 1, defects: 0, kmProcessed: 1, status: 'Complete', isSyncedWithSupabase: true }).publish_to_webgis).toBe('yes')
  })
})
