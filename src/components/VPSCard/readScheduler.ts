import { fetchVPSData, toApiError, type ApiError } from '@/lib/api';
import type { VPSCredentials, VPSData } from '@/types';
import type { VPSSystemData } from '@/types/resources';

export interface ReadSnapshot {
  data: VPSData | null;
  error: ApiError | null;
  reading: boolean;
  lastSuccess: string | null;
  offline: boolean;
  stale: boolean;
}

export const EMPTY_READ: ReadSnapshot = {
  data: null, error: null, reading: false, lastSuccess: null, offline: false, stale: false,
};

export interface ReadRuntime {
  credentials: VPSCredentials;
  update: (patch: Partial<ReadSnapshot>) => void;
  timer: ReturnType<typeof setTimeout> | null;
  controller: AbortController | null;
  pending: Promise<VPSData | null> | null;
  disposed: boolean;
  blocked: boolean;
  sequence: number;
  failures: number;
  lastLiveSystem: VPSSystemData | null;
}

export function available(): boolean {
  return navigator.onLine && document.visibilityState !== 'hidden';
}

export function clearReadTimer(runtime: ReadRuntime): void {
  if (runtime.timer !== null) clearTimeout(runtime.timer);
  runtime.timer = null;
}

export function cancelRead(runtime: ReadRuntime): void {
  clearReadTimer(runtime);
  runtime.sequence += 1;
  runtime.controller?.abort();
  runtime.controller = null;
  runtime.pending = null;
  if (!runtime.disposed) runtime.update({ reading: false });
}

export function scheduleRead(runtime: ReadRuntime): void {
  clearReadTimer(runtime);
  if (runtime.disposed || runtime.blocked || !available()) return;
  const delay = Math.min(30_000 * (2 ** runtime.failures), 300_000);
  runtime.timer = setTimeout(() => { void readData(runtime); }, delay);
}

function settleRead(
  runtime: ReadRuntime, sequence: number, data: VPSData | null, error?: unknown,
): void {
  if (runtime.disposed || sequence !== runtime.sequence) return;
  if (data) {
    if (data.system?.live) runtime.lastLiveSystem = data.system;
    else if (data.system && runtime.lastLiveSystem) {
      data = { ...data, system: { ...runtime.lastLiveSystem,
        planRamBytes: data.system.planRamBytes, planSwapBytes: data.system.planSwapBytes,
        planDiskBytes: data.system.planDiskBytes } };
    }
    runtime.failures = 0;
    runtime.update({ data, error: null, lastSuccess: new Date().toISOString(), stale: false });
  } else if (error && !(error instanceof DOMException && error.name === 'AbortError')) {
    runtime.failures = Math.min(runtime.failures + 1, 4);
    runtime.update({ error: toApiError(error), stale: true });
  }
}

async function executeRead(
  runtime: ReadRuntime, sequence: number, controller: AbortController, live: boolean,
): Promise<VPSData | null> {
  try {
    const data = await fetchVPSData(runtime.credentials, { signal: controller.signal, live });
    if (runtime.disposed || sequence !== runtime.sequence) return null;
    settleRead(runtime, sequence, data);
    return data;
  } catch (error) {
    settleRead(runtime, sequence, null, error);
    return null;
  } finally {
    if (!runtime.disposed && sequence === runtime.sequence) {
      runtime.pending = null;
      runtime.controller = null;
      runtime.update({ reading: false });
      scheduleRead(runtime);
    }
  }
}

export function readData(runtime: ReadRuntime, live = false): Promise<VPSData | null> {
  if (runtime.disposed || (!live && runtime.blocked) || !available()) {
    return Promise.resolve(null);
  }
  if (runtime.pending) return runtime.pending;
  clearReadTimer(runtime);
  const controller = new AbortController();
  runtime.controller = controller;
  const sequence = ++runtime.sequence;
  runtime.update({ reading: true, error: null, offline: false });
  runtime.pending = executeRead(runtime, sequence, controller, live);
  return runtime.pending;
}

export function createReadRuntime(
  credentials: VPSCredentials, update: ReadRuntime['update'],
): ReadRuntime {
  return {
    credentials, update, timer: null, controller: null, pending: null,
    disposed: false, blocked: false, sequence: 0, failures: 0, lastLiveSystem: null,
  };
}

export function subscribeReadRuntime(runtime: ReadRuntime): () => void {
  const updateAvailability = () => {
    if (runtime.disposed) return;
    runtime.update({ offline: !navigator.onLine, ...(!navigator.onLine ? { stale: true } : {}) });
    if (available()) void readData(runtime);
    else clearReadTimer(runtime);
  };
  document.addEventListener('visibilitychange', updateAvailability);
  window.addEventListener('online', updateAvailability);
  window.addEventListener('offline', updateAvailability);
  window.addEventListener('focus', updateAvailability);
  return () => {
    runtime.disposed = true;
    cancelRead(runtime);
    document.removeEventListener('visibilitychange', updateAvailability);
    window.removeEventListener('online', updateAvailability);
    window.removeEventListener('offline', updateAvailability);
    window.removeEventListener('focus', updateAvailability);
  };
}
