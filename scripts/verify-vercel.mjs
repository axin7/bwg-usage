import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { jwtVerify } from 'jose';
import { createOfflineRedisTransport, redisEnvironment } from './offline-redis.mjs';

const origin = 'https://panel.example.com';
const secret = randomBytes(32).toString('base64');
const cookieName = '__Host-panel-session';
const password = 'integration-only-password';
const jsonHeaders = { 'Content-Type': 'application/json', Origin: origin };

function expect(condition, description) {
  if (!condition) throw new Error(`Vercel integration failed: ${description}`);
}

function configure() {
  process.env.NODE_ENV = 'production';
  delete process.env.PANEL_PASSWORD;
  delete process.env.SESSION_SECRET;
  delete process.env.APP_ORIGIN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.BWG_VEID;
  delete process.env.BWG_API_KEY;
}

async function assertResponse(app, path, options, status, expectedCode) {
  const response = await app.fetch(new Request(`${origin}${path}`, options));
  expect(response.status === status, `${path} status ${status}`);
  expect(response.headers.get('cache-control')?.includes('no-store'), `${path} no-store`);
  if (expectedCode) {
    expect((await response.json()).error.code === expectedCode, `${path} ${expectedCode}`);
  }
  return response;
}

async function checkBrowserMode(app, transport) {
  const shell = await assertResponse(app, '/', {}, 200);
  const html = await shell.text();
  expect(html.includes('name="veid"') && html.includes('name="apiKey"'),
    'zero-environment credential SSR inputs');
  expect(shell.headers.get('x-frame-options') === 'DENY', 'browser-mode security headers');
  expect(shell.headers.has('content-security-policy'), 'browser-mode root CSP');
  const login = await assertResponse(app, '/login', {}, 303);
  expect(login.headers.get('location') === '/', 'browser mode does not require login');
  for (const path of ['/api/vps/info', '/api/vps/history', '/api/vps/events']) {
    await assertResponse(app, path, {
      method: 'POST', headers: jsonHeaders, body: '{}',
    }, 400, 'INVALID_INPUT');
    await assertResponse(app, path, {
      method: 'POST', headers: { ...jsonHeaders, Origin: 'https://other.example.com' },
      body: '{}',
    }, 403, 'INVALID_ORIGIN');
  }
  await assertResponse(app, '/api/vps/info', {
    method: 'POST', headers: { Origin: origin }, body: '{}',
  }, 415, 'UNSUPPORTED_MEDIA_TYPE');
  process.env.APP_ORIGIN = 'https://other.example.com';
  await assertResponse(app, '/', {}, 403, 'INVALID_ORIGIN');
  delete process.env.APP_ORIGIN;
  expect(transport.calls.length === 0, 'browser mode requires no Redis request');
}

async function checkConfigurationFailures(app, transport) {
  const cases = [
    { PANEL_PASSWORD: password },
    { SESSION_SECRET: secret },
    { BWG_VEID: '123456' },
    { BWG_API_KEY: 'unprotected-provider-secret' },
    { BWG_VEID: '123456', BWG_API_KEY: 'unprotected-provider-secret' },
    { APP_ORIGIN: 'http://panel.example.com' },
    { APP_ORIGIN: origin, PANEL_PASSWORD: password, SESSION_SECRET: 'too-short' },
  ];
  for (const values of cases) {
    configure();
    Object.assign(process.env, values);
    const refusal = await assertResponse(app, '/', {}, 503, 'SECURITY_NOT_CONFIGURED');
    expect(refusal.headers.get('x-frame-options') === 'DENY', 'refusal security headers');
    const response = await assertResponse(app, '/api/vps/info', {
      method: 'POST', headers: jsonHeaders, body: '{}',
    }, 503);
    const body = await response.text();
    expect(JSON.parse(body).error.code === 'SECURITY_NOT_CONFIGURED',
      'unprotected provider rejects before any request');
    expect(!body.includes('unprotected-provider-secret'),
      'unprotected server key absent from refusal');
  }
  configure();
  expect(transport.calls.length === 0, 'invalid configuration creates no Redis request');
}

async function checkProtection(app) {
  Object.assign(process.env, {
    APP_ORIGIN: origin, PANEL_PASSWORD: password, SESSION_SECRET: secret,
  });
  const anonymous = await assertResponse(app, '/', {}, 303);
  expect(anonymous.headers.get('location') === '/login', 'anonymous login redirect');
  await assertResponse(app, '/', { headers: { cookie: `${cookieName}=forged` } }, 303);
  for (const path of ['/api/vps/info', '/api/vps/history', '/api/vps/events']) {
    await assertResponse(app, path, {
      method: 'POST', headers: jsonHeaders, body: '{}',
    }, 401, 'ACCESS_DENIED');
  }
}

async function checkLogin(app, transport, useRedis) {
  if (useRedis) Object.assign(process.env, redisEnvironment);
  const count = transport.calls.length;
  const rejected = await assertResponse(app, '/api/auth/login', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ password: 'incorrect' }),
  }, 401, 'ACCESS_DENIED');
  expect(!rejected.headers.has('set-cookie'), 'incorrect password creates no cookie');
  const response = await assertResponse(app, '/api/auth/login', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ password }),
  }, 200);
  expect((await response.json()).ok === true, 'compiled login accepted');
  const setCookie = response.headers.get('set-cookie') ?? '';
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=28800']) {
    expect(setCookie.includes(flag), `login cookie ${flag}`);
  }
  expect(!setCookie.includes('Domain='), 'host-only login cookie');
  const cookie = setCookie.split(';')[0];
  expect(cookie.startsWith(`${cookieName}=`), 'protected login cookie name');
  const { payload } = await jwtVerify(cookie.slice(cookieName.length + 1),
    new TextEncoder().encode(secret), {
      algorithms: ['HS256'], issuer: 'bwg-usage', audience: origin,
      requiredClaims: ['iat', 'exp', 'sub'],
    });
  expect(payload.sub === 'panel-owner' && payload.exp - payload.iat === 28_800,
    'compiled login signature and eight-hour claims');
  const calls = transport.calls.slice(count);
  expect(useRedis ? calls.length === 2 && calls.every(({ scope }) => scope === 'login') :
    calls.length === 0, 'compiled login uses the selected limiter');
  return cookie;
}

async function checkAuthenticatedBoundaries(app, cookie, transport) {
  const calls = transport.calls.length;
  await assertResponse(app, '/api/vps/action', {
    method: 'POST', headers: { ...jsonHeaders, cookie, Origin: 'https://other.example.com' },
    body: JSON.stringify({ action: 'restart' }),
  }, 403, 'INVALID_ORIGIN');
  expect(transport.calls.length === calls, 'cross-origin action creates no Redis request');
  for (const path of ['/api/vps/history', '/api/vps/events']) {
    await assertResponse(app, path, {
      method: 'POST', headers: { ...jsonHeaders, cookie, Origin: 'https://other.example.com' },
      body: '{}',
    }, 403, 'INVALID_ORIGIN');
  }
  expect(transport.calls.length === calls, 'cross-origin history creates no Redis request');
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  await assertResponse(app, '/api/vps/info', {
    method: 'POST', headers: { ...jsonHeaders, cookie }, body: '{}',
  }, 400, 'INVALID_INPUT');
  expect(transport.calls.length === calls, 'local query limit creates no Redis request');
  for (const values of [
    { UPSTASH_REDIS_REST_URL: redisEnvironment.UPSTASH_REDIS_REST_URL },
    { UPSTASH_REDIS_REST_TOKEN: redisEnvironment.UPSTASH_REDIS_REST_TOKEN },
    { UPSTASH_REDIS_REST_URL: 'http://offline-redis.invalid',
      UPSTASH_REDIS_REST_TOKEN: redisEnvironment.UPSTASH_REDIS_REST_TOKEN },
  ]) {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    Object.assign(process.env, values);
    await assertResponse(app, '/api/vps/info', {
      method: 'POST', headers: { ...jsonHeaders, cookie }, body: '{}',
    }, 503, 'RATE_LIMIT_UNAVAILABLE');
  }
  expect(transport.calls.length === calls, 'invalid Redis configuration creates no request');
  Object.assign(process.env, redisEnvironment);
}

async function checkRateFailures(app, cookie, transport) {
  const cases = [
    ['/api/auth/login', { password }, 'login'],
    ['/api/vps/info', {}, 'query'],
    ['/api/vps/history', {}, 'query'],
    ['/api/vps/events', {}, 'query'],
    ['/api/vps/action', { action: 'restart' }, 'action'],
  ];
  for (const mode of ['network-error', 'http-error', 'timeout']) {
    transport.mode = mode;
    for (const [path, body, scope] of cases) {
      const count = transport.calls.length;
      const response = await assertResponse(app, path, {
        method: 'POST', headers: { ...jsonHeaders, cookie }, body: JSON.stringify(body),
      }, 503, 'RATE_LIMIT_UNAVAILABLE');
      expect(!response.headers.has('set-cookie'), `${mode} creates no session cookie`);
      expect(transport.calls.length === count + 1 && transport.calls.at(-1).scope === scope,
        `${mode} exercises configured ${scope} Redis transport`);
      if (mode === 'timeout') {
        expect(transport.pendingCount() > 0, 'SDK timeout rejected before Redis response');
      }
    }
  }
  transport.mode = 'deny';
  const exhausted = await assertResponse(app, '/api/vps/action', {
    method: 'POST', headers: { ...jsonHeaders, cookie },
    body: JSON.stringify({ action: 'restart' }),
  }, 429, 'RATE_LIMITED');
  const retry = Number(exhausted.headers.get('retry-after'));
  expect(retry >= 1 && retry <= 60, 'compiled rate rejection has bounded Retry-After');
  transport.mode = 'success';
}

async function checkLogout(app, cookie, transport) {
  const count = transport.calls.length;
  const rejected = await assertResponse(app, '/api/auth/logout', {
    method: 'POST', headers: { ...jsonHeaders, cookie, Origin: 'https://other.example.com' },
    body: '{}',
  }, 403, 'INVALID_ORIGIN');
  expect(!rejected.headers.has('set-cookie'), 'cross-origin logout preserves cookie');
  const response = await assertResponse(app, '/api/auth/logout', {
    method: 'POST', headers: { ...jsonHeaders, cookie }, body: '{}',
  }, 200);
  expect((await response.json()).ok === true, 'compiled logout accepted');
  const expired = response.headers.get('set-cookie') ?? '';
  expect(expired.startsWith(`${cookieName}=;`), 'logout clears protected cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=0']) {
    expect(expired.includes(flag), `logout cookie ${flag}`);
  }
  expect(expired.includes('Expires=Thu, 01 Jan 1970'), 'logout expiry is in the past');
  await assertResponse(app, '/', { headers: { cookie: expired.split(';')[0] } }, 303);
  expect(transport.calls.length === count, 'logout requires no distributed store');
}

async function checkRendering(app, cookie) {
  const login = await assertResponse(app, '/login', {}, 200);
  expect((await login.text()).includes('name="password"'), 'login SSR input');
  const shell = await assertResponse(app, '/', { headers: { cookie } }, 200);
  expect((await shell.text()).includes('name="veid"'), 'credential SSR input');
  process.env.BWG_VEID = '123456';
  process.env.BWG_API_KEY = 'runtime-only-provider-secret';
  const managed = await assertResponse(app, '/', { headers: { cookie } }, 200);
  const html = await managed.text();
  expect(html.includes('123456') && html.includes('服务端配置'), 'server managed SSR shell');
  expect(!html.includes(process.env.BWG_API_KEY), 'server API key absent from SSR');
  expect(!html.includes('name="apiKey"'), 'no client credential field in server mode');
  expect(managed.headers.has('content-security-policy'), 'authenticated root CSP');
}

async function checkClientSecrets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await checkClientSecrets(path);
    else if (/\.(js|html|json)$/.test(entry.name)) {
      const text = await readFile(path, 'utf8');
      expect(!/BWG_API_KEY|PANEL_PASSWORD|SESSION_SECRET/.test(text), 'client secret isolation');
    }
  }
}

configure();
const transport = createOfflineRedisTransport();
globalThis.fetch = transport.fetch;
const app = (await import('../.vercel/output/functions/__server.func/index.mjs')).default;
await checkBrowserMode(app, transport);
await checkConfigurationFailures(app, transport);
await checkProtection(app);
const localCookie = await checkLogin(app, transport, false);
await checkLogout(app, localCookie, transport);
const cookie = await checkLogin(app, transport, true);
await checkAuthenticatedBoundaries(app, cookie, transport);
await checkRendering(app, cookie);
await checkRateFailures(app, cookie, transport);
await checkLogout(app, cookie, transport);
await checkClientSecrets('.vercel/output/static');
await transport.settle();
expect(transport.protocolErrors === 0, 'offline Redis protocol matches the actual SDK');
expect(transport.unexpectedCalls === 0, 'no real Redis or VPS calls');
console.log('Vercel integration passed: browser credentials, optional Redis, auth, secrets.');
