import { describe, expect, it, vi } from 'vitest';
import { createRequestSecurity } from './security';
import type { SecurityEnvironment } from './security-env';
import { panelRequest } from './security-test-fixtures';

const BROWSER_ENV: SecurityEnvironment = { NODE_ENV: 'production' };
const REJECTED_HEADERS: Record<string, string>[] = [
  { origin: 'https://other.example.com' },
  { origin: 'null' },
  { 'sec-fetch-site': 'cross-site' },
  { 'sec-fetch-site': 'same-site' },
  { origin: 'https://other.example.com', 'x-forwarded-host': 'other.example.com',
    forwarded: 'host=other.example.com;proto=https' },
];

function guard(env: SecurityEnvironment = BROWSER_ENV) {
  return createRequestSecurity({ readEnvironment: async () => env });
}

describe('production browser credential mode', () => {
  it('allows the panel without environment variables or a session', async () => {
    await expect(guard().assertRequestAccess(new Request('https://panel.example.com/')))
      .resolves.toEqual({ isLocal: false });
  });

  it('still applies rate limits to browser-supplied credentials', async () => {
    const checkLimit = vi.fn().mockResolvedValue(undefined);
    const security = createRequestSecurity({
      readEnvironment: async () => BROWSER_ENV, checkLimit,
    });
    const request = panelRequest(undefined, {}, 'POST');
    await security.checkRateLimit(request, false);
    await security.checkRateLimit(request, true);
    expect(checkLimit.mock.calls.map(([scope]) => scope)).toEqual(['query', 'action']);
  });

  it.each(REJECTED_HEADERS)('rejects cross-origin evidence without login %j', async (headers) => {
    await expect(guard().assertRequestAccess(panelRequest(undefined, headers, 'POST')))
      .rejects.toMatchObject({ status: 403, code: 'INVALID_ORIGIN' });
  });

  it('requires an Origin and JSON content type', async () => {
    const request = panelRequest(undefined, {}, 'POST');
    request.headers.delete('origin');
    await expect(guard().assertRequestAccess(request)).rejects.toMatchObject({ status: 403 });
    const plain = panelRequest(undefined, { 'content-type': 'text/plain' }, 'POST');
    await expect(guard().assertRequestAccess(plain)).rejects.toMatchObject({ status: 415 });
  });
});

describe('browser mode origin restrictions', () => {
  it('honors a configured origin even without password login', async () => {
    const security = guard({ ...BROWSER_ENV, APP_ORIGIN: 'https://panel.example.com' });
    await expect(security.assertRequestAccess(panelRequest())).resolves.toBeDefined();
    await expect(security.assertRequestAccess(new Request('https://other.example.com/')))
      .rejects.toMatchObject({ status: 403 });
  });

  it.each(['not-a-url', 'http://panel.example.com', 'https://panel.example.com/'])
  ('rejects malformed explicit origin %s', async (APP_ORIGIN) => {
    await expect(guard({ ...BROWSER_ENV, APP_ORIGIN }).assertRequestAccess(panelRequest()))
      .rejects.toMatchObject({ status: 503, code: 'SECURITY_NOT_CONFIGURED' });
  });

  it('rejects production HTTP requests without using the development exception', async () => {
    await expect(guard().assertRequestAccess(new Request('http://localhost/')))
      .rejects.toMatchObject({ status: 403, code: 'INVALID_ORIGIN' });
  });
});

describe('browser mode cannot expose server-managed credentials', () => {
  it.each([
    { BWG_API_KEY: 'server-only-key' },
    { BWG_VEID: '123456' },
    { BWG_VEID: '123456', BWG_API_KEY: 'server-only-key' },
    { PANEL_PASSWORD: 'configured-password-only' },
    { SESSION_SECRET: 'configured-session-secret-with-32-characters' },
  ])('requires valid panel protection for sensitive server configuration %j', async (settings) => {
    await expect(guard({ ...BROWSER_ENV, ...settings }).assertRequestAccess(panelRequest()))
      .rejects.toMatchObject({ status: 503, code: 'SECURITY_NOT_CONFIGURED' });
  });
});
