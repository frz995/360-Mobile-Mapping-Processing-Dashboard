import { describe, it, expect } from 'vitest'
import { neutraliseEventTriggers } from '../../scripts/db-gate-readiness.mjs'

/**
 * Regression cover for the gate script's container-readiness loop.
 *
 * WHY THIS TEST EXISTS
 *   `npm run db:gate` passed on a local machine and failed in CI on the same
 *   commit. The loop counted armed event triggers and slept between attempts
 *   only when that count was POSITIVE. On a cold or slow container the count
 *   query fails instead, so the loop spun through all 60 retries without
 *   pausing, then reported "could not neutralise the base image event triggers"
 *   — a readiness heuristic dressed up as a schema failure. CI booted slower
 *   than the local machine and took that path; a local re-run passed every
 *   time, which is exactly why it needed a test rather than more re-runs.
 *
 *   The behaviour asserted here is the contract: an unreadable count is not a
 *   non-zero count, it pauses, and it does not abort the run.
 */

/** A psql-shaped fake that fails the first `failures` reads. */
const fakeExec = (sequence: Array<{ armed?: number; fail?: boolean; stderr?: string }>) => {
  let calls = 0
  const log: string[] = []
  return {
    log,
    exec(sql: string) {
      const step = sequence[Math.min(calls, sequence.length - 1)]
      const reading = sql.startsWith('SELECT')
      calls += 1
      if (reading) {
        if (step.fail) {
          return { status: 2, stdout: '', stderr: step.stderr || 'the database system is starting up' }
        }
        return { status: 0, stdout: `${step.armed ?? 0}\n`, stderr: '' }
      }
      // The ALTER runs on every non-zero pass.
      return { status: 0, stdout: '', stderr: '' }
    }
  }
}

describe('neutraliseEventTriggers', () => {
  it('returns immediately when nothing is armed', () => {
    const slept: number[] = []
    const f = fakeExec([{ armed: 0 }])

    const result = neutraliseEventTriggers(f.exec, { sleep: () => slept.push(1) })

    expect(result.armed).toBe(0)
    expect(result.attempts).toBe(1)
    expect(slept).toHaveLength(0)
  })

  it('disables triggers until the count reaches zero', () => {
    const slept: number[] = []
    // Reads report 6, then 0 once the ALTER has run.
    let alters = 0
    const result = neutraliseEventTriggers(
      (sql) => {
        if (sql.startsWith('SELECT')) return { status: 0, stdout: `${alters === 0 ? 6 : 0}\n`, stderr: '' }
        alters += 1
        return { status: 0, stdout: '', stderr: '' }
      },
      { sleep: () => slept.push(1) }
    )

    expect(result.armed).toBe(0)
    expect(slept.length).toBeGreaterThan(0)
  })

  it('pauses on a failed read instead of spinning', () => {
    // THE REGRESSION. The count query fails three times (container still
    // booting), then succeeds. An earlier version slept only on a positive
    // count, so this made zero progress between attempts and exhausted its
    // retries against a database that was about to come up fine.
    const slept: number[] = []
    let reads = 0
    const result = neutraliseEventTriggers(
      (sql) => {
        if (!sql.startsWith('SELECT')) return { status: 0, stdout: '', stderr: '' }
        reads += 1
        if (reads <= 3) return { status: 2, stdout: '', stderr: 'the database system is starting up' }
        return { status: 0, stdout: '0\n', stderr: '' }
      },
      { sleep: () => slept.push(1) }
    )

    expect(result.armed).toBe(0)
    expect(reads).toBe(4)
    // One pause per failed read. Zero here is the bug.
    expect(slept.length).toBeGreaterThanOrEqual(3)
  })

  it('reports armed=-1 and does not throw when the count is never readable', () => {
    // Readiness is not knowable up front, so this must be a warning, not an
    // abort: whether the triggers matter is answered by applying the bundle.
    const result = neutraliseEventTriggers(
      () => ({ status: 2, stdout: '', stderr: 'connection refused' }),
      { attempts: 4, sleep: () => {} }
    )

    expect(result.armed).toBe(-1)
    expect(result.attempts).toBe(4)
    expect(result.lastReadError).toContain('connection refused')
  })

  it('treats empty output as unreadable rather than as zero', () => {
    // `Number('') || 0` would read an empty result as "nothing armed" and stop.
    const result = neutraliseEventTriggers(
      () => ({ status: 0, stdout: '\n', stderr: '' }),
      { attempts: 3, sleep: () => {} }
    )

    expect(result.armed).toBe(-1)
  })

  it('does not report success when a positive count persists', () => {
    const result = neutraliseEventTriggers(
      (sql) => (sql.startsWith('SELECT') ? { status: 0, stdout: '2\n', stderr: '' } : { status: 0, stdout: '', stderr: '' }),
      { attempts: 5, sleep: () => {} }
    )

    expect(result.armed).toBe(2)
    expect(result.attempts).toBe(5)
  })
})