export class RouteError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly outcome?: 'unknown' | 'rejected',
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'RouteError';
  }
}

export function invalidUpstream(): RouteError {
  return new RouteError(502, 'INVALID_UPSTREAM_RESPONSE', '服务商返回的数据无效。');
}
