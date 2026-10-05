import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/vps/action/route';
import { recordActionEvent } from '@/lib/server/action-events';
import { submitVPSAction } from '@/lib/server/provider';
import { RouteError } from '@/lib/server/route-error';

vi.mock('@/lib/server/security', () => ({
  assertRequestAccess: vi.fn().mockResolvedValue({ isLocal: true }),
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  SecurityError: class extends Error {},
}));
vi.mock('@/lib/server/provider', () => ({ submitVPSAction: vi.fn() }));
vi.mock('@/lib/server/action-events', () => ({ recordActionEvent: vi.fn() }));

function request() {
  return new Request('http://localhost/api/vps/action', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ veid: '123', action: 'restart' }),
  });
}

beforeEach(() => {
  vi.stubEnv('BWG_VEID', '123');
  vi.stubEnv('BWG_API_KEY', 'secret-provider-key');
  vi.mocked(submitVPSAction).mockResolvedValue(undefined);
  vi.mocked(recordActionEvent).mockResolvedValue(null);
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('management receipt and history isolation', () => {
  it('keeps an accepted provider result when history persistence is unavailable', async () => {
    vi.mocked(recordActionEvent).mockResolvedValue('面板记录暂不可用。');
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      accepted: true, action: 'restart', historyWarning: '面板记录暂不可用。',
    });
    expect(submitVPSAction).toHaveBeenCalledTimes(1);
    expect(recordActionEvent).toHaveBeenNthCalledWith(1, {
      veid: '123', action: 'restart', outcome: 'unknown', requestId: body.requestId,
      occurredAt: expect.any(String),
    });
    expect(recordActionEvent).toHaveBeenNthCalledWith(2, {
      veid: '123', action: 'restart', outcome: 'accepted', requestId: body.requestId,
      occurredAt: expect.any(String),
    });
    const calls = vi.mocked(recordActionEvent).mock.calls;
    expect(calls[0][0].occurredAt).toBe(calls[1][0].occurredAt);
    expect(JSON.stringify(vi.mocked(recordActionEvent).mock.calls))
      .not.toContain('secret-provider-key');
  });

  it.each(['rejected', 'unknown'] as const)('preserves a provider %s result', async (outcome) => {
    vi.mocked(submitVPSAction).mockRejectedValue(
      new RouteError(502, 'UPSTREAM_UNAVAILABLE', '服务商暂不可用。', outcome),
    );
    vi.mocked(recordActionEvent).mockResolvedValue('面板记录暂不可用。');
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.error.outcome).toBe(outcome);
    expect(recordActionEvent).toHaveBeenNthCalledWith(2, {
      veid: '123', action: 'restart', outcome, requestId: body.error.requestId,
      occurredAt: expect.any(String),
    });
    expect(submitVPSAction).toHaveBeenCalledTimes(1);
  });
});
