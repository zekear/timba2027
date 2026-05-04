import { describe, it, expect } from 'vitest';
import { fetchWithTimeout } from '../../src/lib/http.js';

describe('fetchWithTimeout', () => {
  it('aborts when the server is slower than the timeout', async () => {
    // httpbin /delay/5 espera 5s antes de responder; timeout 200ms debe abortar.
    await expect(
      fetchWithTimeout('https://httpbin.org/delay/5', { timeoutMs: 200 }),
    ).rejects.toThrow(/timeout|abort/i);
  }, 10_000);

  it('returns the response when the server is fast enough', async () => {
    const res = await fetchWithTimeout('https://httpbin.org/status/200', { timeoutMs: 5_000 });
    expect(res.ok).toBe(true);
  }, 10_000);
});
