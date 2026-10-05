import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { HeroUIProvider } from '@heroui/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { fetchVPSData, performVPSAction } from '@/lib/api';
import { VPSCard } from './index';
import { useVPSController } from './useVPSController';
import { CREDENTIALS, dataFixture, prepareControllerTest } from './testHelpers';

vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(),
  fetchVPSData: vi.fn(), performVPSAction: vi.fn(),
}));

beforeEach(() => {
  prepareControllerTest();
  vi.mocked(fetchVPSData).mockReset().mockResolvedValue(dataFixture());
  vi.mocked(performVPSAction).mockReset();
});

test('server-mode SSR exposes only VEID and a useful shell without key or credential form', () => {
  localStorage.setItem('vps_credentials', JSON.stringify(CREDENTIALS));
  const html = renderToString(<HeroUIProvider disableAnimation>
    <VPSCard serverVEID="2468" />
  </HeroUIProvider>);
  expect(html).toContain('VPS 控制面板');
  expect(html).toContain('2468');
  expect(html).toContain('服务端配置');
  expect(html).not.toContain('name="apiKey"');
  expect(html).not.toContain(CREDENTIALS.apiKey);
  expect(html).not.toContain('修改配置');
  expect(html).not.toContain('清除配置');
});

test('server mode reads after mounting without restoring or persisting browser credentials',
  async () => {
    localStorage.setItem('vps_credentials', JSON.stringify(CREDENTIALS));
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useVPSController('2468'));
    await act(async () => {});
    expect(fetchVPSData).toHaveBeenCalledWith({ veid: '2468', apiKey: '' },
      expect.objectContaining({ live: false }));
    expect(result.current.session.serverConfigured).toBe(true);
    expect(result.current.session.credentials).toEqual({ veid: '2468', apiKey: '' });
    expect(result.current.session.editing).toBe(false);
    expect(writes).not.toHaveBeenCalled();
    expect(localStorage.getItem('vps_credentials')).not.toBeNull();
  });

test('server mode permits local cleanup without changing the server connection', async () => {
  localStorage.setItem('vps_credentials', JSON.stringify(CREDENTIALS));
  render(<HeroUIProvider disableAnimation><VPSCard serverVEID="2468" /></HeroUIProvider>);
  await act(async () => {});
  expect(screen.queryByRole('button', { name: '修改配置' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '清除配置' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '清除本地配置' }));
  expect(localStorage.getItem('vps_credentials')).toBeNull();
  expect(screen.getByText('VEID 2468')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '刷新数据' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument();
});

test('the lazy action dialog opens on demand and cancellation sends no power command',
  async () => {
    render(<HeroUIProvider disableAnimation><VPSCard serverVEID="2468" /></HeroUIProvider>);
    await act(async () => {});
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '停止' }));
      await import('./ActionDialog');
    });
    expect(screen.getByRole('dialog')).toHaveTextContent('VEID：2468');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(performVPSAction).not.toHaveBeenCalled();
  });

test('the localized close icon dismisses the lazy dialog without sending a command', async () => {
  render(<HeroUIProvider disableAnimation><VPSCard serverVEID="2468" /></HeroUIProvider>);
  await act(async () => {});
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    await import('./ActionDialog');
  });
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(performVPSAction).not.toHaveBeenCalled();
});
