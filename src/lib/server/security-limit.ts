import { createHash } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import type { SecurityEnvironment } from './security-env';
import { SecurityError } from './security-error';
import { createMemoryRateChecker } from './security-memory-limit';

export type RateScope = 'login' | 'query' | 'action';
export type RateChecker = (scope: RateScope, env: SecurityEnvironment) => Promise<void>;

const LIMITS: Record<RateScope, number> = { login: 10, query: 60, action: 5 };
const limiters = new Map<string, Ratelimit>();
const checkMemoryLimit = createMemoryRateChecker(LIMITS);

function unavailable(): SecurityError {
  return new SecurityError(503, 'RATE_LIMIT_UNAVAILABLE', '请求保护暂时不可用。');
}

function redisConfig(env: SecurityEnvironment): { url: string; token: string } {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw unavailable();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw unavailable();
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw unavailable();
  }
  return { url, token };
}

function getLimiter(scope: RateScope, env: SecurityEnvironment): Ratelimit {
  const config = redisConfig(env);
  const cacheKey = `${config.url}:${config.token}:${env.APP_ORIGIN}:${scope}`;
  const key = createHash('sha256').update(cacheKey).digest('hex');
  const existing = limiters.get(key);
  if (existing) return existing;
  const redis = new Redis({
    ...config, retry: { retries: 0 }, signal: () => AbortSignal.timeout(2_000),
  });
  const originKey = createHash('sha256').update(env.APP_ORIGIN ?? '').digest('hex').slice(0, 12);
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(LIMITS[scope], '60 s'),
    prefix: `bwg-usage:${originKey}:${scope}`,
    analytics: false,
    timeout: 1_500,
  });
  limiters.set(key, limiter);
  return limiter;
}

export const checkDistributedLimit: RateChecker = async (scope, env) => {
  if (!env.UPSTASH_REDIS_REST_URL && !env.UPSTASH_REDIS_REST_TOKEN) {
    return checkMemoryLimit(scope, env);
  }
  let result: Awaited<ReturnType<Ratelimit['limit']>>;
  try {
    result = await getLimiter(scope, env).limit('panel');
  } catch {
    throw unavailable();
  }
  if (!result || typeof result.success !== 'boolean' || result.reason === 'timeout') {
    throw unavailable();
  }
  if (!result.success) {
    const duration = Number.isFinite(result.reset) ? (result.reset - Date.now()) / 1_000 : 60;
    const seconds = Math.min(60, Math.max(1, Math.ceil(duration)));
    throw new SecurityError(
      429, 'RATE_LIMITED', '请求过于频繁，请稍后重试。', seconds,
    );
  }
};
