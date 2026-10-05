export interface AuditEvent {
  id: string;
  observedAt: string;
  occurredAt: string | null;
  source: 'provider' | 'panel';
  action: string;
  outcome: 'accepted' | 'rejected' | 'unknown' | 'recorded';
  message: string;
  requestId: string | null;
}

export interface AuditData {
  events: AuditEvent[];
  observedAt: string;
  panelHistoryAvailable: boolean;
  warning: string | null;
}
