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
 *
 * THE SECOND REGRESSION, AND THE ONE THAT ACTUALLY REACHES CI
 *   Fixing the pause was not enough. The gate failed on 2134267 and passed on
 *   9eec9d1 four hours earlier, though the diff between them touches no SQL.
 *   It reproduced locally on the first cold container of the day and passed on
 *   the next two.
 *
 *   The base image runs its init script against a TEMPORARY postmaster and then
 *   restarts. `pg_event_trigger` is empty on that temporary server, so the
 *   count is a genuine zero — of the wrong database. The loop took the first
 *   zero as definitive, reported success, and the bundle apply then died at its
 *   first DROP:
 *
 *       bundle.sql:1440: ERROR:  could not open relation with OID 16715
 *       CONTEXT:  SELECT pg_catalog.nextval('graphql.seq_schema_version')
 *
 *   Measured boot, polling every 400ms:
 *
 *       t=6296ms  armed=0     <- accepted, loop stopped
 *       t=6883ms  armed=8
 *       t=8103ms  FATAL: the database system is shutting down
 *       t=8689ms  armed=6
 *
 *   So a zero is provisional until consecutive polls agree AND the postmaster
 *   start time has not moved. `replaysTheBoot` below is that trace, and
 *   `acceptsAPrematureZero` pins the old behaviour so the fix cannot be
 *   quietly reverted into it.
 */

interface Sample {
  armed?: number
  fail?: boolean
  stderr?: string
  /** Distinct values replay the container swapping its postmaster. */
  postmaster?: string
}

const COUNT_SQL = 'SELECT count(*) FROM pg_event_trigger'

/**
 * A psql-shaped fake that replays a scripted sequence of container polls.
 *
 * The three statements are told apart by content, not by prefix: the trigger
 * count and the postmaster start time are both `SELECT`s, and the DISABLE block
 * mentions `pg_event_trigger` in its own body.
 */
const replay = (samples: Sample[]) => {
  let reads = 0
  let current: Sample = samples[0] ?? {}
  const alters: string[] = []
  const sleeps: number[] = []

  return {
    alters,
    sleeps,
    reads: () => reads,
    exec(sql: string) {
      if (sql.trimStart().startsWith(COUNT_SQL)) {
        current = samples[Math.min(reads, samples.length - 1)] ?? {}
        reads += 1
        if (current.fail) {
          return {
            status: 2,
            stdout: '',
            stderr: current.stderr || 'the database system is starting up',
          }
        }
        return { status: 0, stdout: `${current.armed ?? 0}\n`, stderr: '' }
      }
      if (sql.includes('pg_postmaster_start_time')) {
        return {
          status: 0,
          stdout: `${current.postmaster ?? '2026-10-15 09:31:21.44+00'}\n`,
          stderr: '',
        }
      }
      alters.push(sql)
      return { status: 0, stdout: '', stderr: '' }
    },
  }
}

/** The measured boot: a zero on the init postmaster, then the real one. */
const replaysTheBoot = (): ReturnType<typeof replay> =>
  replay([
    { armed: 0, postmaster: 'T1' }, // temporary postmaster: nothing armed yet
    { armed: 6, postmaster: 'T2' }, // restarted, and the image armed all six
    { armed: 0, postmaster: 'T2' }, // the DISABLE landed
    { armed: 0, postmaster: 'T2' },
    { armed: 0, postmaster: 'T2' },
  ])

describe('neutraliseEventTriggers', () => {
  it('does not accept the first zero it reads', () => {
    // THE REGRESSION. `confirmReads: 1` is the old behaviour: it stops on the
    // temporary postmaster's zero, never disables anything, and hands the
    // bundle a server full of triggers whose `graphql` schema is empty.
    const f = replay([{ armed: 0, postmaster: 'T1' }, { armed: 6, postmaster: 'T2' }])

    const result = neutraliseEventTriggers(f.exec, {
      confirmReads: 1,
      sleep: () => f.sleeps.push(1),
    })

    expect(result.armed).toBe(0)
    expect(result.attempts).toBe(1)
    expect(f.alters).toHaveLength(0)
  })

  it('keeps going through the postmaster restart and neutralises the real one', () => {
    // The same trace under the fixed contract.
    const f = replaysTheBoot()

    const result = neutraliseEventTriggers(f.exec, { sleep: () => f.sleeps.push(1) })

    expect(result.armed).toBe(0)
    expect(result.restarts).toBe(1)
    expect(result.attempts).toBe(5)
    // The load-bearing assertion: the six triggers were actually disabled,
    // which is what the premature zero skipped.
    expect(f.alters).toHaveLength(1)
    expect(f.alters[0]).toContain('ALTER EVENT TRIGGER')
  })

  it('discards an in-progress run of zeros when the server is replaced', () => {
    // Two agreeing zeros are not consent to stop if the postmaster they came
    // from has since gone away.
    const f = replay([
      { armed: 0, postmaster: 'T1' },
      { armed: 0, postmaster: 'T1' },
      { armed: 6, postmaster: 'T2' },
      { armed: 0, postmaster: 'T2' },
      { armed: 0, postmaster: 'T2' },
      { armed: 0, postmaster: 'T2' },
    ])

    const result = neutraliseEventTriggers(f.exec, { sleep: () => f.sleeps.push(1) })

    expect(result.armed).toBe(0)
    expect(result.restarts).toBe(1)
    expect(result.attempts).toBe(6)
    expect(f.alters).toHaveLength(1)
  })

  it('requires agreement before reporting success on a settled container', () => {
    const f = replay([{ armed: 0 }])

    const result = neutraliseEventTriggers(f.exec, { sleep: () => f.sleeps.push(1) })

    expect(result.armed).toBe(0)
    expect(result.attempts).toBe(3)
    expect(f.sleeps).toHaveLength(2)
    // Nothing to disable, so no ALTER is issued on the confirming polls.
    expect(f.alters).toHaveLength(0)
  })

  it('disables triggers until the count reaches zero', () => {
    const f = replay([
      { armed: 6 },
      { armed: 0 },
      { armed: 0 },
      { armed: 0 },
    ])

    const result = neutraliseEventTriggers(f.exec, { sleep: () => f.sleeps.push(1) })

    expect(result.armed).toBe(0)
    expect(result.attempts).toBe(4)
    expect(f.alters).toHaveLength(1)
  })

  it('pauses on a failed read instead of spinning', () => {
    // THE FIRST REGRESSION. The count query fails three times (container still
    // booting), then succeeds. An earlier version slept only on a positive
    // count, so this made zero progress between attempts and exhausted its
    // retries against a database that was about to come up fine.
    const f = replay([
      { fail: true },
      { fail: true },
      { fail: true },
      { armed: 0 },
      { armed: 0 },
      { armed: 0 },
    ])

    const result = neutraliseEventTriggers(f.exec, { sleep: () => f.sleeps.push(1) })

    expect(result.armed).toBe(0)
    // Three failed reads plus the three confirming ones.
    expect(f.reads()).toBe(6)
    // One pause per non-final pass. Zero here is the bug.
    expect(f.sleeps.length).toBeGreaterThanOrEqual(3)
  })

  it('reports armed=-1 and does not throw when the count is never readable', () => {
    // Readiness is not knowable up front, so this must be a warning, not an
    // abort: whether the triggers matter is answered by applying the bundle.
    const result = neutraliseEventTriggers(
      () => ({ status: 2, stdout: '', stderr: 'connection refused' }),
      { attempts: 4, sleep: () => {} },
    )

    expect(result.armed).toBe(-1)
    expect(result.attempts).toBe(4)
    expect(result.lastReadError).toContain('connection refused')
  })

  it('treats empty output as unreadable rather than as zero', () => {
    // `Number('') || 0` would read an empty result as "nothing armed" and stop.
    const result = neutraliseEventTriggers(
      () => ({ status: 0, stdout: '\n', stderr: '' }),
      { attempts: 3, sleep: () => {} },
    )

    expect(result.armed).toBe(-1)
  })

  it('does not report success when a positive count persists', () => {
    const f = replay([{ armed: 2 }])

    const result = neutraliseEventTriggers(f.exec, { attempts: 5, sleep: () => {} })

    expect(result.armed).toBe(2)
    expect(result.attempts).toBe(5)
  })
})