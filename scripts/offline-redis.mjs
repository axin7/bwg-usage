import assert from 'node:assert/strict';

export const redisEnvironment = {
  UPSTASH_REDIS_REST_URL: 'https://offline-redis.invalid',
  UPSTASH_REDIS_REST_TOKEN: 'offline-verification-token',
};

const limits = { login: 10, query: 60, action: 5 };

function commandDetails(command) {
  assert(Array.isArray(command), 'Redis command must be an array');
  assert(['eval', 'evalsha'].includes(String(command[0]).toLowerCase()),
    'Unexpected Redis command');
  const keyCount = Number(command[2]);
  const match = String(command[3]).match(
    /^bwg-usage:[a-f\d]{12}:(login|query|action):panel:\d+$/,
  );
  assert(match && keyCount === 2, 'Unexpected rate-limit key');
  const scope = match[1];
  const allowance = Number(command[3 + keyCount]);
  assert.equal(allowance, limits[scope], 'Unexpected rate-limit allowance');
  return { scope, allowance };
}

function requestDetails(input, options) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.origin, redisEnvironment.UPSTASH_REDIS_REST_URL);
  assert(['/', '/pipeline'].includes(url.pathname), 'Unexpected Redis endpoint');
  assert.equal(options.method, 'POST');
  assert.equal(new Headers(options.headers).get('authorization'),
    `Bearer ${redisEnvironment.UPSTASH_REDIS_REST_TOKEN}`);
  const body = JSON.parse(options.body);
  const pipeline = url.pathname === '/pipeline';
  const commands = pipeline ? body : [body];
  assert(Array.isArray(commands) && commands.length > 0, 'Empty Redis request');
  return { pipeline, commands: commands.map(commandDetails) };
}

function waitForAbort(signal) {
  assert(signal instanceof AbortSignal, 'Redis request must have a deadline');
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      reject(new Error('Offline Redis deadline expired'));
    }, 2_100);
    function abort() {
      clearTimeout(deadline);
      reject(signal.reason);
    }
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export function createOfflineRedisTransport() {
  const pending = new Set();
  const transport = { mode: 'success', calls: [], protocolErrors: 0, unexpectedCalls: 0 };
  transport.fetch = async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== redisEnvironment.UPSTASH_REDIS_REST_URL) {
      transport.unexpectedCalls += 1;
      throw new Error('External network disabled');
    }
    let details;
    try {
      details = requestDetails(input, options);
    } catch (error) {
      transport.protocolErrors += 1;
      throw error;
    }
    const calls = details.commands.map(({ scope }) => ({ scope, mode: transport.mode }));
    transport.calls.push(...calls);
    if (transport.mode === 'network-error') throw new Error('Offline Redis unavailable');
    if (transport.mode === 'http-error') {
      return Response.json({ error: 'Offline Redis unavailable' }, { status: 503 });
    }
    if (transport.mode === 'timeout') {
      const request = waitForAbort(options.signal);
      pending.add(request);
      try { return await request; } finally { pending.delete(request); }
    }
    const replies = details.commands.map(({ allowance }) => ({
      result: [transport.mode === 'deny' ? -1 : allowance - 1, allowance],
    }));
    return Response.json(details.pipeline ? replies : replies[0]);
  };
  transport.pendingCount = () => pending.size;
  transport.settle = () => Promise.allSettled([...pending]);
  return transport;
}
