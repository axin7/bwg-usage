import { beforeEach, expect, test, vi } from 'vitest';
import { fetchVPSData } from '@/lib/api';
import type { VPSCredentials } from '@/types';
import type { VPSSystemData } from '@/types/resources';
import { createReadRuntime, EMPTY_READ, readData, type ReadSnapshot } from './readScheduler';
import { CREDENTIALS, dataFixture, prepareControllerTest } from './testHelpers';

vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(), fetchVPSData: vi.fn(),
}));

const LIVE_AT = '2026-10-05T00:00:00.000Z';
const BASIC_AT = '2026-10-05T00:01:00.000Z';

function systemFixture(overrides: Partial<VPSSystemData> = {}): VPSSystemData {
  return {
    planRamBytes: 1024, planSwapBytes: 512, planDiskBytes: 4096,
    availableRamBytes: 768, swapTotalBytes: 512, swapAvailableBytes: 256,
    mappedDiskBytes: 2048, loadAverage: [0.1, 0.2, 0.3],
    cpuThrottled: true, diskThrottled: false, observedAt: LIVE_AT, live: true,
    ...overrides,
  };
}

function basicSystem(): VPSSystemData {
  return systemFixture({
    planRamBytes: 2048, planSwapBytes: null, planDiskBytes: 8192,
    availableRamBytes: null, swapTotalBytes: null, swapAvailableBytes: null,
    mappedDiskBytes: null, loadAverage: null, cpuThrottled: null, diskThrottled: null,
    observedAt: BASIC_AT, live: false,
  });
}

function harness(credentials: VPSCredentials = CREDENTIALS) {
  let snapshot: ReadSnapshot = { ...EMPTY_READ };
  const runtime = createReadRuntime(credentials, (patch) => {
    snapshot = { ...snapshot, ...patch };
  });
  return { runtime, snapshot: () => snapshot };
}

beforeEach(() => {
  prepareControllerTest();
  vi.mocked(fetchVPSData).mockReset();
});

test('basic polling preserves live readings and date while updating all plan capacities',
  async () => {
    const state = harness();
    const live = systemFixture();
    vi.mocked(fetchVPSData)
      .mockResolvedValueOnce(dataFixture({ system: live, observedAt: LIVE_AT }))
      .mockResolvedValueOnce(dataFixture({ system: basicSystem(), observedAt: BASIC_AT }));
    await readData(state.runtime, true);
    vi.setSystemTime(new Date(BASIC_AT));
    await readData(state.runtime);
    expect(state.snapshot().data?.system).toEqual({
      ...live, planRamBytes: 2048, planSwapBytes: null, planDiskBytes: 8192,
    });
    expect(state.snapshot().data?.observedAt).toBe(BASIC_AT);
    expect(state.snapshot().lastSuccess).toBe(BASIC_AT);
    expect(state.snapshot().data?.system?.observedAt).toBe(LIVE_AT);
    expect(vi.mocked(fetchVPSData).mock.calls[1][1]?.live).toBe(false);
  });

test('a newly created target runtime cannot reuse the previous target live metrics', async () => {
  const previous = harness();
  vi.mocked(fetchVPSData).mockResolvedValueOnce(dataFixture({ system: systemFixture() }));
  await readData(previous.runtime, true);
  const nextCredentials = { veid: '654321', apiKey: 'second-test-only-key' };
  const next = harness(nextCredentials);
  const basic = basicSystem();
  expect(next.runtime.lastLiveSystem).toBeNull();
  vi.mocked(fetchVPSData).mockResolvedValueOnce(dataFixture({ system: basic }));
  await readData(next.runtime);
  expect(next.snapshot().data?.system).toEqual(basic);
  expect(next.snapshot().data?.system?.availableRamBytes).toBeNull();
  expect(next.runtime.lastLiveSystem).toBeNull();
  expect(previous.runtime.lastLiveSystem?.availableRamBytes).toBe(768);
  expect(vi.mocked(fetchVPSData).mock.calls[1][0]).toEqual(nextCredentials);
});

test('failed live refresh retains the snapshot and its original freshness timestamps',
  async () => {
    const state = harness();
    vi.mocked(fetchVPSData).mockResolvedValueOnce(dataFixture({ system: systemFixture() }));
    await readData(state.runtime, true);
    const successful = state.snapshot();
    const cachedSystem = state.runtime.lastLiveSystem;
    vi.setSystemTime(new Date(BASIC_AT));
    vi.mocked(fetchVPSData).mockRejectedValueOnce(new Error('Live provider unavailable'));
    await expect(readData(state.runtime, true)).resolves.toBeNull();
    expect(state.snapshot().data).toBe(successful.data);
    expect(state.snapshot().lastSuccess).toBe(successful.lastSuccess);
    expect(state.snapshot().data?.system?.observedAt).toBe(LIVE_AT);
    expect(state.runtime.lastLiveSystem).toBe(cachedSystem);
    expect(state.snapshot()).toMatchObject({ stale: true, reading: false });
    expect(state.snapshot().error?.code).toBe('CLIENT_ERROR');
  });
