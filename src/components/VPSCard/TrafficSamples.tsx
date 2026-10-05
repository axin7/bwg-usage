import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { TrafficPoint } from '@/types/dashboard';
import { IconButton } from './controls';
import { formatDate } from './VPSOverview';
import { formatSampleBytes } from './trafficPresentation';

const PAGE_SIZE = 20;

export function TrafficSamples({ points }: { points: TrafficPoint[] }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(points.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = [...points].reverse().slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  return <details className="mt-6 border-t border-default-200 py-4">
    <summary className="cursor-pointer text-sm font-medium">采样记录（{points.length} 条）</summary>
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[580px] text-left text-sm">
        <caption className="sr-only">原始网络统计采样，时间为北京时间</caption>
        <thead className="border-b border-default-200 text-default-600">
          <tr>{['采样时间', '接收', '发送', '间隔', '数据状态'].map((label) =>
            <th key={label} scope="col" className="px-2 py-3 font-medium">{label}</th>)}</tr>
        </thead>
        <tbody>{rows.map((point) => <tr key={point.timestamp}
          className="border-b border-default-100 tabular-nums">
          <td className="px-2 py-3">{formatDate(point.timestamp)}</td>
          <td className="px-2 py-3">{formatSampleBytes(point.receivedBytes)}</td>
          <td className="px-2 py-3">{formatSampleBytes(point.sentBytes)}</td>
          <td className="px-2 py-3">
            {point.intervalSeconds === null ? '未知' : `${point.intervalSeconds} 秒`}
          </td>
          <td className="px-2 py-3">{point.gapBefore ? '间隔变化'
            : point.receivedBytes === null || point.sentBytes === null ? '部分缺失' : '已记录'}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="mt-3 flex items-center justify-end gap-2">
      <IconButton label="上一页采样" disabled={current === 0}
        onPress={() => setPage(current - 1)}>
        <ChevronLeft size={18} aria-hidden="true" />
      </IconButton>
      <span className="min-w-16 text-center text-sm tabular-nums">{current + 1} / {pages}</span>
      <IconButton label="下一页采样" disabled={current + 1 === pages}
        onPress={() => setPage(current + 1)}>
        <ChevronRight size={18} aria-hidden="true" />
      </IconButton>
    </div>
  </details>;
}
