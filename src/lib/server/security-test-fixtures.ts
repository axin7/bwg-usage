import { SignJWT, type JWTPayload } from 'jose';
import type { SecurityEnvironment } from './security-env';
import { SESSION_COOKIE_NAME } from './security-session';

export const PUBLIC_ENV: SecurityEnvironment = {
  NODE_ENV: 'production',
  PANEL_PASSWORD: 'test-only-panel-password',
  SESSION_SECRET: 'test-session-secret-with-at-least-32-characters',
  APP_ORIGIN: 'https://panel.example.com',
  UPSTASH_REDIS_REST_URL: 'https://test-only-redis.example.com',
  UPSTASH_REDIS_REST_TOKEN: 'test-only-redis-token',
};

export async function signPanelToken(claims: JWTPayload = {}, algorithm = 'HS256') {
  const now = Math.floor(Date.now() / 1_000);
  const key = await crypto.subtle.importKey('raw',
    new TextEncoder().encode(PUBLIC_ENV.SESSION_SECRET),
    { name: 'HMAC', hash: `SHA-${algorithm.slice(2)}` }, false, ['sign']);
  return new SignJWT({
    iss: 'bwg-usage', aud: PUBLIC_ENV.APP_ORIGIN, sub: 'panel-owner',
    iat: now, exp: now + 300, ...claims,
  }).setProtectedHeader({ alg: algorithm }).sign(key);
}

export function panelRequest(token?: string, headers: HeadersInit = {}, method = 'GET') {
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set('cookie', `${SESSION_COOKIE_NAME}=${token}`);
  if (method === 'POST') {
    if (!requestHeaders.has('content-type')) {
      requestHeaders.set('content-type', 'application/json');
    }
    if (!requestHeaders.has('origin')) requestHeaders.set('origin', 'https://panel.example.com');
  }
  return new Request('https://panel.example.com/api/vps/info', {
    method, headers: requestHeaders,
  });
}

export function loginRequest(body: unknown, origin = 'https://panel.example.com') {
  return new Request('https://panel.example.com/api/auth/login', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
