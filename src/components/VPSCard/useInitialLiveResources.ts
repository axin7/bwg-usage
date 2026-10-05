import { useEffect, useRef, useState } from 'react';
import type { VPSController } from './useVPSController';

export function useInitialLiveResources(controller: VPSController, active: boolean) {
  const { session, reads, actions } = controller;
  const attempted = useRef<{ scope: string; at: number } | null>(null);
  const [clockRevision, setClockRevision] = useState(0);
  const scope = `${session.credentials?.veid}:${session.revision}`;
  const ready = reads.data !== null;
  const observedAt = reads.data?.system?.live ? reads.data.system.observedAt : null;
  const { reading, refresh } = reads;
  const blocked = session.editing || reads.offline || actions.pending !== null;
  useEffect(() => {
    const visible = () => setClockRevision((previous) => previous + 1);
    const timer = setInterval(visible, 30_000);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer); document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  useEffect(() => {
    if (!active || !ready || reading || blocked
      || document.visibilityState !== 'visible') return;
    const lastAttempt = attempted.current?.scope === scope ? attempted.current.at : -Infinity;
    const lastObserved = observedAt === null ? -Infinity : Date.parse(observedAt);
    if (Date.now() - Math.max(lastAttempt, lastObserved) < 300_000) return;
    attempted.current = { scope, at: Date.now() };
    void refresh(true);
  }, [active, ready, observedAt, reading, refresh, blocked, scope, clockRevision]);
}
