import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as info } from '@/app/api/vps/info/route';
import { POST as history } from '@/app/api/vps/history/route';
import { POST as events } from '@/app/api/vps/events/route';
import { POST as action } from '@/app/api/vps/action/route';

const origin = 'https://browser-panel.example.com';
const credentials = { veid: '123', apiKey: 'browser-only-synthetic-key' };
const fetcher = vi.fn<typeof fetch>();
const routes = [
  { name: 'info', handler: info, body: {}, endpoint: 'getServiceInfo' },
  { name: 'history', handler: history, body: { range: '7d' }, endpoint: 'getRawUsageStats' },
  { name: 'events', handler: events, body: {}, endpoint: 'getAuditLog' },
  { name: 'action', handler: action, body: { action: 'restart' }, endpoint: 'restart' },
];

function request(body: unknown, headers: Record<string, string> = {}, url = origin): Request {
  return new Request(`${url}/api/vps/info`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  for (const key of ['PANEL_PASSWORD', 'SESSION_SECRET', 'APP_ORIGIN', 'BWG_VEID',
    'BWG_API_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    vi.stubEnv(key, undefined);
  }
  fetcher.mockReset().mockRejectedValue(new Error('Unexpected external request'));
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('production browser credential routes without panel or Redis settings', () => {
  it.each(routes)('requires both browser credentials for $name', async ({ handler, body }) => {
    for (const input of [{}, { veid: credentials.veid }, { apiKey: credentials.apiKey }]) {
      const response = await handler(request({ ...body, ...input }));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('INVALID_INPUT');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(routes)('passes browser credentials to $name without a session',
    async ({ handler, body, endpoint }) => {
      fetcher.mockImplementation(async () => Response.json({
        error: 0, data_counter: 10, plan_monthly_data: 100,
        data: [], log_entries: [], api_key: credentials.apiKey,
      }));
      const response = await handler(request({ ...body, ...credentials }));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.has('set-cookie')).toBe(false);
      expect(await response.text()).not.toContain(credentials.apiKey);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [url, options] = fetcher.mock.calls[0];
      expect(url).toBe(`https://api.64clouds.com/v1/${endpoint}`);
      const upstream = new URLSearchParams(String(options?.body));
      expect(upstream.get('veid')).toBe(credentials.veid);
      expect(upstream.get('api_key')).toBe(credentials.apiKey);
      expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(credentials.apiKey);
    },
  );
});

describe('production guest request boundaries', () => {
  it.each(routes)('rejects cross-origin $name before any external request',
    async ({ handler, body }) => {
      const response = await handler(request({ ...body, ...credentials }, {
        Origin: 'https://untrusted.example.com',
      }));
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('INVALID_ORIGIN');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(['same-site', 'cross-site'])('rejects sec-fetch-site %s', async (site) => {
    const response = await info(request(credentials, { 'Sec-Fetch-Site': site }));
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects missing Origin and non-JSON requests before any external request', async () => {
    const missingOrigin = request(credentials);
    missingOrigin.headers.delete('Origin');
    expect((await info(missingOrigin)).status).toBe(403);
    expect((await info(request(credentials, { 'Content-Type': 'text/plain' }))).status).toBe(415);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects production HTTP even on a loopback host', async () => {
    const response = await info(request(credentials, { Origin: 'http://localhost:3000' },
      'http://localhost:3000'));
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('honors the optional configured origin', async () => {
    vi.stubEnv('APP_ORIGIN', 'https://pinned.example.com');
    const response = await info(request(credentials));
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('server credentials retain access protection', () => {
  it.each([
    { veid: '123', apiKey: undefined },
    { veid: undefined, apiKey: 'unprotected-server-key' },
    { veid: '123', apiKey: 'unprotected-server-key' },
  ])('fails closed without a valid panel configuration: %j', async (values) => {
    vi.stubEnv('BWG_VEID', values.veid);
    vi.stubEnv('BWG_API_KEY', values.apiKey);
    const response = await info(request(credentials));
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body).error.code).toBe('SECURITY_NOT_CONFIGURED');
    expect(body).not.toContain('unprotected-server-key');
    expect(body).not.toContain(credentials.apiKey);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
