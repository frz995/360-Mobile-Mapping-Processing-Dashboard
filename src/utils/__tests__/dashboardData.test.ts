import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  formatBatchIdDisplay,
  getPOICount,
  getImagesProcessedCount,
  parseFlexibleDate,
  formatDisplayDate,
  toISODateString,
  createBatchLogFromSupabaseOrDummy,
  reconcileBatchLogs
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

describe('getImagesProcessedCount', () => {
  it('returns 0 for empty input', () => {
    expect(getImagesProcessedCount(undefined)).toBe(0)
  })

  it('prefers explicit availableImagesCount (gold standard), clamped to POI', () => {
    expect(getImagesProcessedCount({ availableImagesCount: 10, poiCount: 12 })).toBe(10)
    // clamps to POI when available count exceeds POI
    expect(getImagesProcessedCount({ availableImagesCount: 15, poiCount: 12 })).toBe(12)
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

  it('uses imagesProcessed clamped to poi', () => {
    expect(getImagesProcessedCount({ imagesProcessed: 8, poiCount: 10 })).toBe(8)
    expect(getImagesProcessedCount({ imagesProcessed: 20, poiCount: 10 })).toBe(10)
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

describe('createBatchLogFromSupabaseOrDummy', () => {
  it('builds a BatchLog from a supabase row', () => {
    const log = createBatchLogFromSupabaseOrDummy(
      { image_url: 'https://x/N93E70-0002.jpg', images: 5, defects: 1, km_processed: 2.5 },
      'N93E70',
      '7'
    )
    expect(log.subgrid).toBe('N93E70')
    expect(log.images).toBe(5)
    expect(log.defects).toBe(1)
    expect(log.kmProcessed).toBe(2.5)
    expect(log.grid).toBe('7')
  })

  it('uses fallback subgrid filename when row has no image info', () => {
    const log = createBatchLogFromSupabaseOrDummy({}, 'N91E71', '3')
    expect(log.subgrid).toBe('N91E71')
    expect(log.imageFilename).toContain('N91E71')
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
})
