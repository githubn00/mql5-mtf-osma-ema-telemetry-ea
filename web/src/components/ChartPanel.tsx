import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickChart, Grid3X3, Info, LocateFixed, Maximize2, Moon, RefreshCcw, ScanLine, Sun } from "lucide-react";
import { ColorType, CrosshairMode, LineStyle, PriceScaleMode, createChart } from "lightweight-charts";
import type { ChartEvent, ChartTfData, TfName } from "../types";

interface Props {
  tf: TfName;
  data?: ChartTfData;
  onSelectEvent: (ev: ChartEvent | null) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  bid?: number;
  ask?: number;
  spreadPoints?: number;
  countdown: string;
}

type IndicatorKey = "ema13" | "ema34" | "ema150" | "ema200" | "sma2" | "sma5" | "osma";
type MarkerKey = "cross" | "extremum" | "osma_zero" | "signal";

interface CrosshairValues {
  time: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  values: Partial<Record<IndicatorKey, number>>;
}

interface MarkerMeta {
  short: string;
  name: string;
  description: string;
}

const INDICATOR_PREF_KEY = "telemetry_indicator_visible";
const MARKER_PREF_KEY = "telemetry_marker_visible";
const FOLLOW_PREF_KEY = "telemetry_follow_latest";

const INDICATOR_ORDER: IndicatorKey[] = ["ema13", "ema34", "ema150", "ema200", "sma2", "sma5", "osma"];
const MARKER_ORDER: MarkerKey[] = ["cross", "extremum", "osma_zero", "signal"];
const INDICATOR_COLORS: Record<IndicatorKey, string> = {
  ema13: "#2962ff",
  ema34: "#7c3aed",
  ema150: "#f59e0b",
  ema200: "#ef4444",
  sma2: "#0ea5e9",
  sma5: "#14b8a6",
  osma: "#111827",
};
const MARKER_META: Record<MarkerKey, MarkerMeta> = {
  cross: { short: "CR", name: "Cross", description: "Moving-average cross event" },
  extremum: { short: "EX", name: "Extremum", description: "Detected peak/bottom pivot" },
  osma_zero: { short: "ZC", name: "Zero Cross", description: "OsMA crossed zero line" },
  signal: { short: "SG", name: "Signal", description: "Strategy signal emitted" },
};

function nearestEvent(events: ChartEvent[], time: number, price?: number) {
  if (!events.length) return null;
  let best: ChartEvent | null = null;
  let bestDt = Number.MAX_SAFE_INTEGER;
  let bestDp = Number.MAX_VALUE;
  for (const ev of events) {
    const dt = Math.abs(ev.time - time);
    const dp = price === undefined ? 0 : Math.abs((ev.price ?? 0) - price);
    if (dt < bestDt || (dt === bestDt && dp < bestDp)) {
      best = ev;
      bestDt = dt;
      bestDp = dp;
    }
  }
  return best;
}

function loadVisibilityPref<T extends string>(storageKey: string, keys: T[], defaults: Record<T, boolean>) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Record<T, boolean>;
    return keys.reduce((acc, key) => {
      acc[key] = typeof parsed[key] === "boolean" ? parsed[key] : defaults[key];
      return acc;
    }, {} as Record<T, boolean>);
  } catch {
    return defaults;
  }
}

export function ChartPanel({ tf, data, onSelectEvent, darkMode, onToggleDarkMode, bid, ask, spreadPoints, countdown }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const priceRootRef = useRef<HTMLDivElement | null>(null);
  const osmaRootRef = useRef<HTMLDivElement | null>(null);

  const priceChartRef = useRef<any>(null);
  const osmaChartRef = useRef<any>(null);
  const candleRef = useRef<any>(null);
  const osmaSeriesRef = useRef<any>(null);
  const bidLineRef = useRef<any>(null);
  const askLineRef = useRef<any>(null);

  const linesRef = useRef<Record<IndicatorKey, any>>({} as Record<IndicatorKey, any>);
  const eventsRef = useRef<ChartEvent[]>([]);
  const didInitialFitRef = useRef(false);
  const prevTfRef = useRef<TfName>(tf);
  const syncingRangeRef = useRef(false);
  const lastAppliedBarTimeRef = useRef<number>(0);
  const lastAppliedBarCountRef = useRef<number>(0);

  const [crosshair, setCrosshair] = useState<CrosshairValues | null>(null);
  const [showCrosshairPanel, setShowCrosshairPanel] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [followLatest, setFollowLatest] = useState(() => window.localStorage.getItem(FOLLOW_PREF_KEY) === "1");

  const [indicatorVisible, setIndicatorVisible] = useState<Record<IndicatorKey, boolean>>(() =>
    loadVisibilityPref(INDICATOR_PREF_KEY, INDICATOR_ORDER, {
      ema13: true,
      ema34: true,
      ema150: true,
      ema200: true,
      sma2: true,
      sma5: true,
      osma: true,
    })
  );

  const [markerVisible, setMarkerVisible] = useState<Record<MarkerKey, boolean>>(() =>
    loadVisibilityPref(MARKER_PREF_KEY, MARKER_ORDER, {
      cross: true,
      extremum: true,
      osma_zero: true,
      signal: true,
    })
  );

  const bars = useMemo(
    () =>
      (data?.bars ?? []).map((b) => ({
        time: b.time as any,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    [data]
  );

  const latestIndicatorValues = useMemo(() => {
    const indicators = data?.indicators;
    const out: Partial<Record<IndicatorKey, number>> = {};
    INDICATOR_ORDER.forEach((k) => {
      const points = indicators?.[k as keyof typeof indicators] as { time: number; value: number }[] | undefined;
      const last = points?.[points.length - 1];
      if (last && Number.isFinite(last.value)) out[k] = last.value;
    });
    return out;
  }, [data]);

  useEffect(() => {
    window.localStorage.setItem(INDICATOR_PREF_KEY, JSON.stringify(indicatorVisible));
  }, [indicatorVisible]);

  useEffect(() => {
    window.localStorage.setItem(MARKER_PREF_KEY, JSON.stringify(markerVisible));
  }, [markerVisible]);

  useEffect(() => {
    window.localStorage.setItem(FOLLOW_PREF_KEY, followLatest ? "1" : "0");
  }, [followLatest]);

  useEffect(() => {
    if (!priceRootRef.current || !osmaRootRef.current || priceChartRef.current || osmaChartRef.current) return;

    const baseOptions = {
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#2a2e39", mode: PriceScaleMode.Normal, autoScale: true },
      timeScale: { borderColor: "#2a2e39", timeVisible: true, secondsVisible: false, rightOffset: 3 },
      grid: { vertLines: { color: "#2a2e39" }, horzLines: { color: "#2a2e39" } },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      trackingMode: { exitMode: 1 as const },
      kineticScroll: { mouse: true, touch: true },
    };

    const priceChart = createChart(priceRootRef.current, {
      ...baseOptions,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#131722",
      },
      width: priceRootRef.current.clientWidth,
      height: 360,
    });

    const osmaChart = createChart(osmaRootRef.current, {
      ...baseOptions,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#131722",
      },
      width: osmaRootRef.current.clientWidth,
      height: 160,
    });

    const candle = priceChart.addCandlestickSeries({
      upColor: "#22ab94",
      downColor: "#f23645",
      wickUpColor: "#22ab94",
      wickDownColor: "#f23645",
      borderVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const makeLine = (key: Exclude<IndicatorKey, "osma">, color: string, width = 2, style = LineStyle.Solid) => {
      linesRef.current[key] = priceChart.addLineSeries({
        color,
        lineWidth: width as any,
        lineStyle: style,
        priceLineVisible: false,
        lastValueVisible: false,
        visible: true,
      });
    };

    makeLine("ema13", INDICATOR_COLORS.ema13, 2);
    makeLine("ema34", INDICATOR_COLORS.ema34, 2);
    makeLine("ema150", INDICATOR_COLORS.ema150, 1, LineStyle.Dashed);
    makeLine("ema200", INDICATOR_COLORS.ema200, 1, LineStyle.Dashed);
    makeLine("sma2", INDICATOR_COLORS.sma2, 1);
    makeLine("sma5", INDICATOR_COLORS.sma5, 1);

    const osmaSeries = osmaChart.addHistogramSeries({
      color: INDICATOR_COLORS.osma,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const syncFromPrice = (range: any) => {
      if (!range || syncingRangeRef.current || !osmaChartRef.current) return;
      syncingRangeRef.current = true;
      osmaChartRef.current.timeScale().setVisibleLogicalRange(range);
      syncingRangeRef.current = false;
    };

    const syncFromOsma = (range: any) => {
      if (!range || syncingRangeRef.current || !priceChartRef.current) return;
      syncingRangeRef.current = true;
      priceChartRef.current.timeScale().setVisibleLogicalRange(range);
      syncingRangeRef.current = false;
    };

    priceChart.timeScale().subscribeVisibleLogicalRangeChange(syncFromPrice);
    osmaChart.timeScale().subscribeVisibleLogicalRangeChange(syncFromOsma);

    const handleClick = (param: any) => {
      if (!param || !param.time) {
        onSelectEvent(null);
        return;
      }
      const cp = param.seriesData?.get(candleRef.current);
      const close = cp?.close;
      const ev = nearestEvent(eventsRef.current, Number(param.time), close);
      onSelectEvent(ev);
    };

    const handleCrosshair = (param: any) => {
      if (!param || !param.time) {
        setCrosshair(null);
        return;
      }
      const c = param.seriesData?.get(candleRef.current) || {};
      const values: Partial<Record<IndicatorKey, number>> = {};
      INDICATOR_ORDER.forEach((k) => {
        if (k === "osma") return;
        const p = param.seriesData?.get(linesRef.current[k]);
        if (p && typeof p.value === "number") values[k] = p.value;
      });
      const op = param.seriesData?.get(osmaSeriesRef.current);
      if (op && typeof op.value === "number") values.osma = op.value;

      setCrosshair({
        time: Number(param.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        values,
      });
    };

    priceChart.subscribeClick(handleClick);
    priceChart.subscribeCrosshairMove(handleCrosshair);
    osmaChart.subscribeCrosshairMove(handleCrosshair);

    const resizeCharts = () => {
      if (priceRootRef.current && priceChartRef.current) {
        priceChartRef.current.applyOptions({ width: priceRootRef.current.clientWidth });
      }
      if (osmaRootRef.current && osmaChartRef.current) {
        osmaChartRef.current.applyOptions({ width: osmaRootRef.current.clientWidth });
      }
    };

    const scheduleResize = () => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resizeCharts());
      });
    };

    const observer = new ResizeObserver(() => scheduleResize());
    observer.observe(priceRootRef.current);
    observer.observe(osmaRootRef.current);

    window.addEventListener("resize", scheduleResize);
    document.addEventListener("fullscreenchange", scheduleResize);

    priceChartRef.current = priceChart;
    osmaChartRef.current = osmaChart;
    candleRef.current = candle;
    osmaSeriesRef.current = osmaSeries;

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleResize);
      document.removeEventListener("fullscreenchange", scheduleResize);
      priceChart.unsubscribeClick(handleClick);
      priceChart.unsubscribeCrosshairMove(handleCrosshair);
      osmaChart.unsubscribeCrosshairMove(handleCrosshair);
      priceChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncFromPrice);
      osmaChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncFromOsma);
      priceChart.remove();
      osmaChart.remove();
      priceChartRef.current = null;
      osmaChartRef.current = null;
      candleRef.current = null;
      osmaSeriesRef.current = null;
      linesRef.current = {} as Record<IndicatorKey, any>;
      bidLineRef.current = null;
      askLineRef.current = null;
    };
  }, [onSelectEvent]);

  useEffect(() => {
    if (!priceChartRef.current || !osmaChartRef.current || !candleRef.current || !osmaSeriesRef.current) return;

    eventsRef.current = data?.events ?? [];
    const visible = priceChartRef.current.timeScale().getVisibleLogicalRange();

    candleRef.current.setData(bars);

    const indicators = data?.indicators;
    const setPriceLine = (key: Exclude<IndicatorKey, "osma">, points?: { time: number; value: number }[]) => {
      const s = linesRef.current[key];
      if (!s) return;
      const mapped = (points ?? [])
        .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value) && p.time > 0 && p.value > 0)
        .map((p) => ({ time: p.time as any, value: p.value }));
      s.setData(mapped);
    };

    setPriceLine("ema13", indicators?.ema13);
    setPriceLine("ema34", indicators?.ema34);
    setPriceLine("ema150", indicators?.ema150);
    setPriceLine("ema200", indicators?.ema200);
    setPriceLine("sma2", indicators?.sma2);
    setPriceLine("sma5", indicators?.sma5);

    const osmaMapped = (indicators?.osma ?? [])
      .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value) && p.time > 0)
      .map((p) => ({
        time: p.time as any,
        value: p.value,
        color: p.value >= 0 ? "#22ab94" : "#f23645",
      }));
    osmaSeriesRef.current.setData(osmaMapped);

    const markers = (data?.events ?? [])
      .filter((ev) => markerVisible[(ev.type as MarkerKey) ?? "cross"] ?? true)
      .map((ev) => {
        const markerType = (ev.type as MarkerKey) ?? "cross";
        return {
          time: ev.time as any,
          position: ev.direction > 0 ? "belowBar" : "aboveBar",
          color: ev.direction > 0 ? "#22ab94" : "#f23645",
          shape: markerType === "extremum" ? "circle" : ev.direction > 0 ? "arrowUp" : "arrowDown",
          text: MARKER_META[markerType].short,
        };
      });
    candleRef.current.setMarkers(markers as any);

    const tfChanged = prevTfRef.current !== tf;
    prevTfRef.current = tf;
    const lastBarTime = bars.length ? Number(bars[bars.length - 1].time) : 0;
    const hasNewBar =
      tfChanged ||
      bars.length !== lastAppliedBarCountRef.current ||
      (lastBarTime > 0 && lastBarTime > lastAppliedBarTimeRef.current);
    lastAppliedBarCountRef.current = bars.length;
    lastAppliedBarTimeRef.current = lastBarTime;

    if (!didInitialFitRef.current || tfChanged) {
      priceChartRef.current.timeScale().fitContent();
      osmaChartRef.current.timeScale().fitContent();
      priceChartRef.current.priceScale("right").applyOptions({ autoScale: true, mode: PriceScaleMode.Normal });
      osmaChartRef.current.priceScale("right").applyOptions({ autoScale: true, mode: PriceScaleMode.Normal });
      didInitialFitRef.current = true;
      return;
    }

    if (followLatest && hasNewBar) {
      priceChartRef.current.timeScale().scrollToRealTime();
      osmaChartRef.current.timeScale().scrollToRealTime();
    } else if (visible) {
      priceChartRef.current.timeScale().setVisibleLogicalRange(visible);
      osmaChartRef.current.timeScale().setVisibleLogicalRange(visible);
    }
  }, [bars, data, tf, markerVisible, followLatest]);

  useEffect(() => {
    if (typeof bid === "number" && bid > 0) {
      if (!bidLineRef.current && candleRef.current) {
        bidLineRef.current = candleRef.current.createPriceLine({
          price: bid,
          color: "#22ab94",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: "Bid",
        });
      } else if (bidLineRef.current) {
        bidLineRef.current.applyOptions({ price: bid, lineVisible: true, axisLabelVisible: true, title: "Bid" });
      }
    } else if (bidLineRef.current) {
      bidLineRef.current.applyOptions({ lineVisible: false, axisLabelVisible: false });
    }

    if (typeof ask === "number" && ask > 0) {
      if (!askLineRef.current && candleRef.current) {
        askLineRef.current = candleRef.current.createPriceLine({
          price: ask,
          color: "#f23645",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: "Ask",
        });
      } else if (askLineRef.current) {
        askLineRef.current.applyOptions({ price: ask, lineVisible: true, axisLabelVisible: true, title: "Ask" });
      }
    } else if (askLineRef.current) {
      askLineRef.current.applyOptions({ lineVisible: false, axisLabelVisible: false });
    }
  }, [bid, ask]);

  useEffect(() => {
    if (!priceChartRef.current || !osmaChartRef.current) return;

    const lightBg = "#ffffff";
    const darkBg = "#131722";
    const lightText = "#131722";
    const darkText = "#d1d4dc";
    const lightGrid = "#f0f3fa";
    const darkGrid = "#2a2e39";

    const applyTheme = (chart: any) => {
      chart.applyOptions({
        layout: {
          background: { type: ColorType.Solid, color: darkMode ? darkBg : lightBg },
          textColor: darkMode ? darkText : lightText,
        },
        rightPriceScale: { borderColor: darkMode ? darkGrid : lightGrid },
        timeScale: { borderColor: darkMode ? darkGrid : lightGrid, timeVisible: true, secondsVisible: false },
        grid: {
          vertLines: { color: showGrid ? (darkMode ? darkGrid : lightGrid) : "transparent" },
          horzLines: { color: showGrid ? (darkMode ? darkGrid : lightGrid) : "transparent" },
        },
      });
    };

    applyTheme(priceChartRef.current);
    applyTheme(osmaChartRef.current);

    INDICATOR_ORDER.forEach((k) => {
      if (k === "osma") return;
      const s = linesRef.current[k];
      if (!s) return;
      s.applyOptions({ visible: indicatorVisible[k] });
    });

    if (osmaSeriesRef.current) {
      osmaSeriesRef.current.applyOptions({ visible: indicatorVisible.osma });
    }
  }, [darkMode, indicatorVisible, showGrid]);

  const toggleFullscreen = async () => {
    if (!panelRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await panelRef.current.requestFullscreen();
    }
  };

  const fmt = (v?: number, d = 2) => (typeof v === "number" ? v.toFixed(d) : "-");

  return (
    <section className={`panel chart-panel ${darkMode ? "panel-dark" : ""}`} ref={panelRef}>
      <div className="panel-head">
        <h3><CandlestickChart size={15} className="icon" />Chart {tf}</h3>
        <span className="muted">Bars: {data?.historyBarsExported ?? 0}</span>
      </div>

      <div className="controls-row">
        <button className="icon-btn" onClick={() => { priceChartRef.current?.timeScale().fitContent(); osmaChartRef.current?.timeScale().fitContent(); }}><RefreshCcw size={13} className="icon" />Reset</button>
        <button className={`icon-btn ${followLatest ? "active" : ""}`} onClick={() => setFollowLatest((v) => !v)}><LocateFixed size={13} className="icon" />Follow</button>
        <button className={`icon-btn ${showGrid ? "active" : ""}`} onClick={() => setShowGrid((v) => !v)}><Grid3X3 size={13} className="icon" />Grid</button>
        <button className={`icon-btn ${showCrosshairPanel ? "active" : ""}`} onClick={() => setShowCrosshairPanel((v) => !v)}><ScanLine size={13} className="icon" />OHLC</button>
        <button className="icon-btn" onClick={onToggleDarkMode}>{darkMode ? <Sun size={13} className="icon" /> : <Moon size={13} className="icon" />}{darkMode ? "Light" : "Dark"}</button>
        <button className="icon-btn" onClick={() => void toggleFullscreen()}><Maximize2 size={13} className="icon" />Fullscreen</button>
        <span className="quote-chip">Bid {typeof bid === "number" ? bid.toFixed(2) : "-"}</span>
        <span className="quote-chip">Ask {typeof ask === "number" ? ask.toFixed(2) : "-"}</span>
        <span className="quote-chip">Spread {typeof spreadPoints === "number" ? spreadPoints.toFixed(1) : "-"} pt</span>
        <span className="quote-chip">{tf} {countdown}</span>
      </div>

      <div className="tv-legend-row">
        {INDICATOR_ORDER.map((k) => (
          <button
            key={`legend-${k}`}
            className={`legend-chip marker-chip ${indicatorVisible[k] ? "" : "off"}`}
            onClick={() => setIndicatorVisible((p) => ({ ...p, [k]: !p[k] }))}
            title={`Toggle ${k.toUpperCase()} indicator`}
          >
            <span className="legend-dot" style={{ backgroundColor: INDICATOR_COLORS[k] }} />
            {k.toUpperCase()} {fmt((crosshair?.values[k] ?? latestIndicatorValues[k]) as number | undefined, 4)}
          </button>
        ))}
      </div>

      <div className="tv-legend-row">
        {MARKER_ORDER.map((k) => (
          <button
            key={`marker-${k}`}
            className={`legend-chip marker-chip ${markerVisible[k] ? "active" : "off"}`}
            onClick={() => setMarkerVisible((p) => ({ ...p, [k]: !p[k] }))}
            title={`${MARKER_META[k].name}: ${MARKER_META[k].description}`}
          >
            <span className={`marker-icon marker-${k}`}>{MARKER_META[k].short}</span>
            <span className="marker-text">{MARKER_META[k].name}</span>
          </button>
        ))}
      </div>

      <div className="overlay-help">
        <Info size={12} className="icon" />
        Marker codes on candles: `CR` = Cross, `EX` = Extremum, `ZC` = OsMA Zero Cross, `SG` = Strategy Signal.
      </div>

      {showCrosshairPanel && (
        <div className="crosshair-panel">
          <span>T {crosshair?.time ? new Date(crosshair.time * 1000).toLocaleString() : "-"}</span>
          <span>O {fmt(crosshair?.open, 2)}</span>
          <span>H {fmt(crosshair?.high, 2)}</span>
          <span>L {fmt(crosshair?.low, 2)}</span>
          <span>C {fmt(crosshair?.close, 2)}</span>
          <span>EMA13 {fmt(crosshair?.values.ema13, 4)}</span>
          <span>EMA34 {fmt(crosshair?.values.ema34, 4)}</span>
          <span>OSMA {fmt(crosshair?.values.osma, 4)}</span>
        </div>
      )}

      <div ref={priceRootRef} className="chart-root" />
      <div ref={osmaRootRef} className="osma-root" />
    </section>
  );
}
