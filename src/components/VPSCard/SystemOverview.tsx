import { Chip } from '@heroui/react';
import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { VPSSystemData } from '@/types/resources';
import { IconButton } from './controls';
import { formatBytes, formatDate } from './VPSOverview';

const NUMBER = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

function ResourceMetric({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-2">
    <dt className="text-sm text-default-600">{label}</dt>
    <dd className="break-words font-medium tabular-nums">{children}</dd>
  </div>;
}

function Throttle({ value }: { value: boolean | null }) {
  return <Chip size="sm" radius="sm" variant="flat" color={value ? 'warning' : 'default'}>
    {value === null ? '未知' : value ? '已限制' : '未限制'}
  </Chip>;
}

function LiveResources({ system }: { system: VPSSystemData }) {
  const load = system.loadAverage;
  return <dl className="mt-5 grid gap-5 sm:grid-cols-2 md:grid-cols-3">
    <ResourceMetric label="可用内存">{formatBytes(system.availableRamBytes)}</ResourceMetric>
    <ResourceMetric label="Swap 总量 / 可用">
      {formatBytes(system.swapTotalBytes)} / {formatBytes(system.swapAvailableBytes)}
    </ResourceMetric>
    <ResourceMetric label="映射磁盘容量">{formatBytes(system.mappedDiskBytes)}</ResourceMetric>
    <ResourceMetric label="平均负载（1 / 5 / 15 分钟）">
      {load ? load.map((value) => NUMBER.format(value)).join(' / ') : '未知'}
    </ResourceMetric>
    <ResourceMetric label="CPU 限流"><Throttle value={system.cpuThrottled} /></ResourceMetric>
    <ResourceMetric label="磁盘限流"><Throttle value={system.diskThrottled} /></ResourceMetric>
  </dl>;
}

export function SystemOverview({ system, reading, disabled, onRefresh }: {
  system?: VPSSystemData; reading: boolean; disabled: boolean; onRefresh: () => void;
}) {
  const stale = system?.live && Date.now() - Date.parse(system.observedAt) > 300_000;
  return <section className="border-b border-default-200 py-6"
    aria-labelledby="resources-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="resources-heading" className="text-lg font-semibold">系统资源</h2>
      <IconButton label="刷新资源数据" onPress={onRefresh}
        loading={reading} disabled={disabled}>
        <RefreshCw size={18} aria-hidden="true" />
      </IconButton>
    </div>
    <dl className="mt-4 grid gap-5 sm:grid-cols-2 md:grid-cols-3">
      <ResourceMetric label="套餐内存">{formatBytes(system?.planRamBytes ?? null)}</ResourceMetric>
      <ResourceMetric label="套餐 Swap">{formatBytes(system?.planSwapBytes ?? null)}</ResourceMetric>
      <ResourceMetric label="套餐磁盘">{formatBytes(system?.planDiskBytes ?? null)}</ResourceMetric>
    </dl>
    {system?.live ? <>
      <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-default-600">
        <p>实时采集：{formatDate(system.observedAt)}（北京时间）</p>
        {stale ? <Chip size="sm" radius="sm" color="warning" variant="flat">
          实时数据已过期
        </Chip> : null}
      </div>
      <LiveResources system={system} />
    </> : <p className="mt-6 text-sm text-default-600">尚无实时资源数据。</p>}
  </section>;
}
