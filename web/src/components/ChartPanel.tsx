import { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, CrosshairMode, LineStyle, createChart } from "lightweight-charts";
import type { ChartEvent, ChartTfData, TfName } from "../types";

interface Props {
  tf: TfName;
  data?: ChartTfData;
  onSelectEvent: (ev: ChartEvent | null) => void;
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

export function ChartPanel({ tf, data, onSelectEvent }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const candleRef = useRef<any>(null);
  const linesRef = useRef<Record<IndicatorKey, any>>({} as Record<IndicatorKey, any>);
  const eventsRef = useRef<ChartEvent[]>([]);
  const didInitialFitRef = useRef(false);
  const prevTfRef = useRef<TfName>(tf);

  const [darkMode, setDarkMode] = useState(false);
  const [crosshair, setCrosshair] = useState<CrosshairValues | null>(null);
  const [indicatorVisible, setIndicatorVisible] = useState<Record<IndicatorKey, boolean>>({
    ema13: true,
    ema34: true,
    ema150: true,
    ema200: true,
    sma2: true,
    sma5: true,
    osma: true,
  });
  const [markerVisible, setMarkerVisible] = useState<Record<MarkerKey, boolean>>({
    cross: true,
    extremum: true,
    osma_zero: true,
    signal: true,
  });

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

  useEffect(() => {
    if (!rootRef.current || chartRef.current) return;

    const chart = createChart(rootRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#1f2937",
      },
      width: rootRef.current.clientWidth,
      height: 420,
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#d6dce5" },
      timeScale: { borderColor: "#d6dce5", timeVisible: true, secondsVisible: false },
      grid: { vertLines: { color: "#eef2f7" }, horzLines: { color: "#eef2f7" } },
    });

    const candle = chart.addCandlestickSeries({
      upColor: "#16a34a",
      downColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
      borderVisible: false,
    });

    const makeLine = (key: IndicatorKey, color: string, width = 2, style = LineStyle.Solid) => {
      linesRef.current[key] = chart.addLineSeries({
        color,
        lineWidth: width as any,
        lineStyle: style,
        priceLineVisible: false,
        visible: true,
      });
    };

    makeLine("ema13", "#2563eb", 2);
    makeLine("ema34", "#9333ea", 2);
    makeLine("ema150", "#f59e0b", 1, LineStyle.Dashed);
    makeLine("ema200", "#ef4444", 1, LineStyle.Dashed);
    makeLine("sma2", "#0ea5e9", 1);
    makeLine("sma5", "#14b8a6", 1);
    makeLine("osma", "#111827", 1);

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
      (Object.keys(linesRef.current) as IndicatorKey[]).forEach((k) => {
        const p = param.seriesData?.get(linesRef.current[k]);
        if (p && typeof p.value === "number") values[k] = p.value;
      });

      setCrosshair({
        time: Number(param.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        values,
      });
    };

    chart.subscribeClick(handleClick);
    chart.subscribeCrosshairMove(handleCrosshair);

    const onResize = () => {
      if (!rootRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: rootRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);

    chartRef.current = chart;
    candleRef.current = candle;

    return () => {
      window.removeEventListener("resize", onResize);
      chart.unsubscribeClick(handleClick);
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      linesRef.current = {} as Record<IndicatorKey, any>;
    };
  }, [onSelectEvent]);

  useEffect(() => {
    if (!chartRef.current || !candleRef.current) return;

    eventsRef.current = data?.events ?? [];
    const visible = chartRef.current.timeScale().getVisibleLogicalRange();

    candleRef.current.setData(bars);

    const indicators = data?.indicators;
    const setLine = (key: IndicatorKey, points?: { time: number; value: number }[]) => {
      const s = linesRef.current[key];
      if (!s) return;
      const mapped = (points ?? []).map((p) => ({ time: p.time as any, value: p.value }));
      s.setData(mapped);
    };

    setLine("ema13", indicators?.ema13);
    setLine("ema34", indicators?.ema34);
    setLine("ema150", indicators?.ema150);
    setLine("ema200", indicators?.ema200);
    setLine("sma2", indicators?.sma2);
    setLine("sma5", indicators?.sma5);
    setLine("osma", indicators?.osma);

    const markers = (data?.events ?? [])
      .filter((ev) => markerVisible[(ev.type as MarkerKey) ?? "cross"] ?? true)
      .map((ev) => ({
        time: ev.time as any,
        position: ev.direction > 0 ? "belowBar" : "aboveBar",
        color: ev.direction > 0 ? "#16a34a" : "#dc2626",
        shape: ev.type === "extremum" ? "circle" : ev.direction > 0 ? "arrowUp" : "arrowDown",
        text: ev.type,
      }));

    candleRef.current.setMarkers(markers as any);

    const tfChanged = prevTfRef.current !== tf;
    prevTfRef.current = tf;
    if (!didInitialFitRef.current || tfChanged) {
      chartRef.current.timeScale().fitContent();
      didInitialFitRef.current = true;
    } else if (visible) {
      chartRef.current.timeScale().setVisibleLogicalRange(visible);
    }
  }, [bars, data, tf, markerVisible]);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: darkMode ? "#0f172a" : "#ffffff" },
        textColor: darkMode ? "#dbe7ff" : "#1f2937",
      },
      rightPriceScale: { borderColor: darkMode ? "#334155" : "#d6dce5" },
      timeScale: { borderColor: darkMode ? "#334155" : "#d6dce5", timeVisible: true, secondsVisible: false },
      grid: {
        vertLines: { color: darkMode ? "#1e293b" : "#eef2f7" },
        horzLines: { color: darkMode ? "#1e293b" : "#eef2f7" },
      },
    });

    (Object.keys(linesRef.current) as IndicatorKey[]).forEach((k) => {
      const s = linesRef.current[k];
      if (!s) return;
      s.applyOptions({ visible: indicatorVisible[k] });
    });
  }, [darkMode, indicatorVisible]);

  const toggleIndicator = (k: IndicatorKey) => {
    setIndicatorVisible((p) => ({ ...p, [k]: !p[k] }));
  };

  const toggleMarker = (k: MarkerKey) => {
    setMarkerVisible((p) => ({ ...p, [k]: !p[k] }));
  };

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
    <section className={`panel ${darkMode ? "panel-dark" : ""}`} ref={panelRef}>
      <div className="panel-head">
        <h3>Chart {tf}</h3>
        <span className="muted">Bars: {data?.historyBarsExported ?? 0}</span>
      </div>

      <div className="controls-row">
        <button onClick={() => chartRef.current?.timeScale().fitContent()}>Reset Zoom</button>
        <button onClick={() => setDarkMode((v) => !v)}>{darkMode ? "Light" : "Dark"}</button>
        <button onClick={() => void toggleFullscreen()}>Fullscreen</button>
      </div>

      <div className="controls-row">
        {(Object.keys(indicatorVisible) as IndicatorKey[]).map((k) => (
          <button key={k} className={indicatorVisible[k] ? "active" : ""} onClick={() => toggleIndicator(k)}>
            {k}
          </button>
        ))}
      </div>

      <div className="controls-row">
        {(Object.keys(markerVisible) as MarkerKey[]).map((k) => (
          <button key={k} className={markerVisible[k] ? "active" : ""} onClick={() => toggleMarker(k)}>
            marker:{k}
          </button>
        ))}
      </div>

      <div className="crosshair-panel">
        <span>T: {crosshair?.time ? new Date(crosshair.time * 1000).toLocaleString() : "-"}</span>
        <span>O: {fmt(crosshair?.open, 2)}</span>
        <span>H: {fmt(crosshair?.high, 2)}</span>
        <span>L: {fmt(crosshair?.low, 2)}</span>
        <span>C: {fmt(crosshair?.close, 2)}</span>
        <span>EMA13: {fmt(crosshair?.values.ema13, 4)}</span>
        <span>EMA34: {fmt(crosshair?.values.ema34, 4)}</span>
        <span>OSMA: {fmt(crosshair?.values.osma, 4)}</span>
      </div>

      <div ref={rootRef} className="chart-root" />
    </section>
  );
}
