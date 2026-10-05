import { createHash, timingSafeEqual } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { SecurityEnvironment } from './security-env';
import { SecurityError } from './security-error';

export const SESSION_COOKIE_NAME = '__Host-panel-session';
export const SESSION_SECONDS = 8 * 60 * 60;

export interface PanelConfig {
  password: string;
  secret: string;
  origin: string;
}

export function readPanelConfig(env: SecurityEnvironment): PanelConfig {
  const password = env.PANEL_PASSWORD;
  const secret = env.SESSION_SECRET;
  if (!password || password.length < 16 || password.length > 1024 ||
    !secret || secret.length < 32) throw unconfigured();
  const origin = env.APP_ORIGIN;
  if (!origin) throw unconfigured();
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw unconfigured();
  }
  if (url.protocol !== 'https:' || url.origin !== origin) throw unconfigured();
  return { password, secret, origin };
}

function unconfigured(): SecurityError {
  return new SecurityError(503, 'SECURITY_NOT_CONFIGURED', '服务尚未配置访问保护。');
}

export function matchesPassword(provided: string, expected: string): boolean {
  const suppliedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(suppliedHash, expectedHash);
}

async function sessionKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {
    name: 'HMAC', hash: 'SHA-256',
  }, false, ['sign', 'verify']);
}

export async function createSession(config: PanelConfig): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('bwg-usage')
    .setAudience(config.origin)
    .setSubject('panel-owner')
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(await sessionKey(config.secret));
}

export async function verifySession(token: string, config: PanelConfig): Promise<void> {
  const { payload } = await jwtVerify(token, await sessionKey(config.secret), {
    algorithms: ['HS256'],
    issuer: 'bwg-usage',
    audience: config.origin,
    requiredClaims: ['exp', 'iat', 'sub'],
    maxTokenAge: SESSION_SECONDS,
  });
  if (payload.sub !== 'panel-owner' || !payload.exp || payload.iat === undefined) {
    throw new Error('Invalid session claims.');
  }
  if (payload.exp - payload.iat > SESSION_SECONDS) throw new Error('Invalid session lifetime.');
}

export function readSessionToken(request: Request): string | null {
  const cookies = request.headers.get('cookie')?.split(';') ?? [];
  const matches = cookies.map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(SESSION_COOKIE_NAME.length + 1);
  return token && token.length <= 16_384 ? token : null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; ` +
    `Max-Age=${SESSION_SECONDS}`;
}

export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; ` +
    'Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
}
