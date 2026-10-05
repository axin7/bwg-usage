import { useCallback, useEffect, useRef } from 'react';
import { ApiError, fetchVPSData, toApiError } from '@/lib/api';
import {
  clearSavedCredentials, loadSavedCredentials, persistCredentials, validateCredentials,
} from '@/lib/credentials';
import type { VPSCredentials } from '@/types';
import type { VPSSession } from './useVPSSession';
import type { VPSReadController } from './useVPSRead';

async function validateConfiguration(
  candidate: VPSCredentials, remember: boolean, session: VPSSession,
  controller: AbortController, reads: VPSReadController,
) {
  if (!validateCredentials(candidate)) {
    session.commit({ error: new ApiError({ code: 'INVALID_CREDENTIALS',
      message: '请输入数字 VEID 和有效的 API Key。', requestId: '' }) });
    return;
  }
  reads.pause();
  session.commit({ saving: true, error: null, notice: null });
  try {
    const data = await fetchVPSData(candidate, { signal: controller.signal });
    if (controller.signal.aborted) return;
    const notice = persistCredentials(candidate, remember);
    session.commit({ credentials: candidate, initialData: data, editing: false,
      revision: session.current.current.revision + 1, stored: null, reuse: null, notice });
  } catch (error) {
    if (!controller.signal.aborted) session.commit({ error: toApiError(error) });
  } finally {
    if (!controller.signal.aborted) session.commit({ saving: false });
  }
}

function disconnectSession(
  session: VPSSession, reads: VPSReadController, pending: AbortController | null,
) {
  pending?.abort();
  reads.invalidate();
  session.commit({ credentials: null, initialData: null, editing: true, saving: false,
    error: null, notice: null, stored: null, reuse: null,
    revision: session.current.current.revision + 1,
    formRevision: session.current.current.formRevision + 1 });
}

export function useVPSConfiguration(
  session: VPSSession, reads: VPSReadController, isManagementPending: () => boolean,
) {
  const { commit } = session;
  const pending = useRef<AbortController | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      const stored = loadSavedCredentials();
      commit({ stored, notice: stored.error });
    }
    return () => { pending.current?.abort(); };
  }, [commit]);
  const save = useCallback((candidate: VPSCredentials, remember: boolean) => {
    if (session.current.current.saving || session.current.current.serverConfigured
      || isManagementPending()) {
      return Promise.resolve();
    }
    const controller = new AbortController();
    pending.current = controller;
    return validateConfiguration(candidate, remember, session, controller, reads);
  }, [reads, session, isManagementPending]);
  const reset = useCallback(() => {
    disconnectSession(session, reads, pending.current);
    session.commit({ notice: clearSavedCredentials() });
  }, [reads, session]);
  const disconnect = () => disconnectSession(session, reads, pending.current);
  const edit = () => {
    if (session.current.current.serverConfigured || isManagementPending()) return;
    reads.pause();
    session.commit({ editing: true, error: null, reuse: null,
      formRevision: session.current.current.formRevision + 1 });
  };
  const cancel = () => {
    pending.current?.abort();
    session.commit({ editing: false, saving: false, error: null, reuse: null });
    if (!isManagementPending()) reads.resume();
  };
  const reuse = () => session.commit({ reuse: session.current.current.stored?.credentials ?? null,
    formRevision: session.current.current.formRevision + 1 });
  const removeSaved = () => session.commit({ stored: null, notice: clearSavedCredentials() });
  return { save, reset, disconnect, edit, cancel, reuse, removeSaved };
}
