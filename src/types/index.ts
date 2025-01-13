export interface VPSCredentials {
  veid: string;
  apiKey: string;
}

export interface VPSData {
  basic: {
    hostname: string;
    node_location: string;
    os: string;
    ip_addresses: string[];
  };
  resources: {
    totalGB: string | number;
    usedGB: string | number;
    percentUsed: number;
    plan_disk: number;
    plan_ram: number;
    plan_swap: number;
  };
  status: {
    resetDate: string;
    daysRemaining: string | number;
    dailyAverage: string | number;
  };
} 