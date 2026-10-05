import { useCallback, useEffect, useRef, useState } from 'react';
import type { VPSCredentials, VPSData } from '@/types';
import {
  cancelRead, createReadRuntime, EMPTY_READ, readData, scheduleRead,
  subscribeReadRuntime, type ReadRuntime,
} from './readScheduler';

export function useVPSRead(
  credentials: VPSCredentials | null, initialData: VPSData | null, revision: number,
) {
  const [snapshot, setSnapshot] = useState(EMPTY_READ);
  const runtime = useRef<ReadRuntime | null>(null);
  useEffect(() => {
    if (!credentials) { setSnapshot(EMPTY_READ); runtime.current = null; return; }
    const current = createReadRuntime(credentials, (patch) => {
      setSnapshot((previous) => ({ ...previous, ...patch }));
    });
    runtime.current = current;
    setSnapshot({ ...EMPTY_READ, data: initialData,
      lastSuccess: initialData ? new Date().toISOString() : null, offline: !navigator.onLine });
    const unsubscribe = subscribeReadRuntime(current);
    if (initialData) scheduleRead(current);
    else void readData(current);
    return unsubscribe;
  }, [credentials, initialData, revision]);
  const refresh = useCallback((live = false) => runtime.current
    ? readData(runtime.current, live) : Promise.resolve(null), []);
  const pause = useCallback(() => {
    if (runtime.current) { runtime.current.blocked = true; cancelRead(runtime.current); }
  }, []);
  const resume = useCallback(() => {
    if (runtime.current) { runtime.current.blocked = false; scheduleRead(runtime.current); }
  }, []);
  const invalidate = useCallback(() => {
    if (runtime.current) { runtime.current.disposed = true; cancelRead(runtime.current); }
  }, []);
  return { ...snapshot, refresh, pause, resume, invalidate };
}

export type VPSReadController = ReturnType<typeof useVPSRead>;
