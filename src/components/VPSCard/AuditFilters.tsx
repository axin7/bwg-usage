import { Select, SelectItem } from '@heroui/react';
import type { AuditEvent } from '@/types/audit';

export type AuditSource = 'all' | 'provider' | 'panel' | 'session';
export type AuditOutcome = 'all' | AuditEvent['outcome'];
const SOURCES = [
  { key: 'all', label: '全部来源' }, { key: 'provider', label: '服务商' },
  { key: 'panel', label: '面板历史' }, { key: 'session', label: '本次会话' },
];
const OUTCOMES = [
  { key: 'all', label: '全部结果' }, { key: 'recorded', label: '已记录' },
  { key: 'accepted', label: '已受理' }, { key: 'rejected', label: '已拒绝' },
  { key: 'unknown', label: '结果未知' },
];

export function filterAuditEvents(
  events: AuditEvent[], source: AuditSource, outcome: AuditOutcome,
) {
  return events.filter((event) => {
    const session = event.id.startsWith('session-panel-');
    const matchesSource = source === 'all' || (source === 'session' ? session
      : source === 'panel' ? event.source === 'panel' && !session : event.source === source);
    return matchesSource && (outcome === 'all' || event.outcome === outcome);
  });
}

export function AuditFilters({ source, outcome, onSourceChange, onOutcomeChange }: {
  source: AuditSource; outcome: AuditOutcome;
  onSourceChange: (source: AuditSource) => void; onOutcomeChange: (outcome: AuditOutcome) => void;
}) {
  return <div className="mt-5 grid max-w-lg grid-cols-2 gap-3">
    <Select aria-label="记录来源" size="sm" radius="sm" disallowEmptySelection
      selectedKeys={[source]} onSelectionChange={(keys) => {
        onSourceChange(String([...keys][0]) as AuditSource);
      }}>{SOURCES.map((item) => <SelectItem key={item.key}>{item.label}</SelectItem>)}</Select>
    <Select aria-label="记录结果" size="sm" radius="sm" disallowEmptySelection
      selectedKeys={[outcome]} onSelectionChange={(keys) => {
        onOutcomeChange(String([...keys][0]) as AuditOutcome);
      }}>{OUTCOMES.map((item) => <SelectItem key={item.key}>{item.label}</SelectItem>)}</Select>
  </div>;
}
