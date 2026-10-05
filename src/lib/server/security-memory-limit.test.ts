import { describe, expect, it } from 'vitest';
import { createMemoryRateChecker, MEMORY_ORIGIN_LIMIT } from './security-memory-limit';
import type { RateChecker, RateScope } from './security-limit';

const LIMITS = { login: 10, query: 60, action: 5 };
const ENV = { APP_ORIGIN: 'https://panel.example.com' };

async function exhaust(check: RateChecker, scope: RateScope): Promise<void> {
  for (let index = 0; index < LIMITS[scope]; index += 1) {
    await check(scope, ENV);
  }
}

describe('process-local panel limits', () => {
  it.each(['login', 'query', 'action'] as const)(
    'allows the configured %s allowance and recovers after 60 seconds',
    async (scope) => {
      let timestamp = 0;
      const check = createMemoryRateChecker(LIMITS, () => timestamp);
      await exhaust(check, scope);
      await expect(check(scope, ENV)).rejects.toMatchObject({
        status: 429, code: 'RATE_LIMITED', retryAfter: 60,
      });
      timestamp = 59_500;
      await expect(check(scope, ENV)).rejects.toMatchObject({ retryAfter: 1 });
      timestamp = 60_000;
      await exhaust(check, scope);
      await expect(check(scope, ENV)).rejects.toMatchObject({ status: 429 });
    },
  );

  it('keeps scopes and deployment origins independent', async () => {
    const check = createMemoryRateChecker(LIMITS, () => 0);
    await exhaust(check, 'action');
    await expect(check('action', ENV)).rejects.toMatchObject({ status: 429 });
    await expect(check('query', ENV)).resolves.toBeUndefined();
    await expect(check('login', ENV)).resolves.toBeUndefined();
    await expect(check('action', { APP_ORIGIN: 'https://other.example.com' }))
      .resolves.toBeUndefined();
  });
});

describe('process-local origin memory bounds', () => {
  it('preserves active allowances and reclaims expired origins', async () => {
    let timestamp = 0;
    const check = createMemoryRateChecker(LIMITS, () => timestamp);
    await exhaust(check, 'action');
    for (let index = 1; index < MEMORY_ORIGIN_LIMIT; index += 1) {
      await check('query', { APP_ORIGIN: `https://panel-${index}.example.com` });
    }
    const otherEnv = { APP_ORIGIN: 'https://overflow.example.com' };
    await expect(check('query', otherEnv)).rejects.toMatchObject({
      status: 503, code: 'RATE_LIMIT_UNAVAILABLE',
    });
    await expect(check('action', ENV)).rejects.toMatchObject({ status: 429 });
    timestamp = 60_000;
    await expect(check('query', otherEnv)).resolves.toBeUndefined();
  });

  it('retains an origin until every scope window has expired', async () => {
    let timestamp = 0;
    const check = createMemoryRateChecker(LIMITS, () => timestamp);
    for (let index = 0; index < MEMORY_ORIGIN_LIMIT; index += 1) {
      await check('query', { APP_ORIGIN: `https://panel-${index}.example.com` });
    }
    timestamp = 30_000;
    const activeEnv = { APP_ORIGIN: 'https://panel-0.example.com' };
    for (let index = 0; index < LIMITS.action; index += 1) {
      await check('action', activeEnv);
    }
    timestamp = 60_000;
    await check('query', { APP_ORIGIN: 'https://new.example.com' });
    await expect(check('action', activeEnv)).rejects.toMatchObject({
      status: 429, retryAfter: 30,
    });
  });
});
