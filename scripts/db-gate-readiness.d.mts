/**
 * Types for `scripts/db-gate-readiness.mjs`.
 *
 * Declaration file rather than enabling `allowJs`, matching the existing
 * `scripts/bootstrap-migrations.d.mts`. The scripts directory is outside
 * `tsconfig.json`'s `include`, so a `.d.mts` beside the module is how the test
 * suite gets types for it without pulling the whole tree into the app build.
 */

/** Shape of a `psql` invocation result, as `child_process.spawnSync` returns. */
export interface PsqlResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface NeutraliseOptions {
  /** Maximum passes before giving up. Default 60. */
  attempts?: number;
  /** Nominal pause between passes, for callers that provide their own `sleep`. */
  waitMs?: number;
  /**
   * Consecutive polls that must report zero before the container is called
   * settled. Default 3.
   *
   * The base image counts zero on the temporary postmaster it runs its init
   * script against, so a single zero is a true count of the wrong database.
   */
  confirmReads?: number;
  /** Injected pause. Tests pass a counter so they can assert it was called. */
  sleep?: () => void;
}

export interface NeutraliseResult {
  /**
   * What the last count read.
   *
   * 0 when nothing was armed, -1 when the count could never be read —
   * container readiness, not a schema property, and must not be conflated with
   * a positive count. A positive count means triggers remained armed.
   *
   * Not a success signal on its own; see `settled`.
   */
  armed: number;
  /** Last read failure, or '' when the last read succeeded. */
  lastReadError: string;
  /** Passes actually taken. */
  attempts: number;
  /**
   * Times the postmaster start time changed mid-check, i.e. how often the
   * container replaced its server. Non-zero means earlier readings described a
   * database that no longer existed.
   */
  restarts: number;
  /**
   * True when a zero was confirmed across `confirmReads` consecutive polls on
   * an unchanged postmaster.
   *
   * `armed === 0 && !settled` means the retries ran out on an unconfirmed zero.
   * That is not success and must not be treated as it.
   */
  settled: boolean;
}

/**
 * Disable every event trigger the `supabase/postgres` base image arms.
 * Never throws; see the module comment in the `.mjs`.
 */
export declare function neutraliseEventTriggers(
  exec: (sql: string) => PsqlResult,
  options?: NeutraliseOptions
): NeutraliseResult;

export default neutraliseEventTriggers;