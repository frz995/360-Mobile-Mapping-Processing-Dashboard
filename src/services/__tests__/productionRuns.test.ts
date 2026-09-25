import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock, getServiceProjectIdMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getServiceProjectIdMock: vi.fn()
}))

vi.mock('../api/client', () => ({
  getServiceProjectId: getServiceProjectIdMock,
  supabase: { from: fromMock }
}))

import {
  checkProductionPublicationEligibility,
  fetchProductionReleaseHandoffStatus,
  markReleasePublished,
  saveProductionRelease,
  syncProductionAttemptForQaDecision
} from '../api/productionRuns'

type QueryResponse = { data: unknown[]; error: { message: string } | null }

const run = {
  id: 'run-1',
  active_release_id: 'release-1',
  subgrid: 'N93E70',
  capture_date: '2026-09-25',
  run_code: 'N93E70-2026-09-25-R001',
  source_folder: '05_Final/N93E70'
}

const release = {
  id: 'release-1',
  production_run_id: 'run-1',
  attempt_id: 'attempt-1',
  subgrid: 'N93E70',
  status: 'READY',
  is_active: true
}

const attempt = {
  id: 'attempt-1',
  status: 'APPROVED',
  processing_job_id: 'job-1'
}

const job = {
  id: 'job-1',
  qa_decision: 'APPROVED',
  production_run_id: 'run-1',
  production_attempt_id: 'attempt-1'
}

const validManifest = {
  schemaVersion: 1 as const,
  projectId: 'project-1',
  runId: 'run-1',
  attemptId: 'attempt-1',
  subgrid: 'N93E70',
  runCode: 'N93E70-2026-09-25-R001',
  captureDate: '2026-09-25',
  sourceFolder: '05_Final/N93E70',
  releaseFolder: '/DELIVERABLES/N93E70/N93E70-2026-09-25-R001',
  generatedAt: '2026-09-25T00:00:00.000Z',
  files: [],
  csvFiles: [],
  fileCount: 0,
  totalSizeBytes: 0
}

function makeBuilder(response: QueryResponse) {
  const chain: any = {}
  for (const method of ['select', 'eq', 'neq', 'order', 'limit', 'range', 'is', 'in', 'update', 'insert', 'upsert', 'delete']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn(async () => ({ ...response, data: response.data[0] || null }))
  chain.single = vi.fn(async () => ({ ...response, data: response.data[0] || null }))
  chain.then = (resolve: (value: QueryResponse) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(response).then(resolve, reject)
  return chain
}

function setResponses(overrides: Record<string, QueryResponse> = {}) {
  const responses: Record<string, QueryResponse> = {
    production_runs: { data: [run], error: null },
    production_releases: { data: [release], error: null },
    production_run_attempts: { data: [attempt], error: null },
    processing_jobs: { data: [job], error: null },
    ...overrides
  }
  fromMock.mockImplementation((table: string) => makeBuilder(responses[table] || { data: [], error: null }))
}

describe('checkProductionPublicationEligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServiceProjectIdMock.mockReturnValue('project-1')
    setResponses()
  })

  it('allows an approved active release with a complete handoff', async () => {
    const result = await checkProductionPublicationEligibility({
      subgrid: 'N93E70',
      date: '2026-09-25',
      productionRunId: 'run-1',
      productionAttemptId: 'attempt-1',
      productionReleaseId: 'release-1'
    })

    expect(result).toEqual(expect.objectContaining({
      managed: true,
      allowed: true,
      productionRunId: 'run-1',
      productionAttemptId: 'attempt-1',
      productionReleaseId: 'release-1'
    }))
  })

  it('blocks a managed run without an active release', async () => {
    setResponses({
      production_runs: {
        data: [{ ...run, active_release_id: null }],
        error: null
      }
    })

    const result = await checkProductionPublicationEligibility({
      subgrid: 'N93E70',
      date: '2026-09-25'
    })

    expect(result.managed).toBe(true)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('no active release')
  })

  it('blocks ambiguous matching runs', async () => {
    setResponses({
      production_runs: {
        data: [run, { ...run, id: 'run-2', active_release_id: 'release-2' }],
        error: null
      }
    })

    const result = await checkProductionPublicationEligibility({
      subgrid: 'N93E70',
      date: '2026-09-25'
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Multiple active production releases')
  })

  it('blocks a stale inactive release pointer', async () => {
    setResponses({
      production_releases: {
        data: [{ ...release, is_active: false }],
        error: null
      }
    })

    const result = await checkProductionPublicationEligibility({
      subgrid: 'N93E70',
      date: '2026-09-25',
      productionRunId: 'run-1'
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('no longer active')
  })

  it('preserves legacy publication when no production run matches', async () => {
    setResponses({ production_runs: { data: [], error: null } })

    const result = await checkProductionPublicationEligibility({
      subgrid: 'N93E70',
      date: '2026-09-25'
    })

    expect(result).toEqual(expect.objectContaining({ managed: false, allowed: true }))
  })

  it('fails closed when an explicit run identity is missing', async () => {
    setResponses({ production_runs: { data: [], error: null } })

    const result = await checkProductionPublicationEligibility({
      subgrid: 'N93E70',
      date: '2026-09-25',
      productionRunId: 'run-1'
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('missing')
  })

  it('fails closed when the run verification query fails', async () => {
    setResponses({
      production_runs: { data: [], error: { message: 'database unavailable' } }
    })

    await expect(checkProductionPublicationEligibility({
      subgrid: 'N93E70',
      date: '2026-09-25'
    })).rejects.toThrow('database unavailable')
  })

  it('accepts worker absolute manifest paths for the canonical request', async () => {
    setResponses({ production_releases: { data: [release], error: null } })

    const result = await saveProductionRelease({
      productionRunId: 'run-1',
      attemptId: 'attempt-1',
      sourceFolder: '05_Final/N93E70',
      releaseFolder: validManifest.releaseFolder,
      manifest: {
        ...validManifest,
        sourceFolder: '/nas/360_images/05_Final/N93E70',
        releaseFolder: '/nas/360_images/DELIVERABLES/N93E70/N93E70-2026-09-25-R001'
      }
    })

    expect(result).toEqual(release)
  })

  it('rejects active releases with a non-publishable status', async () => {
    await expect(saveProductionRelease({
      productionRunId: 'run-1',
      attemptId: 'attempt-1',
      sourceFolder: '05_Final/N93E70',
      releaseFolder: validManifest.releaseFolder,
      manifest: validManifest,
      status: 'ARCHIVED',
      isActive: true
    })).rejects.toThrow('Only READY or PUBLISHED releases can be active')
  })

  it('rejects non-canonical release folders before persisting', async () => {
    await expect(saveProductionRelease({
      productionRunId: 'run-1',
      attemptId: 'attempt-1',
      sourceFolder: '05_Final/N93E70',
      releaseFolder: '/DELIVERABLES/N93E70/not-the-run',
      manifest: validManifest
    })).rejects.toThrow('canonical production release path')
  })

  it('blocks handoff when the attempt has no processing job', async () => {
    setResponses({
      production_run_attempts: {
        data: [{ ...attempt, processing_job_id: null }],
        error: null
      }
    })

    const result = await fetchProductionReleaseHandoffStatus('run-1', 'attempt-1', 'release-1')

    expect(result.ready).toBe(false)
    expect(result.reason).toContain('not linked')
  })

  it('blocks handoff for a superseded inactive release', async () => {
    setResponses({
      production_releases: {
        data: [{ ...release, is_active: false }],
        error: null
      }
    })

    const result = await fetchProductionReleaseHandoffStatus('run-1', 'attempt-1', 'release-1')

    expect(result.ready).toBe(false)
    expect(result.reason).toContain('no longer active')
  })

  it('blocks handoff when the remote QA decision is not approved', async () => {
    setResponses({
      processing_jobs: {
        data: [{ ...job, qa_decision: 'REJECTED' }],
        error: null
      }
    })

    const result = await fetchProductionReleaseHandoffStatus('run-1', 'attempt-1', 'release-1')

    expect(result.ready).toBe(false)
    expect(result.reason).toContain('APPROVED QA decision')
  })

  it('synchronizes the linked attempt after a remote QA approval', async () => {
    const result = await syncProductionAttemptForQaDecision('job-1', 'APPROVED')

    expect(result).toEqual(expect.objectContaining({
      id: 'attempt-1',
      status: 'APPROVED',
      processing_job_id: 'job-1'
    }))
  })

  it('cleans superseded pointers when publishing a release', async () => {
    const result = await markReleasePublished('release-1', 'operator@example.com')

    expect(result).toEqual(expect.objectContaining({ id: 'release-1' }))
    expect(fromMock.mock.calls.filter(([table]) => table === 'production_runs')).toHaveLength(2)
    expect(fromMock.mock.calls.filter(([table]) => table === 'production_releases')).toHaveLength(3)
  })

  it('rejects manifests whose identity does not match the run', async () => {
    await expect(saveProductionRelease({
      productionRunId: 'run-1',
      attemptId: 'attempt-1',
      sourceFolder: '05_Final/N93E70',
      releaseFolder: validManifest.releaseFolder,
      manifest: { ...validManifest, subgrid: 'N93E71' }
    })).rejects.toThrow('identity does not match')
  })

  it('allows a legacy record when no project is active', async () => {
    getServiceProjectIdMock.mockReturnValue(null)

    const result = await checkProductionPublicationEligibility({
      subgrid: 'N93E70',
      date: '2026-09-25'
    })

    expect(result.managed).toBe(false)
    expect(result.allowed).toBe(true)
    expect(fromMock).not.toHaveBeenCalled()
  })
})
