import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoginForm } from '@/components/LoginForm';

function submit() {
  const input = screen.getByLabelText('面板密码');
  fireEvent.change(input, { target: { value: 'integration-only-password' } });
  fireEvent.submit(input.closest('form')!);
}

describe('password login', () => {
  it('localizes native network failures without internal details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('internal-network-details')));
    render(<LoginForm />);
    submit();
    await screen.findByText('无法连接登录服务，请稍后重试。');
    expect(screen.queryByText(/internal-network-details/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeEnabled();
  });

  it('preserves a server rejection and never stores the password', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试。' },
    }, { status: 429 }));
    localStorage.clear();
    vi.stubGlobal('fetch', fetcher);
    render(<LoginForm />);
    submit();
    await screen.findByText('请求过于频繁，请稍后再试。');
    expect(localStorage.length).toBe(0);
    expect(fetcher.mock.calls[0][0]).toBe('/api/auth/login');
  });

  it('sends one request when the form is submitted twice before a response arrives', async () => {
    let resolve!: (response: Response) => void;
    const response = new Promise<Response>((accept) => { resolve = accept; });
    const fetcher = vi.fn().mockReturnValue(response);
    vi.stubGlobal('fetch', fetcher);
    render(<LoginForm />);
    submit();
    fireEvent.submit(screen.getByLabelText('面板密码').closest('form')!);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(Response.json({ error: { message: '密码不正确。' } }, { status: 401 }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('密码不正确。'));
  });
});
