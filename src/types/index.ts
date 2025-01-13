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
    vm_type?: string;
    node_datacenter?: string;
  };
  resources: {
    totalGB: string | number;
    usedGB: string | number;
    percentUsed: number;
    plan_disk: number;
    plan_ram: number;
    plan_swap: number;
    plan?: string;
  };
  status: {
    resetDate: string;
    daysRemaining: string | number;
    dailyAverage: string | number;
    suspended?: boolean;
    policy_violation?: boolean;
  };
  network?: {
    location_ipv6_ready: boolean;
    plan_private_network_available: boolean;
    location_private_network_available: boolean;
    rdns_api_available: boolean;
  };
} 