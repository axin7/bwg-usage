'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@heroui/react';
import { LogIn } from 'lucide-react';

class LoginError extends Error {}

function errorMessage(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return '登录未完成，请稍后重试。';
  }
  const error = value.error;
  return typeof error === 'object' && error !== null && 'message' in error
    && typeof error.message === 'string' ? error.message : '登录未完成，请稍后重试。';
}

async function signIn(password: string): Promise<void> {
  const response = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }), signal: AbortSignal.timeout(10_000),
  });
  const result: unknown = await response.json();
  if (!response.ok) throw new LoginError(errorMessage(result));
  if (typeof result !== 'object' || result === null || !('ok' in result) || result.ok !== true) {
    throw new LoginError('登录响应无法识别。');
  }
}

export function LoginForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current) return;
    const password = new FormData(event.currentTarget).get('password');
    if (typeof password !== 'string' || !password) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await signIn(password);
      window.location.assign('/');
    } catch (failure) {
      setError(failure instanceof LoginError ? failure.message
        : failure instanceof DOMException && failure.name === 'TimeoutError'
          ? '登录请求超时，请稍后重试。' : '无法连接登录服务，请稍后重试。');
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return <form onSubmit={(event) => { void submit(event); }} className="space-y-5">
    <div className="space-y-2">
      <label htmlFor="password" className="text-sm font-medium">面板密码</label>
      <input id="password" name="password" type="password" required maxLength={1024}
        autoComplete="current-password" disabled={pending} aria-describedby="login-error"
        className="h-11 w-full rounded-md border border-default-300 bg-white px-3 text-base
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
    </div>
    <p id="login-error" role="alert" className="break-words text-sm text-danger">{error}</p>
    <Button type="submit" color="primary" radius="sm" isLoading={pending}
      startContent={<LogIn size={18} aria-hidden="true" />}>登录</Button>
  </form>;
}
