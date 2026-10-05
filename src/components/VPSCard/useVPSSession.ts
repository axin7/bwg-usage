import { useCallback, useRef, useState } from 'react';
import type { ApiError } from '@/lib/api';
import type { SavedCredentials } from '@/lib/credentials';
import type { VPSCredentials, VPSData } from '@/types';

export interface SessionState {
  serverConfigured: boolean;
  credentials: VPSCredentials | null;
  initialData: VPSData | null;
  revision: number;
  editing: boolean;
  saving: boolean;
  error: ApiError | null;
  notice: string | null;
  stored: SavedCredentials | null;
  reuse: VPSCredentials | null;
  formRevision: number;
}

const INITIAL_SESSION: SessionState = {
  serverConfigured: false,
  credentials: null, initialData: null, revision: 0, editing: true, saving: false,
  error: null, notice: null, stored: null, reuse: null, formRevision: 0,
};

export function useVPSSession(serverVEID: string | null = null) {
  const [state, setState] = useState<SessionState>(() => ({
    ...INITIAL_SESSION,
    serverConfigured: Boolean(serverVEID),
    credentials: serverVEID ? { veid: serverVEID, apiKey: '' } : null,
    editing: !serverVEID,
  }));
  const current = useRef(state);
  const commit = useCallback((patch: Partial<SessionState>) => {
    current.current = { ...current.current, ...patch };
    setState(current.current);
  }, []);
  return { state, current, commit };
}

export type VPSSession = ReturnType<typeof useVPSSession>;
