import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/vps/events/route';
import { readActionEvents } from '@/lib/server/action-events';
import { getProviderAudit } from '@/lib/server/provider-audit';
import type { AuditEvent } from '@/types/audit';

vi.mock('@/lib/server/security', () => ({
  assertRequestAccess: vi.fn().mockResolvedValue({ isLocal: true }),
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  SecurityError: class extends Error {},
}));
vi.mock('@/lib/server/action-events', () => ({ readActionEvents: vi.fn() }));
vi.mock('@/lib/server/provider-audit', () => ({ getProviderAudit: vi.fn() }));

const panel: AuditEvent = {
  id: 'panel:event', observedAt: '2026-10-05T12:00:00.000Z',
  occurredAt: '2026-10-05T12:00:00.000Z', source: 'panel', action: 'restart',
  outcome: 'unknown', message: '结果未知。', requestId: 'event',
};
const provider: AuditEvent = { ...panel, id: 'provider:event', source: 'provider',
  occurredAt: '2026-10-05T11:00:00.000Z', outcome: 'recorded', requestId: null };

function request(body: unknown = { veid: '123' }) {
  return new Request('http://localhost/api/vps/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv('BWG_VEID', '123');
  vi.stubEnv('BWG_API_KEY', 'secret-provider-key');
  vi.mocked(readActionEvents).mockResolvedValue({
    events: [panel], available: true, warning: null,
  });
  vi.mocked(getProviderAudit).mockResolvedValue({ events: [provider], warning: null });
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('protected combined event history', () => {
  it('merges the fixed target sources chronologically without returning credentials', async () => {
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      events: [panel, provider], panelHistoryAvailable: true, warning: null,
    });
    expect(readActionEvents).toHaveBeenCalledWith('123');
    expect(getProviderAudit).toHaveBeenCalledWith({ veid: '123', apiKey: 'secret-provider-key' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(JSON.stringify(body)).not.toContain('secret-provider-key');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('keeps panel events and a sanitized warning when the provider fails', async () => {
    vi.mocked(getProviderAudit).mockRejectedValue(new Error('secret-provider-key'));
    const response = await POST(request());
    const body = await response.json();
    expect(body.events).toEqual([panel]);
    expect(body.warning).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain('secret-provider-key');
  });

});

describe('panel history availability and bounds', () => {
  it('keeps provider events when shared panel persistence is unavailable', async () => {
    vi.mocked(readActionEvents).mockResolvedValue({
      events: [], available: false, warning: '记录暂不可用。',
    });
    const body = await (await POST(request())).json();
    expect(body).toMatchObject({ events: [provider], panelHistoryAvailable: false,
      warning: '记录暂不可用。' });
  });

  it('rejects a substituted target before reading either event source', async () => {
    const response = await POST(request({ veid: '456' }));
    expect(response.status).toBe(400);
    expect(readActionEvents).not.toHaveBeenCalled();
    expect(getProviderAudit).not.toHaveBeenCalled();
  });

  it('retains both bounded sources without truncating one behind the other', async () => {
    const panelEvents = Array.from({ length: 200 }, (_, index) => ({
      ...panel, id: `panel:${index}`,
    }));
    const providerEvents = Array.from({ length: 200 }, (_, index) => ({
      ...provider, id: `provider:${index}`,
    }));
    vi.mocked(readActionEvents).mockResolvedValue({
      events: panelEvents, available: true, warning: null,
    });
    vi.mocked(getProviderAudit).mockResolvedValue({ events: providerEvents, warning: null });
    const body = await (await POST(request())).json();
    expect(body.events).toHaveLength(400);
    const providerRows = body.events.filter((event: AuditEvent) => event.source === 'provider');
    const panelRows = body.events.filter((event: AuditEvent) => event.source === 'panel');
    expect(providerRows).toHaveLength(200);
    expect(panelRows).toHaveLength(200);
  });
});
