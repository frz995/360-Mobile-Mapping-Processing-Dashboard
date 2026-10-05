import { describe, it, expect } from 'vitest'
import { resolveAuditForRun } from '../items'

// A subgrid surveyed twice: N93E70 on 2022-04-08 and again on 2026-09-27.
// Only the 08 Apr run was audited, with 54 defects.
//
// The audit cache is keyed `${SUBGRID}_${runId}`. The bug this guards against is
// a prefix scan (`key.startsWith('N93E70_')`) that let the unaudited run adopt
// the audited run's record, so both rows reported 54.
const CACHE = {
  'N93E70_spd-n93e70-08apr2022': { subgrid: 'N93E70', defectCount: 54 },
  'N94E71_spd-n94e71-01jun2026': { subgrid: 'N94E71', defectCount: 3 }
}

describe('resolveAuditForRun', () => {
  it('returns the exact run-scoped audit', () => {
    expect(resolveAuditForRun(CACHE, 'N93E70', 'spd-n93e70-08apr2022')).toEqual(CACHE['N93E70_spd-n93e70-08apr2022'])
  })

  it('does not borrow a sibling run of the same subgrid', () => {
    // The 27 Sept run has no audit. It must resolve to nothing, not to 54.
    expect(resolveAuditForRun(CACHE, 'N93E70', 'spd-n93e70-27sep2026')).toBeUndefined()
  })

  it('does not cross subgrids', () => {
    expect(resolveAuditForRun(CACHE, 'N93E70', 'spd-n94e71-01jun2026')).toBeUndefined()
  })

  it('normalises subgrid casing and surrounding whitespace', () => {
    expect(resolveAuditForRun(CACHE, '  n93e70 ', 'spd-n93e70-08apr2022')).toEqual(CACHE['N93E70_spd-n93e70-08apr2022'])
  })

  it('falls back to _default for a run-less (masterlist) lookup', () => {
    const cache = { 'N93E70_default': { subgrid: 'N93E70', defectCount: 7 } }
    expect(resolveAuditForRun(cache, 'N93E70')).toEqual(cache['N93E70_default'])
    expect(resolveAuditForRun(cache, 'N93E70', null)).toEqual(cache['N93E70_default'])
  })

  it('lets a subgrid-level audit reach a run only when nothing more specific exists', () => {
    const onlyDefault = { 'N93E70_default': { subgrid: 'N93E70', defectCount: 7 } }
    expect(resolveAuditForRun(onlyDefault, 'N93E70', 'spd-a')).toEqual(onlyDefault['N93E70_default'])

    // Once a run-scoped audit exists, the subgrid-level one stops over-reporting.
    const mixed = {
      'N93E70_default': { subgrid: 'N93E70', defectCount: 7 },
      'N93E70_spd-a': { subgrid: 'N93E70', defectCount: 2 }
    }
    expect(resolveAuditForRun(mixed, 'N93E70', 'spd-b')).toBeUndefined()
    expect(resolveAuditForRun(mixed, 'N93E70', 'spd-a')).toEqual(mixed['N93E70_spd-a'])
  })

  it('returns undefined for a cache, subgrid or runId that carries no data', () => {
    expect(resolveAuditForRun(null, 'N93E70', 'spd-a')).toBeUndefined()
    expect(resolveAuditForRun({}, 'N93E70', 'spd-a')).toBeUndefined()
    expect(resolveAuditForRun(CACHE, '', 'spd-a')).toBeUndefined()
    expect(resolveAuditForRun(CACHE, null, 'spd-a')).toBeUndefined()
  })

  it('treats a whitespace-only runId as run-less', () => {
    const cache = { 'N93E70_default': { subgrid: 'N93E70', defectCount: 7 } }
    expect(resolveAuditForRun(cache, 'N93E70', '   ')).toEqual(cache['N93E70_default'])
  })

  it('does not let N93E7 match a N93E70 audit by prefix', () => {
    // A shorter subgrid code must not resolve against a longer one's key.
    expect(resolveAuditForRun(CACHE, 'N93E7', 'spd-n93e70-08apr2022')).toBeUndefined()
  })
})
