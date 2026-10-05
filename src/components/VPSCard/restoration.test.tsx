import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError, fetchVPSData, performVPSAction } from '@/lib/api';
import type { VPSData } from '@/types';
import { useVPSController } from './useVPSController';
import { CREDENTIALS, dataFixture, deferred, prepareControllerTest } from './testHelpers';

vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(),
  fetchVPSData: vi.fn(), performVPSAction: vi.fn(),
}));

beforeEach(() => {
  prepareControllerTest();
  sessionStorage.clear();
  vi.mocked(fetchVPSData).mockReset().mockResolvedValue(dataFixture());
  vi.mocked(performVPSAction).mockReset();
});

test('saved connection waits for fresh data and never submits a management action', async () => {
  localStorage.setItem('vps_credentials_v2', JSON.stringify(CREDENTIALS));
  const pending = deferred<VPSData>();
  vi.mocked(fetchVPSData).mockReturnValueOnce(pending.promise);
  const { result } = renderHook(useVPSController);
  await act(async () => {});
  expect(result.current.session.saving).toBe(true);
  expect(result.current.session.credentials).toBeNull();
  expect(result.current.reads.data).toBeNull();
  await act(async () => {
    pending.resolve(dataFixture({ observedAt: '2026-10-05T00:01:00.000Z' }));
    await pending.promise;
  });
  expect(result.current.session.credentials).toEqual(CREDENTIALS);
  expect(result.current.reads.data?.observedAt).toBe('2026-10-05T00:01:00.000Z');
  expect(result.current.session.saving).toBe(false);
  expect(fetchVPSData).toHaveBeenCalledOnce();
  expect(performVPSAction).not.toHaveBeenCalled();
});

test('explicit disconnect survives reload until a verified manual reconnect', async () => {
  const first = renderHook(useVPSController);
  await act(async () => { await first.result.current.configuration.save(CREDENTIALS, true); });
  act(() => first.result.current.configuration.disconnect());
  first.unmount();
  const second = renderHook(useVPSController);
  await act(async () => {});
  expect(second.result.current.session.credentials).toBeNull();
  expect(second.result.current.session.stored?.credentials).toEqual(CREDENTIALS);
  expect(fetchVPSData).toHaveBeenCalledOnce();
  act(() => second.result.current.configuration.reuse());
  await act(async () => { await second.result.current.configuration.save(CREDENTIALS, true); });
  second.unmount();
  const third = renderHook(useVPSController);
  await act(async () => {});
  expect(third.result.current.session.credentials).toEqual(CREDENTIALS);
  expect(fetchVPSData).toHaveBeenCalledTimes(3);
});

test('opted-out credentials remain in memory and are never restored on reload', async () => {
  const first = renderHook(useVPSController);
  await act(async () => { await first.result.current.configuration.save(CREDENTIALS, false); });
  expect(first.result.current.session.credentials).toEqual(CREDENTIALS);
  first.unmount();
  const second = renderHook(useVPSController);
  await act(async () => {});
  expect(second.result.current.session.credentials).toBeNull();
  expect(second.result.current.session.editing).toBe(true);
  expect(fetchVPSData).toHaveBeenCalledOnce();
  expect(localStorage.getItem('vps_credentials_v2')).toBeNull();
});

test('failed restoration retains saved credentials and permits a manual replacement', async () => {
  localStorage.setItem('vps_credentials_v2', JSON.stringify(CREDENTIALS));
  vi.mocked(fetchVPSData).mockRejectedValueOnce(new ApiError({
    code: 'INVALID_KEY', message: '密钥无效', requestId: 'restore-1',
  }));
  const { result } = renderHook(useVPSController);
  await act(async () => {});
  expect(result.current.session.credentials).toBeNull();
  expect(result.current.session.editing).toBe(true);
  expect(result.current.session.saving).toBe(false);
  expect(result.current.session.error?.requestId).toBe('restore-1');
  expect(result.current.session.stored?.credentials).toEqual(CREDENTIALS);
  const replacement = { veid: '9999', apiKey: 'replacement-key' };
  await act(async () => { await result.current.configuration.save(replacement, true); });
  expect(result.current.session.credentials).toEqual(replacement);
  expect(result.current.session.error).toBeNull();
});

test('Strict Mode starts only one automatic verification and keeps its result', async () => {
  localStorage.setItem('vps_credentials_v2', JSON.stringify(CREDENTIALS));
  const { result } = renderHook(useVPSController, {
    wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
  });
  await act(async () => {});
  expect(fetchVPSData).toHaveBeenCalledOnce();
  expect(result.current.session.credentials).toEqual(CREDENTIALS);
  expect(result.current.session.saving).toBe(false);
});

test('unmount before automatic verification starts makes no request', async () => {
  localStorage.setItem('vps_credentials_v2', JSON.stringify(CREDENTIALS));
  const { unmount } = renderHook(useVPSController);
  unmount();
  await act(async () => {});
  expect(fetchVPSData).not.toHaveBeenCalled();
});

test('disconnect during restoration aborts and ignores a late successful response', async () => {
  localStorage.setItem('vps_credentials_v2', JSON.stringify(CREDENTIALS));
  const pending = deferred<VPSData>();
  vi.mocked(fetchVPSData).mockReturnValueOnce(pending.promise);
  const { result } = renderHook(useVPSController);
  await act(async () => {});
  const signal = vi.mocked(fetchVPSData).mock.calls[0]?.[1]?.signal;
  act(() => result.current.configuration.disconnect());
  expect(signal?.aborted).toBe(true);
  await act(async () => { pending.resolve(dataFixture()); await pending.promise; });
  expect(result.current.session.credentials).toBeNull();
  expect(result.current.reads.data).toBeNull();
  expect(result.current.session.saving).toBe(false);
  expect(result.current.session.stored?.credentials).toEqual(CREDENTIALS);
});

test('unmount aborts active restoration without changing the saved credentials', async () => {
  const saved = JSON.stringify(CREDENTIALS);
  localStorage.setItem('vps_credentials_v2', saved);
  const pending = deferred<VPSData>();
  vi.mocked(fetchVPSData).mockReturnValueOnce(pending.promise);
  const { unmount } = renderHook(useVPSController);
  await act(async () => {});
  const signal = vi.mocked(fetchVPSData).mock.calls[0]?.[1]?.signal;
  unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => { pending.resolve(dataFixture()); await pending.promise; });
  expect(localStorage.getItem('vps_credentials_v2')).toBe(saved);
});

test('server-managed mode reads only its server target despite saved browser credentials',
  async () => {
    localStorage.setItem('vps_credentials_v2', JSON.stringify(CREDENTIALS));
    const { result } = renderHook(() => useVPSController('7777'));
    await act(async () => {});
    expect(fetchVPSData).toHaveBeenCalledOnce();
    expect(vi.mocked(fetchVPSData).mock.calls[0]?.[0]).toEqual({ veid: '7777', apiKey: '' });
    expect(result.current.session.credentials).toEqual({ veid: '7777', apiKey: '' });
    expect(result.current.session.stored?.credentials).toEqual(CREDENTIALS);
    expect(localStorage.getItem('vps_credentials_v2')).toBe(JSON.stringify(CREDENTIALS));
  });

test('corrupt current storage remains a usable form without contacting the server', async () => {
  localStorage.setItem('vps_credentials_v2', '{not-json');
  const { result } = renderHook(useVPSController);
  await act(async () => {});
  expect(result.current.session.credentials).toBeNull();
  expect(result.current.session.editing).toBe(true);
  expect(result.current.session.notice).toContain('无法读取');
  expect(fetchVPSData).not.toHaveBeenCalled();
});

test('unavailable tab storage prevents automatic restoration but allows manual use', async () => {
  localStorage.setItem('vps_credentials_v2', JSON.stringify(CREDENTIALS));
  const getItem = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
    if (this === sessionStorage) throw new DOMException('Denied', 'SecurityError');
    return getItem.call(this, key);
  });
  const { result } = renderHook(useVPSController);
  await act(async () => {});
  expect(fetchVPSData).not.toHaveBeenCalled();
  expect(result.current.session.editing).toBe(true);
  await act(async () => { await result.current.configuration.save(CREDENTIALS, false); });
  expect(result.current.session.credentials).toEqual(CREDENTIALS);
});
