import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError, fetchVPSData, performVPSAction } from './api';
import { CREDENTIALS, dataFixture } from '@/components/VPSCard/testHelpers';

beforeEach(() => { vi.useFakeTimers(); });

test('client narrows valid zero and over-quota DTOs without clamping data', async () => {
  const data = dataFixture();
  data.status.daysRemaining = 0;
  data.resources.percentUsed = 120;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)));
  await expect(fetchVPSData(CREDENTIALS)).resolves.toMatchObject({
    resources: { percentUsed: 120 }, status: { daysRemaining: 0 },
  });
});

test('invalid DTO and non-JSON responses become safe structured errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ basic: {} }))
    .mockResolvedValueOnce(new Response('<html>Unavailable</html>', { status: 502 })));
  await expect(fetchVPSData(CREDENTIALS)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  await expect(fetchVPSData(CREDENTIALS)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

test('server errors retain their code, outcome and correlation identifier', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: {
    code: 'PROVIDER_REJECTED', message: '服务商拒绝了操作', requestId: 'server-1',
    outcome: 'rejected',
  } }, { status: 400 })));
  await expect(performVPSAction('stop', CREDENTIALS)).rejects.toMatchObject({
    code: 'PROVIDER_REJECTED', outcome: 'rejected', requestId: 'server-1',
  });
});

test('action deadline aborts once and produces an unknown outcome without retries', async () => {
  const fetcher = vi.fn((_route: string, options: RequestInit) => new Promise<Response>(
    (_resolve, reject) => options.signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'));
    }),
  ));
  vi.stubGlobal('fetch', fetcher);
  const pending = performVPSAction('restart', CREDENTIALS);
  const checked = expect(pending).rejects.toMatchObject({
    code: 'CLIENT_TIMEOUT', outcome: 'unknown',
  });
  await vi.advanceTimersByTimeAsync(25_000);
  await checked;
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('caller cancellation is distinguished from request failure', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn((_route: string, options: RequestInit) => new Promise<Response>(
    (_resolve, reject) => options.signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'));
    }),
  )));
  const pending = fetchVPSData(CREDENTIALS, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});

test('an unrecognizable action response cannot be reported as acceptance', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
    action: 'stop', accepted: true,
  })));
  await expect(performVPSAction('stop', CREDENTIALS)).rejects.toBeInstanceOf(ApiError);
});

test.each([
  { name: 'array power state', patch: { powerState: ['running'] } },
  { name: 'negative average', patch: { dailyAverageBytes: -1 } },
  { name: 'fractional remaining days', patch: { daysRemaining: 0.5 } },
])('rejects $name without accepting an invalid DTO', async ({ patch }) => {
  const data = dataFixture();
  const invalid = { ...data, status: { ...data.status, ...patch } };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(invalid)));
  await expect(fetchVPSData(CREDENTIALS)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

test('negative integer remaining days represent overdue resets', async () => {
  const data = dataFixture();
  data.status.daysRemaining = -1;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)));
  await expect(fetchVPSData(CREDENTIALS)).resolves.toMatchObject({
    status: { daysRemaining: -1 },
  });
});

test('server credentials send only the public VEID without a blank or real API key', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(dataFixture()));
  vi.stubGlobal('fetch', fetcher);
  await fetchVPSData({ veid: '2468', apiKey: '' });
  expect(fetcher).toHaveBeenCalledWith('/api/vps/info', expect.objectContaining({
    body: JSON.stringify({ veid: '2468' }),
  }));
});
