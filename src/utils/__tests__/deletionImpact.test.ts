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
})
