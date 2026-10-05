import { expect, test } from 'vitest';
import type { TrafficHistoryData } from '@/types/dashboard';
import type { AuditEvent } from '@/types/audit';
import { mergeAuditEvents } from './AuditHistory';
import { filterAuditEvents } from './AuditFilters';
import { formatSampleBytes, trafficChartPoints, trafficCsv } from './trafficPresentation';

const TRAFFIC: TrafficHistoryData = {
  range: '24h', source: 'provider', unit: 'bytes', semantics: 'raw-samples',
  observedAt: '2026-10-05T00:00:00.000Z', availableFrom: null, availableTo: null, warning: null,
  points: [
    { timestamp: '2026-10-04T00:00:00.000Z', receivedBytes: 0, sentBytes: 4096,
      intervalSeconds: null, gapBefore: false },
    { timestamp: '2026-10-04T02:00:00.000Z', receivedBytes: null, sentBytes: 8192,
      intervalSeconds: 7200, gapBefore: true },
  ],
};

test('byte sample formatting preserves zero and unknown rather than inferring a rate', () => {
  expect(formatSampleBytes(0)).toBe('0 B');
  expect(formatSampleBytes(null)).toBe('未知');
  expect(formatSampleBytes(4096)).toBe('4 KiB');
  expect(formatSampleBytes(0.5)).toBe('0.5 B');
});

test('CSV preserves source samples, nullable intervals and missing bytes', () => {
  expect(trafficCsv(TRAFFIC)).toBe([
    'timestamp_utc,received_bytes,sent_bytes,interval_seconds,gap_before,source,unit,semantics',
    '"2026-10-04T00:00:00.000Z","0","4096",,"false","provider","bytes","raw-samples"',
    '"2026-10-04T02:00:00.000Z",,"8192","7200","true","provider","bytes","raw-samples"',
  ].join('\r\n'));
});

test('chart breaks lines at source gaps without adding zero-valued samples', () => {
  const points = trafficChartPoints(TRAFFIC.points);
  expect(points).toHaveLength(3);
  expect(points[1]).toMatchObject({ receivedBytes: null, sentBytes: null, gapBefore: true });
  expect(points[1].timestamp).toBe(Date.parse('2026-10-04T01:00:00.000Z'));
  expect(points[2].receivedBytes).toBeNull();
  expect(points[2].sentBytes).toBe(8192);
  expect(TRAFFIC.points).toHaveLength(2);
});

function auditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return { id: 'persisted', observedAt: '2026-10-05T01:00:00.000Z',
    occurredAt: '2026-10-05T00:00:00.000Z', source: 'panel', action: '停止',
    outcome: 'accepted', message: '服务商已受理', requestId: 'action-1', ...overrides };
}

test('persisted panel records deduplicate session receipts while provider records remain', () => {
  const remote = [auditEvent(), auditEvent({ id: 'provider', source: 'provider' })];
  const session = [auditEvent({ id: 'session-panel-1' }),
    auditEvent({ id: 'session-panel-2', requestId: null,
      occurredAt: '2026-10-05T00:01:00.000Z', outcome: 'unknown' })];
  const result = mergeAuditEvents(remote, session);
  expect(result.map((event) => event.id)).toEqual(['session-panel-2', 'persisted', 'provider']);
  expect(result[0].outcome).toBe('unknown');
});

test('audit filtering distinguishes current-session events and outcomes', () => {
  const events = [auditEvent(), auditEvent({ id: 'provider', source: 'provider' }),
    auditEvent({ id: 'session-panel-1', requestId: null, outcome: 'unknown' })];
  expect(filterAuditEvents(events, 'session', 'unknown').map((event) => event.id))
    .toEqual(['session-panel-1']);
  expect(filterAuditEvents(events, 'panel', 'all').map((event) => event.id))
    .toEqual(['persisted']);
  expect(filterAuditEvents(events, 'provider', 'rejected')).toEqual([]);
});
