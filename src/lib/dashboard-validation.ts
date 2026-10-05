import type { AuditData, AuditEvent } from '@/types/audit';
import type { TrafficHistoryData, TrafficPoint } from '@/types/dashboard';
import { record, validBytes, validDate } from './dto-validation';

const nullableDate = (value: unknown) => value === null || validDate(value);
const nullableText = (value: unknown) => value === null || typeof value === 'string';

function validPoint(value: unknown): value is TrafficPoint {
  if (!record(value)) return false;
  return validDate(value.timestamp) && validBytes(value.receivedBytes)
    && validBytes(value.sentBytes)
    && (value.intervalSeconds === null || (typeof value.intervalSeconds === 'number'
      && Number.isFinite(value.intervalSeconds) && value.intervalSeconds > 0))
    && typeof value.gapBefore === 'boolean';
}

export function validTraffic(value: unknown): value is TrafficHistoryData {
  if (!record(value) || !Array.isArray(value.points) || value.points.length > 5000) return false;
  const points = value.points;
  return typeof value.range === 'string' && ['24h', '7d', '30d'].includes(value.range)
    && validDate(value.observedAt)
    && value.source === 'provider' && value.unit === 'bytes' && value.semantics === 'raw-samples'
    && nullableDate(value.availableFrom) && nullableDate(value.availableTo)
    && nullableText(value.warning) && points.every(validPoint)
    && points.every((point, index) => index === 0
      || Date.parse(point.timestamp) > Date.parse(points[index - 1].timestamp));
}

function validEvent(value: unknown): value is AuditEvent {
  if (!record(value)) return false;
  return typeof value.id === 'string' && validDate(value.observedAt)
    && nullableDate(value.occurredAt) && typeof value.source === 'string'
    && ['provider', 'panel'].includes(value.source) && typeof value.outcome === 'string'
    && ['accepted', 'rejected', 'unknown', 'recorded'].includes(value.outcome)
    && typeof value.action === 'string' && typeof value.message === 'string'
    && nullableText(value.requestId);
}

export function validAudit(value: unknown): value is AuditData {
  return record(value) && Array.isArray(value.events) && value.events.length <= 400
    && value.events.every(validEvent) && validDate(value.observedAt)
    && typeof value.panelHistoryAvailable === 'boolean' && nullableText(value.warning);
}
