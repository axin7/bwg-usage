import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { HeroUIProvider } from '@heroui/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { fetchVPSData, performVPSAction } from '@/lib/api';
import { fetchAuditHistory, fetchTrafficHistory } from '@/lib/dashboard-api';
import type { TrafficHistoryData } from '@/types/dashboard';
import type { AuditData } from '@/types/audit';
import type { VPSSystemData } from '@/types/resources';
import { VPSCard } from './index';
import { SystemOverview } from './SystemOverview';
import { useInitialLiveResources } from './useInitialLiveResources';
import { useVPSController } from './useVPSController';
import { useSessionAudit } from './useSessionAudit';
import type { ActionResult } from './actionState';
import { dataFixture, prepareControllerTest } from './testHelpers';

vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(),
  fetchVPSData: vi.fn(), performVPSAction: vi.fn(),
}));
vi.mock('@/lib/dashboard-api', () => ({
  fetchTrafficHistory: vi.fn(), fetchAuditHistory: vi.fn(),
}));
vi.mock('./TrafficChart', () => ({ TrafficChart: () => <div>采样图表</div> }));

const SYSTEM: VPSSystemData = {
  planRamBytes: 1024 ** 3, planSwapBytes: 0, planDiskBytes: 20 * 1024 ** 3,
  availableRamBytes: 0, swapTotalBytes: 0, swapAvailableBytes: 0, mappedDiskBytes: null,
  loadAverage: [0, 1, 2], cpuThrottled: false, diskThrottled: null,
  observedAt: '2026-10-04T23:00:00.000Z', live: true,
};
const TRAFFIC: TrafficHistoryData = {
  range: '7d', source: 'provider', unit: 'bytes', semantics: 'raw-samples',
  observedAt: '2026-10-05T00:00:00.000Z', availableFrom: '2026-10-04T22:00:00.000Z',
  availableTo: '2026-10-04T22:00:00.000Z', warning: '原始采样口径尚未确认。',
  points: [{ timestamp: '2026-10-04T22:00:00.000Z', receivedBytes: 0, sentBytes: null,
    intervalSeconds: null, gapBefore: false }],
};
const AUDIT: AuditData = {
  observedAt: '2026-10-05T00:00:00.000Z', panelHistoryAvailable: false, warning: null,
  events: [{ id: 'provider-1', source: 'provider', occurredAt: null,
    observedAt: '2026-10-05T00:00:00.000Z', action: 'restart', outcome: 'recorded',
    message: '记录内容', requestId: null }],
};

beforeEach(() => {
  prepareControllerTest();
  vi.mocked(fetchVPSData).mockReset().mockResolvedValue(dataFixture());
  vi.mocked(performVPSAction).mockReset();
  vi.mocked(fetchTrafficHistory).mockReset().mockResolvedValue(TRAFFIC);
  vi.mocked(fetchAuditHistory).mockReset().mockResolvedValue(AUDIT);
});

test('history tabs load their data only on selection and preserve the server target', async () => {
  render(<HeroUIProvider disableAnimation><VPSCard serverVEID="2468" /></HeroUIProvider>);
  await act(async () => {});
  expect(screen.getByRole('tab', { name: '总览' })).toHaveAttribute('aria-selected', 'true');
  expect(fetchTrafficHistory).not.toHaveBeenCalled();
  expect(fetchAuditHistory).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole('tab', { name: '流量趋势' }));
    await import('./TrafficHistory'); await import('./TrafficChart');
  });
  expect(fetchTrafficHistory).toHaveBeenCalledWith({ veid: '2468', apiKey: '' }, '7d',
    expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(screen.getByText('原始网络统计')).toBeInTheDocument();
  expect(screen.getByText(/可用采样/)).toHaveTextContent('2026/10/05 06:00');
  expect(screen.getByRole('button', { name: '导出 CSV' })).toBeEnabled();
  expect(screen.getAllByText('0 B').length).toBeGreaterThan(0);
  await act(async () => {
    fireEvent.click(screen.getByRole('tab', { name: '操作记录' })); await import('./AuditHistory');
  });
  expect(fetchAuditHistory).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('heading', { name: '重启' })).toBeInTheDocument();
  expect(screen.getByText('发生时间未知', { exact: false })).toBeInTheDocument();
  expect(screen.getByText('记录内容')).toBeInTheDocument();
  expect(screen.getByText(/面板跨会话记录当前不可用/)).toBeInTheDocument();
  expect(performVPSAction).not.toHaveBeenCalled();
});

test('resource display preserves zero, unknown metrics and live timestamps', () => {
  render(<HeroUIProvider disableAnimation><SystemOverview system={SYSTEM}
    reading={false} disabled={false} onRefresh={vi.fn()} /></HeroUIProvider>);
  expect(screen.getByText('0 / 1 / 2')).toBeInTheDocument();
  expect(screen.getByText('映射磁盘容量')).toBeInTheDocument();
  expect(screen.getByText('可用内存').nextElementSibling).toHaveTextContent('0 GiB');
  expect(screen.getByText('映射磁盘容量').nextElementSibling).toHaveTextContent('未知');
  expect(screen.getByText(/实时采集/)).toHaveTextContent('2026/10/05 07:00');
  expect(screen.getByText('实时数据已过期')).toBeInTheDocument();
});

test('live resource failures are bounded to one attempt per five minutes and pause inactive views',
  async () => {
    vi.mocked(fetchVPSData).mockImplementation(async (credentials, options) => {
      if (credentials.veid !== '2468') throw new Error('Wrong target');
      if (options?.live) throw new Error('Resource request failed');
      return dataFixture();
    });
    const { rerender } = renderHook(({ active }) => {
      const controller = useVPSController('2468');
      useInitialLiveResources(controller, active);
    }, { initialProps: { active: true } });
    await act(async () => {});
    const liveCalls = () => vi.mocked(fetchVPSData).mock.calls
      .filter(([, options]) => options?.live).length;
    expect(liveCalls()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(299_000); });
    expect(liveCalls()).toBe(1);
    rerender({ active: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(liveCalls()).toBe(1);
    rerender({ active: true });
    await act(async () => {});
    expect(liveCalls()).toBe(2);
  });

test('session audit retains successive commands and updates accepted receipts after verification',
  async () => {
    const receipt: ActionResult = { target: { action: 'stop', veid: '2468', hostname: 'vps' },
      outcome: 'accepted', requestId: 'accepted-1', message: '已受理' };
    const initial: { current: ActionResult | null } = { current: receipt };
    const { result, rerender } = renderHook(({ current }: { current: ActionResult | null }) =>
      useSessionAudit(current, '2468'), { initialProps: initial });
    await act(async () => {});
    const firstId = result.current[0].id;
    rerender({ current: { ...receipt, outcome: 'verified', message: '已观察到停止状态' } });
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ id: firstId, action: 'stop', outcome: 'accepted',
      message: '已观察到停止状态' });
    rerender({ current: null });
    rerender({ current: { ...receipt, requestId: '', outcome: 'unknown', message: '结果未知' } });
    expect(result.current).toHaveLength(2);
    expect(result.current[0].outcome).toBe('unknown');
    rerender({ current: { ...receipt, target: { ...receipt.target, veid: '9999' } } });
    expect(result.current).toHaveLength(2);
  });

test('audit filters do not make another network request', async () => {
  render(<HeroUIProvider disableAnimation><VPSCard serverVEID="2468" /></HeroUIProvider>);
  await act(async () => {});
  await act(async () => {
    fireEvent.click(screen.getByRole('tab', { name: '操作记录' })); await import('./AuditHistory');
  });
  expect(screen.getByText('记录内容')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /记录结果/ })); });
  await act(async () => { fireEvent.click(screen.getByRole('option', { name: '已受理' })); });
  expect(screen.queryByText('记录内容')).not.toBeInTheDocument();
  expect(screen.getByText('没有符合筛选条件的记录。')).toBeInTheDocument();
  expect(fetchAuditHistory).toHaveBeenCalledTimes(1);
});

test('history persistence failures preserve accepted command results', async () => {
  vi.mocked(performVPSAction).mockResolvedValue({ action: 'start', accepted: true,
    requestId: 'accepted-command', historyWarning: '操作已受理，但面板历史暂未保存。' });
  render(<HeroUIProvider disableAnimation><VPSCard serverVEID="2468" /></HeroUIProvider>);
  await act(async () => {});
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '启动' })); await import('./ActionDialog');
  });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认启动' })); });
  expect(screen.getByText('操作已受理，但面板历史暂未保存。')).toBeInTheDocument();
  expect(screen.getByText('请求编号：accepted-command')).toBeInTheDocument();
  expect(screen.getByText(/服务商已接收启动请求/)).toBeInTheDocument();
});
