import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestProvider } from '@/lib/server/provider-request';

const CREDENTIALS = { veid: '123', apiKey: 'synthetic-key' };
const success = () => Response.json({ error: 0 });

afterEach(() => { vi.useRealTimers(); });

describe('bounded basic-read recovery', () => {
  it('retries a network failure once', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Synthetic network failure'))
      .mockResolvedValueOnce(success());
    const pending = requestProvider('getServiceInfo', CREDENTIALS, false, {
      fetcher, timeoutMs: 1000, random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(150);
    await expect(pending).resolves.toEqual({ error: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('caps unsuccessful retries at two total dispatches', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      return new Response('failure', { status: 503 });
    });
    const pending = requestProvider('getServiceInfo', CREDENTIALS, false, {
      fetcher, timeoutMs: 1000, random: () => 0,
    });
    const assertion = expect(pending).rejects.toMatchObject({ status: 502 });
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps retries inside one total deadline', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('failure', { status: 503 }))
      .mockImplementationOnce(() => new Promise(() => {}));
    const pending = requestProvider('getServiceInfo', CREDENTIALS, false, {
      fetcher, timeoutMs: 300, random: () => 0,
    });
    const assertion = expect(pending).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(300);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('rate and action contract boundaries', () => {
  it('waits for a short Retry-After before the single permitted retry', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('limited', {
        status: 429, headers: { 'Retry-After': '1' },
      }))
      .mockResolvedValueOnce(success());
    const pending = requestProvider('getServiceInfo', CREDENTIALS, false, {
      fetcher, timeoutMs: 3000,
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ error: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not retry the slower live endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('failure', { status: 503 }),
    );
    await expect(requestProvider('getLiveServiceInfo', CREDENTIALS, false, { fetcher }))
      .rejects.toMatchObject({ status: 502 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('treats every nonzero numeric provider error as a rejection', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: -1 }));
    await expect(requestProvider('restart', CREDENTIALS, true, { fetcher }))
      .rejects.toMatchObject({ code: 'UPSTREAM_REJECTED', outcome: 'rejected' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('action ambiguity and cancellation', () => {
  it('never retries a management transport failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Synthetic disconnect'));
    await expect(requestProvider('restart', CREDENTIALS, true, { fetcher }))
      .rejects.toMatchObject({ status: 502, outcome: 'unknown' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<typeof fetch>();
    await expect(requestProvider('getServiceInfo', CREDENTIALS, false, {
      fetcher, signal: controller.signal,
    })).rejects.toMatchObject({ status: 502 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('unfinished error response cleanup', () => {
  it.each(['getLiveServiceInfo', 'restart'] as const)('releases the %s response body',
    async (endpoint) => {
      const cancelled = vi.fn();
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new TextEncoder().encode('incomplete error')); },
          cancel: cancelled,
        });
        const response = new Response(stream, { status: 503 });
        options?.signal?.addEventListener('abort', () => { void response.body?.cancel(); },
          { once: true });
        return response;
      });
      const action = endpoint === 'restart';
      await expect(requestProvider(endpoint, CREDENTIALS, action, { fetcher }))
        .rejects.toMatchObject({ status: 502, code: 'UPSTREAM_UNAVAILABLE' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(cancelled).toHaveBeenCalledTimes(1);
    });
});
