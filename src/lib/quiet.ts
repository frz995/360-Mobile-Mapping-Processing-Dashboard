/**
 * data-quiet mode (dev-only): suppress non-fatal console noise from workers
 * and legacy analysis paths once Sentry/telemetry logging is live, without
 * touching production console output by default.
 *
 * The flag can be armed via `localStorage.geosphere_quiet === '1'` or the
 * build-time `import.meta.env.VITE_DATA_QUIET === '1'`.
 */

const STORAGE_KEY = 'geosphere_quiet';

function readQuiet(): boolean {
  if (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_DATA_QUIET === '1' || import.meta.env?.VITE_DATA_QUIET === true)) {
    return true;
  }
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1');
  } catch {
    return false;
  }
}

let quiet = readQuiet();

export function isDataQuiet(): boolean {
  return quiet;
}

export function setDataQuiet(next: boolean): void {
  quiet = next;
  try {
    if (next) {
      localStorage.setItem(STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

/**
 * Gate a non-fatal warning: silently drops it in data-quiet mode, otherwise
 * emits via console.warn (routed to the telemetry sink when available).
 */
export function quietWarn(scope: string, ...args: unknown[]): void {
  if (quiet) return;
  if (typeof console !== 'undefined') {
    console.warn(`[${scope}]`, ...args);
  }
}

/**
 * Gate a non-fatal debug log: only emitted when data-quiet is OFF.
 */
export function quietLog(scope: string, ...args: unknown[]): void {
  if (quiet) return;
  if (typeof console !== 'undefined') {
    console.log(`[${scope}]`, ...args);
  }
}
