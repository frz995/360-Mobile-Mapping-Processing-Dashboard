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
 */

/**
 * @param {(sql: string) => {status: number, stdout: string, stderr: string}} exec
 *   Runs one SQL statement and returns a psql-shaped result. Injected so the
 *   test can make the read fail on demand.
 * @param {{attempts?: number, waitMs?: number, sleep?: () => void}} [options]
 * @returns {{armed: number, lastReadError: string, attempts: number}}
 *   `armed` is 0 on success, -1 when the count could never be read, and a
 *   positive count when triggers remained armed.
 */
export function neutraliseEventTriggers(exec, { attempts = 60, waitMs = 1500, sleep } = {}) {
  const pause = sleep || (() => {});

  let armed = -1;
  let lastReadError = '';
  let used = 0;

  for (let attempt = 0; attempt < attempts && armed !== 0; attempt++) {
    used = attempt + 1;
    const res = exec("SELECT count(*) FROM pg_event_trigger WHERE evtenabled <> 'D';");
    const raw = (res.stdout || '').trim();

    if (res.status === 0 && raw !== '') {
      armed = Number(raw) || 0;
      lastReadError = '';
    } else {
      // Not ready yet, or the query failed. Distinct from a non-zero count:
      // nothing is known here, and nothing may be asserted.
      armed = -1;
      lastReadError = (res.stderr || '').trim().split('\n').pop() || `psql exited ${res.status}`;
    }

    if (armed === 0) break;

    exec("DO $$ DECLARE r record; BEGIN FOR r IN SELECT evtname FROM pg_event_trigger WHERE evtenabled <> 'D' LOOP EXECUTE 'ALTER EVENT TRIGGER ' || quote_ident(r.evtname) || ' DISABLE'; END LOOP; END $$;");

    // Pause on EVERY unsuccessful attempt, including a failed read. Skipping the
    // pause when the count is unreadable is what turned a slow boot into a
    // spurious failure.
    pause();
  }

  return { armed, lastReadError, attempts: used };
}

export default neutraliseEventTriggers;