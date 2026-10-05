import { Chip } from '@heroui/react';
import type { ApiError } from '@/lib/api';
import { ErrorMessage } from './controls';
import { formatDate } from './VPSOverview';

export function HistoryStatus({ observedAt, reading, stale, blocked, error, warning }: {
  observedAt: string | null; reading: boolean; stale: boolean; blocked: boolean;
  error: ApiError | null; warning?: string | null;
}) {
  const expired = stale || (observedAt !== null
    && Date.now() - Date.parse(observedAt) > 900_000);
  return <div className="space-y-3 py-4 text-sm">
    <div className="flex min-h-6 flex-wrap items-center gap-3 text-default-600">
      <p>读取时间：{observedAt ? formatDate(observedAt) : '尚无数据'}（北京时间）</p>
      {expired ? <Chip size="sm" radius="sm" variant="flat" color="warning">
        数据已过期
      </Chip> : null}
      <span role="status" aria-live="polite">
        {reading ? '读取中…' : blocked ? '数据读取已暂停。' : ''}
      </span>
    </div>
    {warning ? <p className="break-words border-l-2 border-warning p-3 text-warning-700">
      {warning}
    </p> : null}
    <ErrorMessage error={error} />
  </div>;
}
