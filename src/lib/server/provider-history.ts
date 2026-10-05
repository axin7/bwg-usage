import type { VPSCredentials } from '@/types';
import type { TrafficHistoryData, TrafficPoint, TrafficRange } from '@/types/dashboard';
import { requestProvider, type ProviderOptions } from './provider-request';
import { invalidUpstream, RouteError } from './route-error';

const RANGE_SECONDS = { '24h': 86_400, '7d': 604_800, '30d': 2_592_000 };
const MAX_POINTS = 5000;

export function parseTrafficRange(body: Record<string, unknown>): TrafficRange {
  if (body.range === '24h' || body.range === '7d' || body.range === '30d') return body.range;
  throw new RouteError(400, 'INVALID_INPUT', '请选择有效的统计时间范围。');
}

function sampleBytes(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function parsePoint(value: unknown): TrafficPoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidUpstream();
  const raw = value as Record<string, unknown>;
  const timestamp = sampleBytes(raw.timestamp);
  if (timestamp === null || !Number.isFinite(new Date(timestamp * 1000).getTime())) {
    throw invalidUpstream();
  }
  return {
    timestamp: new Date(timestamp * 1000).toISOString(),
    receivedBytes: sampleBytes(raw.network_in_bytes),
    sentBytes: sampleBytes(raw.network_out_bytes),
    intervalSeconds: null, gapBefore: false,
  };
}

function addIntervals(points: TrafficPoint[]): TrafficPoint[] {
  const intervals = points.slice(1).map((point, index) =>
    (Date.parse(point.timestamp) - Date.parse(points[index].timestamp)) / 1000);
  const sorted = [...intervals].sort((a, b) => a - b);
  const typical = sorted[Math.floor((sorted.length - 1) / 2)];
  return points.map((point, index) => ({
    ...point, intervalSeconds: index === 0 ? null : intervals[index - 1],
    gapBefore: index > 0 && typical > 0 && intervals[index - 1] > typical * 3,
  }));
}

function uniquePoints(raw: unknown[]): { points: TrafficPoint[]; duplicate: boolean } {
  const byTime = new Map<string, TrafficPoint>();
  for (const entry of raw) {
    const point = parsePoint(entry);
    byTime.set(point.timestamp, point);
  }
  return {
    points: [...byTime.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    duplicate: byTime.size !== raw.length,
  };
}

export function parseTrafficHistory(
  raw: Record<string, unknown>, range: TrafficRange, now = new Date(),
): TrafficHistoryData {
  if (!Array.isArray(raw.data) || raw.data.length > 50_000) throw invalidUpstream();
  const { points, duplicate } = uniquePoints(raw.data);
  const from = now.getTime() - RANGE_SECONDS[range] * 1000;
  const selected = points.filter((point) => {
    const time = Date.parse(point.timestamp);
    return time >= from && time <= now.getTime();
  });
  const visible = addIntervals(selected.slice(-MAX_POINTS));
  const warnings = ['原始统计样本不等同于月度计费流量，未换算为区间用量或速率。'];
  if (visible.some((point) => point.receivedBytes === null || point.sentBytes === null)) {
    warnings.push('部分指标缺失或无效，以未知显示。');
  }
  if (visible.some((point) => point.gapBefore)) warnings.push('样本间隔发生变化，未补零。');
  if (duplicate) warnings.push('重复时间点保留最后一个样本。');
  if (selected.length > MAX_POINTS) warnings.push(`仅显示和导出最近 ${MAX_POINTS} 个样本。`);
  return {
    range, points: visible, observedAt: now.toISOString(), source: 'provider',
    unit: 'bytes', semantics: 'raw-samples',
    availableFrom: points[0]?.timestamp ?? null,
    availableTo: points.at(-1)?.timestamp ?? null,
    warning: warnings.join(' '),
  };
}

export async function getTrafficHistory(
  credentials: VPSCredentials, range: TrafficRange, options: ProviderOptions = {},
): Promise<TrafficHistoryData> {
  const raw = await requestProvider('getRawUsageStats', credentials, false, options);
  return parseTrafficHistory(raw, range);
}
