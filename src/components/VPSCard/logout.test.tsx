import { act, fireEvent, render, screen } from '@testing-library/react';
import { HeroUIProvider } from '@heroui/react';
import { expect, test, vi } from 'vitest';
import { LogoutButton } from './LogoutButton';

test('successful logout clears memory then navigates without changing browser storage',
  async () => {
  localStorage.setItem('vps_credentials_v2', 'retained-placeholder');
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetcher);
  const disconnected = vi.fn();
  const navigate = vi.fn();
  render(<HeroUIProvider disableAnimation><LogoutButton onDisconnected={disconnected}
    onError={vi.fn()} navigate={navigate} /></HeroUIProvider>);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '退出登录' })); });
  expect(fetcher).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({
    method: 'POST', body: '{}',
  }));
  expect(disconnected).toHaveBeenCalledOnce();
  expect(navigate).toHaveBeenCalledOnce();
  expect(localStorage.getItem('vps_credentials_v2')).toBe('retained-placeholder');
  });

test('failed logout reports its request identifier and retains runtime connection', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: {
    code: 'SESSION_ERROR', message: '退出失败', requestId: 'logout-1',
  } }, { status: 503 })));
  const disconnected = vi.fn();
  const navigate = vi.fn();
  const error = vi.fn();
  render(<HeroUIProvider disableAnimation><LogoutButton onDisconnected={disconnected}
    onError={error} navigate={navigate} /></HeroUIProvider>);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '退出登录' })); });
  expect(error).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: 'logout-1' }));
  expect(disconnected).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});
