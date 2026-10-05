import { createHash } from 'node:crypto';
import type { VPSCredentials } from '@/types';
import type { AuditEvent } from '@/types/audit';
import { requestProvider, type ProviderOptions } from './provider-request';

const ACTIONS: Record<string, { action: string; message: string }> = {
  start: { action: 'start', message: '服务商记录了一次启动事件。' },
  stop: { action: 'stop', message: '服务商记录了一次停止事件。' },
  restart: { action: 'restart', message: '服务商记录了一次重启事件。' },
  reboot: { action: 'restart', message: '服务商记录了一次重启事件。' },
  snapshot: { action: 'snapshot', message: '服务商记录了一次快照事件。' },
  backup: { action: 'backup', message: '服务商记录了一次备份事件。' },
  migrate: { action: 'migrate', message: '服务商记录了一次迁移事件。' },
  reinstall: { action: 'reinstall', message: '服务商记录了一次系统重装事件。' },
  login: { action: 'login', message: '服务商记录了一次登录相关事件。' },
  api: { action: 'api', message: '服务商记录了一次 API 相关事件。' },
};
const UNKNOWN = { action: 'unknown', message: '未识别的服务商事件。' };
const SUMMARY_ACTIONS: Record<string, string> = {
  start: 'start', started: 'start', stop: 'stop', stopped: 'stop',
  restart: 'restart', restarted: 'restart', reboot: 'restart', rebooted: 'restart',
  snapshot: 'snapshot', reinstall: 'reinstall', login: 'login', api: 'api',
};
const SUMMARY_PATTERN = new RegExp('\\b(' + Object.keys(SUMMARY_ACTIONS).join('|') + ')\\b', 'gi');

export interface ProviderAudit {
  events: AuditEvent[];
  warning: string | null;
}

function summaryDescription(summary: string) {
  if (summary.length > 4_096) return UNKNOWN;
  const tokens = summary.match(SUMMARY_PATTERN) ?? [];
  const actions = new Set(tokens.map((token) => SUMMARY_ACTIONS[token.toLowerCase()]));
  if (actions.size !== 1) return UNKNOWN;
  return ACTIONS[[...actions][0]];
}

function actionDescription(row: Record<string, unknown>, actual: boolean) {
  if (actual && !Number.isSafeInteger(row.type)) return null;
  const value = actual ? row.summary : row.action;
  if (typeof value !== 'string' || (!actual && !value.trim())) return null;
  if (actual) return summaryDescription(value);
  const prefix = value.trim().toLowerCase().match(/^([a-z]+)(?:$|[\s:_./-])/);
  return prefix && Object.hasOwn(ACTIONS, prefix[1]) ? ACTIONS[prefix[1]] : UNKNOWN;
}

function auditEvent(
  value: unknown,
  index: number,
  observedAt: string,
  actual: boolean,
): AuditEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const description = actionDescription(row, actual);
  if (!description || typeof row.timestamp !== 'number' || !Number.isSafeInteger(row.timestamp)
    || row.timestamp < 0) return null;
  const at = new Date(row.timestamp * 1_000);
  if (!Number.isFinite(at.getTime()) || at.getTime() > Date.parse(observedAt) + 300_000) {
    return null;
  }
  const occurredAt = at.toISOString();
  const identity = JSON.stringify([occurredAt, description.action, index]);
  const id = createHash('sha256').update(identity).digest('hex').slice(0, 24);
  return { id: `provider:${id}`, observedAt, occurredAt, source: 'provider',
    ...description, outcome: 'recorded', requestId: null };
}

export function parseProviderAudit(raw: Record<string, unknown>, now = new Date()): ProviderAudit {
  const actual = Object.hasOwn(raw, 'log_entries');
  const entries = actual ? raw.log_entries : raw.log;
  if (!Array.isArray(entries)) {
    return { events: [], warning: '服务商操作记录结构无法识别，暂未显示。' };
  }
  if (entries.length > 50_000) {
    return { events: [],
      warning: '服务商操作记录超过安全处理范围，暂未显示。' };
  }
  const observedAt = now.toISOString();
  const events = entries
    .map((row, index) => auditEvent(row, index, observedAt, actual))
    .filter((event): event is AuditEvent => event !== null)
    .sort((left, right) => (right.occurredAt ?? '').localeCompare(left.occurredAt ?? ''));
  const warning = events.length !== entries.length || events.length > 200
    ? '部分服务商操作记录无法识别或超出展示范围，已省略。' : null;
  return { events: events.slice(0, 200), warning };
}

export async function getProviderAudit(
  credentials: VPSCredentials,
  options: ProviderOptions = {},
): Promise<ProviderAudit> {
  return parseProviderAudit(await requestProvider('getAuditLog', credentials, false, options));
}
