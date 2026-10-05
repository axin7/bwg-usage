import { act, fireEvent, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { deferred } from './testHelpers';
import { useDashboardHistory } from './useDashboardHistory';

test('history reads are lazy and repeated refreshes share the active request', async () => {
  const request = deferred<string>();
  const load = vi.fn(() => request.promise);
  const { result, rerender } = renderHook(({ active }) =>
    useDashboardHistory('target-1:7d', active, false, load),
  { initialProps: { active: false } });
  expect(load).not.toHaveBeenCalled();
  rerender({ active: true });
  expect(load).toHaveBeenCalledTimes(1);
  let first: Promise<void> | undefined;
  let second: Promise<void> | undefined;
  act(() => { first = result.current.refresh(); second = result.current.refresh(); });
  expect(first).toBe(second);
  await act(async () => { request.resolve('history'); await first; });
  expect(result.current.data).toBe('history');
  expect(result.current.reading).toBe(false);
});

test('target and range changes cancel reads and ignore the former response', async () => {
  const previous = deferred<string>();
  const next = deferred<string>();
  const firstLoad = vi.fn<(signal: AbortSignal) => Promise<string>>()
    .mockReturnValue(previous.promise);
  const nextLoad = vi.fn<(signal: AbortSignal) => Promise<string>>().mockReturnValue(next.promise);
  const { result, rerender } = renderHook(({ scope, load }) =>
    useDashboardHistory(scope, true, false, load),
  { initialProps: { scope: 'target-1:7d', load: firstLoad } });
  const oldSignal = firstLoad.mock.calls[0][0];
  rerender({ scope: 'target-2:30d', load: nextLoad });
  expect(oldSignal.aborted).toBe(true);
  expect(result.current.data).toBeNull();
  await act(async () => { previous.resolve('former target'); });
  expect(result.current.data).toBeNull();
  await act(async () => { next.resolve('current target'); });
  expect(result.current.data).toBe('current target');
});

test('management or inactive tabs cancel history reads without reporting errors', async () => {
  const request = deferred<string>();
  const load = vi.fn<(signal: AbortSignal) => Promise<string>>().mockReturnValue(request.promise);
  const { result, rerender } = renderHook(({ blocked }) =>
    useDashboardHistory('target-1', true, blocked, load),
  { initialProps: { blocked: false } });
  const signal = load.mock.calls[0][0];
  rerender({ blocked: true });
  expect(signal.aborted).toBe(true);
  expect(result.current.reading).toBe(false);
  await act(async () => { request.reject(new Error('canceled transport')); });
  expect(result.current.error).toBeNull();
  expect(result.current.data).toBeNull();
});

test('refresh errors preserve successful observations and mark them stale', async () => {
  const failure = new ApiError({ code: 'UNSUPPORTED', message: '暂不支持', requestId: 'history-1' });
  const load = vi.fn().mockResolvedValueOnce('retained').mockRejectedValueOnce(failure);
  const { result } = renderHook(() => useDashboardHistory('target-1', true, false, load));
  await act(async () => {});
  expect(result.current.data).toBe('retained');
  await act(async () => { await result.current.refresh(); });
  expect(result.current.data).toBe('retained');
  expect(result.current.stale).toBe(true);
  expect(result.current.error?.requestId).toBe('history-1');
});

test('hidden pages defer history reads and cancel requests when visibility changes', async () => {
  let visibility: DocumentVisibilityState = 'hidden';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const request = deferred<string>();
  const load = vi.fn<(signal: AbortSignal) => Promise<string>>().mockReturnValue(request.promise);
  const { result } = renderHook(() => useDashboardHistory('target-1', true, false, load));
  expect(load).not.toHaveBeenCalled();
  act(() => { visibility = 'visible'; fireEvent(document, new Event('visibilitychange')); });
  expect(load).toHaveBeenCalledTimes(1);
  const signal = load.mock.calls[0][0];
  act(() => { visibility = 'hidden'; fireEvent(document, new Event('visibilitychange')); });
  expect(signal.aborted).toBe(true);
  await act(async () => { request.resolve('hidden response'); });
  expect(result.current.data).toBeNull();
});
