import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HeroUIProvider } from '@heroui/react';
import { expect, test, vi } from 'vitest';
import { VPSCard } from './index';
import { ConnectionExitButton } from './ConnectionExitButton';
import { CREDENTIALS, dataFixture } from './testHelpers';

test('browser mode disconnects locally without login requests or deleting saved credentials',
  async () => {
  const saved = JSON.stringify(CREDENTIALS);
  localStorage.setItem('vps_credentials_v2', saved);
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const disconnected = vi.fn();
  render(<HeroUIProvider disableAnimation><ConnectionExitButton authEnabled={false}
    onDisconnected={disconnected} onError={vi.fn()} /></HeroUIProvider>);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '断开连接' }));
  });
  expect(disconnected).toHaveBeenCalledOnce();
  expect(fetcher).not.toHaveBeenCalled();
  expect(localStorage.getItem('vps_credentials_v2')).toBe(saved);
  expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument();
});

test('protected mode retains the existing logout control', () => {
  render(<HeroUIProvider disableAnimation><ConnectionExitButton authEnabled
    onDisconnected={vi.fn()} onError={vi.fn()} /></HeroUIProvider>);
  expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '断开连接' })).not.toBeInTheDocument();
});

test('browser-only panel connects with manually entered credentials and persists by default',
  async () => {
  localStorage.clear();
  const fetcher = vi.fn().mockImplementation(async () => Response.json(dataFixture()));
  vi.stubGlobal('fetch', fetcher);
  render(<HeroUIProvider disableAnimation><VPSCard authEnabled={false} /></HeroUIProvider>);
  fireEvent.change(screen.getByLabelText('VEID'), { target: { value: CREDENTIALS.veid } });
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: CREDENTIALS.apiKey } });
  fireEvent.submit(screen.getByRole('button', { name: '验证并连接' }).closest('form')!);
  await screen.findByRole('button', { name: '断开连接' });
  await waitFor(() => expect(localStorage.getItem('vps_credentials_v2'))
    .toBe(JSON.stringify(CREDENTIALS)));
  expect(fetcher.mock.calls[0][0]).toBe('/api/vps/info');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject(CREDENTIALS);
  expect(fetcher.mock.calls.some(([path]) => String(path).startsWith('/api/auth/'))).toBe(false);
  expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '断开连接' }));
  });
  expect(screen.getByRole('button', { name: '使用保存的配置' })).toBeInTheDocument();
  expect(screen.getByLabelText('VEID')).toHaveValue('');
  expect(screen.getByLabelText('API Key')).toHaveValue('');
  const requests = fetcher.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '使用保存的配置' }));
  expect(screen.getByLabelText('VEID')).toHaveValue(CREDENTIALS.veid);
  expect(screen.getByLabelText('API Key')).toHaveValue(CREDENTIALS.apiKey);
  expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
  expect(fetcher).toHaveBeenCalledTimes(requests);
});
