import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVPSInfo, submitVPSAction } from '@/lib/server/provider';
import { requestProvider } from '@/lib/server/provider-request';

const CREDENTIALS = { veid: '123', apiKey: 'synthetic-key-with-&-and-?' };
const SUCCESS = { error: 0, data_counter: 10, plan_monthly_data: 100 };
const reply = (body: unknown = SUCCESS) => Response.json(body);

afterEach(() => { vi.useRealTimers(); });

describe('bounded provider requests', () => {
  it('uses a fixed HTTPS POST URL with encoded credentials in its body only', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply());
    const data = await getVPSInfo(CREDENTIALS, false, { fetcher });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.64clouds.com/v1/getServiceInfo');
    expect(String(url)).not.toContain(CREDENTIALS.apiKey);
    expect(options).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'manual' });
    const body = new URLSearchParams(String(options?.body));
    expect(body.get('api_key')).toBe(CREDENTIALS.apiKey);
    expect(data.resources.usedBytes).toBe(10);
  });

  it('selects live service info and returns whitelisted live state', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({
      ...SUCCESS, ve_status: 'Running', message: 'synthetic secret', api_key: 'must-not-return',
    }));
    const data = await getVPSInfo(CREDENTIALS, true, { fetcher });
    expect(fetcher.mock.calls[0][0]).toBe('https://api.64clouds.com/v1/getLiveServiceInfo');
    expect(data.status.powerState).toBe('running');
    expect(JSON.stringify(data)).not.toContain('must-not-return');
    expect(JSON.stringify(data)).not.toContain('synthetic secret');
  });
});

describe('basic read recovery', () => {
  it('retries a transient basic-read failure once within the total budget', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
      .mockResolvedValueOnce(reply());
    const pending = requestProvider('getServiceInfo', CREDENTIALS, false, {
      fetcher, timeoutMs: 1000, random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(150);
    await expect(pending).resolves.toEqual(SUCCESS);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('honors long Retry-After without retrying before the permitted time', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('limited', {
      status: 429, headers: { 'Retry-After': '30' },
    }));
    await expect(requestProvider('getServiceInfo', CREDENTIALS, false, { fetcher }))
      .rejects.toMatchObject({ status: 429, code: 'UPSTREAM_RATE_LIMITED', retryAfter: 30 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not retry a provider-declared rejection or leak its raw message', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({
      error: 7, message: CREDENTIALS.apiKey,
    }));
    await expect(requestProvider('getServiceInfo', CREDENTIALS, false, { fetcher }))
      .rejects.toMatchObject({ status: 422, code: 'UPSTREAM_REJECTED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('provider response validation', () => {
  it.each([301, 302, 303, 307, 308])(
    'rejects HTTP %s without retrying or following a credential redirect', async (status) => {
      const location = `https://other.example.com/?api_key=${CREDENTIALS.apiKey}`;
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(SUCCESS, {
        status, headers: { Location: location },
      }));
      await expect(requestProvider('getServiceInfo', CREDENTIALS, false, { fetcher }))
        .rejects.toMatchObject({ status: 502, code: 'UPSTREAM_UNAVAILABLE' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual');
    },
  );

  it.each([null, [], { data_counter: 10 }, { error: 'bad' }, { error: 0.5 }])(
    'rejects invalid provider envelopes: %j', async (payload) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(payload));
      await expect(requestProvider('getServiceInfo', CREDENTIALS, false, { fetcher }))
        .rejects.toMatchObject({ status: 502, code: 'INVALID_UPSTREAM_RESPONSE' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a successful HTTP response containing HTML without retrying', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>bad</html>'));
    await expect(requestProvider('getServiceInfo', CREDENTIALS, false, { fetcher }))
      .rejects.toMatchObject({ status: 502, code: 'INVALID_UPSTREAM_RESPONSE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('management outcome protection', () => {
  it.each([301, 302, 303, 307, 308])(
    'keeps a redirected HTTP %s management outcome unknown without resending', async (status) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', {
        status, headers: { Location: 'https://other.example.com/action' },
      }));
      await expect(submitVPSAction('restart', CREDENTIALS, { fetcher })).rejects.toMatchObject({
        status: 502, code: 'UPSTREAM_UNAVAILABLE', outcome: 'unknown',
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual');
    },
  );

  it('bounds a stalled action and dispatches it exactly once', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = submitVPSAction('restart', CREDENTIALS, { fetcher, timeoutMs: 50 });
    const assertion = expect(pending).rejects.toMatchObject({
      status: 504, code: 'UPSTREAM_TIMEOUT', outcome: 'unknown',
    });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it.each([503, 429])('never retries a management HTTP %s', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('failure', { status }));
    await expect(submitVPSAction('stop', CREDENTIALS, { fetcher })).rejects.toMatchObject({
      outcome: status === 429 ? 'rejected' : 'unknown',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('marks an action with an unreadable acknowledgement as unknown', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('not JSON'));
    await expect(submitVPSAction('start', CREDENTIALS, { fetcher })).rejects.toMatchObject({
      status: 502, outcome: 'unknown',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('client cancellation', () => {
  it('cancels an in-flight read when the client disconnects', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = requestProvider('getServiceInfo', CREDENTIALS, false, {
      fetcher, signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ status: 502 });
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
