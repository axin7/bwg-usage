export type TrafficRange = '24h' | '7d' | '30d';

export interface TrafficPoint {
  timestamp: string;
  receivedBytes: number | null;
  sentBytes: number | null;
  intervalSeconds: number | null;
  gapBefore: boolean;
}

export interface TrafficHistoryData {
  range: TrafficRange;
  points: TrafficPoint[];
  observedAt: string;
  source: 'provider';
  unit: 'bytes';
  semantics: 'raw-samples';
  availableFrom: string | null;
  availableTo: string | null;
  warning: string | null;
}
