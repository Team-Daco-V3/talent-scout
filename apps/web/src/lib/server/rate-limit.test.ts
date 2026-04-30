import { describe, expect, it, vi } from 'vitest';
import { fetchWithRateLimitRetry, retryAfterMs } from './rate-limit';

describe('fetchWithRateLimitRetry', () => {
  it('waits for Retry-After and retries 429 responses', async () => {
    const events: unknown[] = [];
    const waits: number[] = [];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('limited', { status: 429, headers: { 'Retry-After': '3' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const response = await fetchWithRateLimitRetry(
      'https://api.example.com/test',
      {},
      {
        label: 'Test API',
        fetchFn,
        sleepFn: async (ms) => {
          waits.push(ms);
        },
        onRateLimited: (event) => {
          events.push(event);
        }
      }
    );

    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([3000]);
    expect(events).toMatchObject([
      {
        label: 'Test API',
        status: 429,
        retryAttempt: 1,
        maxRetries: 3,
        waitMs: 3000
      }
    ]);
  });

  it('returns the final 429 after retry attempts are exhausted', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('limited', { status: 429 }));

    const response = await fetchWithRateLimitRetry(
      'https://api.example.com/test',
      {},
      {
        fetchFn,
        maxRetries: 2,
        sleepFn: async () => undefined
      }
    );

    expect(response.status).toBe(429);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});

describe('retryAfterMs', () => {
  it('parses seconds and HTTP date values', () => {
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs('Thu, 30 Apr 2026 00:00:10 GMT', Date.parse('Thu, 30 Apr 2026 00:00:00 GMT'))).toBe(10_000);
  });
});
