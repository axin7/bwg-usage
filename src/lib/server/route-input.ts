import type { VPSAction, VPSCredentials } from '@/types';
import { RouteError } from './route-error';

const MAX_BODY_BYTES = 16 * 1024;

function invalidInput(message = '请求参数无效。'): RouteError {
  return new RouteError(400, 'INVALID_INPUT', message);
}

async function readBody(request: Request): Promise<string> {
  if (!request.body) throw invalidInput('请求正文不能为空。');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RouteError(413, 'BODY_TOO_LARGE', '请求正文超过大小限制。');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new RouteError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求必须使用 JSON 格式。');
  }
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    throw new RouteError(413, 'BODY_TOO_LARGE', '请求正文超过大小限制。');
  }
  try {
    const body: unknown = JSON.parse(await readBody(request));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalidInput();
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RouteError) throw error;
    throw invalidInput('请求正文不是有效的 JSON。');
  }
}

export function parseCredentials(body: Record<string, unknown>): VPSCredentials {
  if (typeof body.veid !== 'string' || typeof body.apiKey !== 'string') {
    throw invalidInput('VEID 和 API Key 必须为字符串。');
  }
  const veid = body.veid.trim();
  const apiKey = body.apiKey.trim();
  if (!/^[1-9]\d{0,19}$/.test(veid) || !apiKey || apiKey.length > 512) {
    throw invalidInput('请输入有效的 VEID 和 API Key。');
  }
  if (/\s/.test(apiKey)) throw invalidInput('API Key 不能包含空白字符。');
  return { veid, apiKey };
}

export function parseAction(body: Record<string, unknown>): VPSAction {
  if (body.action === 'start' || body.action === 'stop' || body.action === 'restart') {
    return body.action;
  }
  throw invalidInput('不支持的操作。');
}

export function parseLive(body: Record<string, unknown>): boolean {
  if (body.live !== undefined && typeof body.live !== 'boolean') {
    throw invalidInput('live 必须为布尔值。');
  }
  return body.live === true;
}
