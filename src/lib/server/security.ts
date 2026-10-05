import {
  isLocalDevelopment,
  readSecurityEnvironment,
  type SecurityEnvironment,
  type SecurityEnvironmentReader,
} from './security-env';
import { checkDistributedLimit, type RateChecker } from './security-limit';
import { readSessionToken, verifySession } from './security-session';
import { readAccessConfig } from './security-config';
import { SecurityError } from './security-error';

export { SecurityError } from './security-error';

export interface AccessIdentity {
  isLocal: boolean;
}

type AccessGuard = (request: Request) => Promise<AccessIdentity>;

export interface SecurityDependencies {
  readEnvironment: SecurityEnvironmentReader;
  checkLimit?: RateChecker;
}

export function assertRequestBoundary(request: Request, env: SecurityEnvironment): void {
  const local = isLocalDevelopment(request, env);
  const url = new URL(request.url);
  const actualOrigin = url.origin;
  const expected = local ? actualOrigin : readAccessConfig(env).origin ?? actualOrigin;
  if (!local && url.protocol !== 'https:') throw invalidOrigin();
  if (!local && actualOrigin !== expected) throw invalidOrigin();
  if (request.method !== 'POST') return;
  const origin = request.headers.get('origin');
  if (origin !== expected && (!local || origin !== null)) throw invalidOrigin();
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw invalidOrigin();
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new SecurityError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求必须使用 JSON 格式。');
  }
}

function invalidOrigin(): SecurityError {
  return new SecurityError(403, 'INVALID_ORIGIN', '不允许跨站请求。');
}

function createAccessGuard(deps: SecurityDependencies): AccessGuard {
  const identities = new WeakMap<Request, AccessIdentity>();
  return async (request: Request): Promise<AccessIdentity> => {
    const env = await deps.readEnvironment();
    assertRequestBoundary(request, env);
    const cached = identities.get(request);
    if (cached) return cached;
    if (isLocalDevelopment(request, env)) return { isLocal: true };
    const config = readAccessConfig(env).panel;
    if (!config) return { isLocal: false };
    const token = readSessionToken(request);
    if (!token) throw accessDenied();
    try {
      await verifySession(token, config);
      const identity = { isLocal: false };
      identities.set(request, identity);
      return identity;
    } catch {
      throw accessDenied();
    }
  };
}

function accessDenied(): SecurityError {
  return new SecurityError(401, 'ACCESS_DENIED', '请先登录控制面板。');
}

function createRateLimitGuard(deps: SecurityDependencies, assertAccess: AccessGuard) {
  return async (request: Request, isAction: boolean): Promise<void> => {
    if ((await assertAccess(request)).isLocal) return;
    const env = await deps.readEnvironment();
    await (deps.checkLimit ?? checkDistributedLimit)(isAction ? 'action' : 'query', env);
  };
}

export function createRequestSecurity(deps: SecurityDependencies) {
  const assertRequestAccess = createAccessGuard(deps);
  return {
    assertRequestAccess,
    checkRateLimit: createRateLimitGuard(deps, assertRequestAccess),
  };
}

const security = createRequestSecurity({ readEnvironment: readSecurityEnvironment });
export const assertRequestAccess = security.assertRequestAccess;
export const checkRateLimit = security.checkRateLimit;
