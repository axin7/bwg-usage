import { fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { HeroUIProvider } from '@heroui/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { VPSCard } from './index';
import { CredentialsForm } from './CredentialsForm';
import { VPSOverview } from './VPSOverview';
import { CREDENTIALS, dataFixture } from './testHelpers';

beforeEach(() => { localStorage.clear(); });

function formProps() {
  return { initial: null, stored: null, saving: false, error: null, canCancel: false,
    onSubmit: vi.fn().mockResolvedValue(undefined), onCancel: vi.fn(),
    onReuse: vi.fn(), onRemoveSaved: vi.fn() };
}

test('server rendering includes useful configuration and no stored secret', () => {
  localStorage.setItem('vps_credentials', JSON.stringify(CREDENTIALS));
  const html = renderToString(<HeroUIProvider disableAnimation><VPSCard /></HeroUIProvider>);
  expect(html).toContain('VPS 控制面板');
  expect(html).toContain('name="veid"');
  expect(html).toContain('name="apiKey"');
  expect(html).not.toContain(CREDENTIALS.apiKey);
});

test('zero days and zero usage remain zero rather than becoming unknown', () => {
  const data = dataFixture();
  data.status.daysRemaining = 0;
  data.status.dailyAverageBytes = 0;
  data.resources = { totalBytes: 0, usedBytes: 0, remainingBytes: 0, percentUsed: null };
  render(<HeroUIProvider disableAnimation><VPSOverview data={data} /></HeroUIProvider>);
  expect(screen.getByText('0 天')).toBeInTheDocument();
  expect(screen.getAllByText('0 GiB')).toHaveLength(4);
  expect(screen.getByText('比例未知')).toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

test('over-quota percentage is truthful while progress geometry is clamped', () => {
  const data = dataFixture();
  data.resources.percentUsed = 120;
  render(<HeroUIProvider disableAnimation><VPSOverview data={data} /></HeroUIProvider>);
  expect(screen.getByText('120%')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '已使用 120%');
});

test('configuration defaults to browser persistence and keeps the API key masked', () => {
  const props = formProps();
  render(<HeroUIProvider disableAnimation><CredentialsForm {...props} />
  </HeroUIProvider>);
  expect(screen.getByRole('checkbox')).toBeChecked();
  expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
  fireEvent.change(screen.getByLabelText('VEID'), { target: { value: CREDENTIALS.veid } });
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: CREDENTIALS.apiKey } });
  fireEvent.submit(screen.getByRole('button', { name: '验证并连接' }).closest('form')!);
  expect(props.onSubmit).toHaveBeenCalledWith(CREDENTIALS, true);
});

test('configuration lets the user submit without retaining browser credentials', () => {
  const props = { ...formProps(), initial: CREDENTIALS };
  render(<HeroUIProvider disableAnimation><CredentialsForm {...props} />
  </HeroUIProvider>);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(screen.getByRole('button', { name: '验证并连接' }).closest('form')!);
  expect(props.onSubmit).toHaveBeenCalledWith(CREDENTIALS, false);
});

test('configuration validation errors retain entered values and an explicit persistence opt-out',
  () => {
    const props = formProps();
    const { rerender } = render(<HeroUIProvider disableAnimation>
      <CredentialsForm {...props} />
    </HeroUIProvider>);
    fireEvent.change(screen.getByLabelText('VEID'), { target: { value: '9999' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'candidate-secret' } });
    fireEvent.click(screen.getByRole('checkbox'));
    const error = new ApiError({ code: 'INVALID_KEY', message: '密钥无效', requestId: 'form-1' });
    rerender(<HeroUIProvider disableAnimation><CredentialsForm {...props} error={error} />
    </HeroUIProvider>);
    expect(screen.getByLabelText('VEID')).toHaveValue('9999');
    expect(screen.getByLabelText('API Key')).toHaveValue('candidate-secret');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent('form-1');
  });
