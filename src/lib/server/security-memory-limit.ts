import { SecurityError } from './security-error';
import type { RateChecker, RateScope } from './security-limit';

export const MEMORY_ORIGIN_LIMIT = 64;
const WINDOW_MS = 60_000;

interface Window {
  count: number;
  reset: number;
}

type ScopeWindows = Partial<Record<RateScope, Window>>;

function pruneExpired(origins: Map<string, ScopeWindows>, now: number): void {
  for (const [origin, windows] of origins) {
    if (Object.values(windows).every((window) => window.reset <= now)) {
      origins.delete(origin);
    }
  }
}

export function createMemoryRateChecker(
  limits: Record<RateScope, number>,
  now: () => number = () => Date.now(),
): RateChecker {
  const origins = new Map<string, ScopeWindows>();
  return async (scope, env) => {
    const timestamp = now();
    const origin = env.APP_ORIGIN ?? '';
    let windows = origins.get(origin);
    if (!windows) {
      pruneExpired(origins, timestamp);
      if (origins.size >= MEMORY_ORIGIN_LIMIT) {
        throw new SecurityError(503, 'RATE_LIMIT_UNAVAILABLE', '请求保护暂时不可用。');
      }
      windows = {};
      origins.set(origin, windows);
    }
    let window = windows[scope];
    if (!window || window.reset <= timestamp) {
      window = { count: 0, reset: timestamp + WINDOW_MS };
      windows[scope] = window;
    }
    if (window.count >= limits[scope]) {
      const seconds = Math.min(60, Math.max(1, Math.ceil((window.reset - timestamp) / 1_000)));
      throw new SecurityError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试。', seconds);
    }
    window.count += 1;
  };
}
