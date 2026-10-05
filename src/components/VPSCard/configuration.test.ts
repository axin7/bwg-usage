import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError, fetchVPSData } from '@/lib/api';
import { loadSavedCredentials } from '@/lib/credentials';
import { useVPSController } from './useVPSController';
import { CREDENTIALS, connect, dataFixture, prepareControllerTest } from './testHelpers';

vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(),
  fetchVPSData: vi.fn(), performVPSAction: vi.fn(),
}));

beforeEach(() => {
  prepareControllerTest();
  vi.mocked(fetchVPSData).mockReset().mockResolvedValue(dataFixture());
});

test('legacy storage requires an explicit reuse and retention decision', async () => {
  localStorage.setItem('vps_credentials', JSON.stringify(CREDENTIALS));
  const { result } = renderHook(useVPSController);
  expect(result.current.session.credentials).toBeNull();
  expect(result.current.session.stored?.legacy).toBe(true);
  expect(fetchVPSData).not.toHaveBeenCalled();
  act(() => result.current.configuration.reuse());
  expect(result.current.session.reuse?.veid).toBe('123456');
  expect(fetchVPSData).not.toHaveBeenCalled();
  await connect(result);
  expect(localStorage.getItem('vps_credentials')).toBeNull();
  expect(localStorage.getItem('vps_credentials_v2')).toBeNull();
});

test('denied persistence still connects in memory and reports the storage failure', async () => {
  const { result } = renderHook(useVPSController);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Denied', 'SecurityError');
  });
  await act(async () => { await result.current.configuration.save(CREDENTIALS, true); });
  expect(result.current.session.credentials?.veid).toBe('123456');
  expect(result.current.session.notice).toContain('未能完整保存或清理');
  expect(result.current.session.saving).toBe(false);
});

test('a failed candidate never replaces working credentials or readings', async () => {
  const { result } = renderHook(useVPSController);
  await connect(result);
  act(() => result.current.configuration.edit());
  vi.mocked(fetchVPSData).mockRejectedValueOnce(new ApiError({
    code: 'INVALID_KEY', message: '密钥无效', requestId: 'validation-1',
  }));
  await act(async () => {
    await result.current.configuration.save({ veid: '9999', apiKey: 'candidate-key' }, false);
  });
  expect(result.current.session.credentials?.veid).toBe('123456');
  expect(result.current.reads.data?.basic.hostname).toBe('test-vps');
  expect(result.current.session.editing).toBe(true);
  expect(result.current.session.error?.requestId).toBe('validation-1');
});

test('corrupt storage yields a recoverable warning and no active credentials', () => {
  localStorage.setItem('vps_credentials', '{not-json');
  expect(loadSavedCredentials()).toMatchObject({ credentials: null, exists: true });
  const { result } = renderHook(useVPSController);
  expect(result.current.session.credentials).toBeNull();
  expect(result.current.session.notice).toContain('无法读取');
  expect(fetchVPSData).not.toHaveBeenCalled();
});

test('invalid candidate fails locally without contacting the server', async () => {
  const { result } = renderHook(useVPSController);
  await act(async () => {
    await result.current.configuration.save({ veid: '0123', apiKey: 'valid-key' }, false);
  });
  expect(fetchVPSData).not.toHaveBeenCalled();
  expect(result.current.session.error?.code).toBe('INVALID_CREDENTIALS');
});

test('disconnect clears runtime memory while preserving explicitly retained storage', async () => {
  const { result } = renderHook(useVPSController);
  await act(async () => { await result.current.configuration.save(CREDENTIALS, true); });
  expect(localStorage.getItem('vps_credentials_v2')).not.toBeNull();
  act(() => result.current.configuration.disconnect());
  expect(result.current.session.credentials).toBeNull();
  expect(result.current.reads.data).toBeNull();
  expect(localStorage.getItem('vps_credentials_v2')).not.toBeNull();
});

test('an empty v2 record keeps legacy secrets visible for explicit removal', () => {
  localStorage.setItem('vps_credentials_v2', '');
  localStorage.setItem('vps_credentials', JSON.stringify(CREDENTIALS));
  const { result } = renderHook(useVPSController);
  expect(result.current.session.stored?.exists).toBe(true);
  expect(result.current.session.stored?.credentials).toBeNull();
  expect(result.current.session.credentials).toBeNull();
  expect(fetchVPSData).not.toHaveBeenCalled();
  act(() => result.current.configuration.removeSaved());
  expect(localStorage.getItem('vps_credentials_v2')).toBeNull();
  expect(localStorage.getItem('vps_credentials')).toBeNull();
});
