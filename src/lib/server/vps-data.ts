import type { VPSData } from '@/types';
import type { ProviderService } from './provider-data';

const DAY_MS = 86_400_000;

export function previousMonthClamped(date: Date): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - 1);
  const lastDay = new Date(result);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  result.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  return result;
}

function cycleMetrics(service: ProviderService, now: Date): VPSData['status'] {
  const reset = service.resetSeconds === null ? null : new Date(service.resetSeconds * 1000);
  const remaining = reset ? reset.getTime() - now.getTime() : null;
  const elapsed = reset ? (now.getTime() - previousMonthClamped(reset).getTime()) / DAY_MS : 0;
  const dailyAverageBytes = remaining !== null && remaining > 0 && elapsed > 0
    ? service.usedBytes / elapsed : null;
  return {
    resetAt: reset?.toISOString() ?? null,
    daysRemaining: remaining === null ? null : Math.max(0, Math.ceil(remaining / DAY_MS)),
    dailyAverageBytes,
    averageIsEstimate: dailyAverageBytes !== null,
    suspended: service.suspended,
    policy_violation: service.policyViolation,
    powerState: service.powerState,
  };
}

export function transformVPSData(service: ProviderService, now: Date): VPSData {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid observation time');
  const { usedBytes, totalBytes } = service;
  return {
    basic: {
      hostname: service.hostname,
      node_location: service.location,
      os: service.os,
      ip_addresses: service.addresses,
      ...(service.vmType ? { vm_type: service.vmType } : {}),
    },
    resources: {
      totalBytes,
      usedBytes,
      remainingBytes: totalBytes === null ? null : Math.max(0, totalBytes - usedBytes),
      percentUsed: totalBytes !== null && totalBytes > 0 ? (usedBytes / totalBytes) * 100 : null,
    },
    status: cycleMetrics(service, now),
    ...(service.system ? { system: { ...service.system, observedAt: now.toISOString() } } : {}),
    observedAt: now.toISOString(),
  };
}
