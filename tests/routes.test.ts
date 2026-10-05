import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as info } from '@/app/api/vps/info/route';
import { POST as action } from '@/app/api/vps/action/route';
import { assertRequestAccess, checkRateLimit, SecurityError } from '@/lib/server/security';
import { RouteError } from '@/lib/server/route-error';

vi.mock('@/lib/server/security', () => ({
  assertRequestAccess: vi.fn().mockResolvedValue({ sub: 'synthetic' }),
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  SecurityError: class extends Error { status = 403; code = 'ACCESS_DENIED'; },
}));

vi.mock('@/lib/server/action-events', () => ({
  recordActionEvent: vi.fn().mockResolvedValue(null),
}));

const credentials = { veid: '123', apiKey: 'synthetic-test-secret' };
const successfulProvider = { error: 0, data_counter: 10, plan_monthly_data: 100 };
const fetcher = vi.fn<typeof fetch>();

function request(body: unknown, raw = false): Request {
  return new Request('http://localhost:3000/api/vps/info', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('BWG_VEID', undefined);
  vi.stubEnv('BWG_API_KEY', undefined);
  fetcher.mockReset().mockRejectedValue(new Error('Unexpected network dispatch'));
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('route input boundaries', () => {
  it.each([null, [], false, { veid: {}, apiKey: true }, { veid: '123', apiKey: ' ' }])(
    'rejects invalid input without provider dispatch: %j', async (body) => {
      const response = await info(request(body));
      expect(response.status).toBe(400);
      expect(fetcher).not.toHaveBeenCalled();
      const result = await response.json();
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.requestId).toBe(response.headers.get('X-Request-ID'));
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    },
  );

  it('rejects malformed JSON and an unsupported content type', async () => {
    expect((await info(request('{bad', true))).status).toBe(400);
    const plain = new Request('http://localhost:3000', { method: 'POST', body: '{}' });
    expect((await info(plain)).status).toBe(415);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('enforces actual streamed body size even without Content-Length', async () => {
    const response = await info(request('x'.repeat(16 * 1024 + 1), true));
    expect(response.status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects an invalid action and an incorrectly typed live flag', async () => {
    expect((await action(request({ ...credentials, action: 'destroy' }))).status).toBe(400);
    expect((await info(request({ ...credentials, live: 'true' }))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('route authorization and response isolation', () => {
  it('runs the access guard and limiter before any provider dispatch', async () => {
    vi.mocked(assertRequestAccess).mockRejectedValueOnce(
      new RouteError(403, 'ACCESS_DENIED', 'Denied'),
    );
    const response = await info(request(credentials));
    expect(response.status).toBe(403);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('publishes a bounded retry hint for a denied request', async () => {
    vi.mocked(checkRateLimit).mockRejectedValueOnce(new RouteError(429, 'RATE_LIMITED', 'Wait',
      undefined, 60));
    const response = await info(request(credentials));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns no successful DTO for missing required upstream counters', async () => {
    fetcher.mockResolvedValueOnce(Response.json({ error: 0 }));
    const response = await info(request(credentials));
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('INVALID_UPSTREAM_RESPONSE');
  });

  it('returns only validated data and sanitized structured logs', async () => {
    fetcher.mockResolvedValueOnce(Response.json({
      ...successfulProvider, api_key: credentials.apiKey,
    }));
    const response = await info(request(credentials));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(credentials.apiKey);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(credentials.apiKey);
  });
});

describe('management acknowledgement boundaries', () => {
  it('returns only an acceptance receipt', async () => {
    fetcher.mockResolvedValueOnce(Response.json({ error: 0, extra: credentials.apiKey }));
    const response = await action(request({ ...credentials, action: 'restart' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      action: 'restart', accepted: true, requestId: response.headers.get('X-Request-ID'),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledWith(expect.any(Request), true);
  });

  it('reports an upstream server failure as unknown without retrying the action', async () => {
    fetcher.mockResolvedValueOnce(new Response('<html>failure</html>', { status: 503 }));
    const response = await action(request({ ...credentials, action: 'stop' }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE', outcome: 'unknown',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('pre-dispatch management rejection', () => {
  it('preserves a security rejection and aligns its public outcome with the log', async () => {
    vi.mocked(assertRequestAccess).mockRejectedValueOnce(
      new SecurityError(403, 'ACCESS_DENIED', 'Denied'),
    );
    const response = await action(request({ ...credentials, action: 'stop' }));
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.error).toMatchObject({ code: 'ACCESS_DENIED', outcome: 'rejected' });
    const log = JSON.parse(String(vi.mocked(console.info).mock.calls[0][0]));
    expect(log).toMatchObject({ outcome: 'rejected', requestId: body.error.requestId });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('marks malformed management input as rejected without dispatch', async () => {
    const response = await action(request({ ...credentials, action: 'destroy' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({
      code: 'INVALID_INPUT', outcome: 'rejected',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('marks a limiter failure as rejected without hiding its retry hint', async () => {
    vi.mocked(checkRateLimit).mockRejectedValueOnce(
      new RouteError(429, 'RATE_LIMITED', 'Wait', undefined, 60),
    );
    const response = await action(request({ ...credentials, action: 'stop' }));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect((await response.json()).error).toMatchObject({
      code: 'RATE_LIMITED', outcome: 'rejected',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('server-owned VPS route credentials', () => {
  it('uses only the configured key and omits it from info responses and logs', async () => {
    vi.stubEnv('BWG_VEID', '123');
    vi.stubEnv('BWG_API_KEY', 'synthetic-env-secret');
    fetcher.mockResolvedValueOnce(Response.json(successfulProvider));
    const response = await info(request({ veid: '123', apiKey: 'ignored-browser-key' }));
    expect(response.status).toBe(200);
    const body = new URLSearchParams(String(fetcher.mock.calls[0][1]?.body));
    expect(body.get('api_key')).toBe('synthetic-env-secret');
    expect(String(fetcher.mock.calls[0][0])).not.toContain('synthetic-env-secret');
    expect(await response.text()).not.toContain('synthetic-env-secret');
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).not.toContain('synthetic-env-secret');
  });

  it.each([undefined, ''])('accepts an omitted/empty client key: %j', async (apiKey) => {
    vi.stubEnv('BWG_VEID', '123');
    vi.stubEnv('BWG_API_KEY', 'synthetic-env-secret');
    fetcher.mockResolvedValueOnce(Response.json({ error: 0 }));
    const response = await action(request({ veid: '123', apiKey, action: 'start' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      action: 'start', accepted: true, requestId: response.headers.get('X-Request-ID'),
    });
    const body = new URLSearchParams(String(fetcher.mock.calls[0][1]?.body));
    expect(body.get('veid')).toBe('123');
    expect(body.get('api_key')).toBe('synthetic-env-secret');
  });
});

describe('pinned server credential rejection', () => {
  it.each([
    { veid: '456' }, { veid: 123 }, { veid: {} }, { apiKey: null }, { apiKey: false },
  ])('rejects substituted credentials without any provider dispatch: %j', async (patch) => {
    vi.stubEnv('BWG_VEID', '123');
    vi.stubEnv('BWG_API_KEY', 'synthetic-env-secret');
    const response = await action(request({ veid: '123', action: 'stop', ...patch }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({
      code: 'INVALID_INPUT', outcome: 'rejected',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { veid: '123', key: undefined }, { veid: undefined, key: 'synthetic-env-secret' },
    { veid: 'invalid', key: 'synthetic-env-secret' },
  ])('fails closed for partial or invalid environment configuration', async (env) => {
    vi.stubEnv('BWG_VEID', env.veid);
    vi.stubEnv('BWG_API_KEY', env.key);
    const response = await info(request(credentials));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe('VPS_NOT_CONFIGURED');
    expect(text).not.toContain('synthetic-env-secret');
    expect(text).not.toContain(credentials.apiKey);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
