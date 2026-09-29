// Cancellation plumbing for the Pages Functions that proxy to on-prem
// services.
//
// Why this exists: the browser aborts a slow request (see the 10s
// `AbortSignal.timeout` in src/services/productionApi.ts), but a proxy whose
// upstream `fetch` carries no signal keeps reading the NAS with nobody waiting
// for the answer. On a recursive NAS walk that is minutes of wasted I/O per
// abandoned click, and it burns the Pages request that would otherwise serve
// the next user.
//
// Two things can end an upstream call, and they need different answers:
//   - the client hung up    -> stop immediately, report 499 (nobody is reading)
//   - our own timeout fired -> the client is still there, report 504
// A third case, the transport itself failing, stays a 502.
//
// Cloudflare Workers has no `setTimeout`-based cancellation of the enclosing
// invocation, so the timeout is an AbortController the caller disposes.

const CLIENT_CLOSED = 499;
const UPSTREAM_TIMEOUT = 504;

/**
 * Build a signal for the upstream call that fires when either the client
 * disconnects or `timeoutMs` elapses.
 *
 * `request.signal` is used when present but never trusted as the only source:
 * in some runtime paths it is absent or already-aborted, and a proxy that
 * inherits a dead signal would fail every request.
 */
export function upstreamSignal(request, timeoutMs) {
  const controller = new AbortController();
  const state = { timedOut: false, clientClosed: false, timer: null };

  const clientSignal = request && request.signal;
  let onClientAbort = null;
  if (clientSignal) {
    if (clientSignal.aborted) {
      state.clientClosed = true;
      controller.abort(new DOMException('Client closed the request', 'AbortError'));
    } else {
      onClientAbort = () => {
        state.clientClosed = true;
        controller.abort(new DOMException('Client closed the request', 'AbortError'));
      };
      clientSignal.addEventListener('abort', onClientAbort, { once: true });
    }
  }

  if (timeoutMs > 0) {
    state.timer = setTimeout(() => {
      state.timedOut = true;
      controller.abort(new DOMException('Upstream timed out', 'TimeoutError'));
    }, timeoutMs);
  }

  // Detach from the client signal as well as clearing the timer: the response
  // is already on its way out, so a later abort must not touch this
  // controller (and a retained listener would pin it for the request's life).
  const dispose = () => {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (onClientAbort && clientSignal) {
      clientSignal.removeEventListener('abort', onClientAbort);
      onClientAbort = null;
    }
  };

  return { signal: controller.signal, state, dispose };
}

/** True when the abort came from a timer we set rather than the client. */
function isAbort(error) {
  if (!error) return false;
  return (
    error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    /abort|timed out|timeout/i.test(String(error.message || error))
  );
}

/**
 * Map an upstream failure onto the status the browser should see.
 *
 * Without this a client disconnect is reported as a 502 "service unreachable",
 * which is both untrue and misleading: the service was fine, the caller left.
 */
export function classifyUpstreamError(error, state) {
  if (isAbort(error)) {
    if (state && state.timedOut && !state.clientClosed) {
      return { status: UPSTREAM_TIMEOUT, message: 'Upstream service timed out.' };
    }
    return { status: CLIENT_CLOSED, message: 'Client closed the request.' };
  }
  return { status: 502, message: null };
}

export const PROXY_STATUS = { CLIENT_CLOSED, UPSTREAM_TIMEOUT };
