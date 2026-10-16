/**
 * Container-readiness loop for the DB gate.
 *
 * WHY THIS IS A SEPARATE MODULE
 *   `run-db-gate.mjs` is a CLI: importing it executes `docker run` and resolves
 *   `fileURLToPath(new URL('..', import.meta.url))`, which throws under Vite's
 *   transform because `import.meta.url` is not a file URL there. The loop is the
 *   part worth testing, so it lives where it can be imported without side
 *   effects.
 *
 * WHAT IT DOES
 *   Disables every event trigger the `supabase/postgres` base image arms. Two of
 *   the GraphQL ones and `pgrst_ddl_watch` all fail the same way — they resolve
 *   a relation that does not exist in the bare image — so the first DROP or
 *   CREATE in the migration bundle aborts with "could not open relation with
 *   OID ...". None of them is part of any migration; they are Supabase service
 *   plumbing for services this schema does not use.
 *
 * THE REGRESSION THIS FUNCTION EXISTS TO PREVENT
 *   An earlier version slept between attempts only when the armed count was
 *   POSITIVE. On a cold or slow container the count query fails rather than
 *   returning a number, so the loop spun through every retry without pausing
 *   and then reported "could not neutralise the base image event triggers" — a
 *   container-readiness heuristic dressed up as a schema failure. `npm run
 *   db:gate` passed repeatedly on a warm local machine and failed in CI on the
 *   same commit, which is what made it worth a test rather than more re-runs.
 *
 *   The contract: an unreadable count is NOT a non-zero count, every
 *   unsuccessful attempt pauses, and nothing here throws. Whether the triggers
 *   actually matter is answered by applying the bundle, which reports the real
 *   Postgres error.
 *
 * THE REGRESSION AFTER THAT: A PREMATURE ZERO
 *   Fixing the pause was not enough. `npm run db:gate` then failed on commit
 *   2134267 in CI and passed on 9eec9d1 four hours earlier — a commit whose diff
 *   touches no SQL at all — and reproduced locally on the first cold run of the
 *   day while passing on the next two. The failure was not in the schema:
 *
 *       bundle.sql:1440: ERROR:  could not open relation with OID 16715
 *       CONTEXT:  SELECT pg_catalog.nextval('graphql.seq_schema_version')
 *
 *   Line 1440 is a `drop policy`: the first DROP in the bundle, which is exactly
 *   what the `sql_drop` triggers fire on. `graphql` exists in the base image and
 *   contains zero relations, so `issue_graphql_placeholder` dereferences a
 *   relation that was never there.
 *
 *   The cause was a premature zero. The image runs its init script against a
 *   TEMPORARY postmaster and then restarts, and `pg_event_trigger` is empty on
 *   that temporary server. Probing the boot at 400ms intervals:
 *
 *       t=6296ms  armed=0     <- the loop broke here and reported success
 *       t=6883ms  armed=8
 *       t=8103ms  FATAL: the database system is shutting down
 *       t=8689ms  armed=6
 *
 *   The old loop took the first zero as definitive. That zero was a true count
 *   of the wrong database, taken before the server that the bundle would
 *   actually be applied to existed. It reported `armed = 0`, so
 *   `run-db-gate.mjs` printed no warning, and the bundle apply then died against
 *   a schema that was still being rebuilt.
 *
 *   A reading is only evidence about the server that will still be there later,
 *   so a zero is now provisional until `confirmReads` consecutive polls agree
 *   AND the postmaster start time has not moved. A moved start time means the
 *   server underneath the loop was replaced, which invalidates every zero
 *   counted before it. `restarts` is reported so a human reading a warn-and-
 *   proceed log can see that the container swapped servers mid-check.
 */

/** One authoritative count of enabled event triggers. */
const COUNT_ARMED =
  "SELECT count(*) FROM pg_event_trigger WHERE evtenabled <> 'D';";

/**
 * Identifies the postmaster instance. A different value means a different
 * server, so every reading taken before the change describes a database that no
 * longer exists.
 */
const POSTMASTER_START = 'SELECT pg_postmaster_start_time();';

/**
 * Disables every enabled event trigger.
 *
 * It has to be a standalone statement: issuing the ALTER from inside a SQL
 * file trips the same broken dependency it is meant to avoid.
 */
const DISABLE_ALL =
  'DO $$ DECLARE r record; BEGIN FOR r IN SELECT evtname FROM pg_event_trigger WHERE evtenabled <> \'D\' LOOP EXECUTE \'ALTER EVENT TRIGGER \' || quote_ident(r.evtname) || \' DISABLE\'; END LOOP; END $$;';

/**
 * @param {(sql: string) => {status: number, stdout: string, stderr: string}} exec
 *   Runs one SQL statement and returns a psql-shaped result. Injected so the
 *   test can make the read fail, and can replay the container's boot.
 * @param {{attempts?: number, waitMs?: number, confirmReads?: number, sleep?: () => void}} [options]
 * @returns {{armed: number, lastReadError: string, attempts: number, restarts: number, settled: boolean}}
 *   `armed` is 0 when the last count read nothing armed, -1 when the count
 *   could never be read, and a positive count when triggers remained armed.
 *   `armed === 0` on its own is NOT success: `settled` says whether the zero
 *   was confirmed across polls on one postmaster. A caller that acts on an
 *   unconfirmed zero is back to the bug this loop exists to prevent.
 */
export function neutraliseEventTriggers(
  exec,
  { attempts = 60, waitMs = 1500, confirmReads = 3, sleep } = {},
) {
  const pause = sleep || (() => {});

  let armed = -1;
  let lastReadError = '';
  let used = 0;
  let agreeingZeros = 0;
  let postmaster = '';
  let restarts = 0;
  let settled = false;

  // The loop runs on `settled`, NOT on `armed !== 0`. An earlier version used
  // the latter, which re-introduced the bug through the back door: a provisional
  // zero satisfies it, so the loop ended on exactly the reading it was supposed
  // to doubt, and the confirming polls below never ran.
  for (let attempt = 0; attempt < attempts && !settled; attempt++) {
    used = attempt + 1;
    const res = exec(COUNT_ARMED);
    const raw = (res.stdout || '').trim();

    if (res.status === 0 && raw !== '') {
      armed = Number(raw) || 0;
      lastReadError = '';
    } else {
      // Not ready yet, or the query failed. Distinct from a non-zero count:
      // nothing is known here, and nothing may be asserted.
      armed = -1;
      lastReadError =
        (res.stderr || '').trim().split('\n').pop() || `psql exited ${res.status}`;
    }

    const pm = exec(POSTMASTER_START);
    const pmRaw = pm.status === 0 ? (pm.stdout || '').trim() : '';
    if (pmRaw && postmaster && pmRaw !== postmaster) {
      // The server was replaced mid-check. Anything counted before this point
      // described the postmaster that just went away, including any run of
      // zeros that was about to be accepted as proof of readiness.
      restarts += 1;
      agreeingZeros = 0;
    }
    if (pmRaw) postmaster = pmRaw;

    agreeingZeros = armed === 0 ? agreeingZeros + 1 : 0;

    // One zero is a reading, not a settled server. Accept it only once several
    // consecutive polls agree and none of them straddled a restart.
    if (armed === 0 && agreeingZeros >= confirmReads) {
      settled = true;
      break;
    }

    if (armed > 0) exec(DISABLE_ALL);

    // Pause on EVERY unsuccessful attempt, including a read that succeeded but
    // is not yet trustworthy. Skipping the pause on provisional reads is how the
    // whole sequence gets sampled inside one init window.
    pause();
  }

  return { armed, lastReadError, attempts: used, restarts, settled };
}

export default neutraliseEventTriggers;