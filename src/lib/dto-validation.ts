import type { VPSSystemData } from '@/types/resources';

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function validBytes(value: unknown): boolean {
  return value === null || (typeof value === 'number'
    && Number.isSafeInteger(value) && value >= 0);
}

export function validSystem(value: unknown): value is VPSSystemData {
  if (!record(value) || !validDate(value.observedAt) || typeof value.live !== 'boolean') {
    return false;
  }
  const bytes = [value.planRamBytes, value.planSwapBytes, value.planDiskBytes,
    value.availableRamBytes, value.swapTotalBytes, value.swapAvailableBytes,
    value.mappedDiskBytes];
  const flags = [value.cpuThrottled, value.diskThrottled];
  const load = value.loadAverage;
  return bytes.every(validBytes)
    && flags.every((flag) => flag === null || typeof flag === 'boolean')
    && (load === null || (Array.isArray(load) && load.length === 3
      && load.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0)));
}
