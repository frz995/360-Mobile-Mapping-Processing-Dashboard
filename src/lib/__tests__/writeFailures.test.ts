import { describe, it, expect, beforeEach } from 'vitest'
import {
  reportWriteFailure,
  reportWriteSuccess,
  subscribeWriteFailures,
  getWriteFailures,
  dismissWriteFailure,
  clearWriteFailures,
  type WriteFailure
} from '../writeFailures'

describe('writeFailures', () => {
  beforeEach(() => clearWriteFailures())

  it('records a failed write so the operator can see it', () => {
    reportWriteFailure('qaqc.audit_run', 'QA/QC audit summary', 'duplicate key')

    const [failure] = getWriteFailures()
    expect(failure).toBeDefined()
    expect(failure.op).toBe('qaqc.audit_run')
    expect(failure.label).toBe('QA/QC audit summary')
    expect(failure.detail).toBe('duplicate key')
    expect(failure.count).toBe(1)
    expect(failure.severity).toBe('error')
  })

  it('collapses repeats of the same operation so a retry loop cannot flood the banner', () => {
    reportWriteFailure('qaqc.defect_batch', 'QA/QC defect results', 'first')
    reportWriteFailure('qaqc.defect_batch', 'QA/QC defect results', 'second')
    reportWriteFailure('qaqc.defect_batch', 'QA/QC defect results', 'third')

    const failures = getWriteFailures()
    expect(failures).toHaveLength(1)
    expect(failures[0].count).toBe(3)
    // Latest detail wins so the message reflects the current failure.
    expect(failures[0].detail).toBe('third')
  })

  it('tracks distinct operations separately', () => {
    reportWriteFailure('qaqc.audit_run', 'Audit summary')
    reportWriteFailure('datasets.batch_log', 'Masterlist record')

    expect(getWriteFailures().map((f) => f.op).sort())
      .toEqual(['datasets.batch_log', 'qaqc.audit_run'])
  })

  it('clears a failure once the same write succeeds', () => {
    reportWriteFailure('qaqc.audit_run', 'Audit summary', 'rejected')
    expect(getWriteFailures()).toHaveLength(1)

    reportWriteSuccess('qaqc.audit_run')
    expect(getWriteFailures()).toHaveLength(0)
  })

  it('re-raises a fresh entry when a cleared operation fails again', () => {
    reportWriteFailure('qaqc.audit_run', 'Audit summary')
    reportWriteSuccess('qaqc.audit_run')
    reportWriteFailure('qaqc.audit_run', 'Audit summary')

    const failures = getWriteFailures()
    expect(failures).toHaveLength(1)
    expect(failures[0].count).toBe(1)
  })

  it('ignores a success for an operation that never failed', () => {
    reportWriteSuccess('never.failed')
    expect(getWriteFailures()).toHaveLength(0)
  })

  it('notifies subscribers and stops after unsubscribe', () => {
    const seen: WriteFailure[][] = []
    const unsubscribe = subscribeWriteFailures((snapshot) => seen.push(snapshot))

    reportWriteFailure('a', 'A')
    expect(seen).toHaveLength(2) // initial snapshot + the failure
    expect(seen[seen.length - 1]).toHaveLength(1)

    unsubscribe();
    reportWriteFailure('b', 'B')
    expect(seen).toHaveLength(2)
  })

  it('survives a subscriber that throws', () => {
    const bad = () => { throw new Error('bad listener') };
    // Both the initial snapshot and every later emit must be guarded.
    expect(() => subscribeWriteFailures(bad)).not.toThrow();
    expect(() => reportWriteFailure('a', 'A')).not.toThrow();
    expect(getWriteFailures()).toHaveLength(1);
  })

  it('dismisses one failure without clearing the rest', () => {
    reportWriteFailure('a', 'A')
    reportWriteFailure('b', 'B')

    dismissWriteFailure('a')
    expect(getWriteFailures().map((f) => f.op)).toEqual(['b'])
  })

  it('tolerates a blank operation key', () => {
    reportWriteFailure('   ', 'Fallback label')
    expect(getWriteFailures()).toHaveLength(1)
    expect(getWriteFailures()[0].op).toBe('unknown')
  })

  it('orders the newest failure first', () => {
    reportWriteFailure('a', 'A')
    reportWriteFailure('b', 'B')
    expect(getWriteFailures()[0].op).toBe('b')
  })
})
