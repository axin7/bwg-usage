import { describe, expect, it } from 'vitest';
import { decodeJwt } from 'jose';
import { createRequestSecurity } from './security';
import {
  createSession, matchesPassword, readPanelConfig, SESSION_COOKIE_NAME, SESSION_SECONDS,
} from './security-session';
import { panelRequest, PUBLIC_ENV, signPanelToken } from './security-test-fixtures';
import type { SecurityEnvironment } from './security-env';

function createGuard(env: SecurityEnvironment = PUBLIC_ENV) {
  return createRequestSecurity({ readEnvironment: async () => env }).assertRequestAccess;
}

describe('signed personal panel sessions', () => {
  it('creates and verifies an eight-hour session with the expected claims', async () => {
    const token = await createSession(readPanelConfig(PUBLIC_ENV));
    expect(await createGuard()(panelRequest(token))).toEqual({ isLocal: false });
    const claims = decodeJwt(token);
    expect(claims).toMatchObject({
      iss: 'bwg-usage', aud: PUBLIC_ENV.APP_ORIGIN, sub: 'panel-owner',
    });
    expect(Number(claims.exp) - Number(claims.iat)).toBe(SESSION_SECONDS);
  });

  it('rejects a missing session regardless of spoofed Cloudflare identity headers', async () => {
    const request = panelRequest(undefined, {
      'cf-access-authenticated-user-email': 'owner@example.com',
    });
    await expect(createGuard()(request)).rejects.toMatchObject({
      status: 401, code: 'ACCESS_DENIED',
    });
  });

  it('rejects tampering and multiple cookie values', async () => {
    const token = await signPanelToken();
    const [header, payload, signature] = token.split('.');
    const changedSignature = `${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;
    const changed = `${header}.${payload}.${changedSignature}`;
    await expect(createGuard()(panelRequest(changed))).rejects.toMatchObject({ status: 401 });
    const cookie = `${SESSION_COOKIE_NAME}=${token}; ${SESSION_COOKIE_NAME}=${token}`;
    await expect(createGuard()(panelRequest(undefined, { cookie })))
      .rejects.toMatchObject({ status: 401 });
  });
});

describe('session claim restrictions', () => {
  it.each([
    { exp: Math.floor(Date.now() / 1_000) - 60 },
    { aud: 'https://other.example.com' },
    { iss: 'other-application' },
    { sub: 'other-user' },
    { exp: undefined },
    { iat: undefined },
    { exp: Math.floor(Date.now() / 1_000) + SESSION_SECONDS + 60 },
  ])('rejects invalid signed claims %j', async (claims) => {
    await expect(createGuard()(panelRequest(await signPanelToken(claims))))
      .rejects.toMatchObject({ status: 401, code: 'ACCESS_DENIED' });
  });

  it('rejects an unapproved signing algorithm', async () => {
    await expect(createGuard()(panelRequest(await signPanelToken({}, 'HS512'))))
      .rejects.toMatchObject({ status: 401 });
  });

  it('invalidates previously signed cookies after the session secret rotates', async () => {
    const guard = createGuard({
      ...PUBLIC_ENV, SESSION_SECRET: 'different-secret-at-least-32-chars',
    });
    await expect(guard(panelRequest(await signPanelToken())))
      .rejects.toMatchObject({ status: 401 });
  });
});

describe('password and security configuration', () => {
  it('compares arbitrary password lengths through fixed-size hashes', () => {
    expect(matchesPassword('owner-password', 'owner-password')).toBe(true);
    expect(matchesPassword('', 'owner-password')).toBe(false);
    expect(matchesPassword('owner-password-extended', 'owner-password')).toBe(false);
  });

  it('accepts a configured password at the login length limit', () => {
    const password = 'x'.repeat(1024);
    expect(readPanelConfig({ ...PUBLIC_ENV, PANEL_PASSWORD: password }).password).toBe(password);
  });

  it('rejects a configured password above the login length limit', () => {
    expect(() => readPanelConfig({ ...PUBLIC_ENV, PANEL_PASSWORD: 'x'.repeat(1025) }))
      .toThrow(expect.objectContaining({ status: 503, code: 'SECURITY_NOT_CONFIGURED' }));
  });

  it.each([
    { PANEL_PASSWORD: '' },
    { PANEL_PASSWORD: 'short' },
    { SESSION_SECRET: 'short' },
    { APP_ORIGIN: '' },
    { APP_ORIGIN: 'http://panel.example.com' },
    { APP_ORIGIN: 'https://panel.example.com/' },
  ])('fails closed for invalid production configuration %j', async (override) => {
    await expect(createGuard({ ...PUBLIC_ENV, ...override })(panelRequest()))
      .rejects.toMatchObject({ status: 503, code: 'SECURITY_NOT_CONFIGURED' });
  });
});

describe('development loopback exceptions', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])('allows development loopback %s', async (host) => {
    const request = new Request(`http://${host}:3000/`);
    expect(await createGuard({ NODE_ENV: 'development' })(request)).toEqual({ isLocal: true });
  });

  it('rejects forwarded localhost spoofing on a public URL', async () => {
    const request = panelRequest(undefined, {
      'x-forwarded-host': 'localhost', forwarded: 'host=localhost;proto=http',
    });
    await expect(createGuard({ NODE_ENV: 'development' })(request))
      .rejects.toMatchObject({ status: 503 });
  });

  it('never bypasses production authentication even on localhost', async () => {
    await expect(createGuard({ NODE_ENV: 'production' })(new Request('http://localhost/')))
      .rejects.toMatchObject({ status: 503 });
  });
});

describe('strict production POST origins', () => {
  const headers: Record<string, string>[] = [
    { origin: 'https://evil.example.com' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
  ];
  it.each(headers)('rejects cross-origin evidence %j', async (extra) => {
    await expect(createGuard()(panelRequest(await signPanelToken(), extra, 'POST')))
      .rejects.toMatchObject({ status: 403, code: 'INVALID_ORIGIN' });
  });

  it('requires an Origin even from non-browser production JSON clients', async () => {
    const request = panelRequest(await signPanelToken(), {}, 'POST');
    request.headers.delete('origin');
    await expect(createGuard()(request)).rejects.toMatchObject({ status: 403 });
  });

  it('rejects simple-request content types', async () => {
    const request = panelRequest(await signPanelToken(), { 'content-type': 'text/plain' }, 'POST');
    await expect(createGuard()(request)).rejects.toMatchObject({ status: 415 });
  });
});
