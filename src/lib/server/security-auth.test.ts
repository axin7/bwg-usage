import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthHandlers } from './security-auth';
import { createRequestSecurity } from './security';
import { SecurityError } from './security-error';
import { loginRequest, panelRequest, PUBLIC_ENV } from './security-test-fixtures';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

function handlers(checkLimit = vi.fn().mockResolvedValue(undefined)) {
  return {
    ...createAuthHandlers({ readEnvironment: async () => PUBLIC_ENV, checkLimit }),
    checkLimit,
  };
}

describe('personal password login', () => {
  it('creates an authenticated protected cookie without returning credentials', async () => {
    const auth = handlers();
    const response = await auth.login(loginRequest({ password: PUBLIC_ENV.PANEL_PASSWORD }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('__Host-panel-session=');
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=28800']) {
      expect(cookie).toContain(flag);
    }
    expect(cookie).not.toContain('Domain=');
    const request = panelRequest(undefined, { cookie: cookie?.split(';')[0] ?? '' });
    const guard = createRequestSecurity({ readEnvironment: async () => PUBLIC_ENV });
    await expect(guard.assertRequestAccess(request)).resolves.toEqual({ isLocal: false });
    expect(auth.checkLimit).toHaveBeenCalledWith('login', PUBLIC_ENV);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('rejects incorrect credentials with generic logged metadata', async () => {
    const request = loginRequest({ password: 'wrong-sensitive-password' });
    const response = await handlers().login(request);
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    const body = await response.json();
    expect(body.error).toMatchObject({ code: 'ACCESS_DENIED' });
    expect(body.error.requestId).toBe(response.headers.get('x-request-id'));
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('sensitive-password');
  });
});

describe('login request validation', () => {
  it.each([null, [], {}, { password: 123 }])('rejects malformed credentials %j', async (body) => {
    const response = await handlers().login(loginRequest(body));
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('requires the pinned production Origin before checking a password or limiting', async () => {
    const auth = handlers();
    const response = await auth.login(loginRequest({ password: PUBLIC_ENV.PANEL_PASSWORD },
      'https://evil.example.com'));
    expect(response.status).toBe(403);
    expect(auth.checkLimit).not.toHaveBeenCalled();
  });

  it('fails closed when distributed limiting is unavailable', async () => {
    const limit = vi.fn().mockRejectedValue(
      new SecurityError(503, 'RATE_LIMIT_UNAVAILABLE', '请求保护暂时不可用。'),
    );
    const request = loginRequest({ password: PUBLIC_ENV.PANEL_PASSWORD });
    const response = await handlers(limit).login(request);
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('preserves rate rejection and Retry-After', async () => {
    const rejection = new SecurityError(429, 'RATE_LIMITED', '请求过多。', 60);
    const limit = vi.fn().mockRejectedValue(rejection);
    const request = loginRequest({ password: PUBLIC_ENV.PANEL_PASSWORD });
    const response = await handlers(limit).login(request);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
  });
});

describe('personal panel logout', () => {
  it('expires the protected cookie even if the session already expired', async () => {
    const response = await handlers().logout(panelRequest(undefined, {}, 'POST'));
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('__Host-panel-session=;');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('rejects cross-site logout attempts', async () => {
    const request = panelRequest(undefined, { origin: 'https://evil.example.com' }, 'POST');
    const response = await handlers().logout(request);
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
