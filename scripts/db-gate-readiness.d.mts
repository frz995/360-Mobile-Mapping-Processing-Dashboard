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
  /** Injected pause. Tests pass a counter so they can assert it was called. */
  sleep?: () => void;
}

export interface NeutraliseResult {
  /**
   * 0 when every trigger was disabled.
   *
   * -1 when the count could never be read — container readiness, not a schema
   * property. Must not be conflated with a positive count.
   */
  armed: number;
  /** Last read failure, or '' when the last read succeeded. */
  lastReadError: string;
  /** Passes actually taken. */
  attempts: number;
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