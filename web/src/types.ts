export type TfName = "M1" | "M5" | "M15" | "H1" | "H4" | "D1";

export interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume?: number;
}

export interface ValuePoint {
  time: number;
  value: number;
}

export interface ChartEvent {
  id: string;
  time: number;
  type: "cross" | "extremum" | "osma_zero" | "signal";
  tf: TfName;
  pair: string;
  direction: number;
  price: number;
  value: number;
  barsSincePrev: number;
  phase: string;
  extremumType: string;
  extremumPrice: number;
  extremumBar: number;
  meta?: Record<string, unknown>;
}

export interface ChartTfData {
  timeframe: TfName;
  historyBarsExported: number;
  historyBarsMax: number;
  bars: ChartBar[];
  indicators: {
    ema13: ValuePoint[];
    ema34: ValuePoint[];
    ema150: ValuePoint[];
    ema200: ValuePoint[];
    sma2: ValuePoint[];
    sma5: ValuePoint[];
    osma: ValuePoint[];
  };
  events: ChartEvent[];
}

export interface TfLiveState {
  direction: string;
  phase: string;
  directionStabilized: boolean;
  ema1334AboutScore: number;
  osmaAboutScore: number;
  barsAfterCross1334: number;
  barsAfterCross150200: number;
  extremum1334: string;
  extremumBar1334: number;
}

export interface TelemetryState {
  meta?: {
    symbol?: string;
    updatedAt?: number;
    recommendation?: string;
  };
  live?: {
    per_tf_state?: Record<string, TfLiveState>;
    chart?: Record<string, ChartTfData>;
    signals?: {
      aligned?: { osmaBuy?: number; osmaSell?: number; emaBuy?: number; emaSell?: number };
      strong?: { osmaBuy?: boolean; osmaSell?: boolean; emaBuy?: boolean; emaSell?: boolean };
    };
  };
  _source?: string;
  _selectedFile?: string;
  _stateUpdatedAt?: number;
  _fileUpdatedAt?: number;
  _httpUpdatedAt?: number;
}

export interface ActionRecord {
  id: string;
  action: "buy" | "sell" | "close_all";
  symbol: string;
  source: string;
  ts: number;
  acceptedAt: string;
  meta?: Record<string, unknown>;
}
