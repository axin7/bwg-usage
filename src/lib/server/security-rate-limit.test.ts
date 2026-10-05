import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequestSecurity } from './security';
import { checkDistributedLimit } from './security-limit';
import { panelRequest, PUBLIC_ENV, signPanelToken } from './security-test-fixtures';

const { sdkLimit } = vi.hoisted(() => ({ sdkLimit: vi.fn() }));
vi.mock('@upstash/redis', () => ({ Redis: class {} }));
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() { return undefined; }
    limit = sdkLimit;
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
  sdkLimit.mockResolvedValue({ success: true, reset: Date.now() + 60_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('distributed personal panel limits', () => {
  it('uses independent query and action scopes after validating the session', async () => {
    const checkLimit = vi.fn().mockResolvedValue(undefined);
    const security = createRequestSecurity({
      readEnvironment: async () => PUBLIC_ENV, checkLimit,
    });
    const request = panelRequest(await signPanelToken());
    await security.checkRateLimit(request, false);
    await security.checkRateLimit(request, true);
    expect(checkLimit.mock.calls.map(([scope]) => scope)).toEqual(['query', 'action']);
  });

  it('never calls the distributed limiter for an unauthenticated request', async () => {
    const checkLimit = vi.fn();
    const security = createRequestSecurity({
      readEnvironment: async () => PUBLIC_ENV, checkLimit,
    });
    await expect(security.checkRateLimit(panelRequest(), false))
      .rejects.toMatchObject({ status: 401 });
    expect(checkLimit).not.toHaveBeenCalled();
  });

  it('uses no distributed store for genuine local development', async () => {
    const security = createRequestSecurity({
      readEnvironment: async () => ({ NODE_ENV: 'test' }),
    });
    await expect(security.checkRateLimit(new Request('http://localhost/'), false))
      .resolves.toBeUndefined();
    expect(sdkLimit).not.toHaveBeenCalled();
  });
});

describe('optional Redis configuration', () => {
  const memoryEnv = {
    ...PUBLIC_ENV,
    UPSTASH_REDIS_REST_URL: undefined,
    UPSTASH_REDIS_REST_TOKEN: undefined,
  };

  it('uses process-local limits without making SDK calls when both variables are absent',
    async () => {
      await expect(checkDistributedLimit('query', memoryEnv)).resolves.toBeUndefined();
      expect(sdkLimit).not.toHaveBeenCalled();
    });

  it('applies and resets the local login allowance with no configured store', async () => {
    const env = { ...memoryEnv, APP_ORIGIN: 'https://local-limit-test.example.com' };
    for (let index = 0; index < 10; index += 1) {
      await checkDistributedLimit('login', env);
    }
    await expect(checkDistributedLimit('login', env)).rejects.toMatchObject({
      status: 429, code: 'RATE_LIMITED', retryAfter: 60,
    });
    await expect(checkDistributedLimit('action', env)).resolves.toBeUndefined();
    vi.advanceTimersByTime(60_000);
    await expect(checkDistributedLimit('login', env)).resolves.toBeUndefined();
    expect(sdkLimit).not.toHaveBeenCalled();
  });
});

describe('Upstash limiter failure handling', () => {
  it('checks the shared personal-panel identifier through the SDK', async () => {
    await expect(checkDistributedLimit('query', PUBLIC_ENV)).resolves.toBeUndefined();
    expect(sdkLimit).toHaveBeenCalledWith('panel');
  });

  it.each([
    { UPSTASH_REDIS_REST_URL: '' },
    { UPSTASH_REDIS_REST_TOKEN: '' },
    { UPSTASH_REDIS_REST_URL: 'invalid-url' },
    { UPSTASH_REDIS_REST_URL: 'http://test-only-redis.example.com' },
    { UPSTASH_REDIS_REST_URL: 'https://user:password@test-only-redis.example.com' },
    { UPSTASH_REDIS_REST_URL: 'https://test-only-redis.example.com/#fragment' },
  ])('fails closed for missing or invalid store configuration %j', async (override) => {
    await expect(checkDistributedLimit('login', { ...PUBLIC_ENV, ...override }))
      .rejects.toMatchObject({ status: 503, code: 'RATE_LIMIT_UNAVAILABLE' });
    expect(sdkLimit).not.toHaveBeenCalled();
  });

  it('rejects the SDK timeout response even when its default success flag is true', async () => {
    sdkLimit.mockResolvedValue({ success: true, reason: 'timeout', reset: Date.now() + 60_000 });
    await expect(checkDistributedLimit('query', PUBLIC_ENV))
      .rejects.toMatchObject({ status: 503, code: 'RATE_LIMIT_UNAVAILABLE' });
  });
});

describe('Upstash limiter rejections', () => {
  it('fails closed on an SDK exception without leaking the store details', async () => {
    sdkLimit.mockRejectedValue(new Error('sensitive-store-token'));
    await expect(checkDistributedLimit('action', PUBLIC_ENV)).rejects.toMatchObject({
      status: 503, code: 'RATE_LIMIT_UNAVAILABLE', message: '请求保护暂时不可用。',
    });
  });

  it('returns a bounded Retry-After for an exhausted allowance', async () => {
    sdkLimit.mockResolvedValue({ success: false, reset: Date.now() + 59_000 });
    await expect(checkDistributedLimit('action', PUBLIC_ENV)).rejects.toMatchObject({
      status: 429, code: 'RATE_LIMITED', retryAfter: 59,
    });
  });

  it('fails closed for a malformed SDK response', async () => {
    sdkLimit.mockResolvedValue(undefined);
    await expect(checkDistributedLimit('action', PUBLIC_ENV))
      .rejects.toMatchObject({ status: 503 });
  });
});
