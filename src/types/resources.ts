export interface VPSSystemData {
  planRamBytes: number | null;
  planSwapBytes: number | null;
  planDiskBytes: number | null;
  availableRamBytes: number | null;
  swapTotalBytes: number | null;
  swapAvailableBytes: number | null;
  mappedDiskBytes: number | null;
  loadAverage: [number, number, number] | null;
  cpuThrottled: boolean | null;
  diskThrottled: boolean | null;
  observedAt: string;
  live: boolean;
}
