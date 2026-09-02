import { describe, it, expect } from 'vitest'
import {
  buildPipelineStages,
  stageJobsFor,
  PIPELINE_STAGE_DEFS
} from '../pipelineStages'
import type { PipelineStageCtx } from '../pipelineStages'
import type { PipelineStageKey } from '../../types/production'

const emptyCtx: PipelineStageCtx = { jobs: [], datasets: [], stagingAggregates: [] }

function statusFor(ctx: PipelineStageCtx, key: PipelineStageKey) {
  const stages = buildPipelineStages(ctx)
  return stages.find((s) => s.key === key)?.status
}

describe('buildPipelineStages', () => {
  it('returns all 9 stages', () => {
    expect(buildPipelineStages(emptyCtx)).toHaveLength(9)
  })

  it('starts all stages as WAITING with no data', () => {
    const stages = buildPipelineStages(emptyCtx)
    expect(stages.every((s) => s.status === 'WAITING')).toBe(true)
  })

  it('marks ingestion COMPLETE when a RAW dataset exists', () => {
    const r = statusFor(
      {
        ...emptyCtx,
        datasets: [
          { dataset_type: 'RAW', pipeline_stage: 'STITCH', name: 'raw' }
        ]
      },
      'ingestion'
    )
    expect(r).toBe('COMPLETE')
  })

  it('marks image validation FAILED when a dataset failed', () => {
    const r = statusFor(
      {
        ...emptyCtx,
        datasets: [
          {
            dataset_type: 'RAW',
            pipeline_stage: 'STITCH',
            name: 'raw',
            status: 'FAILED'
          }
        ]
      },
      'image_validation'
    )
    expect(r).toBe('FAILED')
  })

  it('marks metadata validation COMPLETE on an IMPORTED processed dataset', () => {
    const r = statusFor(
      {
        ...emptyCtx,
        datasets: [
          {
            dataset_type: 'PROCESSED',
            pipeline_stage: 'STITCH',
            name: 'proc',
            status: 'IMPORTED'
          }
        ]
      },
      'metadata_validation'
    )
    expect(r).toBe('COMPLETE')
  })

  it('ignores superseded DELIVERABLE datasets for publish', () => {
    const r = statusFor(
      {
        ...emptyCtx,
        datasets: [
          {
            dataset_type: 'DELIVERABLE',
            pipeline_stage: 'QAQC',
            name: 'old',
            superseded_by: 'ds-2'
          }
        ]
      },
      'publish'
    )
    expect(r).toBe('WAITING')
  })

  it('marks blur COMPLETE when a BLUR job completed', () => {
    const r = statusFor(
      { ...emptyCtx, jobs: [{ job_type: 'BLUR', name: 'b', status: 'COMPLETED' }] },
      'privacy_blur'
    )
    expect(r).toBe('COMPLETE')
  })

  it('marks blur IN_PROGRESS with progress percent', () => {
    const stages = buildPipelineStages({
      ...emptyCtx,
      jobs: [{ job_type: 'BLUR', name: 'b', status: 'IN_PROGRESS', progress: 40 }]
    })
    const blur = stages.find((s) => s.key === 'privacy_blur')
    expect(blur?.status).toBe('IN_PROGRESS')
    expect(blur?.pct).toBe(40)
  })

  it('marks data_staging COMPLETE only when all staging subgrids have deliverables', () => {
    const r = statusFor(
      {
        ...emptyCtx,
        stagingAggregates: [{ id: 's1', subgrid: 'N93E70', frames: 50, statuses: {} }],
        datasets: [
          {
            dataset_type: 'DELIVERABLE',
            pipeline_stage: 'QAQC',
            name: 'deliv',
            subgrid: 'N93E70'
          }
        ]
      },
      'data_staging'
    )
    expect(r).toBe('COMPLETE')
  })

  it('marks data_staging IN_PROGRESS when deliverables missing for a staging subgrid', () => {
    const r = statusFor(
      {
        ...emptyCtx,
        stagingAggregates: [{ id: 's1', subgrid: 'N93E70', frames: 50, statuses: {} }],
        datasets: []
      },
      'data_staging'
    )
    expect(r).toBe('IN_PROGRESS')
  })

  it('marks qaqc COMPLETE on an approved QAQC job', () => {
    const r = statusFor(
      {
        ...emptyCtx,
        jobs: [
          { job_type: 'QAQC', name: 'q', qa_decision: 'APPROVED', status: 'COMPLETED' }
        ]
      },
      'qaqc'
    )
    expect(r).toBe('COMPLETE')
  })

  it('marks final_export COMPLETE when export done and deliverable present', () => {
    const r = statusFor(
      {
        ...emptyCtx,
        jobs: [{ job_type: 'EXPORT', name: 'e', status: 'COMPLETED' }],
        datasets: [
          {
            dataset_type: 'DELIVERABLE',
            pipeline_stage: 'QAQC',
            name: 'deliv'
          }
        ]
      },
      'final_export'
    )
    expect(r).toBe('COMPLETE')
  })
})

describe('stageJobsFor', () => {
  it('returns job types for a stage with them', () => {
    expect(stageJobsFor('privacy_blur')).toEqual(['BLUR'])
    expect(stageJobsFor('stitching')).toEqual(['STITCH'])
    expect(stageJobsFor('final_export')).toEqual(['EXPORT', 'REPORT'])
  })

  it('returns empty array for stages without job types', () => {
    expect(stageJobsFor('ingestion')).toEqual([])
    expect(stageJobsFor('publish')).toEqual([])
  })
})

describe('PIPELINE_STAGE_DEFS', () => {
  it('contains exactly 9 stage definitions', () => {
    expect(PIPELINE_STAGE_DEFS).toHaveLength(9)
  })
})
