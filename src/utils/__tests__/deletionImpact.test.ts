import { describe, it, expect } from 'vitest'
import { computeDeletionImpact } from '../deletionImpact'

describe('computeDeletionImpact', () => {
  const baseParams = {
    mode: 'single' as const,
    subgrids: ['N93E70'],
    dailyData: [],
    batchLogs: []
  }

  it('returns a row with zero totals for an unmatched subgrid', () => {
    const r = computeDeletionImpact({ ...baseParams, subgrids: ['Z99Z99'] })
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].runs).toBe(0)
    expect(r.totals.runs).toBe(0)
  })

  it('aggregates runs, frames, poi, km, and defects per subgrid', () => {
    const r = computeDeletionImpact({
      ...baseParams,
      dailyData: [
        {
          subgrid: 'N93E70',
          poiCount: 10,
          availableImagesCount: 8,
          kmProcessed: 12.34,
          defectCount: 2,
          publishToWebGIS: 'yes'
        },
        {
          subgrid: 'N93E70',
          poiCount: 4,
          availableImagesCount: 4,
          kmProcessed: 5.5,
          defectCount: 0,
          publishToWebGIS: 'no'
        }
      ]
    })
    const row = r.rows[0]
    expect(row.subgrid).toBe('N93E70')
    expect(row.runs).toBe(2)
    expect(row.poi).toBe(14)
    expect(row.frames).toBe(12)
    expect(row.km).toBe(17.84)
    expect(row.defects).toBe(2)
    expect(row.published).toBe(1)
  })

  it('flags published records with a warning', () => {
    const r = computeDeletionImpact({
      ...baseParams,
      dailyData: [
        { subgrid: 'N93E70', poiCount: 1, publishToWebGIS: 'yes' }
      ]
    })
    expect(r.hasPublished).toBe(true)
    expect(r.warnings.some((w) => w.includes('published to WebGIS'))).toBe(true)
  })

  it('tracks staging frames and raises orphan risk', () => {
    const r = computeDeletionImpact({
      ...baseParams,
      stagingAggregates: [{ subgrid: 'N93E70', frames: 200 }]
    })
    expect(r.totals.staging).toBe(200)
    expect(r.hasOrphanRisk).toBe(true)
    expect(r.warnings.some((w) => w.includes('RAW capture frame'))).toBe(true)
  })

  it('counts jobs referencing the subgrid or linked datasets', () => {
    const r = computeDeletionImpact({
      ...baseParams,
      datasets: [
        { id: 'ds-1', name: 'RAW N93E70', subgrid: 'N93E70', dataset_type: 'RAW' as const }
      ],
      jobs: [
        { id: 'j1', name: 'stitch', job_type: 'STITCH', subgrid: 'N93E70' },
        { id: 'j2', name: 'blur', job_type: 'BLUR', source_dataset_id: 'ds-1' },
        { id: 'j3', name: 'other', job_type: 'ENHANCE', subgrid: 'OTHER' }
      ]
    })
    expect(r.totals.jobs).toBe(2)
    expect(r.totals.datasets).toBe(1)
    expect(r.hasLinkedJobs).toBe(true)
  })

  it('flags DELIVERABLE datasets as orphan risk and lists names', () => {
    const r = computeDeletionImpact({
      ...baseParams,
      datasets: [
        {
          id: 'd1',
          name: 'Final N93E70',
          subgrid: 'N93E70',
          dataset_type: 'DELIVERABLE'
        }
      ]
    })
    expect(r.totals.deliverables).toBe(1)
    expect(r.hasDeliverables).toBe(true)
    expect(r.rows[0].deliverableNames).toContain('Final N93E70')
    expect(r.warnings.some((w) => w.includes('DELIVERABLE dataset'))).toBe(true)
  })

  it('supports bulk mode over multiple subgrids', () => {
    const r = computeDeletionImpact({
      mode: 'bulk',
      subgrids: ['N93E70', 'N91E71'],
      dailyData: [
        { subgrid: 'N93E70', poiCount: 5 },
        { subgrid: 'N91E71', poiCount: 3 }
      ],
      batchLogs: []
    })
    expect(r.rows).toHaveLength(2)
    expect(r.totals.poi).toBe(8)
  })

  it('deduplicates subgrids regardless of case', () => {
    const r = computeDeletionImpact({
      mode: 'single',
      subgrids: ['n93e70', 'N93E70'],
      dailyData: [{ subgrid: 'N93E70', poiCount: 5 }],
      batchLogs: []
    })
    expect(r.rows).toHaveLength(1)
    expect(r.totals.poi).toBe(5)
  })

  it('isolates single child Daily run counts when deleting from Daily list', () => {
    // 3 daily runs for N93E70: 100 frames/0.3km, 14 frames/0.0km, 50 frames/2.4km (Sum = 164 frames, 2.7km)
    const dailyRuns = [
      { id: 'run-1', subgrid: 'N93E70', date: '2026-03-01', poiCount: 100, availableImagesCount: 100, kmProcessed: 0.3, publishToWebGIS: 'no' },
      { id: 'run-2', subgrid: 'N93E70', date: '2026-03-02', poiCount: 14, availableImagesCount: 14, kmProcessed: 0.0, publishToWebGIS: 'yes' },
      { id: 'run-3', subgrid: 'N93E70', date: '2026-03-03', poiCount: 50, availableImagesCount: 50, kmProcessed: 2.4, publishToWebGIS: 'no' }
    ]
    const masterlistBatch = {
      id: 'batch-1',
      subgrid: 'N93E70',
      imageFilename: 'N93E70-0001.jpg',
      poiCount: 164,
      availableImagesCount: 164,
      kmProcessed: 2.7,
      runsCount: 3,
      status: 'Ongoing'
    }

    // Deleting run-1 (child) from Daily list: must show ONLY 100 frames, 0.3 km, 1 run
    const dailyImpact = computeDeletionImpact({
      mode: 'single',
      subgrids: ['N93E70'],
      dailyData: dailyRuns,
      batchLogs: [masterlistBatch],
      targetRecord: dailyRuns[0],
      sourceTab: 'daily'
    })

    expect(dailyImpact.rows).toHaveLength(1)
    expect(dailyImpact.rows[0].subgrid).toBe('N93E70')
    expect(dailyImpact.rows[0].runs).toBe(1)
    expect(dailyImpact.rows[0].batch).toBe(0)
    expect(dailyImpact.rows[0].poi).toBe(100)
    expect(dailyImpact.rows[0].frames).toBe(100)
    expect(dailyImpact.rows[0].km).toBe(0.3)
    expect(dailyImpact.rows[0].published).toBe(0)
    expect(dailyImpact.totals.poi).toBe(100)
    expect(dailyImpact.totals.km).toBe(0.3)
    expect(dailyImpact.totals.runs).toBe(1)
    expect(dailyImpact.warnings.some((w) => w.includes('2 other run(s) remain'))).toBe(true)

    // Deleting masterlistBatch (parent) from Masterlist: must show 164 frames, 2.7 km, 3 runs
    const masterImpact = computeDeletionImpact({
      mode: 'single',
      subgrids: ['N93E70'],
      dailyData: dailyRuns,
      batchLogs: [masterlistBatch],
      targetRecord: masterlistBatch,
      sourceTab: 'batches'
    })

    expect(masterImpact.rows).toHaveLength(1)
    expect(masterImpact.rows[0].subgrid).toBe('N93E70')
    expect(masterImpact.rows[0].runs).toBe(3)
    expect(masterImpact.rows[0].batch).toBe(1)
    expect(masterImpact.rows[0].poi).toBe(164)
    expect(masterImpact.rows[0].frames).toBe(164)
    expect(masterImpact.rows[0].km).toBe(2.7)
    expect(masterImpact.totals.poi).toBe(164)
    expect(masterImpact.totals.km).toBe(2.7)
    expect(masterImpact.totals.runs).toBe(3)
  })

  it('aggregates only selected records in bulk mode for Daily list and Masterlist', () => {
    const dailyRuns = [
      { id: 'run-1', subgrid: 'N93E70', poiCount: 100, availableImagesCount: 100, kmProcessed: 0.3 },
      { id: 'run-2', subgrid: 'N93E70', poiCount: 14, availableImagesCount: 14, kmProcessed: 0.0 },
      { id: 'run-3', subgrid: 'N94E70', poiCount: 30, availableImagesCount: 30, kmProcessed: 0.5 }
    ]
    const batches = [
      { id: 'batch-1', subgrid: 'N93E70', imageFilename: 'N93E70-0001.jpg', poiCount: 114, kmProcessed: 0.3, runsCount: 2 },
      { id: 'batch-2', subgrid: 'N94E70', imageFilename: 'N94E70-0001.jpg', poiCount: 30, kmProcessed: 0.5, runsCount: 1 }
    ]

    // Bulk delete selecting only run-1 and run-2 on daily list
    const bulkDaily = computeDeletionImpact({
      mode: 'bulk',
      subgrids: ['N93E70'],
      dailyData: dailyRuns,
      batchLogs: batches,
      sourceTab: 'daily',
      selectedIds: new Set(['run-1', 'run-2'])
    })

    expect(bulkDaily.totals.runs).toBe(2)
    expect(bulkDaily.totals.poi).toBe(114)
    expect(bulkDaily.totals.km).toBe(0.3)

    // Bulk delete selecting only batch-2 on masterlist
    const bulkMaster = computeDeletionImpact({
      mode: 'bulk',
      subgrids: ['N94E70'],
      dailyData: dailyRuns,
      batchLogs: batches,
      sourceTab: 'batches',
      selectedIds: new Set(['batch-2'])
    })

    expect(bulkMaster.totals.runs).toBe(1)
    expect(bulkMaster.totals.poi).toBe(30)
    expect(bulkMaster.totals.km).toBe(0.5)
  })
})

