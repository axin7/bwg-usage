import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError, type ApiError } from '@/lib/api';

interface HistoryState<T> {
  scope: string;
  data: T | null;
  reading: boolean;
  error: ApiError | null;
  stale: boolean;
}

type HistoryLoader<T> = (signal: AbortSignal) => Promise<T>;
type RunningRead = { controller: AbortController; promise: Promise<void> };

function emptyState<T>(scope: string): HistoryState<T> {
  return { scope, data: null, reading: false, error: null, stale: false };
}

export function useDashboardHistory<T>(
  scope: string, active: boolean, blocked: boolean, load: HistoryLoader<T>,
) {
  const [state, setState] = useState<HistoryState<T>>(() => emptyState(scope));
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const running = useRef<RunningRead | null>(null);
  const refresh = useCallback((): Promise<void> => {
    if (!active || blocked || !visible) return Promise.resolve();
    if (running.current) return running.current.promise;
    const controller = new AbortController();
    setState((previous) => ({ ...(previous.scope === scope ? previous : emptyState<T>(scope)),
      reading: true, error: null }));
    const promise = load(controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ scope, data, reading: false,
        error: null, stale: false });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState((previous) => ({ ...previous, reading: false,
        error: toApiError(error), stale: previous.data !== null }));
    }).finally(() => {
      if (running.current?.controller === controller) running.current = null;
    });
    running.current = { controller, promise };
    return promise;
  }, [active, blocked, visible, load, scope]);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    if (active && !blocked && visible) void refresh();
    return () => {
      running.current?.controller.abort();
      running.current = null;
      setState((previous) => ({ ...previous, reading: false }));
    };
  }, [active, blocked, visible, refresh]);
  const current = state.scope === scope ? state : emptyState<T>(scope);
  return { ...current, refresh };
}
