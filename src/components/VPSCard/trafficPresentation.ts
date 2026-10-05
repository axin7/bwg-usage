import type { TrafficHistoryData, TrafficPoint } from '@/types/dashboard';

const NUMBER = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

export function formatSampleBytes(value: number | null): string {
  if (value === null) return '未知';
  const scale = value === 0 ? 0
    : Math.max(0, Math.min(4, Math.floor(Math.log(value) / Math.log(1024))));
  return `${NUMBER.format(value / 1024 ** scale)} ${UNITS[scale]}`;
}

export function trafficChartPoints(points: TrafficPoint[]) {
  return points.flatMap((point, index) => {
    const timestamp = Date.parse(point.timestamp);
    const current = { ...point, timestamp };
    if (!point.gapBefore || index === 0) return [current];
    const previous = Date.parse(points[index - 1].timestamp);
    return [{ timestamp: previous + (timestamp - previous) / 2,
      receivedBytes: null, sentBytes: null, intervalSeconds: null, gapBefore: true }, current];
  });
}

function csvCell(value: string | number | boolean | null): string {
  return value === null ? '' : `"${String(value).replaceAll('"', '""')}"`;
}

export function trafficCsv(data: TrafficHistoryData): string {
  const header = 'timestamp_utc,received_bytes,sent_bytes,interval_seconds,gap_before'
    + ',source,unit,semantics';
  const rows = data.points.map((point) => [point.timestamp, point.receivedBytes,
    point.sentBytes, point.intervalSeconds, point.gapBefore,
    data.source, data.unit, data.semantics].map(csvCell).join(','));
  return [header, ...rows].join('\r\n');
}

export function downloadTrafficCsv(data: TrafficHistoryData): void {
  const blob = new Blob([trafficCsv(data)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `vps-traffic-${data.range}.csv`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
