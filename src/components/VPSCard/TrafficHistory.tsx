import { lazy, Suspense, useCallback, useState } from 'react';
import { Button, Tab, Tabs } from '@heroui/react';
import { Download, RefreshCw } from 'lucide-react';
import type { VPSCredentials } from '@/types';
import type { TrafficHistoryData, TrafficRange } from '@/types/dashboard';
import { fetchTrafficHistory } from '@/lib/dashboard-api';
import { IconButton } from './controls';
import { HistoryStatus } from './HistoryStatus';
import { TrafficSamples } from './TrafficSamples';
import { formatDate } from './VPSOverview';
import { downloadTrafficCsv, formatSampleBytes } from './trafficPresentation';
import { useDashboardHistory } from './useDashboardHistory';

const TrafficChart = lazy(() => import('./TrafficChart')
  .then((module) => ({ default: module.TrafficChart })));
const RANGES: Array<{ key: TrafficRange; label: string }> = [
  { key: '24h', label: '24 小时' }, { key: '7d', label: '7 天' }, { key: '30d', label: '30 天' },
];

function TrafficData({ data }: { data: TrafficHistoryData }) {
  const latest = data.points.at(-1);
  if (!latest) return <p className="min-h-64 py-12 text-sm text-default-600">
    此时间范围内暂无可用采样。
  </p>;
  return <>
    <p className="mb-4 break-words text-sm text-default-600">
      可用采样：{formatDate(data.availableFrom)} ~ {formatDate(data.availableTo)}（北京时间）
    </p>
    <dl className="grid gap-5 border-y border-default-200 py-5 sm:grid-cols-3">
      <div><dt className="text-sm text-default-600">最新采样（北京时间）</dt>
        <dd className="mt-2 break-words font-medium">{formatDate(latest.timestamp)}</dd></div>
      <div><dt className="text-sm text-default-600">接收字节样本</dt>
        <dd className="mt-2 font-medium tabular-nums">
          {formatSampleBytes(latest.receivedBytes)}
        </dd>
      </div>
      <div><dt className="text-sm text-default-600">发送字节样本</dt>
        <dd className="mt-2 font-medium tabular-nums">
          {formatSampleBytes(latest.sentBytes)}
        </dd></div>
    </dl>
    <div className="py-6">
      <Suspense fallback={<div role="status" className="h-72 text-sm text-default-600">
        图表加载中…
      </div>}><TrafficChart points={data.points} /></Suspense>
    </div>
    <TrafficSamples key={data.range} points={data.points} />
  </>;
}

export function TrafficHistory({ credentials, revision, active, blocked }: {
  credentials: VPSCredentials; revision: number; active: boolean; blocked: boolean;
}) {
  const [range, setRange] = useState<TrafficRange>('7d');
  const load = useCallback((signal: AbortSignal) => fetchTrafficHistory(credentials, range,
    { signal }), [credentials, range]);
  const history = useDashboardHistory(`${credentials.veid}:${revision}:${range}`,
    active, blocked, load);
  return <section className="min-w-0 py-4" aria-labelledby="history-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="history-heading" className="text-lg font-semibold">原始网络统计</h2>
      <div className="flex items-center gap-1">
        <Button radius="sm" size="sm" variant="light"
          isDisabled={!history.data?.points.length}
          onPress={() => { if (history.data) downloadTrafficCsv(history.data); }}
          startContent={<Download size={17} aria-hidden="true" />}>导出 CSV</Button>
        <IconButton label="刷新流量趋势" loading={history.reading} disabled={blocked}
          onPress={() => { void history.refresh(); }}><RefreshCw size={18} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
    <Tabs aria-label="流量统计时间范围" selectedKey={range} size="sm" radius="sm"
      onSelectionChange={(key) => setRange(key as TrafficRange)} className="mt-4">
      {RANGES.map((item) => <Tab key={item.key} title={item.label} isDisabled={blocked} />)}
    </Tabs>
    <HistoryStatus {...history} observedAt={history.data?.observedAt ?? null} blocked={blocked}
      warning={history.data?.warning} />
    <p className="mb-4 text-sm text-default-600">
      服务商原始网络采样，单位为字节；与套餐流量配额采用不同统计口径。
    </p>
    {history.data ? <TrafficData data={history.data} />
      : <div className="min-h-64 py-12 text-sm text-default-600" role="status">
        {history.reading ? '正在读取网络统计…' : '尚未取得网络统计。'}
      </div>}
  </section>;
}
