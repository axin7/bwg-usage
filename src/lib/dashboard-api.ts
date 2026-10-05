import type { VPSCredentials } from '@/types';
import type { AuditData } from '@/types/audit';
import type { TrafficHistoryData, TrafficRange } from '@/types/dashboard';
import { credentialBody, invalidResponse, request } from './api';
import { validAudit, validTraffic } from './dashboard-validation';

export async function fetchTrafficHistory(
  credentials: VPSCredentials, range: TrafficRange, options: { signal?: AbortSignal } = {},
): Promise<TrafficHistoryData> {
  const body = { ...credentialBody(credentials), range };
  const result = await request('/api/vps/history', body, options);
  if (!validTraffic(result) || result.range !== range) throw invalidResponse(false);
  return result;
}

export async function fetchAuditHistory(
  credentials: VPSCredentials, options: { signal?: AbortSignal } = {},
): Promise<AuditData> {
  const result = await request('/api/vps/events', credentialBody(credentials), options);
  if (!validAudit(result)) throw invalidResponse(false);
  return result;
}
