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
  historyBarsRequested?: number;
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
    quote?: {
      bid?: number;
      ask?: number;
      spreadPoints?: number;
      updatedAt?: number;
    };
    signals?: {
      aligned?: { osmaBuy?: number; osmaSell?: number; emaBuy?: number; emaSell?: number };
      strong?: { osmaBuy?: boolean; osmaSell?: boolean; emaBuy?: boolean; emaSell?: boolean };
    };
  };
  positions?: {
    open?: PositionRecord[];
    reassessments?: Array<Record<string, unknown>>;
    lastActions?: UiExecutionRecord[];
  };
  _source?: string;
  _selectedFile?: string;
  _stateUpdatedAt?: number;
  _fileUpdatedAt?: number;
  _httpUpdatedAt?: number;
  _chartRequest?: {
    updatedAt?: number;
    globalBars?: number;
    perTfBars?: Partial<Record<TfName, number>>;
  };
}

export interface ActionRecord {
  id: string;
  action: "buy" | "sell" | "close_all" | "close_ticket";
  symbol: string;
  source: string;
  ts: number;
  acceptedAt: string;
  lot?: number | null;
  ticket?: number | null;
  meta?: Record<string, unknown>;
}

export interface UiExecutionRecord {
  id: string;
  action: "buy" | "sell" | "close_all" | "close_ticket";
  symbol: string;
  lot?: number;
  ticket?: number;
  success: boolean;
  message?: string;
  time: number;
}

export interface PositionRecord {
  ticket: number;
  symbol: string;
  type: number;
  volume: number;
  openTime: number;
  openPrice: number;
  currentPrice: number;
  sl: number;
  tp: number;
  profit: number;
  swap: number;
  commission: number;
  magic: number;
  comment: string;
}
