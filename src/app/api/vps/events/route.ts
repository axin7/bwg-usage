import type { AuditData } from '@/types/audit';
import { readActionEvents } from '@/lib/server/action-events';
import { getProviderAudit } from '@/lib/server/provider-audit';
import { runRoute } from '@/lib/server/route-handler';
import { resolveVPSCredentials } from '@/lib/server/vps-credentials';

export function POST(request: Request): Promise<Response> {
  return runRoute(request, false, async (body, context): Promise<AuditData> => {
    const credentials = resolveVPSCredentials(body);
    const [panel, provider] = await Promise.all([
      readActionEvents(credentials.veid),
      getProviderAudit(credentials, { signal: context.signal }).catch(() => ({
        events: [], warning: '服务商操作记录暂时无法获取。',
      })),
    ]);
    const events = [...panel.events, ...provider.events].sort((left, right) => {
      const leftAt = left.occurredAt ?? left.observedAt;
      const rightAt = right.occurredAt ?? right.observedAt;
      return rightAt.localeCompare(leftAt);
    });
    const warning = [panel.warning, provider.warning].filter(Boolean).join(' ') || null;
    return { events, observedAt: new Date().toISOString(),
      panelHistoryAvailable: panel.available, warning };
  });
}
