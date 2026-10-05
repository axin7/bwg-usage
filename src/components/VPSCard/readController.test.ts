import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { fetchVPSData } from '@/lib/api';
import type { VPSData } from '@/types';
import { useVPSController } from './useVPSController';
import { connect, dataFixture, deferred, prepareControllerTest } from './testHelpers';

vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(),
  fetchVPSData: vi.fn(), performVPSAction: vi.fn(),
}));

beforeEach(() => {
  prepareControllerTest();
  vi.mocked(fetchVPSData).mockReset().mockResolvedValue(dataFixture());
});

test('deduplicates manual reads and schedules the next poll after completion', async () => {
  const { result } = renderHook(useVPSController);
  await connect(result);
  const pending = deferred<VPSData>();
  vi.mocked(fetchVPSData).mockReturnValueOnce(pending.promise);
  let first: Promise<VPSData | null> | undefined;
  let second: Promise<VPSData | null> | undefined;
  act(() => { first = result.current.reads.refresh(); second = result.current.reads.refresh(); });
  expect(first).toBe(second);
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(fetchVPSData).toHaveBeenCalledTimes(2);
  await act(async () => { pending.resolve(dataFixture()); await first; });
  await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
  expect(fetchVPSData).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(fetchVPSData).toHaveBeenCalledTimes(3);
});

test('pauses hidden/offline polling and refreshes on visibility/network recovery', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  const online = vi.spyOn(navigator, 'onLine', 'get');
  const { result } = renderHook(useVPSController);
  await connect(result);
  visibility.mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(fetchVPSData).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(fetchVPSData).toHaveBeenCalledTimes(2);
  online.mockReturnValue(false);
  act(() => window.dispatchEvent(new Event('offline')));
  expect(result.current.reads.offline).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(fetchVPSData).toHaveBeenCalledTimes(2);
  online.mockReturnValue(true);
  await act(async () => { window.dispatchEvent(new Event('online')); });
  expect(fetchVPSData).toHaveBeenCalledTimes(3);
});

test('reset aborts reads and ignores late completion from the previous credential generation',
  async () => {
    const { result } = renderHook(useVPSController);
    await connect(result);
    const pending = deferred<VPSData>();
    vi.mocked(fetchVPSData).mockReturnValueOnce(pending.promise);
    act(() => { void result.current.reads.refresh(); });
    const signal = vi.mocked(fetchVPSData).mock.calls[1]?.[1]?.signal;
    act(() => result.current.configuration.reset());
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(dataFixture()); await pending.promise; });
    expect(result.current.session.credentials).toBeNull();
    expect(result.current.reads.data).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchVPSData).toHaveBeenCalledTimes(2);
  });

test('backs off failed polling while retaining the last successful snapshot', async () => {
  const { result } = renderHook(useVPSController);
  await connect(result);
  vi.mocked(fetchVPSData).mockRejectedValueOnce(new Error('Offline'));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(result.current.reads.data?.basic.hostname).toBe('test-vps');
  expect(result.current.reads.stale).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
  expect(fetchVPSData).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(fetchVPSData).toHaveBeenCalledTimes(3);
  expect(result.current.reads.stale).toBe(false);
});

test('unmount aborts the active read and removes polling listeners', async () => {
  const { result, unmount } = renderHook(useVPSController);
  await connect(result);
  const pending = deferred<VPSData>();
  vi.mocked(fetchVPSData).mockReturnValueOnce(pending.promise);
  act(() => { void result.current.reads.refresh(); });
  const signal = vi.mocked(fetchVPSData).mock.calls[1]?.[1]?.signal;
  unmount();
  expect(signal?.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000);
  window.dispatchEvent(new Event('focus'));
  expect(fetchVPSData).toHaveBeenCalledTimes(2);
  pending.resolve(dataFixture());
});
