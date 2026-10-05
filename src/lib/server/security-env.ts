export interface SecurityEnvironment {
  NODE_ENV?: string;
  PANEL_PASSWORD?: string;
  SESSION_SECRET?: string;
  APP_ORIGIN?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

export type SecurityEnvironmentReader = () => Promise<SecurityEnvironment>;

export async function readSecurityEnvironment(): Promise<SecurityEnvironment> {
  return typeof process === 'undefined' ? {} : process.env;
}

export function isLocalDevelopment(request: Request, env: SecurityEnvironment): boolean {
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') return false;
  const hostname = new URL(request.url).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
