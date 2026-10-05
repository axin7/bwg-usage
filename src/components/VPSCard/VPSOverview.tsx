import { Chip, Progress } from '@heroui/react';
import type { ReactNode } from 'react';
import type { VPSData } from '@/types';

const NUMBER_FORMAT = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const DATE_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

export function formatBytes(value: number | null): string {
  return value === null ? '未知' : `${NUMBER_FORMAT.format(value / (1024 ** 3))} GiB`;
}

export function formatDate(value: string | null): string {
  return value === null ? '未知' : DATE_FORMAT.format(new Date(value));
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-2">
    <dt className="text-sm text-default-600">{label}</dt>
    <dd className="break-words text-base font-medium tabular-nums">{children}</dd>
  </div>;
}

function BasicInfo({ data }: { data: VPSData }) {
  const labels = { running: '运行中', stopped: '已停止', starting: '启动中', unknown: '未知' };
  return (
    <section className="border-b border-default-200 py-6" aria-labelledby="server-heading">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="server-heading" className="break-words text-xl font-semibold">
            {data.basic.hostname || '未知主机'}
          </h2>
          <p className="mt-1 break-words text-sm text-default-600">{data.basic.node_location}</p>
        </div>
        <Chip size="sm" radius="sm" variant="flat">运行状态：{labels[data.status.powerState]}</Chip>
      </div>
      <dl className="grid min-w-0 gap-5 sm:grid-cols-2">
        <Metric label="系统">{data.basic.os || '未知'}</Metric>
        <Metric label="IP 地址">
          {data.basic.ip_addresses.length ? data.basic.ip_addresses.map((ip) => (
            <span key={ip} className="block break-all">{ip}</span>
          )) : '未知'}
        </Metric>
      </dl>
    </section>
  );
}

function TrafficInfo({ data }: { data: VPSData }) {
  const percent = data.resources.percentUsed;
  return (
    <section className="border-b border-default-200 py-6" aria-labelledby="traffic-heading">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="traffic-heading" className="text-lg font-semibold">流量配额</h2>
        <Chip size="sm" radius="sm" variant="flat"
          color={percent !== null && percent >= 80 ? 'danger' : 'primary'}>
          {percent === null ? '比例未知' : `${NUMBER_FORMAT.format(percent)}%`}
        </Chip>
      </div>
      {percent !== null ? <Progress aria-label="流量使用进度"
        aria-valuetext={`已使用 ${NUMBER_FORMAT.format(percent)}%`}
        value={Math.min(100, Math.max(0, percent))} size="sm"
        color={percent >= 80 ? 'danger' : 'primary'} /> : null}
      <dl className="mt-5 grid gap-5 sm:grid-cols-2 md:grid-cols-3">
        <Metric label="已用流量">{formatBytes(data.resources.usedBytes)}</Metric>
        <Metric label="总配额">{formatBytes(data.resources.totalBytes)}</Metric>
        <Metric label="剩余配额">{formatBytes(data.resources.remainingBytes)}</Metric>
      </dl>
    </section>
  );
}

function CycleInfo({ data }: { data: VPSData }) {
  const days = data.status.daysRemaining;
  return (
    <section className="border-b border-default-200 py-6" aria-label="配额周期">
      <dl className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
        <Metric label="重置时间（北京时间）">{formatDate(data.status.resetAt)}</Metric>
        <Metric label="剩余天数">{days === null ? '未知'
          : days < 0 ? `逾期 ${Math.abs(days)} 天` : `${days} 天`}</Metric>
        <Metric label={data.status.averageIsEstimate ? '估算日均' : '日均使用'}>
          {formatBytes(data.status.dailyAverageBytes)}
        </Metric>
      </dl>
    </section>
  );
}

export function VPSOverview({ data }: { data: VPSData | null }) {
  if (!data) return <div role="status" className="border-y border-default-200 py-8">
    尚未取得有效数据。
  </div>;
  return <>
    {data.status.suspended ? <p role="alert" className="my-4 text-sm text-danger">
      服务商已暂停此 VPS。
    </p> : null}
    {data.status.policy_violation ? <p role="alert" className="my-4 text-sm text-danger">
      服务商报告了使用政策违规，请检查控制台。
    </p> : null}
    <BasicInfo data={data} />
    <TrafficInfo data={data} />
    <CycleInfo data={data} />
  </>;
}
