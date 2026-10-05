import type { VPSAction, VPSCredentials, VPSData } from '@/types';

export interface ActionTarget {
  action: VPSAction;
  veid: string;
  hostname: string;
}

export interface ActionSelection {
  target: ActionTarget;
  credentials: VPSCredentials;
  revision: number;
}

export interface ActionResult {
  target: ActionTarget;
  outcome: 'accepted' | 'verified' | 'unknown' | 'rejected';
  requestId: string;
  message: string;
  historyWarning?: string;
}

export const ACTION_LABELS: Record<VPSAction, string> = {
  start: '启动', stop: '停止', restart: '重启',
};

export function actionVerified(action: VPSAction, data: VPSData | null): boolean {
  return (action === 'start' && data?.status.powerState === 'running')
    || (action === 'stop' && data?.status.powerState === 'stopped');
}
