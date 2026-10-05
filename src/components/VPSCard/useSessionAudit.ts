import { useEffect, useRef, useState } from 'react';
import type { AuditEvent } from '@/types/audit';
import type { ActionResult } from './actionState';

export function useSessionAudit(result: ActionResult | null, veid: string) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const current = useRef<{ id: string; occurredAt: string } | null>(null);
  useEffect(() => {
    if (!result) { current.current = null; return; }
    if (result.target.veid !== veid) return;
    const now = new Date().toISOString();
    if (!current.current) current.current = {
      id: `session-panel-${crypto.randomUUID()}`, occurredAt: now,
    };
    const event: AuditEvent = {
      ...current.current, observedAt: now, source: 'panel',
      action: result.target.action,
      outcome: result.outcome === 'verified' ? 'accepted' : result.outcome,
      message: result.message, requestId: result.requestId || null,
    };
    setEvents((previous) => [event, ...previous.filter((item) => item.id !== event.id)]
      .slice(0, 100));
  }, [result, veid]);
  return events;
}
