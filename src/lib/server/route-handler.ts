import type { ApiErrorBody } from '@/types';
import { RouteError } from './route-error';
import { readJsonBody } from './route-input';
import { assertRequestAccess, checkRateLimit, SecurityError } from './security';

interface RouteContext {
  requestId: string;
  signal: AbortSignal;
}

type Handler = (body: Record<string, unknown>, context: RouteContext) => Promise<unknown>;

const SECURITY_MESSAGES: Record<string, string> = {
  ACCESS_DENIED: '访问验证失败。',
  SECURITY_NOT_CONFIGURED: '服务尚未配置访问验证。',
  INVALID_ORIGIN: '请求来源不受信任。',
  UNSUPPORTED_MEDIA_TYPE: '请求必须使用 JSON 格式。',
  RATE_LIMITED: '请求过于频繁，请稍后重试。',
  RATE_LIMIT_UNAVAILABLE: '服务暂时无法处理请求。',
};

function publicError(error: unknown): RouteError {
  if (error instanceof RouteError) return error;
  if (error instanceof SecurityError) {
    return new RouteError(error.status, error.code,
      SECURITY_MESSAGES[error.code] ?? '请求未通过安全验证。', undefined, error.retryAfter);
  }
  return new RouteError(500, 'INTERNAL_ERROR', '服务器暂时无法处理请求。');
}

function errorResponse(
  error: RouteError,
  requestId: string,
  headers: Headers,
  action: boolean,
): Response {
  const outcome = error.outcome ?? (action ? 'rejected' : undefined);
  const body: ApiErrorBody = { error: {
    code: error.code, message: error.message, requestId,
    ...(outcome ? { outcome } : {}),
  } };
  if (error.retryAfter !== undefined) headers.set('Retry-After', String(error.retryAfter));
  return Response.json(body, { status: error.status, headers });
}

export async function runRoute(
  request: Request,
  action: boolean,
  handler: Handler,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  const headers = new Headers({ 'Cache-Control': 'private, no-store', 'X-Request-ID': requestId });
  let status = 200;
  let outcome = action ? 'accepted' : 'success';
  let code = 'OK';
  try {
    await assertRequestAccess(request);
    await checkRateLimit(request, action);
    const body = await readJsonBody(request);
    const data = await handler(body, { requestId, signal: request.signal });
    return Response.json(data, { headers });
  } catch (error) {
    const failure = publicError(error);
    status = failure.status;
    outcome = failure.outcome ?? 'rejected';
    code = failure.code;
    return errorResponse(failure, requestId, headers, action);
  } finally {
    console.info(JSON.stringify({
      requestId, operation: action ? 'action' : 'info', status, outcome, code,
      durationMs: Date.now() - started,
    }));
  }
}
