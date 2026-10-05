import { installMock, pageEvidence } from './browser-evidence.mjs';

function dashboardFixtures() {
  const state = window.__bwgMock;
  state.fixture.basic.vm_type = 'kvm';
  state.system = {
    planRamBytes: 2 * 1024 ** 3, planSwapBytes: 1024 ** 3, planDiskBytes: 40 * 1024 ** 3,
    availableRamBytes: 1.25 * 1024 ** 3, swapTotalBytes: 1024 ** 3,
    swapAvailableBytes: 0.75 * 1024 ** 3, mappedDiskBytes: null, loadAverage: [0.12, 0.24, 0.36],
    cpuThrottled: false, diskThrottled: true, observedAt: new Date().toISOString(), live: true,
  };
  state.historyCount = 0;
  state.eventsCount = 0;
  state.historyMode = 'success';
  state.eventsMode = 'success';
  state.aborted = [];
  state.pending = [];
  state.csv = null;
  const createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    void blob.text().then((text) => { state.csv = text; });
    return createObjectURL(blob);
  };
}

function historyFixture(range) {
  const at = Date.now();
  const points = [0, 60, 120, 420, 480].map((offset, index) => ({
    timestamp: new Date(at - (600 - offset) * 1000).toISOString(),
    receivedBytes: index === 2 ? null : index * 1024 ** 2,
    sentBytes: (index + 1) * 0.5 * 1024 ** 2,
    intervalSeconds: index === 0 ? null : index === 3 ? 300 : 60,
    gapBefore: index === 3,
  }));
  return { range, points, observedAt: new Date(at).toISOString(), source: 'provider',
    unit: 'bytes', semantics: 'raw-samples', availableFrom: points[0].timestamp,
    availableTo: points.at(-1).timestamp,
    warning: '原始样本不等于计费流量；部分指标缺失，样本间隔变化未补零。' };
}

function auditFixture() {
  const at = new Date().toISOString();
  const event = (id, source, action, outcome, message, requestId = null) => ({
    id, source, action, outcome, message, requestId, occurredAt: at, observedAt: at,
  });
  return { observedAt: at, panelHistoryAvailable: true, warning: null, events: [
    event('provider:1', 'provider', 'restart', 'recorded', '服务商记录了一次重启事件。'),
    event('panel:1', 'panel', 'start', 'accepted', '管理请求已受理，状态待确认。', 'fixture-start'),
    event('panel:2', 'panel', 'stop', 'unknown', '管理请求结果未知，未自动重发。', 'fixture-stop'),
  ] };
}

function pendingReply(state, range, signal, response) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      state.aborted.push(range);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    state.pending.push({ range, resolve: () => {
      signal?.removeEventListener('abort', abort);
      resolve(response);
    } });
  });
}

function dashboardTransport() {
  const previousFetch = window.fetch;
  window.fetch = async (url, options) => {
    const path = String(url);
    const state = window.__bwgMock;
    const input = JSON.parse(String(options?.body ?? '{}'));
    const response = (data, status = 200) => Response.json(data, { status });
    if (path === '/api/vps/history' || path === '/api/vps/events') {
      state.calls.push({ path, range: input.range, veid: input.veid });
      const mode = path.endsWith('history') ? state.historyMode : state.eventsMode;
      if (path.endsWith('history')) state.historyCount += 1;
      else state.eventsCount += 1;
      if (mode === 'failure') return response({ error: { code: 'UPSTREAM_TIMEOUT',
        message: '服务商响应超时。', requestId: 'fixture-history' } }, 504);
      const data = path.endsWith('history') ? window.__trafficFixture(input.range)
        : window.__auditFixture();
      if (mode === 'pending') return window.__pendingReply(state, input.range,
        options?.signal, response(data));
      return response(data);
    }
    const result = await previousFetch(url, options);
    if (path !== '/api/vps/info' || !result.ok) return result;
    const data = await result.json();
    data.system = { ...state.system, live: !!input.live };
    if (!input.live) {
      const keys = ['availableRamBytes', 'swapTotalBytes', 'swapAvailableBytes',
        'mappedDiskBytes', 'loadAverage', 'cpuThrottled', 'diskThrottled'];
      for (const key of keys) data.system[key] = null;
      data.system.observedAt = data.observedAt;
    }
    return response(data);
  };
}

export async function installDashboardMock(page) {
  await installMock(page);
  await page.evaluate(dashboardFixtures);
  await page.evaluate(`window.__trafficFixture = ${historyFixture.toString()};
    window.__auditFixture = ${auditFixture.toString()};
    window.__pendingReply = ${pendingReply.toString()};`);
  await page.evaluate(dashboardTransport);
}

export async function dashboardEvidence(page) {
  const base = await pageEvidence(page);
  const dashboard = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('[role=tab]')].map((tab) => ({
      text: tab.textContent, selected: tab.getAttribute('aria-selected'),
    })),
    tableText: document.querySelector('details table')?.innerText ?? null,
    chartPaths: document.querySelectorAll('.recharts-line-curve').length,
    selectedTab: document.querySelector('[role=tab][aria-selected=true]')?.textContent,
    historyCount: window.__bwgMock.historyCount, eventsCount: window.__bwgMock.eventsCount,
    aborted: window.__bwgMock.aborted, csv: window.__bwgMock.csv,
    auditRows: [...document.querySelectorAll('[aria-labelledby=audit-heading] ol li')]
      .map((row) => row.innerText),
    systemText: document.querySelector('[aria-labelledby=resources-heading]')?.innerText,
  }));
  return { ...base, dashboard };
}
