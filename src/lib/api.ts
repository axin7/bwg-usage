import type {
  ActionReceipt, ApiErrorBody, VPSAction, VPSCredentials, VPSData,
} from '@/types';
import { record, validDate, validSystem } from './dto-validation';

type ErrorDetails = ApiErrorBody['error'];
type RequestOptions = { signal?: AbortSignal; live?: boolean };

export class ApiError extends Error {
  readonly code: string;
  readonly requestId: string;
  readonly outcome?: 'unknown' | 'rejected';

  constructor(details: ErrorDetails) {
    super(details.message);
    this.name = 'ApiError';
    this.code = details.code;
    this.requestId = details.requestId;
    this.outcome = details.outcome;
  }
}

export function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError({
    code: 'CLIENT_ERROR', message: '请求未完成，请稍后重试。', requestId: '',
  });
}

function nullableNumber(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function validData(value: unknown): value is VPSData {
  if (!record(value) || !record(value.basic) || !record(value.resources)) return false;
  if (!record(value.status) || !validDate(value.observedAt)) return false;
  const { basic, resources, status } = value;
  const strings = [basic.hostname, basic.node_location, basic.os];
  const metrics = [resources.totalBytes, resources.remainingBytes, resources.percentUsed];
  const dates = status.resetAt === null || validDate(status.resetAt);
  const flags = [status.suspended, status.policy_violation];
  return strings.every((item) => typeof item === 'string')
    && (value.system === undefined || validSystem(value.system))
    && Array.isArray(basic.ip_addresses)
    && basic.ip_addresses.every((item) => typeof item === 'string')
    && (basic.vm_type === undefined || typeof basic.vm_type === 'string')
    && metrics.every((item) => nullableNumber(item) && (item === null || Number(item) >= 0))
    && typeof resources.usedBytes === 'number' && Number.isFinite(resources.usedBytes)
    && resources.usedBytes >= 0 && dates
    && (status.daysRemaining === null || Number.isInteger(status.daysRemaining))
    && nullableNumber(status.dailyAverageBytes)
    && (status.dailyAverageBytes === null || Number(status.dailyAverageBytes) >= 0)
    && typeof status.averageIsEstimate === 'boolean'
    && flags.every((item) => item === null || typeof item === 'boolean')
    && typeof status.powerState === 'string'
    && ['running', 'stopped', 'starting', 'unknown'].includes(status.powerState);
}

export function invalidResponse(action: boolean): ApiError {
  return new ApiError({
    code: 'INVALID_RESPONSE', message: '服务器返回的数据无法识别。', requestId: '',
    ...(action ? { outcome: 'unknown' as const } : {}),
  });
}

function responseError(value: unknown, action: boolean): ApiError {
  if (!record(value) || !record(value.error)) return invalidResponse(action);
  const error = value.error;
  if (![error.code, error.message, error.requestId].every((item) => typeof item === 'string')) {
    return invalidResponse(action);
  }
  return new ApiError({
    code: String(error.code), message: String(error.message), requestId: String(error.requestId),
    ...(error.outcome === 'unknown' || error.outcome === 'rejected'
      ? { outcome: error.outcome } : {}),
  });
}

export async function request(
  route: string, body: object, options: RequestOptions, action = false,
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; abort(); },
    action || options.live ? 25_000 : 15_000);
  try {
    const response = await fetch(route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    let result: unknown;
    try { result = await response.json(); } catch { throw invalidResponse(action); }
    if (!response.ok) throw responseError(result, action);
    return result;
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
    if (!timedOut && error instanceof ApiError) throw error;
    throw new ApiError({
      code: timedOut ? 'CLIENT_TIMEOUT' : 'NETWORK_ERROR',
      message: timedOut ? '请求超时，请检查连接。' : '网络连接失败，请稍后重试。',
      requestId: '', ...(action ? { outcome: 'unknown' as const } : {}),
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

export async function fetchVPSData(
  credentials: VPSCredentials, options: RequestOptions = {},
): Promise<VPSData> {
  const result = await request('/api/vps/info', {
    ...credentialBody(credentials), ...(options.live ? { live: true } : {}),
  }, options);
  if (!validData(result)) throw invalidResponse(false);
  return result;
}

export async function performVPSAction(
  action: VPSAction, credentials: VPSCredentials,
): Promise<ActionReceipt> {
  const result = await request('/api/vps/action', {
    action, ...credentialBody(credentials),
  }, {}, true);
  if (!record(result) || result.action !== action || result.accepted !== true
    || typeof result.requestId !== 'string') throw invalidResponse(true);
  if (result.historyWarning !== undefined && typeof result.historyWarning !== 'string') {
    throw invalidResponse(true);
  }
  return { action, accepted: true, requestId: result.requestId,
    ...(result.historyWarning === undefined ? {} : { historyWarning: result.historyWarning }) };
}

export async function logoutSession(): Promise<void> {
  const result = await request('/api/auth/logout', {}, {});
  if (!record(result) || result.ok !== true) throw invalidResponse(false);
}

export function credentialBody(credentials: VPSCredentials): { veid: string; apiKey?: string } {
  return credentials.apiKey ? credentials : { veid: credentials.veid };
}
