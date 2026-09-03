export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  shouldRetry?: (attempt: number, error: unknown) => boolean;
  isRetryable?: (error: unknown) => boolean;
}

export interface RetryResult<T> {
  ok: boolean;
  value?: T;
  error?: unknown;
  attempts: number;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'shouldRetry' | 'isRetryable'>> = {
  retries: 3,
  baseDelayMs: 250,
  maxDelayMs: 3000,
  factor: 2
};

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function isNetworkish(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    const msg = error.message;
    if (msg && /fetch|network|timeout|abort|failed to fetch|ECONNREFUSED|socket hang up|temporary|offline/i.test(msg)) {
      return true;
    }
  }
  return false;
}

/**
 * Run an async operation with exponential back-off retries. On the final
 * failure the original error is rethrown so callers can keep their existing
 * error handling.
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts: Required<Omit<RetryOptions, 'shouldRetry' | 'isRetryable'>> = {
    ...DEFAULT_OPTIONS,
    retries: options.retries ?? DEFAULT_OPTIONS.retries,
    baseDelayMs: options.baseDelayMs ?? DEFAULT_OPTIONS.baseDelayMs,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_OPTIONS.maxDelayMs,
    factor: options.factor ?? DEFAULT_OPTIONS.factor
  };
  const isRetryable = options.isRetryable ?? isNetworkish;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const canRetry = isRetryable(err) && shouldRetry(attempt, err);
      if (!canRetry || attempt >= opts.retries) {
        break;
      }
      const delay = Math.min(opts.baseDelayMs * Math.pow(opts.factor, attempt), opts.maxDelayMs);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Like withRetry but never throws: returns a structured result and
 * rethrows only when a non-retryable error occurred.
 */
export async function withRetryResult<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<RetryResult<T>> {
  const opts: Required<Omit<RetryOptions, 'shouldRetry' | 'isRetryable'>> = {
    ...DEFAULT_OPTIONS,
    retries: options.retries ?? DEFAULT_OPTIONS.retries,
    baseDelayMs: options.baseDelayMs ?? DEFAULT_OPTIONS.baseDelayMs,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_OPTIONS.maxDelayMs,
    factor: options.factor ?? DEFAULT_OPTIONS.factor
  };
  const isRetryable = options.isRetryable ?? isNetworkish;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt += 1) {
    try {
      const value = await operation();
      return { ok: true, value, attempts: attempt + 1 };
    } catch (err) {
      lastError = err;
      const canRetry = isRetryable(err) && shouldRetry(attempt, err);
      if (!canRetry || attempt >= opts.retries) {
        break;
      }
      const delay = Math.min(opts.baseDelayMs * Math.pow(opts.factor, attempt), opts.maxDelayMs);
      await sleep(delay);
    }
  }
  return { ok: false, error: lastError, attempts: opts.retries + 1 };
}
