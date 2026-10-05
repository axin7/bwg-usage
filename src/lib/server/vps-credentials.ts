import type { VPSCredentials } from '@/types';
import { RouteError } from './route-error';
import { parseCredentials } from './route-input';

interface CredentialEnvironment {
  BWG_VEID?: string;
  BWG_API_KEY?: string;
}

function environment(): CredentialEnvironment {
  return { BWG_VEID: process.env.BWG_VEID, BWG_API_KEY: process.env.BWG_API_KEY };
}

function serverCredentials(env: CredentialEnvironment): VPSCredentials | null {
  const { BWG_VEID: veid, BWG_API_KEY: apiKey } = env;
  if ((veid === undefined || veid === '') && (apiKey === undefined || apiKey === '')) return null;
  try {
    return parseCredentials({ veid, apiKey });
  } catch {
    throw new RouteError(503, 'VPS_NOT_CONFIGURED', '服务端 VPS 凭据配置不完整或无效。');
  }
}

export function getServerVEID(env: CredentialEnvironment = environment()): string | null {
  return serverCredentials(env)?.veid ?? null;
}

export function resolveVPSCredentials(
  body: Record<string, unknown>,
  env: CredentialEnvironment = environment(),
): VPSCredentials {
  const configured = serverCredentials(env);
  if (!configured) return parseCredentials(body);
  if (body.veid !== undefined
    && (typeof body.veid !== 'string' || body.veid !== configured.veid)) {
    throw new RouteError(400, 'INVALID_INPUT', '请求目标与服务端配置不符。');
  }
  if (body.apiKey !== undefined && typeof body.apiKey !== 'string') {
    throw new RouteError(400, 'INVALID_INPUT', 'API Key 必须为字符串。');
  }
  return configured;
}
