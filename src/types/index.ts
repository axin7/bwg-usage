import type { VPSSystemData } from './resources';

export interface VPSCredentials {
  veid: string;
  apiKey: string;
}

export type VPSAction = 'start' | 'stop' | 'restart';
export type VPSPowerState = 'running' | 'stopped' | 'starting' | 'unknown';

export interface VPSData {
  basic: {
    hostname: string;
    node_location: string;
    os: string;
    ip_addresses: string[];
    vm_type?: string;
  };
  resources: {
    totalBytes: number | null;
    usedBytes: number;
    remainingBytes: number | null;
    percentUsed: number | null;
  };
  status: {
    resetAt: string | null;
    daysRemaining: number | null;
    dailyAverageBytes: number | null;
    averageIsEstimate: boolean;
    suspended: boolean | null;
    policy_violation: boolean | null;
    powerState: VPSPowerState;
  };
  observedAt: string;
  system?: VPSSystemData;
}

export interface ActionReceipt {
  action: VPSAction;
  accepted: true;
  requestId: string;
  historyWarning?: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    outcome?: 'unknown' | 'rejected';
  };
}
