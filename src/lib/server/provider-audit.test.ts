import { describe, expect, it, vi } from 'vitest';
import { getProviderAudit, parseProviderAudit } from './provider-audit';

const now = new Date('2026-10-05T12:00:00.000Z');
const seconds = Math.floor(now.getTime() / 1_000);

function parseSummary(summary: string, type = 99) {
  return parseProviderAudit({ log_entries: [{ timestamp: seconds, type, summary }] }, now);
}

describe('actual provider audit response boundary', () => {
  it('uses log_entries and omits raw summary, IP, actor, and arbitrary fields', () => {
    const result = parseProviderAudit({ error: 0, log_entries: [{
      timestamp: seconds, type: 7, requestor_ipv4: 3_232_235_777,
      summary: 'reboot: requested with secret-provider-key', user: 'sensitive-owner',
    }] }, now);
    expect(result.warning).toBeNull();
    expect(result.events[0]).toMatchObject({
      source: 'provider', action: 'restart', outcome: 'recorded',
      occurredAt: now.toISOString(), requestId: null,
    });
    expect(JSON.stringify(result)).not.toMatch(/secret-provider-key|sensitive-owner|3232235777/);
    expect(result.events[0]).not.toHaveProperty('summary');
    expect(result.events[0]).not.toHaveProperty('requestor_ipv4');
  });

  it('keeps unknown types and summaries generic without inventing success', () => {
    const result = parseProviderAudit({ log_entries: [{
      timestamp: seconds, type: 99, summary: 'secret-provider-key details',
    }, { timestamp: seconds - 1, type: 0, summary: '' }] }, now);
    expect(result.events).toHaveLength(2);
    expect(result.events.every(({ action, outcome }) => action === 'unknown'
      && outcome === 'recorded')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret-provider-key');
  });

  it('supports empty actual logs and exposes malformed primary fields', () => {
    expect(parseProviderAudit({ log_entries: [] }, now)).toEqual({ events: [], warning: null });
    const raw = { log_entries: null, log: [{ timestamp: seconds, action: 'start' }] };
    expect(parseProviderAudit(raw, now))
      .toMatchObject({ events: [], warning: expect.any(String) });
  });
});

describe('actual provider audit bounds and malformed rows', () => {
  it('sorts all455 oldest-first entries before retaining the latest200', () => {
    const log_entries = Array.from({ length: 455 }, (_, index) => ({
      timestamp: seconds - 454 + index, type: 1, summary: 'start: provider operation',
      requestor_ipv4: 3_232_235_777,
    }));
    const result = parseProviderAudit({ error: 0, log_entries }, now);
    expect(result.events).toHaveLength(200);
    expect(result.events[0].occurredAt).toBe(now.toISOString());
    expect(result.events.at(-1)?.occurredAt)
      .toBe(new Date(now.getTime() - 199_000).toISOString());
    expect(result.warning).toEqual(expect.any(String));
  });

  it('keeps valid entries while omitting malformed timestamps, types, and summaries', () => {
    const entry = { timestamp: seconds, type: 1, summary: 'start' };
    const result = parseProviderAudit({ log_entries: [
      entry, { ...entry, timestamp: 'secret-time' }, { ...entry, type: '1' },
      { ...entry, summary: null }, { ...entry, timestamp: seconds * 1_000 }, null,
    ] }, now);
    expect(result.events).toHaveLength(1);
    expect(result.warning).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toContain('secret-time');
  });
});

describe('actual audit summary classification', () => {
  it.each([
    ['Command received: start', 'start'], ['VM started', 'start'],
    ['Command received: STOP', 'stop'], ['VM stopped', 'stop'],
    ['Command received: restart', 'restart'], ['VM restarted', 'restart'],
    ['Command rebooted then restart observed', 'restart'],
    ['Guest login attempt', 'login'], ['API call', 'api'],
  ])('classifies an allowlisted whole word in %s', (summary, action) => {
    const result = parseSummary(summary);
    expect(result.events[0]).toMatchObject({ action, outcome: 'recorded' });
  });

  it.each([
    'Command received: start then stop', 'Restart followed by guest login', 'restarting',
  ])('keeps ambiguous or unsupported summary %s generic', (summary) => {
    const result = parseSummary(summary, 1);
    expect(result.events[0]).toMatchObject({ action: 'unknown', outcome: 'recorded' });
  });

  it('bounds summary processing without hiding a second token after truncation', () => {
    const summary = `start ${'x'.repeat(4_096)} stop`;
    const result = parseSummary(summary, 36);
    expect(result.events[0].action).toBe('unknown');
  });

  it('returns only fixed API descriptions rather than private raw summaries', () => {
    const summary = 'API call containing private-provider-key and private-owner';
    const result = parseSummary(summary, 18);
    expect(result.events[0]).toMatchObject({ action: 'api', outcome: 'recorded' });
    expect(JSON.stringify(result)).not.toMatch(/private-provider-key|private-owner/);
  });
});

describe('public client audit compatibility', () => {
  it('supports the public log array without raw actor, IP, or detail fields', () => {
    const result = parseProviderAudit({ error: 0, log: [{
      timestamp: seconds, action: 'reboot: via API', user: 'sensitive-owner',
      ip: '192.0.2.123', details: 'secret-provider-key',
    }] }, now);
    expect(result.warning).toBeNull();
    expect(result.events[0]).toMatchObject({
      source: 'provider', action: 'restart', outcome: 'recorded',
      occurredAt: now.toISOString(), observedAt: now.toISOString(), requestId: null,
    });
    expect(JSON.stringify(result))
      .not.toMatch(/sensitive-owner|192\.0\.2\.123|secret-provider-key/);
  });

  it('labels unsupported actions without echoing arbitrary upstream text', () => {
    const log = [{ timestamp: seconds, action: 'secret-api-key' }];
    const result = parseProviderAudit({ log }, now);
    expect(result.events[0]).toMatchObject({
      action: 'unknown', message: '未识别的服务商事件。',
    });
    expect(JSON.stringify(result)).not.toContain('secret-api-key');
  });

  it('treats an empty log as supported and an unknown envelope as unavailable data', () => {
    expect(parseProviderAudit({ log: [] }, now)).toEqual({ events: [], warning: null });
    expect(parseProviderAudit({ events: [{ timestamp: seconds, action: 'start' }] }, now))
      .toMatchObject({ events: [], warning: expect.any(String) });
  });

  it('omits malformed and implausible timestamps while keeping valid records', () => {
    const result = parseProviderAudit({ log: [
      { timestamp: seconds - 60, action: 'stop' },
      { timestamp: seconds, action: 'start' },
      { timestamp: seconds * 1_000, action: 'restart' },
      { timestamp: 'secret-time', action: 'restart' },
      { timestamp: seconds, action: null }, null,
    ] }, now);
    expect(result.events.map(({ action }) => action)).toEqual(['start', 'stop']);
    expect(result.warning).toEqual(expect.any(String));
  });

});

describe('provider audit display bounds', () => {
  it('bounds the display and warns when records are omitted', () => {
    const log = Array.from({ length: 201 }, (_, index) => ({
      timestamp: seconds - index, action: 'start',
    }));
    const result = parseProviderAudit({ log }, now);
    expect(result.events).toHaveLength(200);
    expect(result.warning).toEqual(expect.any(String));
  });

  it('keeps the latest events from an oldest-first provider response', () => {
    const log = Array.from({ length: 2_001 }, (_, index) => ({
      timestamp: seconds - 2_000 + index, action: 'start',
    }));
    const result = parseProviderAudit({ log }, now);
    expect(result.events).toHaveLength(200);
    expect(result.events[0].occurredAt).toBe(now.toISOString());
    expect(result.events.at(-1)?.occurredAt)
      .toBe(new Date(now.getTime() - 199_000).toISOString());
  });

  it('degrades explicitly when the response exceeds the bounded processing limit', () => {
    const result = parseProviderAudit({ log: Array.from({ length: 50_001 }, () => null) }, now);
    expect(result).toMatchObject({ events: [], warning: expect.any(String) });
  });
});

describe('provider audit transport', () => {
  it('uses the fixed provider endpoint with injected offline requests', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: 0, log_entries: [] }));
    expect(await getProviderAudit({ veid: '123', apiKey: 'test-secret' }, { fetcher }))
      .toEqual({ events: [], warning: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.64clouds.com/v1/getAuditLog');
    expect(new URLSearchParams(String(fetcher.mock.calls[0][1]?.body)).get('api_key'))
      .toBe('test-secret');
  });
});
