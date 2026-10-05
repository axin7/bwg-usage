import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { ApiError, fetchVPSData, toApiError } from '@/lib/api';
import {
  clearSavedCredentials, loadSavedCredentials, persistCredentials, validateCredentials,
  preventCredentialRestore, shouldRestoreCredentials,
} from '@/lib/credentials';
import type { VPSCredentials } from '@/types';
import type { VPSSession } from './useVPSSession';
import type { VPSReadController } from './useVPSRead';

async function validateConfiguration(
  candidate: VPSCredentials, remember: boolean, session: Pick<VPSSession, 'current' | 'commit'>,
  controller: AbortController, reads: Pick<VPSReadController, 'pause'>, automatic = false,
) {
  if (!validateCredentials(candidate)) {
    session.commit({ error: new ApiError({ code: 'INVALID_CREDENTIALS',
      message: '请输入数字 VEID 和有效的 API Key。', requestId: '' }) });
    return;
  }
  reads.pause();
  session.commit({ saving: true, error: null, notice: null });
  try {
    const data = await fetchVPSData(candidate, {
      signal: controller.signal, ...(automatic ? { live: true } : {}),
    });
    if (controller.signal.aborted) return;
    const notice = automatic ? null : persistCredentials(candidate, remember);
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
  restoreSaved = false,
) {
  pending?.abort();
  reads.invalidate();
  const notice = preventCredentialRestore();
  const stored = restoreSaved ? loadSavedCredentials() : null;
  session.commit({ credentials: null, initialData: null, editing: true, saving: false,
    error: null, notice: notice ?? stored?.error ?? null, stored, reuse: null,
    revision: session.current.current.revision + 1,
    formRevision: session.current.current.formRevision + 1 });
}

function useSavedConfiguration(
  session: VPSSession, reads: VPSReadController,
  pending: RefObject<AbortController | null>,
) {
  const { current, commit } = session;
  const { pause } = reads;
  useEffect(() => {
    const stored = loadSavedCredentials();
    commit({ stored, notice: stored.error });
    const controller = new AbortController();
    pending.current = controller;
    // Delay the read until Strict Mode's first setup has been cleaned up.
    void Promise.resolve().then(() => {
      const state = current.current;
      if (controller.signal.aborted || state.serverConfigured || state.credentials || state.saving
        || !shouldRestoreCredentials(stored) || !stored.credentials) return;
      void validateConfiguration(stored.credentials, true, { current, commit }, controller,
        { pause }, true);
    });
    return () => { pending.current?.abort(); controller.abort(); };
  }, [commit, current, pause, pending]);
}

export function useVPSConfiguration(
  session: VPSSession, reads: VPSReadController, isManagementPending: () => boolean,
) {
  const pending = useRef<AbortController | null>(null);
  useSavedConfiguration(session, reads, pending);
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
  const disconnect = () => disconnectSession(session, reads, pending.current, true);
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
