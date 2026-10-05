import { createHash } from 'node:crypto';
import { Redis } from '@upstash/redis';
import type { VPSAction } from '@/types';
import type { AuditEvent } from '@/types/audit';
import { getServerVEID } from './vps-credentials';

const RETENTION_SECONDS = 90 * 24 * 60 * 60;
const MAX_EVENTS = 200;
const UNAVAILABLE = '面板操作记录暂时无法保存或读取；' +
  'VPS 操作结果不受影响。';
const BROWSER_NOTICE = '浏览器凭据模式不保存跨会话面板记录，' +
  '仅显示本次会话的操作。';
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const MESSAGES = {
  accepted: '服务商已接受管理请求，实际状态尚待确认。',
  rejected: '服务商拒绝了管理请求。',
  unknown: '管理请求结果未知，未自动重发。',
};

const PRUNE_SCRIPT = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
for _, id in ipairs(expired) do redis.call('HDEL', KEYS[2], id) end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local overflow = redis.call('ZRANGE', KEYS[1], 0, -(tonumber(ARGV[2]) + 1))
for _, id in ipairs(overflow) do
  redis.call('ZREM', KEYS[1], id)
  redis.call('HDEL', KEYS[2], id)
end`;

const APPEND_SCRIPT = `
local next = cjson.decode(ARGV[6])
local previous = redis.call('HGET', KEYS[2], ARGV[4])
if previous then
  local old = cjson.decode(previous)
  if old.observedAt > next.observedAt then return 1 end
  if next.outcome == 'unknown' and
    (old.outcome == 'accepted' or old.outcome == 'rejected') then return 1 end
  next.occurredAt = old.occurredAt
end
redis.call('ZADD', KEYS[1], ARGV[5], ARGV[4])
redis.call('HSET', KEYS[2], ARGV[4], cjson.encode(next))
${PRUNE_SCRIPT}
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return 1`;

const READ_SCRIPT = `${PRUNE_SCRIPT}
local ids = redis.call('ZREVRANGE', KEYS[1], 0, tonumber(ARGV[2]) - 1)
local events = {}
for _, id in ipairs(ids) do
  local event = redis.call('HGET', KEYS[2], id)
  if event then table.insert(events, event) end
end
return events`;

interface EventEnvironment {
  APP_ORIGIN?: string;
  BWG_VEID?: string;
  BWG_API_KEY?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

interface EventRedis {
  eval(script: string, keys: string[], args: (number | string)[]): Promise<unknown>;
}

interface EventDependencies {
  readEnvironment?: () => EventEnvironment;
  createRedis?: (env: EventEnvironment) => EventRedis;
  now?: () => Date;
}

export interface PanelCommandEvent {
  veid: string;
  action: VPSAction;
  outcome: 'accepted' | 'rejected' | 'unknown';
  requestId: string;
  occurredAt?: string;
}

export interface PanelHistory {
  events: AuditEvent[];
  available: boolean;
  warning: string | null;
}

function redisClient(env: EventEnvironment): EventRedis {
  const url = new URL(env.UPSTASH_REDIS_REST_URL ?? '');
  if (url.protocol !== 'https:' || url.username || url.password || url.hash
    || !env.UPSTASH_REDIS_REST_TOKEN) throw new Error('Invalid history configuration');
  return new Redis({
    url: url.href, token: env.UPSTASH_REDIS_REST_TOKEN,
    retry: { retries: 0 }, signal: () => AbortSignal.timeout(800),
  });
}

function historyKey(env: EventEnvironment, veid: string): string | null {
  const configured = getServerVEID(env);
  if (!configured) return null;
  if (configured !== veid) throw new Error('Invalid history target');
  const origin = new URL(env.APP_ORIGIN ?? '');
  if (origin.protocol !== 'https:' || origin.origin !== env.APP_ORIGIN) {
    throw new Error('Invalid history origin');
  }
  const identity = createHash('sha256').update(JSON.stringify([origin.origin, veid]))
    .digest('hex');
  return `bwg-usage:panel-events:${identity}`;
}

async function withinDeadline<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('History deadline exceeded')), 1_000);
  });
  try { return await Promise.race([operation, timeout]); } finally { clearTimeout(timer); }
}

function panelEvent(input: PanelCommandEvent, observedAt: string): AuditEvent {
  if (!['start', 'stop', 'restart'].includes(input.action) || !UUID.test(input.requestId)
    || !Object.hasOwn(MESSAGES, input.outcome)) throw new Error('Invalid command event');
  const occurredAt = input.occurredAt ?? observedAt;
  const at = new Date(occurredAt);
  if (!Number.isFinite(at.getTime()) || at.toISOString() !== occurredAt
    || occurredAt > observedAt) throw new Error('Invalid command time');
  return {
    id: `panel:${input.requestId}`, observedAt, occurredAt, source: 'panel',
    action: input.action, outcome: input.outcome, message: MESSAGES[input.outcome],
    requestId: input.requestId,
  };
}

function storedEvent(value: unknown, veid: string, now: Date): AuditEvent | null {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.source !== 'panel' || typeof record.observedAt !== 'string'
      || typeof record.action !== 'string' || typeof record.outcome !== 'string'
      || typeof record.requestId !== 'string') return null;
    const at = new Date(record.observedAt);
    if (!Number.isFinite(at.getTime()) || at.toISOString() !== record.observedAt
      || at.getTime() <= now.getTime() - RETENTION_SECONDS * 1_000
      || at.getTime() > now.getTime() + 300_000) return null;
    return panelEvent({
      veid, action: record.action as VPSAction,
      outcome: record.outcome as PanelCommandEvent['outcome'], requestId: record.requestId,
      ...(typeof record.occurredAt === 'string' ? { occurredAt: record.occurredAt } : {}),
    }, record.observedAt);
  } catch {
    return null;
  }
}

async function recordCommand(input: PanelCommandEvent, deps: Required<EventDependencies>) {
  try {
    const env = deps.readEnvironment();
    const key = historyKey(env, input.veid);
    if (!key) return null;
    const at = deps.now();
    const result = await withinDeadline(deps.createRedis(env).eval(APPEND_SCRIPT,
      [key, `${key}:data`], [
        at.getTime() - RETENTION_SECONDS * 1_000, MAX_EVENTS, RETENTION_SECONDS,
        input.requestId, at.getTime(), JSON.stringify(panelEvent(input, at.toISOString())),
      ]));
    return result === 1 ? null : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

async function readHistory(
  veid: string,
  deps: Required<EventDependencies>,
): Promise<PanelHistory> {
  try {
    const env = deps.readEnvironment();
    const key = historyKey(env, veid);
    if (!key) return { events: [], available: false, warning: BROWSER_NOTICE };
    const at = deps.now();
    const rows = await withinDeadline(deps.createRedis(env).eval(READ_SCRIPT,
      [key, `${key}:data`], [at.getTime() - RETENTION_SECONDS * 1_000, MAX_EVENTS]));
    if (!Array.isArray(rows)) throw new Error('Invalid stored history');
    const events = rows.slice(0, MAX_EVENTS).map((row) => storedEvent(row, veid, at))
      .filter((event): event is AuditEvent => event !== null);
    return { events, available: true,
      warning: events.length === rows.length ? null
        : '部分面板操作记录无效，已忽略。' };
  } catch {
    return { events: [], available: false, warning: UNAVAILABLE };
  }
}

export function createActionEventStore(deps: EventDependencies = {}) {
  const resolved = {
    readEnvironment: deps.readEnvironment ?? (() => process.env),
    createRedis: deps.createRedis ?? redisClient,
    now: deps.now ?? (() => new Date()),
  };
  return {
    record: (input: PanelCommandEvent) => recordCommand(input, resolved),
    read: (veid: string) => readHistory(veid, resolved),
  };
}

const store = createActionEventStore();
export const recordActionEvent = store.record;
export const readActionEvents = store.read;
