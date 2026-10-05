import { describe, expect, it } from 'vitest';
import { getServerVEID, resolveVPSCredentials } from '@/lib/server/vps-credentials';

const SERVER = { BWG_VEID: '123', BWG_API_KEY: 'synthetic-server-secret' };
const BROWSER = { veid: '456', apiKey: 'synthetic-browser-secret' };

describe('server-owned credential resolution', () => {
  it('retains browser credentials when neither server secret is configured', () => {
    expect(getServerVEID({})).toBeNull();
    expect(getServerVEID({ BWG_VEID: '', BWG_API_KEY: '' })).toBeNull();
    expect(resolveVPSCredentials(BROWSER, {})).toEqual(BROWSER);
    expect(() => resolveVPSCredentials({}, {})).toThrow();
  });

  it('publishes only the server VEID and uses only its key', () => {
    expect(getServerVEID(SERVER)).toBe('123');
    expect(resolveVPSCredentials({ veid: '123', apiKey: 'ignored-client-key' }, SERVER))
      .toEqual({ veid: '123', apiKey: SERVER.BWG_API_KEY });
    expect(resolveVPSCredentials({ veid: '123' }, SERVER).apiKey).toBe(SERVER.BWG_API_KEY);
    expect(resolveVPSCredentials({ veid: '123', apiKey: '' }, SERVER).apiKey)
      .toBe(SERVER.BWG_API_KEY);
    expect(resolveVPSCredentials({}, SERVER).veid).toBe('123');
  });

  it.each(['456', ' 123 ', 123, null, {}, ['123']])('rejects a changed target %j', (veid) => {
    expect(() => resolveVPSCredentials({ veid }, SERVER)).toThrow();
  });

  it.each([null, false, {}, ['secret'], 123])('rejects a non-string client key %j', (apiKey) => {
    expect(() => resolveVPSCredentials({ apiKey }, SERVER)).toThrow();
  });
});

describe('invalid deployment credential configuration', () => {
  it.each([
    { BWG_VEID: '123' }, { BWG_API_KEY: 'synthetic-server-secret' },
    { BWG_VEID: '123', BWG_API_KEY: '' }, { BWG_VEID: 'invalid', BWG_API_KEY: 'secret' },
    { BWG_VEID: '123', BWG_API_KEY: ' ' }, { BWG_VEID: '123', BWG_API_KEY: 'x'.repeat(513) },
  ])('fails closed without exposing configuration values: %j', (env) => {
    try {
      resolveVPSCredentials(BROWSER, env);
      expect.fail('Expected deployment configuration rejection');
    } catch (error) {
      expect(error).toMatchObject({ status: 503, code: 'VPS_NOT_CONFIGURED' });
      expect(String(error)).not.toContain('synthetic-server-secret');
      expect(String(error)).not.toContain(BROWSER.apiKey);
    }
    expect(() => getServerVEID(env)).toThrow();
  });
});
