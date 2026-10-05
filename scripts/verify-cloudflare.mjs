import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { jwtVerify } from 'jose';
import { createOfflineRedisTransport, redisEnvironment } from './offline-redis.mjs';

const origin = 'https://panel.example.com';
const password = 'cloudflare-offline-password';
const secret = randomBytes(32).toString('base64');
const cookieName = '__Host-panel-session';
const configPath = resolve('.output/server/wrangler.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const entryPath = resolve(dirname(configPath), config.main);
const modules = await readWorkerModules(dirname(configPath));
modules.sort((left, right) => left.path === entryPath ? -1 : right.path === entryPath ? 1 : 0);
const transport = createOfflineRedisTransport();
const panel = { APP_ORIGIN: origin, PANEL_PASSWORD: password, SESSION_SECRET: secret };
const credentials = { veid: '123456', apiKey: 'cloudflare-offline-api-key+/&' };
const provider = {
  calls: [], expectedKey: credentials.apiKey, errors: 0, failures: [], redirect: false,
};

function serviceFixture(live) {
  return {
    hostname: 'offline-cloudflare-worker', data_counter: 10, plan_monthly_data: 100,
    monthly_data_multiplier: 2, vm_type: 'kvm', ve_status: 'running', plan_ram: 1024 ** 3,
    ...(live && { mem_available_kb: 512 }),
  };
}

function providerFixture(endpoint) {
  const seconds = Math.floor(Date.now() / 1000);
  if (endpoint === 'getServiceInfo' || endpoint === 'getLiveServiceInfo') {
    return serviceFixture(endpoint === 'getLiveServiceInfo');
  }
  if (endpoint === 'getRawUsageStats') {
    return { data: [
      { timestamp: seconds - 120, network_in_bytes: 100, network_out_bytes: 50 },
      { timestamp: seconds - 60, network_in_bytes: 200, network_out_bytes: 75 },
    ] };
  }
  expect(endpoint === 'getAuditLog', 'only read-only provider endpoints are mocked');
  return { log_entries: [{ timestamp: seconds, type: 7,
    summary: 'reboot: private-provider-summary', user: 'private-provider-owner' }] };
}

async function offlineProvider(request) {
  try {
    const url = new URL(request.url);
    expect(!url.search && !url.hash && !url.username && !url.password, 'provider URL boundary');
    expect(request.method === 'POST', 'provider POST transport');
    expect(request.headers.get('content-type') === 'application/x-www-form-urlencoded',
      'provider form encoding');
    const body = new URLSearchParams(await request.text());
    expect(body.size === 2 && body.get('veid') === credentials.veid &&
      body.get('api_key') === provider.expectedKey, 'only synthetic provider credentials');
    const endpoint = url.pathname.replace(/^\/v1\//, '');
    const fixture = providerFixture(endpoint);
    provider.calls.push(endpoint);
    if (provider.redirect) {
      return new Response(null, {
        status: 302, headers: { Location: 'https://other.example.com/credentials' },
      });
    }
    return Response.json({ error: 0, api_key: provider.expectedKey, ...fixture });
  } catch (error) {
    provider.errors += 1;
    provider.failures.push(error.message);
    throw error;
  }
}

function expect(condition, description) {
  assert(condition, `Cloudflare integration failed: ${description}`);
}

async function readWorkerModules(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...await readWorkerModules(path));
    else if (/\.(mjs|js)$/.test(entry.name)) {
      found.push({ type: 'ESModule', path, contents: await readFile(path, 'utf8') });
    }
  }
  return found;
}

async function outbound(request) {
  if (new URL(request.url).origin === 'https://api.64clouds.com') {
    return offlineProvider(request);
  }
  return transport.fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: await request.text(),
    signal: request.signal,
  });
}

function runtimeOptions(bindings) {
  return convertV4MiniflareOptions({
    modules,
    modulesRoot: dirname(configPath),
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    bindings: { ...config.vars, ...bindings },
    assets: {
      directory: resolve(dirname(configPath), config.assets.directory),
      binding: config.assets.binding,
      run_worker_first: config.assets.run_worker_first,
      routerConfig: { has_user_worker: true },
    },
    outboundService: outbound,
  });
}

async function response(app, path, options, status, code) {
  const result = await app.dispatchFetch(`${origin}${path}`, { redirect: 'manual', ...options });
  expect(result.status === status, `${path} status ${status}, received ${result.status}`);
  expect(result.headers.get('cache-control')?.includes('no-store'), `${path} no-store`);
  if (code) expect((await result.clone().json()).error.code === code, `${path} ${code}`);
  return result;
}

function post(body, cookie, requestOrigin = origin) {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Origin: requestOrigin, ...(cookie && { cookie }),
    },
    body: JSON.stringify(body),
  };
}

async function checkBrowserMode(app) {
  const shell = await response(app, '/', {}, 200);
  const html = await shell.text();
  expect(html.includes('name="veid"') && html.includes('name="apiKey"'),
    'zero-environment browser credential form');
  expect(shell.headers.get('x-frame-options') === 'DENY', 'frame protection');
  expect(shell.headers.has('content-security-policy'), 'SSR content security policy');
  const login = await response(app, '/login', {}, 303);
  expect(login.headers.get('location') === '/', 'browser mode needs no password setup');
  const insecure = await app.dispatchFetch('http://panel.example.com/', { redirect: 'manual' });
  expect(insecure.status === 403, 'production Worker rejects plaintext HTTP');
  expect((await insecure.json()).error.code === 'INVALID_ORIGIN', 'HTTPS request boundary');
  for (const path of ['/api/vps/info', '/api/vps/history', '/api/vps/events']) {
    await response(app, path, post({}), 400, 'INVALID_INPUT');
    await response(app, path, post({}, undefined, 'https://other.example.com'),
      403, 'INVALID_ORIGIN');
  }
  const stylesheet = html.match(/href="([^"]+\.css)"/);
  expect(stylesheet, 'SSR references bundled stylesheet');
  const css = await app.dispatchFetch(new URL(stylesheet[1], origin).href);
  expect(css.status === 200 && (await css.text()).includes('inline-flex'),
    'Worker asset binding serves generated component CSS');
  expect(transport.calls.length === 0, 'browser mode needs no Redis');
}

async function checkUnprotectedSecrets(app) {
  await app.setOptions(runtimeOptions({ BWG_API_KEY: 'unprotected-offline-secret' }));
  const refusal = await response(app, '/', {}, 503, 'SECURITY_NOT_CONFIGURED');
  expect(!(await refusal.text()).includes('unprotected-offline-secret'),
    'unprotected Worker key is never exposed');
  await response(app, '/api/vps/info', post({}), 503, 'SECURITY_NOT_CONFIGURED');
  expect(transport.calls.length === 0, 'invalid protection makes no outbound request');
}

async function checkProviderReads(app) {
  const info = await response(app, '/api/vps/info', post(credentials), 200);
  const data = await info.json();
  expect(data.basic.hostname === 'offline-cloudflare-worker' && data.resources.usedBytes === 20
    && data.resources.totalBytes === 200, 'Worker normalized monthly traffic multiplier');
  const live = await response(app, '/api/vps/info', post({ ...credentials, live: true }), 200);
  expect((await live.json()).system.availableRamBytes === 512 * 1024,
    'Worker normalized live Linux memory units');
  const history = await response(app, '/api/vps/history',
    post({ ...credentials, range: '24h' }), 200);
  const samples = await history.json();
  expect(samples.range === '24h' && samples.points.length === 2 &&
    samples.points[1].receivedBytes === 200 && samples.points[1].intervalSeconds === 60,
    'Worker normalized raw history samples and intervals');
  const audit = await response(app, '/api/vps/events', post(credentials), 200);
  const events = await audit.json();
  expect(events.events.length === 1 && events.events[0].action === 'restart' &&
    events.events[0].source === 'provider', 'Worker normalized provider audit event');
  const publicData = JSON.stringify({ data, samples, events });
  expect(!publicData.includes(credentials.apiKey) && !publicData.includes('private-provider'),
    'Worker DTOs redact provider secret and raw audit details');
  expect(provider.calls.length === 4, 'all read endpoints exercised actual workerd fetch');
}

async function checkProviderRedirect(app) {
  provider.redirect = true;
  const count = provider.calls.length;
  try {
    const result = await response(app, '/api/vps/info', post(credentials),
      502, 'UPSTREAM_UNAVAILABLE');
    const body = await result.text();
    expect(!body.includes(credentials.apiKey) && !body.includes('other.example.com'),
      'redirect response does not expose credentials or raw upstream details');
    expect(provider.calls.length === count + 1 && transport.unexpectedCalls === 0,
      'Worker never retries or forwards credentials to the redirected host');
  } finally {
    provider.redirect = false;
  }
}

async function login(app, useRedis) {
  const calls = transport.calls.length;
  const rejected = await response(app, '/api/auth/login', post({ password: 'incorrect' }),
    401, 'ACCESS_DENIED');
  expect(!rejected.headers.has('set-cookie'), 'wrong password creates no session');
  const accepted = await response(app, '/api/auth/login', post({ password }), 200);
  expect((await accepted.json()).ok === true, 'Worker password login');
  const setCookie = accepted.headers.get('set-cookie') ?? '';
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=28800']) {
    expect(setCookie.includes(flag), `Worker session cookie ${flag}`);
  }
  expect(!setCookie.includes('Domain='), 'host-only session cookie');
  const cookie = setCookie.split(';')[0];
  expect(cookie.startsWith(`${cookieName}=`), 'protected session cookie name');
  const { payload } = await jwtVerify(cookie.slice(cookieName.length + 1),
    new TextEncoder().encode(secret), {
      algorithms: ['HS256'], issuer: 'bwg-usage', audience: origin,
      requiredClaims: ['iat', 'exp', 'sub'],
    });
  expect(payload.sub === 'panel-owner' && payload.exp - payload.iat === 28_800,
    'workerd Web Crypto session signature and lifetime');
  const requests = transport.calls.slice(calls);
  expect(useRedis ? requests.length === 2 && requests.every(({ scope }) => scope === 'login') :
    requests.length === 0, 'configured Worker login limiter');
  return cookie;
}

async function checkPasswordMode(app) {
  await app.setOptions(runtimeOptions(panel));
  const anonymous = await response(app, '/', {}, 303);
  expect(anonymous.headers.get('location') === '/login', 'Worker env enables password gate');
  await response(app, '/', { headers: { cookie: `${cookieName}=forged` } }, 303);
  const loginPage = await response(app, '/login', {}, 200);
  expect((await loginPage.text()).includes('name="password"'), 'password SSR field');
  await response(app, '/api/vps/info', post({}), 401, 'ACCESS_DENIED');
  const cookie = await login(app, false);
  const shell = await response(app, '/', { headers: { cookie } }, 200);
  expect((await shell.text()).includes('name="apiKey"'), 'authenticated browser credentials');
  await response(app, '/api/vps/info', post({}, cookie), 400, 'INVALID_INPUT');
  return cookie;
}

async function checkManagedMode(app, cookie) {
  const key = 'runtime-only-cloudflare-provider-secret';
  provider.expectedKey = key;
  await app.setOptions(runtimeOptions({ ...panel, BWG_VEID: '123456', BWG_API_KEY: key }));
  const shell = await response(app, '/', { headers: { cookie } }, 200);
  const html = await shell.text();
  expect(html.includes('123456') && html.includes('服务端配置'),
    'Worker provider env bindings');
  expect(!html.includes(key) && !html.includes('name="apiKey"'), 'provider key stays server-only');
  const info = await response(app, '/api/vps/info',
    post({ veid: credentials.veid, apiKey: 'must-not-be-forwarded' }, cookie), 200);
  const dto = await info.text();
  expect(JSON.parse(dto).resources.usedBytes === 20 && !dto.includes(key),
    'Worker uses server binding over client key and redacts normalized response');
  const calls = transport.calls.length;
  await response(app, '/api/vps/action', post({ action: 'restart' }, cookie,
    'https://other.example.com'), 403, 'INVALID_ORIGIN');
  expect(transport.calls.length === calls, 'cross-origin action performs no Redis request');
}

async function checkRedisMode(app) {
  await app.setOptions(runtimeOptions({ ...panel, ...redisEnvironment }));
  const cookie = await login(app, true);
  await response(app, '/api/vps/info', post({}, cookie), 400, 'INVALID_INPUT');
  expect(transport.calls.at(-1).scope === 'query', 'Worker uses real Upstash query protocol');
  transport.mode = 'http-error';
  await response(app, '/api/vps/info', post({}, cookie), 503, 'RATE_LIMIT_UNAVAILABLE');
  transport.mode = 'deny';
  const denied = await response(app, '/api/vps/action', post({ action: 'restart' }, cookie),
    429, 'RATE_LIMITED');
  const retry = Number(denied.headers.get('retry-after'));
  expect(retry >= 1 && retry <= 60, 'Worker rate rejection has bounded Retry-After');
  transport.mode = 'success';
  await app.setOptions(runtimeOptions({ ...panel,
    UPSTASH_REDIS_REST_URL: redisEnvironment.UPSTASH_REDIS_REST_URL,
  }));
  const calls = transport.calls.length;
  await response(app, '/api/vps/info', post({}, cookie), 503, 'RATE_LIMIT_UNAVAILABLE');
  expect(transport.calls.length === calls, 'partial Redis config refuses without outbound');
}

async function checkClientSecrets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await checkClientSecrets(path);
    else if (/\.(js|html|json)$/.test(entry.name)) {
      const content = await readFile(path, 'utf8');
      expect(!/BWG_API_KEY|PANEL_PASSWORD|SESSION_SECRET/.test(content),
        'client secret isolation');
    }
  }
}

expect(config.compatibility_flags.includes('nodejs_compat'), 'Node compatibility flag');
expect(config.vars.NODE_ENV === 'production', 'deployed Worker uses production security');
expect(config.keep_vars === true, 'deploy keeps dashboard-configured Worker vars');
const app = new Miniflare(runtimeOptions({}));
try {
  await checkBrowserMode(app);
  await checkProviderReads(app);
  await checkProviderRedirect(app);
  await checkUnprotectedSecrets(app);
  const cookie = await checkPasswordMode(app);
  await checkManagedMode(app, cookie);
  await checkRedisMode(app);
  await checkClientSecrets(resolve(dirname(configPath), config.assets.directory));
  expect(transport.protocolErrors === 0, 'actual SDK matches offline Redis protocol');
  expect(transport.unexpectedCalls === 0, 'no real VPS or Redis calls');
  expect(provider.errors === 0 && provider.calls.length === 6,
    'only expected synthetic provider calls');
  console.log('Cloudflare workerd passed: assets, HTTPS, bindings, auth, Redis, secrets.');
} catch (error) {
  console.error('Offline transport diagnostics:', {
    providerCalls: provider.calls, providerFailures: provider.failures,
    unexpectedRequests: transport.unexpectedCalls, redisProtocolErrors: transport.protocolErrors,
  });
  throw error;
} finally {
  await app.dispose();
  await transport.settle();
}
