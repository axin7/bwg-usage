import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const EVIDENCE_DIR = join(tmpdir(), 'bwg-usage-validation');

async function requestJudgment(acceptance, evidence) {
  if (!process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY is required');
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'jev-latest', state: { acceptance, evidence },
      questions: { verdict: {
        type: 'choice',
        instructions: 'Judge every acceptance criterion against the actual browser evidence. '
          + 'Choose insufficient_evidence if any criterion is not established.',
        criteria: {
          pass: 'All criteria are directly supported by the evidence.',
          fail: 'At least one criterion is contradicted by the evidence.',
          insufficient_evidence: 'At least one criterion cannot be established.',
        },
      } },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  return { httpStatus: response.status, judgment: await response.json() };
}

export async function verifyCase(name, acceptance, evidence) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const record = { name, acceptance, evidence, status: 'unverified' };
  await writeFile(`${EVIDENCE_DIR}/${name}.json`, JSON.stringify(record, null, 2));
  const { httpStatus, judgment } = await requestJudgment(acceptance, evidence);
  await writeFile(`${EVIDENCE_DIR}/${name}.json`, JSON.stringify({
    ...record, httpStatus, judgment,
    status: httpStatus === 200 && judgment.answers?.verdict?.choice === 'pass'
      ? 'verified' : 'unverified',
  }, null, 2));
  console.log(JSON.stringify({ name, httpStatus, judgment }));
  if (httpStatus !== 200) throw new Error(`TypeSafe validation failed: ${httpStatus}`);
  if (judgment.answers?.verdict?.choice !== 'pass') {
    throw new Error(`Browser case was not verified: ${name}`);
  }
  return judgment;
}

function browserFixture() {
    if (window.__bwgMock?.syntheticDocument !== true
      && document.querySelector('[role=tablist][aria-label="VPS 数据视图"]')) {
      throw new Error('Install synthetic fixtures before connecting the dashboard.');
    }
    const fixture = {
      basic: { hostname: 'test-vps', node_location: 'Los Angeles', os: 'Debian 12',
        ip_addresses: ['192.0.2.1', '2001:db8:1234:5678:9012:3456:7890:abcd'] },
      resources: { totalBytes: 100 * 1024 ** 3, usedBytes: 20 * 1024 ** 3,
        remainingBytes: 80 * 1024 ** 3, percentUsed: 20 },
      status: { resetAt: '2026-11-06T00:00:00.000Z', daysRemaining: 31,
        dailyAverageBytes: 1024 ** 3, averageIsEstimate: true,
        suspended: false, policy_violation: false, powerState: 'unknown' },
      observedAt: new Date().toISOString(),
    };
    window.__bwgMock = { syntheticDocument: true, fixture,
      infoMode: 'success', actionMode: 'accepted',
      infoCount: 0, liveCount: 0, actionCount: 0, loginCount: 0, calls: [] };
}

function browserMock() {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const state = window.__bwgMock;
      const path = typeof url === 'string' ? url : String(url);
      if (!path.startsWith('/api/')) return originalFetch(url, options);
      const input = JSON.parse(String(options?.body ?? '{}'));
      const reply = (value, status = 200) => new Response(JSON.stringify(value), {
        status, headers: { 'Content-Type': 'application/json' },
      });
      if (path === '/api/auth/login') {
        state.loginCount += 1;
        return reply({ error: { code: 'ACCESS_DENIED', message: '密码错误。' } }, 401);
      }
      if (path === '/api/auth/logout') return reply({ ok: true });
      state.calls.push({ path, veid: input.veid, action: input.action, live: !!input.live });
      if (path === '/api/vps/info') {
        state.infoCount += 1;
        if (input.live) state.liveCount += 1;
        if (state.infoMode === 'failure') return reply({ error: {
          code: 'UPSTREAM_TIMEOUT', message: '服务商响应超时。', requestId: 'mock-read',
        } }, 504);
        const data = structuredClone(state.fixture);
        data.observedAt = new Date().toISOString();
        if (input.live) data.status.powerState = 'running';
        return reply(data);
      }
      if (path === '/api/vps/action') {
        state.actionCount += 1;
        await new Promise((resolve) => setTimeout(resolve, state.actionDelay ?? 1_500));
        if (state.actionMode === 'unknown') return reply({ error: {
          code: 'UPSTREAM_TIMEOUT', message: '服务商响应超时。', requestId: 'mock-unknown',
          outcome: 'unknown',
        } }, 504);
        return reply({ accepted: true, action: input.action, requestId: 'mock-accepted' });
      }
      throw new Error('Unexpected API path');
    };
}

export async function installMock(page) {
  await page.evaluate(browserFixture);
  await page.evaluate(browserMock);
}

export async function installPreload(page) {
  return page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `(${browserFixture.toString()})();(${browserMock.toString()})();`,
  });
}

export async function pageEvidence(page) {
  return page.evaluate(() => {
    if (window.__bwgMock?.syntheticDocument !== true
      && document.querySelector('[role=tablist][aria-label="VPS 数据视图"]')) {
      throw new Error('Use synthetic fixtures before collecting connected dashboard evidence.');
    }
    const visible = (element) => element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== 'hidden';
    const viewport = { width: innerWidth, height: innerHeight };
    const overflow = [...document.querySelectorAll('button,input,h1,h2,dd,dt')]
      .filter(visible).filter((element) => {
        const box = element.getBoundingClientRect();
        return box.left < -1 || box.right > innerWidth + 1;
      }).map((element) => element.getAttribute('aria-label') || element.tagName);
    const buttons = [...document.querySelectorAll('button')].filter(visible)
      .map((button) => ({ text: button.textContent, label: button.getAttribute('aria-label'),
        disabled: button.disabled }));
    const inputs = [...document.querySelectorAll('input')].filter(visible)
      .map((input) => ({ id: input.id, name: input.name, type: input.type,
        checked: input.checked, disabled: input.disabled }));
    const metrics = Object.fromEntries([...document.querySelectorAll('dl>div')]
      .map((item) => [item.querySelector('dt')?.textContent,
        item.querySelector('dd')?.textContent]));
    const progress = document.querySelector('[role=progressbar]');
    return { text: document.body.innerText, viewport, overflow, buttons, inputs, metrics,
      progress: { value: progress?.getAttribute('aria-valuenow'),
        text: progress?.getAttribute('aria-valuetext') },
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      rememberChecked: !!document.querySelector('[name=remember]')?.checked,
      apiKeyMasked: document.querySelector('#apiKey')?.type === 'password',
      storedKeys: Object.keys(localStorage),
      api: window.__bwgMock ? { info: window.__bwgMock.infoCount,
        live: window.__bwgMock.liveCount, actions: window.__bwgMock.actionCount,
        login: window.__bwgMock.loginCount, calls: window.__bwgMock.calls } : null,
    };
  });
}
