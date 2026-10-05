import { useCallback, useState } from 'react';
import { Chip } from '@heroui/react';
import { RefreshCw } from 'lucide-react';
import type { VPSCredentials } from '@/types';
import type { AuditEvent } from '@/types/audit';
import { fetchAuditHistory } from '@/lib/dashboard-api';
import { IconButton } from './controls';
import { HistoryStatus } from './HistoryStatus';
import { formatDate } from './VPSOverview';
import { useDashboardHistory } from './useDashboardHistory';
import {
  AuditFilters, filterAuditEvents, type AuditOutcome, type AuditSource,
} from './AuditFilters';

const OUTCOMES = { accepted: '已受理', rejected: '已拒绝', unknown: '结果未知', recorded: '已记录' };
const ACTION_NAMES: Record<string, string> = {
  start: '启动', stop: '停止', restart: '重启', snapshot: '快照', backup: '备份',
  migrate: '迁移', reinstall: '系统重装', unknown: '未知事件',
  login: '登录相关记录', api: 'API 访问记录',
};

export function mergeAuditEvents(remote: AuditEvent[], session: AuditEvent[]): AuditEvent[] {
  const storedIds = new Set(remote.filter((item) => item.source === 'panel' && item.requestId)
    .map((item) => item.requestId));
  const unsaved = session.filter((item) => !item.requestId || !storedIds.has(item.requestId));
  return [...remote, ...unsaved]
    .sort((first, second) => Date.parse(second.occurredAt ?? second.observedAt)
      - Date.parse(first.occurredAt ?? first.observedAt));
}

function AuditEntry({ event }: { event: AuditEvent }) {
  const session = event.id.startsWith('session-panel-');
  return <li className="space-y-3 border-b border-default-200 py-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="break-words font-medium">{ACTION_NAMES[event.action] ?? event.action}</h3>
        <p className="mt-1 text-xs text-default-600">
          {event.source === 'provider' ? '服务商' : session ? '本次会话' : '面板'} ·
          {event.occurredAt ? formatDate(event.occurredAt) : '发生时间未知'}
        </p>
      </div>
      <Chip size="sm" radius="sm" variant="flat"
        color={event.outcome === 'rejected' || event.outcome === 'unknown'
          ? 'warning' : 'default'}>
        {OUTCOMES[event.outcome]}
      </Chip>
    </div>
    <p className="break-words text-sm">{event.message}</p>
    {event.requestId ? <p className="break-all text-xs text-default-600">
      请求编号：{event.requestId}
    </p> : null}
  </li>;
}

export function AuditHistory({ credentials, revision, active, blocked, sessionEvents }: {
  credentials: VPSCredentials; revision: number; active: boolean; blocked: boolean;
  sessionEvents: AuditEvent[];
}) {
  const [source, setSource] = useState<AuditSource>('all');
  const [outcome, setOutcome] = useState<AuditOutcome>('all');
  const load = useCallback((signal: AbortSignal) => fetchAuditHistory(credentials, { signal }),
    [credentials]);
  const history = useDashboardHistory(`${credentials.veid}:${revision}`, active, blocked, load);
  const events = mergeAuditEvents(history.data?.events ?? [], sessionEvents);
  const filtered = filterAuditEvents(events, source, outcome);
  return <section className="min-w-0 py-4" aria-labelledby="audit-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="audit-heading" className="text-lg font-semibold">操作记录</h2>
      <IconButton label="刷新操作记录" loading={history.reading} disabled={blocked}
        onPress={() => { void history.refresh(); }}><RefreshCw size={18} aria-hidden="true" />
      </IconButton>
    </div>
    <HistoryStatus {...history} observedAt={history.data?.observedAt ?? null} blocked={blocked}
      warning={history.data?.warning} />
    <p className="text-sm text-default-600">已受理及服务商记录不代表操作已完成。时间为北京时间。</p>
    {history.data && !history.data.panelHistoryAvailable ? <p
      className="mt-3 text-sm text-default-600">
      面板跨会话记录当前不可用；本次会话记录仍可查看。
    </p> : null}
    <AuditFilters source={source} outcome={outcome}
      onSourceChange={setSource} onOutcomeChange={setOutcome} />
    {filtered.length ? <ol className="mt-2">{filtered.map((event) =>
      <AuditEntry key={event.id} event={event} />)}</ol>
      : <p role="status" className="min-h-64 py-12 text-sm text-default-600">
        {history.reading ? '正在读取操作记录…'
          : events.length ? '没有符合筛选条件的记录。'
            : history.data ? '暂无操作记录。' : '尚未取得操作记录。'}
      </p>}
  </section>;
}
