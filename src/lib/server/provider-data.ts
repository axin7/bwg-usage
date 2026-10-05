import type { VPSPowerState } from '@/types';
import { parseProviderResources, type ProviderResources } from './provider-resources';
import { invalidUpstream } from './route-error';

export interface ProviderService {
  hostname: string;
  location: string;
  os: string;
  addresses: string[];
  vmType?: string;
  usedBytes: number;
  totalBytes: number | null;
  resetSeconds: number | null;
  suspended: boolean | null;
  policyViolation: boolean | null;
  powerState: VPSPowerState;
  system?: ProviderResources;
}

export function providerNumber(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') throw invalidUpstream();
  if (typeof value === 'string' && !value.trim()) throw invalidUpstream();
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw invalidUpstream();
  return number;
}

function optionalNumber(value: unknown): number | null {
  return value === undefined || value === null ? null : providerNumber(value);
}

function text(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw invalidUpstream();
  return value;
}

function addresses(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw invalidUpstream();
  }
  return value;
}

function flag(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  throw invalidUpstream();
}

function powerState(value: unknown): VPSPowerState {
  if (value === undefined || value === null) return 'unknown';
  const state = text(value).toLowerCase();
  return state === 'running' || state === 'stopped' || state === 'starting' ? state : 'unknown';
}

function traffic(raw: Record<string, unknown>): Pick<ProviderService, 'usedBytes' | 'totalBytes'> {
  const multiplier = raw.monthly_data_multiplier === undefined
    ? 1 : providerNumber(raw.monthly_data_multiplier);
  if (multiplier <= 0) throw invalidUpstream();
  const counter = providerNumber(raw.data_counter);
  const allowance = optionalNumber(raw.plan_monthly_data);
  if (!Number.isSafeInteger(counter) || (allowance !== null && !Number.isSafeInteger(allowance))) {
    throw invalidUpstream();
  }
  const usedBytes = counter * multiplier;
  const totalBytes = allowance === null ? null : allowance * multiplier;
  if (usedBytes > Number.MAX_SAFE_INTEGER
    || (totalBytes !== null && totalBytes > Number.MAX_SAFE_INTEGER)) {
    throw invalidUpstream();
  }
  return { usedBytes, totalBytes };
}

export function parseProviderService(
  raw: Record<string, unknown>,
  live = false,
): ProviderService {
  const resetSeconds = optionalNumber(raw.data_next_reset);
  if (resetSeconds !== null && !Number.isFinite(new Date(resetSeconds * 1000).getTime())) {
    throw invalidUpstream();
  }
  const vmType = raw.vm_type === undefined ? undefined : text(raw.vm_type);
  return {
    hostname: text(raw.hostname) || text(raw.node_alias) || '未知主机',
    location: text(raw.node_location, '未知位置'),
    os: text(raw.os, '未知系统'),
    addresses: addresses(raw.ip_addresses),
    vmType,
    ...traffic(raw),
    resetSeconds,
    suspended: flag(raw.suspended),
    policyViolation: flag(raw.policy_violation),
    powerState: powerState(raw.ve_status),
    system: parseProviderResources(raw, live),
  };
}
