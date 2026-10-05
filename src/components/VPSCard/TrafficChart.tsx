import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { TrafficPoint } from '@/types/dashboard';
import { formatDate } from './VPSOverview';
import { formatSampleBytes, trafficChartPoints } from './trafficPresentation';

const TICK_DATE = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit',
  minute: '2-digit', hour12: false,
});

export function TrafficChart({ points }: { points: TrafficPoint[] }) {
  return <div className="h-72 w-full min-w-0" aria-label="原始网络统计趋势图">
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <LineChart data={trafficChartPoints(points)} accessibilityLayer
        margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d4d4d8" />
        <XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']}
          scale="time" minTickGap={32} tick={{ fontSize: 12 }}
          tickFormatter={(value: number) => TICK_DATE.format(value)} />
        <YAxis width={70} tick={{ fontSize: 12 }}
          tickFormatter={(value: number) => formatSampleBytes(value)} />
        <Tooltip labelFormatter={(value) => formatDate(new Date(Number(value)).toISOString())}
          formatter={(value) => formatSampleBytes(value === undefined ? null : Number(value))} />
        <Legend />
        <Line type="linear" dataKey="receivedBytes" name="接收" stroke="#0072ce"
          connectNulls={false} dot={false} isAnimationActive={false} strokeWidth={2} />
        <Line type="linear" dataKey="sentBytes" name="发送" stroke="#bc5800"
          connectNulls={false} dot={false} isAnimationActive={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  </div>;
}
