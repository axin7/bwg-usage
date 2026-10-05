import { invalidUpstream, RouteError } from './route-error';

function providerErrorCode(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') throw invalidUpstream();
  if (typeof value === 'string' && !value.trim()) throw invalidUpstream();
  const code = Number(value);
  if (!Number.isFinite(code) || !Number.isInteger(code)) throw invalidUpstream();
  return code;
}

export function retryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  const seconds = Number.isFinite(numeric) ? numeric : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.min(60, Math.max(0, Math.ceil(seconds))) : undefined;
}

export function upstreamHttpError(response: Response, action: boolean): RouteError {
  if (response.status === 429) {
    return new RouteError(429, 'UPSTREAM_RATE_LIMITED', '服务商请求过于频繁，请稍后重试。',
      action ? 'rejected' : undefined, retryAfterSeconds(response.headers.get('retry-after')));
  }
  const rejected = response.status >= 400 && response.status < 500;
  return new RouteError(rejected ? 422 : 502,
    rejected ? 'UPSTREAM_REJECTED' : 'UPSTREAM_UNAVAILABLE',
    rejected ? '服务商拒绝该请求，请检查凭据。' : '服务商暂时不可用，请稍后重试。',
    action ? (rejected ? 'rejected' : 'unknown') : undefined);
}

export async function parseProviderReply(
  response: Response,
  action: boolean,
): Promise<Record<string, unknown>> {
  if (!response.ok) throw upstreamHttpError(response, action);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    const error = invalidUpstream();
    throw new RouteError(error.status, error.code, error.message, action ? 'unknown' : undefined);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new RouteError(502, 'INVALID_UPSTREAM_RESPONSE', '服务商返回的数据无效。',
      action ? 'unknown' : undefined);
  }
  const raw = data as Record<string, unknown>;
  let code: number;
  try {
    code = providerErrorCode(raw.error);
  } catch {
    throw new RouteError(502, 'INVALID_UPSTREAM_RESPONSE', '服务商返回的数据无效。',
      action ? 'unknown' : undefined);
  }
  if (code !== 0) {
    throw new RouteError(422, 'UPSTREAM_REJECTED', '服务商拒绝该请求，请检查凭据或稍后重试。',
      action ? 'rejected' : undefined);
  }
  return raw;
}
