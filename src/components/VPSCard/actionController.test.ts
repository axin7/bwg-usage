import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError, fetchVPSData, performVPSAction } from '@/lib/api';
import type { ActionReceipt, VPSData } from '@/types';
import { useVPSController } from './useVPSController';
import { connect, dataFixture, deferred, prepareControllerTest } from './testHelpers';

vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(),
  fetchVPSData: vi.fn(), performVPSAction: vi.fn(),
}));

beforeEach(() => {
  prepareControllerTest();
  vi.mocked(fetchVPSData).mockReset().mockResolvedValue(dataFixture());
  vi.mocked(performVPSAction).mockReset();
});

test('cancel performs zero actions and double confirmation performs exactly one', async () => {
  const { result } = renderHook(useVPSController);
  await connect(result);
  act(() => result.current.actions.open('stop'));
  act(() => result.current.actions.close());
  expect(performVPSAction).not.toHaveBeenCalled();
  const pending = deferred<ActionReceipt>();
  vi.mocked(performVPSAction).mockReturnValueOnce(pending.promise);
  act(() => result.current.actions.open('stop'));
  act(() => { result.current.actions.confirm(); result.current.actions.confirm(); });
  expect(performVPSAction).toHaveBeenCalledTimes(1);
  expect(result.current.actions.pending?.action).toBe('stop');
  await act(async () => {
    pending.resolve({ action: 'stop', accepted: true, requestId: 'action-1' });
    await pending.promise;
  });
  expect(result.current.actions.result?.outcome).toBe('accepted');
});

test('mutation busy state remains independent of an aborted read and periodic polling',
  async () => {
    const { result } = renderHook(useVPSController);
    await connect(result);
    const reading = deferred<VPSData>();
    const action = deferred<ActionReceipt>();
    vi.mocked(fetchVPSData).mockReturnValueOnce(reading.promise);
    vi.mocked(performVPSAction).mockReturnValueOnce(action.promise);
    act(() => { void result.current.reads.refresh(); });
    act(() => result.current.actions.open('restart'));
    act(() => result.current.actions.confirm());
    expect(result.current.reads.reading).toBe(false);
    await act(async () => { reading.resolve(dataFixture()); await reading.promise; });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current.actions.pending?.action).toBe('restart');
    expect(fetchVPSData).toHaveBeenCalledTimes(2);
    await act(async () => {
      action.resolve({ action: 'restart', accepted: true, requestId: 'restart-1' });
      await action.promise;
    });
    expect(fetchVPSData).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetchVPSData).mock.calls[2]?.[1]?.live).toBe(true);
    expect(result.current.actions.result?.outcome).toBe('accepted');
  });

test('accepted action receipt survives a failed status refresh', async () => {
  const { result } = renderHook(useVPSController);
  await connect(result);
  vi.mocked(performVPSAction).mockResolvedValueOnce({
    action: 'start', accepted: true, requestId: 'accepted-1',
  });
  vi.mocked(fetchVPSData).mockRejectedValueOnce(new ApiError({
    code: 'UPSTREAM_TIMEOUT', message: '状态刷新超时', requestId: 'read-1',
  }));
  act(() => result.current.actions.open('start'));
  await act(async () => { result.current.actions.confirm(); });
  expect(result.current.actions.result?.outcome).toBe('accepted');
  expect(result.current.actions.result?.requestId).toBe('accepted-1');
  expect(result.current.reads.error?.requestId).toBe('read-1');
});

test('a late action result retains its original target after reset', async () => {
  const { result } = renderHook(useVPSController);
  await connect(result);
  const pending = deferred<ActionReceipt>();
  vi.mocked(performVPSAction).mockReturnValueOnce(pending.promise);
  act(() => result.current.actions.open('stop'));
  act(() => result.current.actions.confirm());
  act(() => result.current.configuration.reset());
  await act(async () => {
    pending.resolve({ action: 'stop', accepted: true, requestId: 'old-target' });
    await pending.promise;
  });
  expect(result.current.actions.result?.target.veid).toBe('123456');
  expect(result.current.actions.result?.target.hostname).toBe('test-vps');
  expect(result.current.session.credentials).toBeNull();
  expect(fetchVPSData).toHaveBeenCalledTimes(1);
});

test('unknown action outcomes are never automatically retried', async () => {
  const { result } = renderHook(useVPSController);
  await connect(result);
  vi.mocked(performVPSAction).mockRejectedValueOnce(new ApiError({
    code: 'ACTION_TIMEOUT', message: '操作超时', requestId: 'unknown-1', outcome: 'unknown',
  }));
  act(() => result.current.actions.open('restart'));
  await act(async () => { result.current.actions.confirm(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
  expect(performVPSAction).toHaveBeenCalledTimes(1);
  expect(result.current.actions.result?.outcome).toBe('unknown');
});

test('editing invalidates the confirmation before any request can be sent', async () => {
  const { result } = renderHook(useVPSController);
  await connect(result);
  act(() => result.current.actions.open('stop'));
  act(() => { result.current.configuration.edit(); result.current.actions.confirm(); });
  expect(performVPSAction).not.toHaveBeenCalled();
  expect(result.current.actions.dialog).toBeNull();
});

test('pending management blocks immediate edit and cancellation cannot resume a basic read',
  async () => {
    const { result } = renderHook(useVPSController);
    await connect(result);
    const pending = deferred<ActionReceipt>();
    vi.mocked(performVPSAction).mockReturnValueOnce(pending.promise);
    act(() => result.current.actions.open('stop'));
    act(() => {
      result.current.actions.confirm();
      result.current.configuration.edit();
      result.current.configuration.cancel();
    });
    expect(result.current.session.editing).toBe(false);
    expect(result.current.actions.pending?.action).toBe('stop');
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(fetchVPSData).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ action: 'stop', accepted: true, requestId: 'pause-owner' });
      await pending.promise;
    });
    expect(fetchVPSData).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchVPSData).mock.calls[1]?.[1]?.live).toBe(true);
  });
