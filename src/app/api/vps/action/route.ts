import type { ActionReceipt } from '@/types';
import { submitVPSAction } from '@/lib/server/provider';
import { runRoute } from '@/lib/server/route-handler';
import { parseAction } from '@/lib/server/route-input';
import { resolveVPSCredentials } from '@/lib/server/vps-credentials';
import { recordActionEvent } from '@/lib/server/action-events';
import { RouteError } from '@/lib/server/route-error';

export function POST(request: Request): Promise<Response> {
  return runRoute(request, true, async (body, context) => {
    const action = parseAction(body);
    const credentials = resolveVPSCredentials(body);
    const event = { action, veid: credentials.veid, requestId: context.requestId,
      occurredAt: new Date().toISOString() };
    await recordActionEvent({ ...event, outcome: 'unknown' });
    try {
      await submitVPSAction(action, credentials, { signal: context.signal });
    } catch (error) {
      const outcome = error instanceof RouteError && error.outcome === 'rejected'
        ? 'rejected' : 'unknown';
      await recordActionEvent({ ...event, outcome });
      throw error;
    }
    const historyWarning = await recordActionEvent({ ...event, outcome: 'accepted' });
    return { action, accepted: true, requestId: context.requestId,
      ...(historyWarning ? { historyWarning } : {}) } satisfies ActionReceipt;
  });
}
