import { beforeEach, expect, test, vi } from 'vitest';
import { fetchAuditHistory, fetchTrafficHistory } from './dashboard-api';
import { fetchVPSData, performVPSAction } from './api';
import { dataFixture } from '@/components/VPSCard/testHelpers';
import type { VPSSystemData } from '@/types/resources';

const credentials = { veid: '123', apiKey: '' };
const history = { range: '7d', points: [], observedAt: '2026-10-05T10:00:00Z',
  source: 'provider', unit: 'bytes', semantics: 'raw-samples',
  availableFrom: null, availableTo: null, warning: null };
const system: VPSSystemData = {
  planRamBytes: 1024, planSwapBytes: 0, planDiskBytes: null, availableRamBytes: 512,
  swapTotalBytes: 0, swapAvailableBytes: 0, mappedDiskBytes: null,
  loadAverage: [0, 0.1, 1.2], cpuThrottled: false, diskThrottled: null,
  live: true, observedAt: '2026-10-05T10:00:00Z',
};

beforeEach(() => { vi.useFakeTimers(); });

test('server target history request carries the range and no key', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(history));
  vi.stubGlobal('fetch', fetcher);
  await expect(fetchTrafficHistory(credentials, '7d')).resolves.toMatchObject(history);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ veid: '123', range: '7d' });
});

test.each([
  { ...history, range: '24h' }, { ...history, semantics: 'cumulative' },
  { ...history, points: [{ timestamp: 'bad', receivedBytes: 0, sentBytes: 0 }] },
])('rejects mismatched or malformed history DTOs', async (payload) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)));
  await expect(fetchTrafficHistory(credentials, '7d'))
    .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

test('validates audit sources and outcomes rather than accepting untyped events', async () => {
  const base = { events: [], observedAt: history.observedAt,
    panelHistoryAvailable: false, warning: null };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(base))
    .mockResolvedValueOnce(Response.json({ ...base, events: [{ source: 'invalid' }] })));
  await expect(fetchAuditHistory(credentials)).resolves.toEqual(base);
  await expect(fetchAuditHistory(credentials)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

test.each([{ source: ['provider'], outcome: 'recorded' },
  { source: 'provider', outcome: ['recorded'] }])('rejects array event enums', async (patch) => {
  const event = { id: 'test', observedAt: history.observedAt, occurredAt: history.observedAt,
    action: 'start', message: 'event', requestId: null, ...patch };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ events: [event],
    observedAt: history.observedAt, panelHistoryAvailable: false, warning: null })));
  await expect(fetchAuditHistory(credentials)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

test('optional resources must have safe bytes, valid load and real observation time', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ ...dataFixture(), system }))
    .mockResolvedValueOnce(Response.json({ ...dataFixture(), system: { ...system,
      planRamBytes: Number.MAX_SAFE_INTEGER + 1 } })));
  await expect(fetchVPSData(credentials)).resolves.toMatchObject({ system });
  await expect(fetchVPSData(credentials)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

test('history storage warning does not discard an accepted action receipt', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ accepted: true,
    action: 'restart', requestId: 'test', historyWarning: '记录暂时不可用。' })));
  await expect(performVPSAction('restart', credentials)).resolves.toMatchObject({
    accepted: true, historyWarning: '记录暂时不可用。',
  });
});
