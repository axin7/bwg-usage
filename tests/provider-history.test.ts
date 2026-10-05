import { describe, expect, it, vi } from 'vitest';
import { getTrafficHistory, parseTrafficHistory } from '@/lib/server/provider-history';

const NOW = new Date('2026-10-05T10:00:00.000Z');
const seconds = (iso: string) => Date.parse(iso) / 1000;
const sample = (timestamp: string, received: unknown = 100, sent: unknown = 50) => ({
  timestamp: seconds(timestamp), network_in_bytes: received, network_out_bytes: sent,
});

describe('raw traffic sample normalization', () => {
  it('sorts, filters locally and deduplicates without aggregating bytes', () => {
    const data = [sample('2026-10-05T09:00:00Z'), sample('2026-10-03T08:00:00Z'),
      sample('2026-10-04T10:00:00Z', 40), sample('2026-10-05T09:00:00Z', 200)];
    const history = parseTrafficHistory({ data }, '24h', NOW);
    expect(history.points).toHaveLength(2);
    expect(history.points[0]).toMatchObject({ receivedBytes: 40, intervalSeconds: null });
    expect(history.points[1]).toMatchObject({ receivedBytes: 200, intervalSeconds: 82_800 });
    expect(history.availableFrom).toBe('2026-10-03T08:00:00.000Z');
    expect(history.warning).toContain('重复');
    expect(history.semantics).toBe('raw-samples');
  });

  it('preserves zero and converts invalid metrics to null without filling gaps', () => {
    const data = ['05:00', '05:05', '05:10', '09:00'].map((time, index) =>
      sample(`2026-10-05T${time}:00Z`, index === 0 ? 0 : -1, '20'));
    const history = parseTrafficHistory({ data }, '7d', NOW);
    expect(history.points.map((point) => point.receivedBytes)).toEqual([0, null, null, null]);
    expect(history.points.map((point) => point.sentBytes)).toEqual([20, 20, 20, 20]);
    expect(history.points[3].gapBefore).toBe(true);
    expect(history.warning).toContain('未补零');
  });

  it('marks changed intervals in short series using the lower median', () => {
    const data = ['05:00', '05:01', '06:01'].map((time) => sample(`2026-10-05T${time}:00Z`));
    const history = parseTrafficHistory({ data }, '24h', NOW);
    expect(history.points[2].gapBefore).toBe(true);
    expect(history.warning).toContain('间隔发生变化');
  });
});

describe('traffic sample time and size boundaries', () => {
  it.each([{}, { data: {} }, { data: [{ timestamp: -1 }] },
    { data: [{ timestamp: Number.MAX_SAFE_INTEGER }] }, { data: [null] }])(
    'rejects unsupported schemas and invalid time values: %j', (raw) => {
      expect(() => parseTrafficHistory(raw, '7d', NOW)).toThrow();
    },
  );

  it('keeps empty ranges empty and excludes future samples', () => {
    const history = parseTrafficHistory({ data: [sample('2026-10-06T00:00:00Z')] }, '24h', NOW);
    expect(history.points).toEqual([]);
    expect(history.availableTo).toBe('2026-10-06T00:00:00.000Z');
    expect(parseTrafficHistory({ data: [] }, '30d', NOW).availableFrom).toBeNull();
  });

  it('bounds response size and marks truncation instead of silently aggregating', () => {
    const end = NOW.getTime() / 1000;
    const data = Array.from({ length: 5001 }, (_, index) => ({
      timestamp: end - 5000 + index, network_in_bytes: index, network_out_bytes: 0,
    }));
    const history = parseTrafficHistory({ data }, '24h', NOW);
    expect(history.points).toHaveLength(5000);
    expect(history.points[0].receivedBytes).toBe(1);
    expect(history.warning).toContain('5000');
    expect(() => parseTrafficHistory({ data: Array(50_001).fill(data[0]) }, '30d', NOW))
      .toThrow();
  });
});

it('sends no invented range parameters upstream and never forwards unknown fields', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    error: 0, data: [], api_key: 'synthetic-secret', message: 'private',
  }));
  const history = await getTrafficHistory({ veid: '123', apiKey: 'synthetic-secret' }, '7d',
    { fetcher });
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('https://api.64clouds.com/v1/getRawUsageStats');
  expect([...new URLSearchParams(String(options?.body)).keys()]).toEqual(['veid', 'api_key']);
  expect(JSON.stringify(history)).not.toContain('synthetic-secret');
  expect(JSON.stringify(history)).not.toContain('private');
});
