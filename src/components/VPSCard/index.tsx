'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import { Button, Chip } from '@heroui/react';
import { Pencil, Power, RefreshCw, RotateCw, Square, Trash2 } from 'lucide-react';
import type { ApiError } from '@/lib/api';
import { CredentialsForm } from './CredentialsForm';
import { ErrorMessage, IconButton } from './controls';
import { formatDate, VPSOverview } from './VPSOverview';
import { ACTION_LABELS } from './actionState';
import { useVPSController, type VPSController } from './useVPSController';
import { LogoutButton } from './LogoutButton';
import { DashboardTabs } from './DashboardTabs';
import { SystemOverview } from './SystemOverview';

const ActionDialog = lazy(() => import('./ActionDialog')
  .then((module) => ({ default: module.ActionDialog })));
const ResetDialog = lazy(() => import('./ActionDialog')
  .then((module) => ({ default: module.ResetDialog })));

function Toolbar({ controller, onReset }: { controller: VPSController; onReset: () => void }) {
  const { session, reads, configuration, actions } = controller;
  const [logoutError, setLogoutError] = useState<ApiError | null>(null);
  return (
    <>
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-semibold">VPS 控制面板</h1>
        {session.credentials ? <p className="mt-1 text-sm text-default-600">
          VEID {session.credentials.veid}
        </p> : null}
        {session.serverConfigured ? <p className="mt-1 text-sm text-default-600">
          服务端配置
        </p> : null}
      </div>
      <div className="flex shrink-0 gap-1">
        {session.credentials && !session.editing ? <>
          <IconButton label="刷新数据" loading={reads.reading}
            disabled={reads.offline || actions.pending !== null}
            onPress={() => { void reads.refresh(true); }}>
            <RefreshCw size={18} aria-hidden="true" />
          </IconButton>
          {!session.serverConfigured ? <IconButton label="修改配置"
            disabled={actions.pending !== null}
            onPress={() => { actions.close(); configuration.edit(); }}>
            <Pencil size={18} aria-hidden="true" />
          </IconButton> : null}
        </> : null}
        {!session.serverConfigured && (session.credentials || session.saving)
          ? <IconButton label="清除配置" onPress={onReset}>
          <Trash2 size={18} aria-hidden="true" />
        </IconButton> : null}
        {session.credentials ? <LogoutButton onDisconnected={() => {
          actions.close(); configuration.disconnect();
        }} onError={setLogoutError} /> : null}
      </div>
    </header>
    <ErrorMessage error={logoutError} />
    </>
  );
}

function ReadStatus({ controller }: { controller: VPSController }) {
  const { reads } = controller;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const stale = reads.stale || (reads.lastSuccess !== null
    && now - Date.parse(reads.lastSuccess) > 60_000);
  return (
    <div className="flex flex-wrap items-center gap-3 pb-4 text-sm text-default-600">
      <p>最后更新：{reads.lastSuccess ? formatDate(reads.lastSuccess) : '尚无数据'}</p>
      {reads.offline ? <Chip size="sm" radius="sm" color="warning" variant="flat">离线</Chip>
        : stale ? <Chip size="sm" radius="sm" color="warning" variant="flat">数据已过期</Chip> : null}
      <span role="status" aria-live="polite">{reads.reading ? '刷新中…' : ''}</span>
    </div>
  );
}

function ActionControls({ controller }: { controller: VPSController }) {
  const { actions, reads, session } = controller;
  const disabled = session.editing || reads.offline || actions.pending !== null;
  return (
    <section aria-label="服务器操作" className="grid grid-cols-1 gap-3 py-6 sm:grid-cols-3">
      <Button color="success" variant="flat" radius="sm" isDisabled={disabled}
        isLoading={actions.pending?.action === 'start'} onPress={() => actions.open('start')}
        startContent={<Power size={17} aria-hidden="true" />}>启动</Button>
      <Button color="danger" variant="flat" radius="sm" isDisabled={disabled}
        isLoading={actions.pending?.action === 'stop'} onPress={() => actions.open('stop')}
        startContent={<Square size={17} aria-hidden="true" />}>停止</Button>
      <Button color="warning" variant="flat" radius="sm" isDisabled={disabled}
        isLoading={actions.pending?.action === 'restart'} onPress={() => actions.open('restart')}
        startContent={<RotateCw size={17} aria-hidden="true" />}>重启</Button>
    </section>
  );
}

function ActionFeedback({ controller }: { controller: VPSController }) {
  const { pending, result } = controller.actions;
  return (
    <div role="status" aria-live="polite" className="space-y-2 break-words text-sm">
      {pending ? <p>正在向 {pending.hostname}（VEID {pending.veid}）提交
        {ACTION_LABELS[pending.action]}请求…</p> : null}
      {result ? <div className={`border-l-2 p-3 ${result.outcome === 'unknown'
        || result.outcome === 'rejected' ? 'border-warning' : 'border-success'}`}>
        <p className="font-medium">{result.target.hostname}（VEID {result.target.veid}）
          · {ACTION_LABELS[result.target.action]}</p>
        <p className="mt-1">{result.message}</p>
        {result.historyWarning ? <p className="mt-2 text-warning-700">
          {result.historyWarning}
        </p> : null}
        {result.requestId ? <p className="mt-1 text-default-600">
          请求编号：{result.requestId}
        </p> : null}
      </div> : null}
    </div>
  );
}

function SavedLocalConfiguration({ controller }: { controller: VPSController }) {
  if (!controller.session.serverConfigured || !controller.session.stored?.exists) return null;
  return <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
    <p>此浏览器中仍有保存的本地配置。</p>
    <Button size="sm" radius="sm" variant="light" color="danger"
      onPress={controller.configuration.removeSaved}
      startContent={<Trash2 size={15} aria-hidden="true" />}>清除本地配置</Button>
  </div>;
}

export function VPSCard({ serverVEID = null }: { serverVEID?: string | null } = {}) {
  const controller = useVPSController(serverVEID);
  const [resetOpen, setResetOpen] = useState(false);
  const { session, configuration, actions, reads } = controller;
  const reset = () => {
    actions.close(); configuration.reset(); setResetOpen(false);
  };
  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Toolbar controller={controller} onReset={() => setResetOpen(true)} />
      <SavedLocalConfiguration controller={controller} />
      {session.notice ? <p role="status" className="mb-4 break-words text-sm text-warning-700">
        {session.notice}
      </p> : null}
      {!session.serverConfigured && session.editing ? <CredentialsForm key={session.formRevision}
        initial={session.reuse ?? session.credentials} stored={session.stored}
        saving={session.saving} error={session.error} canCancel={session.credentials !== null}
        onSubmit={configuration.save} onCancel={configuration.cancel}
        onReuse={configuration.reuse} onRemoveSaved={configuration.removeSaved} /> : null}
      {session.credentials ? <div className={session.editing ? 'mt-6' : ''}>
        <ReadStatus controller={controller} />
        <DashboardTabs key={session.revision} controller={controller} overview={<>
          <VPSOverview data={reads.data} />
          <SystemOverview system={reads.data?.system} reading={reads.reading}
            disabled={session.editing || reads.offline || actions.pending !== null}
            onRefresh={() => { void reads.refresh(true); }} />
          <ActionControls controller={controller} />
        </>} />
        <ErrorMessage error={reads.error} />
      </div> : null}
      <ActionFeedback controller={controller} />
      <Suspense fallback={null}>
        {actions.dialog ? <ActionDialog target={actions.dialog}
          onClose={actions.close} onConfirm={actions.confirm} /> : null}
        {resetOpen ? <ResetDialog open onClose={() => setResetOpen(false)}
          onConfirm={reset} /> : null}
      </Suspense>
    </section>
  );
}
