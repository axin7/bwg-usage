import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { VPSData } from '@/types';
import type { VPSController } from './useVPSController';

export const CREDENTIALS = { veid: '123456', apiKey: 'test-only-key' };

export function dataFixture(overrides: Partial<VPSData> = {}): VPSData {
  return {
    basic: { hostname: 'test-vps', node_location: 'Los Angeles', os: 'Debian 12',
      ip_addresses: ['192.0.2.1', '2001:db8::1'] },
    resources: { totalBytes: 100 * 1024 ** 3, usedBytes: 20 * 1024 ** 3,
      remainingBytes: 80 * 1024 ** 3, percentUsed: 20 },
    status: { resetAt: '2026-10-06T00:00:00.000Z', daysRemaining: 1,
      dailyAverageBytes: 1024 ** 3, averageIsEstimate: true,
      suspended: false, policy_violation: false, powerState: 'unknown' },
    observedAt: '2026-10-05T00:00:00.000Z', ...overrides,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

export function prepareControllerTest() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T00:00:00.000Z'));
  localStorage.clear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
}

export async function connect(result: { current: VPSController }) {
  await act(async () => { await result.current.configuration.save(CREDENTIALS, false); });
}
