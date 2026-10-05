import type { VPSSystemData } from '@/types/resources';

export type ProviderResources = Omit<VPSSystemData, 'observedAt'>;

function bytes(value: unknown, multiplier = 1): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  const result = parsed * multiplier;
  return Number.isSafeInteger(parsed) && parsed >= 0 && Number.isSafeInteger(result)
    ? result : null;
}

function flag(value: unknown): boolean | null {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return null;
}

function loadAverage(value: unknown): VPSSystemData['loadAverage'] {
  if (typeof value !== 'string') return null;
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 3 && fields.length !== 5) return null;
  if (fields.length === 5 && (!/^\d+\/\d+$/.test(fields[3]) || !/^\d+$/.test(fields[4]))) {
    return null;
  }
  const loads = fields.slice(0, 3);
  if (!loads.every((field) => /^\d+(?:\.\d+)?$/.test(field))) return null;
  const [one, five, fifteen] = loads.map(Number);
  return [one, five, fifteen].every(Number.isFinite) ? [one, five, fifteen] : null;
}

function supportsKvmMetrics(vmType: unknown): boolean {
  if (vmType === undefined || vmType === null) return true;
  return typeof vmType === 'string' && ['', 'kvm'].includes(vmType.trim().toLowerCase());
}

export function parseProviderResources(
  raw: Record<string, unknown>,
  live: boolean,
): ProviderResources {
  const kvmLive = live && supportsKvmMetrics(raw.vm_type);
  // Live *_kb fields use Linux /proc/meminfo kB: one kB represents 1024 bytes.
  return {
    planRamBytes: bytes(raw.plan_ram),
    planSwapBytes: bytes(raw.plan_swap),
    planDiskBytes: bytes(raw.plan_disk),
    availableRamBytes: kvmLive ? bytes(raw.mem_available_kb, 1024) : null,
    swapTotalBytes: kvmLive ? bytes(raw.swap_total_kb, 1024) : null,
    swapAvailableBytes: kvmLive ? bytes(raw.swap_available_kb, 1024) : null,
    mappedDiskBytes: kvmLive ? bytes(raw.ve_used_disk_space_b) : null,
    loadAverage: kvmLive ? loadAverage(raw.load_average) : null,
    cpuThrottled: live ? flag(raw.is_cpu_throttled) : null,
    diskThrottled: kvmLive ? flag(raw.is_disk_throttled) : null,
    live,
  };
}
