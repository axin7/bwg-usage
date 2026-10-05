import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActionEventStore, type PanelCommandEvent } from './action-events';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const RETENTION = 90 * 24 * 60 * 60;
const environment = {
  APP_ORIGIN: 'https://panel.example.com', BWG_VEID: '123', BWG_API_KEY: 'secret-provider-key',
  UPSTASH_REDIS_REST_URL: 'https://offline-redis.invalid',
  UPSTASH_REDIS_REST_TOKEN: 'secret-redis-token',
};
const command: PanelCommandEvent = {
  veid: '123', action: 'restart', outcome: 'accepted',
  requestId: '00000000-0000-4000-8000-000000000001',
};

function fixture(env = environment) {
  const evaluate = vi.fn().mockResolvedValue(1);
  const createRedis = vi.fn(() => ({ eval: evaluate }));
  const store = createActionEventStore({
    readEnvironment: () => env, createRedis, now: () => NOW,
  });
  return { store, evaluate, createRedis };
}

function stored(overrides: Record<string, unknown> = {}) {
  return {
    source: 'panel', action: 'restart', outcome: 'accepted',
    requestId: command.requestId, observedAt: NOW.toISOString(), ...overrides,
  };
}

afterEach(() => { vi.useRealTimers(); });

describe('bounded panel command persistence', () => {
  it('writes a sanitized event and atomically bounds age, count, and key expiry', async () => {
    const { store, evaluate } = fixture();
    expect(await store.record(command)).toBeNull();
    const [script, keys, args] = evaluate.mock.calls[0];
    expect(script).toContain('ZREMRANGEBYSCORE');
    expect(script).toContain('ZREM');
    expect(script).toContain('HDEL');
    expect(script).toContain('EXPIRE');
    expect(keys[0]).toMatch(/^bwg-usage:panel-events:[a-f\d]{64}$/);
    expect(keys[1]).toBe(`${keys[0]}:data`);
    expect(args.slice(0, 3)).toEqual([NOW.getTime() - RETENTION * 1_000, 200, RETENTION]);
    expect(args[3]).toBe(command.requestId);
    const event = JSON.parse(args[5]);
    expect(event).toMatchObject({
      source: 'panel', action: 'restart', outcome: 'accepted', requestId: command.requestId,
      id: `panel:${command.requestId}`, occurredAt: NOW.toISOString(),
    });
    const serialized = JSON.stringify(evaluate.mock.calls);
    expect(serialized).not.toContain(environment.BWG_API_KEY);
    expect(serialized).not.toContain(environment.UPSTASH_REDIS_REST_TOKEN);
  });

  it('isolates history by fixed origin and VEID while allowing API key rotation', async () => {
    const original = fixture();
    const changedOrigin = fixture({ ...environment, APP_ORIGIN: 'https://other.example.com' });
    const changedTarget = fixture({ ...environment, BWG_VEID: '456' });
    const rotated = fixture({ ...environment, BWG_API_KEY: 'rotated-provider-key' });
    await original.store.record(command);
    await changedOrigin.store.record(command);
    await changedTarget.store.record({ ...command, veid: '456' });
    await rotated.store.record(command);
    const key = (value: typeof original) => value.evaluate.mock.calls[0][1][0];
    expect(key(original)).not.toBe(key(changedOrigin));
    expect(key(original)).not.toBe(key(changedTarget));
    expect(key(original)).toBe(key(rotated));
  });

});

describe('panel history credential isolation', () => {
  it('never opens shared history storage for browser credential mode', async () => {
    const { store, createRedis } = fixture({ ...environment, BWG_VEID: '', BWG_API_KEY: '' });
    expect(await store.record(command)).toBeNull();
    expect(await store.read('123')).toMatchObject({
      events: [], available: false, warning: expect.stringContaining('浏览器凭据模式'),
    });
    expect(createRedis).not.toHaveBeenCalled();
  });

  it('never opens storage for a substituted target or an invalid fixed origin', async () => {
    const wrongTarget = fixture();
    const wrongOrigin = fixture({ ...environment, APP_ORIGIN: 'http://panel.example.com' });
    expect(await wrongTarget.store.record({ ...command, veid: '456' }))
      .toEqual(expect.any(String));
    expect(await wrongOrigin.store.record(command)).toEqual(expect.any(String));
    expect(wrongTarget.createRedis).not.toHaveBeenCalled();
    expect(wrongOrigin.createRedis).not.toHaveBeenCalled();
  });
});

describe('safe panel history reads', () => {
  it('retains submission time independently of later result observations', async () => {
    const { store, evaluate } = fixture();
    const occurredAt = new Date(NOW.getTime() - 10_000).toISOString();
    evaluate.mockResolvedValue([stored({ occurredAt })]);
    const result = await store.read('123');
    expect(result.events[0]).toMatchObject({ occurredAt, observedAt: NOW.toISOString() });
  });

  it('reconstructs allowlisted messages without returning stored raw text', async () => {
    const { store, evaluate } = fixture();
    const event = stored({ message: 'secret-raw-text', apiKey: 'key' });
    evaluate.mockResolvedValue([JSON.stringify(event)]);
    const result = await store.read('123');
    expect(result).toMatchObject({ available: true, warning: null });
    expect(result.events[0]).toMatchObject({
      id: `panel:${command.requestId}`, source: 'panel', action: 'restart', outcome: 'accepted',
    });
    expect(JSON.stringify(result)).not.toContain('secret-raw-text');
    expect(JSON.stringify(result)).not.toContain('apiKey');
    expect(evaluate.mock.calls[0][2]).toEqual([NOW.getTime() - RETENTION * 1_000, 200]);
  });

  it('excludes stale, future, malformed, and unsupported records', async () => {
    const { store, evaluate } = fixture();
    evaluate.mockResolvedValue([
      stored(), stored({ action: 'shell' }), stored({ outcome: 'completed' }),
      stored({ requestId: 'raw-secret' }), '{broken',
      stored({ observedAt: new Date(NOW.getTime() + 300_001).toISOString() }),
      stored({ observedAt: new Date(NOW.getTime() - RETENTION * 1_000).toISOString() }),
    ]);
    const result = await store.read('123');
    expect(result.events).toHaveLength(1);
    expect(result.warning).toContain('已忽略');
    expect(JSON.stringify(result)).not.toContain('raw-secret');
  });

  it('caps returned events even if a malformed backend exceeds its bounded read', async () => {
    const { store, evaluate } = fixture();
    evaluate.mockResolvedValue(Array.from({ length: 201 }, () => stored()));
    const result = await store.read('123');
    expect(result.events).toHaveLength(200);
    expect(result.warning).toContain('已忽略');
  });
});

describe('nonblocking history failures', () => {
  it('returns a separate warning for store errors without exposing credentials', async () => {
    const { store, evaluate } = fixture();
    evaluate.mockRejectedValue(new Error(environment.UPSTASH_REDIS_REST_TOKEN));
    const warning = await store.record(command);
    expect(warning).toEqual(expect.any(String));
    expect(warning).not.toContain(environment.UPSTASH_REDIS_REST_TOKEN);
    expect(await store.read('123')).toMatchObject({ events: [], available: false, warning });
  });

  it('bounds a hanging backend without blocking the caller indefinitely', async () => {
    vi.useFakeTimers();
    const { store, evaluate } = fixture();
    evaluate.mockImplementation(() => new Promise(() => {}));
    const result = store.record(command);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toEqual(expect.any(String));
  });

  it('returns sanitized unavailability for malformed storage results', async () => {
    const { store, evaluate } = fixture();
    evaluate.mockResolvedValue(undefined);
    expect(await store.record(command)).toEqual(expect.any(String));
    expect(await store.read('123')).toMatchObject({ events: [], available: false });
  });
});
