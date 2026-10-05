import { beforeEach, expect, test, vi } from 'vitest';
import { config, proxy } from '@/proxy';
import { PUBLIC_ENV } from '@/lib/server/security-test-fixtures';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  for (const name of [
    'PANEL_PASSWORD', 'SESSION_SECRET', 'APP_ORIGIN', 'BWG_VEID', 'BWG_API_KEY',
    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
  ]) vi.stubEnv(name, undefined);
});

test('browser-mode login redirects through the proxy with security and no-store headers',
  async () => {
  expect(config.matcher).toContain('/login');
  const response = await proxy(new Request('https://panel.example.com/login'));
  expect(response?.status).toBe(303);
  expect(response?.headers.get('location')).toBe('/');
  expect(response?.headers.get('cache-control')).toContain('no-store');
  expect(response?.headers.get('x-frame-options')).toBe('DENY');
  expect(response?.headers.has('content-security-policy')).toBe(true);
});

test('configured password login remains accessible without a session', async () => {
  for (const [name, value] of Object.entries(PUBLIC_ENV)) vi.stubEnv(name, value);
  expect(await proxy(new Request('https://panel.example.com/login'))).toBeUndefined();
});

test('invalid login configuration returns a protected refusal before rendering', async () => {
  vi.stubEnv('BWG_API_KEY', 'must-not-be-exposed');
  const response = await proxy(new Request('https://panel.example.com/login'));
  expect(response?.status).toBe(503);
  expect(response?.headers.get('cache-control')).toContain('no-store');
  expect(await response?.text()).not.toContain('must-not-be-exposed');
});
