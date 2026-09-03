import { describe, it, expect } from 'vitest';
import { withRetry, withRetryResult } from '../retry';

const FAST = { baseDelayMs: 1, factor: 1, maxDelayMs: 2 };

function failing(failures: number, error = new Error('fetch failed')) {
  let calls = 0;
  return async () => {
    calls += 1;
    if (calls <= failures) throw error;
    return 'ok';
  };
}

describe('withRetry', () => {
  it('returns the value on the first success', async () => {
    await expect(withRetry(async () => 42, FAST)).resolves.toBe(42);
  });

  it('retries until success and returns the value', async () => {
    const op = failing(2);
    await expect(withRetry(op, { ...FAST, retries: 3 })).resolves.toBe('ok');
  });

  it('rethrows the original error when retries are exhausted', async () => {
    const err = new Error('fetch failed');
    const op = failing(10, err);
    await expect(withRetry(op, { ...FAST, retries: 2 })).rejects.toBe(err);
  });

  it('only retries retryable (network-ish) errors', async () => {
    const op = failing(10, new Error('schema conflict'));
    await expect(withRetry(op, { ...FAST, retries: 3 })).rejects.toThrow('schema conflict');
  });

  it('supports a custom isRetryable predicate', async () => {
    const op = failing(3, new Error('whatever'));
    await expect(withRetry(op, { ...FAST, retries: 4, isRetryable: () => true })).resolves.toBe('ok');
  });
});

describe('withRetryResult', () => {
  it('returns ok:true with value on success', async () => {
    const res = await withRetryResult(async () => 'value', FAST);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe('value');
  });

  it('returns ok:false with the final error after exhaustion', async () => {
    const err = new Error('fetch failed');
    const res = await withRetryResult(failing(10, err), { ...FAST, retries: 2 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(err);
  });
});
