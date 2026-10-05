import { describe, it, expect } from 'vitest'
import { resolveRunDefectCount, buildQaqcStatus } from '../defectCounts'

// N93E70 surveyed twice. The 2022-04-08 run was audited (54 defects); the
// 2026-09-27 run was not. Both rows used to report 54 because two independent
// derivations existed and one of them fell back to a subgrid-wide tally.
const RUN_AUDITED = { subgrid: 'N93E70', runId: 'spd-n93e70-08apr2022' }
const RUN_UNAUDITED = { subgrid: 'N93E70', runId: 'spd-n93e70-27sep2026' }

describe('resolveRunDefectCount', () => {
  it('prefers run-scoped defect rows over anything coarser', () => {
    expect(
      resolveRunDefectCount({ ...RUN_AUDITED, fromRunRows: 54, fromRunAudit: 50, fromSubgridRows: 92 })
    ).toBe(54)
  })

  it('falls back to the run own audit summary when no rows exist', () => {
    expect(resolveRunDefectCount({ ...RUN_AUDITED, fromRunAudit: 54, fromSubgridRows: 92 })).toBe(54)
  })

  it('does not hand one run a sibling run count', () => {
    // No run-scoped source at all for this run. Only the legacy subgrid-wide
    // tally exists, so it is used — but a sibling run's audit summary is not
    // reachable through this function, which is the point.
    expect(resolveRunDefectCount(RUN_UNAUDITED)).toBe(0)
  })

  it('treats a clean audit as zero rather than falling through', () => {
    // A run audited with 0 defects must read 0, not inherit a legacy total.
    expect(resolveRunDefectCount({ ...RUN_AUDITED, fromRunAudit: 0, fromSubgridRows: 92 })).toBe(0)
    expect(resolveRunDefectCount({ ...RUN_AUDITED, fromRunRows: 0, fromRunAudit: 12 })).toBe(0)
  })

  it('clamps to the run ceiling', () => {
    expect(resolveRunDefectCount({ ...RUN_AUDITED, fromRunAudit: 54, ceiling: 10 })).toBe(10)
  })

  it('does not clamp when no ceiling is known', () => {
    expect(resolveRunDefectCount({ ...RUN_AUDITED, fromRunAudit: 54, ceiling: 0 })).toBe(54)
    expect(resolveRunDefectCount({ ...RUN_AUDITED, fromRunAudit: 54, ceiling: null })).toBe(54)
  })

  it('ignores non-finite and negative counts', () => {
    expect(resolveRunDefectCount({ ...RUN_AUDITED, fromRunAudit: NaN, fromSubgridRows: 5 })).toBe(5)
    expect(resolveRunDefectCount({ ...RUN_AUDITED, fromRunAudit: -3 })).toBe(0)
  })
})

describe('buildQaqcStatus', () => {
  it('distinguishes a clean audit from an absent one', () => {
    expect(buildQaqcStatus({ defectCount: 0, isPublished: true, hasAudit: true }))
      .toBe('Published (QAQC Verified)')
    expect(buildQaqcStatus({ defectCount: 0, isPublished: false, hasAudit: true }))
      .toBe('QAQC Passed (Ready to Publish)')
  })

  it('pluralises correctly at 1', () => {
    expect(buildQaqcStatus({ defectCount: 1, isPublished: false, hasAudit: true }))
      .toBe('QAQC Flagged (1 Defect Found)')
    expect(buildQaqcStatus({ defectCount: 2, isPublished: false, hasAudit: true }))
      .toBe('QAQC Flagged (2 Defects Found)')
  })

  it('does not relabel an unaudited row as passed', () => {
    // Absence of evidence is not evidence of quality.
    expect(buildQaqcStatus({ defectCount: 0, isPublished: false, hasAudit: false })).toBeUndefined()
  })

  it('preserves an existing status when there is no audit', () => {
    expect(
      buildQaqcStatus({ defectCount: 0, isPublished: false, hasAudit: false, existing: 'In Process' })
    ).toBe('In Process')
  })

  it('lets an audit supersede an existing status', () => {
    expect(
      buildQaqcStatus({ defectCount: 3, isPublished: false, hasAudit: true, existing: 'In Process' })
    ).toBe('QAQC Flagged (3 Defects Found)')
  })
})
