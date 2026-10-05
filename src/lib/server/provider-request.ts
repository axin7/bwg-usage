import type { VPSAction, VPSCredentials } from '@/types';
import { RouteError } from './route-error';
import { parseProviderReply, retryAfterSeconds } from './provider-reply';

const API_BASE = 'https://api.64clouds.com/v1';
export type ProviderEndpoint = VPSAction | 'getServiceInfo' | 'getLiveServiceInfo'
  | 'getRawUsageStats' | 'getAuditLog';

export interface ProviderOptions {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  random?: () => number;
}

interface Context {
  endpoint: ProviderEndpoint;
  credentials: VPSCredentials;
  action: boolean;
  fetcher: typeof fetch;
  signal: AbortSignal;
  endAt: number;
  random: () => number;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new Error('Request aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

function retryDelay(response: Response | null, context: Context): number | null {
  const retryAfter = retryAfterSeconds(response?.headers.get('retry-after') ?? null);
  const delay = retryAfter === undefined ? 150 + context.random() * 150 : retryAfter * 1000;
  return delay <= 2000 && delay + 100 < context.endAt - Date.now() ? delay : null;
}

function fetchOnce(context: Context): Promise<Response> {
  const body = new URLSearchParams({
    veid: context.credentials.veid,
    api_key: context.credentials.apiKey,
  });
  return context.fetcher(`${API_BASE}/${context.endpoint}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: context.signal,
    cache: 'no-store',
    redirect: 'error',
  });
}

async function attempts(context: Context): Promise<Record<string, unknown>> {
  const canRetry = !context.action && context.endpoint === 'getServiceInfo';
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetchOnce(context);
    } catch (error) {
      if (context.signal.aborted) throw error;
      const delay = retryDelay(null, context);
      if (!canRetry || attempt === 1 || delay === null) throw error;
      await wait(delay, context.signal);
      continue;
    }
    const retryable = response.status === 429 || response.status >= 500;
    const delay = retryable ? retryDelay(response, context) : null;
    if (canRetry && attempt === 0 && delay !== null) {
      await response.body?.cancel();
      await wait(delay, context.signal);
      continue;
    }
    return parseProviderReply(response, context.action);
  }
  throw new Error('Provider retries exhausted');
}

function transportError(error: unknown, action: boolean, timedOut: boolean): RouteError {
  if (timedOut) {
    return new RouteError(504, 'UPSTREAM_TIMEOUT', '服务商响应超时。',
      action ? 'unknown' : undefined);
  }
  if (error instanceof RouteError) return error;
  return new RouteError(502, 'UPSTREAM_UNAVAILABLE', '无法连接服务商，请稍后重试。',
    action ? 'unknown' : undefined);
}

export async function requestProvider(
  endpoint: ProviderEndpoint,
  credentials: VPSCredentials,
  action: boolean,
  options: ProviderOptions = {},
): Promise<Record<string, unknown>> {
  const defaultTimeout = action || endpoint === 'getLiveServiceInfo' ? 20000 : 10000;
  const timeoutMs = options.timeoutMs ?? defaultTimeout;
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const context: Context = {
    endpoint, credentials, action, signal: controller.signal,
    fetcher: options.fetcher ?? fetch, endAt: Date.now() + timeoutMs,
    random: options.random ?? Math.random,
  };
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new Error('Request aborted'));
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    if (controller.signal.aborted) rejectAbort();
  });
  try {
    const operation = controller.signal.aborted ? aborted : attempts(context);
    return await Promise.race([operation, aborted]);
  } catch (error) {
    throw transportError(error, action, timedOut);
  } finally {
    clearTimeout(timeout);
    controller.abort();
    options.signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}
