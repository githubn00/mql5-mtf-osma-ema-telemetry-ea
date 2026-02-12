import { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, CrosshairMode, LineStyle, createChart } from "lightweight-charts";
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
    if (!priceRootRef.current || !osmaRootRef.current || priceChartRef.current || osmaChartRef.current) return;

    const baseOptions = {
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#d6dce5" },
      timeScale: { borderColor: "#d6dce5", timeVisible: true, secondsVisible: false },
      grid: { vertLines: { color: "#eef2f7" }, horzLines: { color: "#eef2f7" } },
    };

    const priceChart = createChart(priceRootRef.current, {
      ...baseOptions,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#1f2937",
      },
      width: priceRootRef.current.clientWidth,
      height: 340,
    });

    const osmaChart = createChart(osmaRootRef.current, {
      ...baseOptions,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#1f2937",
      },
      width: osmaRootRef.current.clientWidth,
      height: 140,
    });

    const candle = priceChart.addCandlestickSeries({
      upColor: "#16a34a",
      downColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
      borderVisible: false,
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

    makeLine("ema13", "#2563eb", 2);
    makeLine("ema34", "#9333ea", 2);
    makeLine("ema150", "#f59e0b", 1, LineStyle.Dashed);
    makeLine("ema200", "#ef4444", 1, LineStyle.Dashed);
    makeLine("sma2", "#0ea5e9", 1);
    makeLine("sma5", "#14b8a6", 1);

    const osmaSeries = osmaChart.addHistogramSeries({
      color: "#111827",
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
      (Object.keys(linesRef.current) as IndicatorKey[]).forEach((k) => {
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

    const onResize = () => {
      if (priceRootRef.current && priceChartRef.current) {
        priceChartRef.current.applyOptions({ width: priceRootRef.current.clientWidth });
      }
      if (osmaRootRef.current && osmaChartRef.current) {
        osmaChartRef.current.applyOptions({ width: osmaRootRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", onResize);

    priceChartRef.current = priceChart;
    osmaChartRef.current = osmaChart;
    candleRef.current = candle;
    osmaSeriesRef.current = osmaSeries;

    return () => {
      window.removeEventListener("resize", onResize);
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
        color: p.value >= 0 ? "#16a34a" : "#dc2626",
      }));
    osmaSeriesRef.current.setData(osmaMapped);

    const markers = (data?.events ?? [])
      .filter((ev) => markerVisible[(ev.type as MarkerKey) ?? "cross"] ?? true)
      .map((ev) => ({
        time: ev.time as any,
        position: ev.direction > 0 ? "belowBar" : "aboveBar",
        color: ev.direction > 0 ? "#16a34a" : "#dc2626",
        shape: ev.type === "extremum" ? "circle" : ev.direction > 0 ? "arrowUp" : "arrowDown",
        text: "",
      }));

    candleRef.current.setMarkers(markers as any);

    const tfChanged = prevTfRef.current !== tf;
    prevTfRef.current = tf;
    if (!didInitialFitRef.current || tfChanged) {
      priceChartRef.current.timeScale().fitContent();
      didInitialFitRef.current = true;
    } else if (visible) {
      priceChartRef.current.timeScale().setVisibleLogicalRange(visible);
      osmaChartRef.current.timeScale().setVisibleLogicalRange(visible);
    }
  }, [bars, data, tf, markerVisible]);

  useEffect(() => {
    if (typeof bid === "number" && bid > 0) {
      if (!bidLineRef.current && candleRef.current) {
        bidLineRef.current = candleRef.current.createPriceLine({
          price: bid,
          color: "#22c55e",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: "Bid",
        });
      } else if (bidLineRef.current) {
        bidLineRef.current.applyOptions({
          price: bid,
          lineVisible: true,
          axisLabelVisible: true,
          title: "Bid",
        });
      }
    } else if (bidLineRef.current) {
      bidLineRef.current.applyOptions({ lineVisible: false, axisLabelVisible: false });
    }

    if (typeof ask === "number" && ask > 0) {
      if (!askLineRef.current && candleRef.current) {
        askLineRef.current = candleRef.current.createPriceLine({
          price: ask,
          color: "#ef4444",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: "Ask",
        });
      } else if (askLineRef.current) {
        askLineRef.current.applyOptions({
          price: ask,
          lineVisible: true,
          axisLabelVisible: true,
          title: "Ask",
        });
      }
    } else if (askLineRef.current) {
      askLineRef.current.applyOptions({ lineVisible: false, axisLabelVisible: false });
    }
  }, [bid, ask]);

  useEffect(() => {
    if (!priceChartRef.current || !osmaChartRef.current) return;

    const applyTheme = (chart: any) => {
      chart.applyOptions({
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
    };

    applyTheme(priceChartRef.current);
    applyTheme(osmaChartRef.current);

    (Object.keys(linesRef.current) as Exclude<IndicatorKey, "osma">[]).forEach((k) => {
      const s = linesRef.current[k];
      if (!s) return;
      s.applyOptions({ visible: indicatorVisible[k] });
    });

    if (osmaSeriesRef.current) {
      osmaSeriesRef.current.applyOptions({ visible: indicatorVisible.osma });
    }
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
        <button onClick={() => priceChartRef.current?.timeScale().fitContent()}>Reset Zoom</button>
        <button onClick={onToggleDarkMode}>{darkMode ? "Light" : "Dark"}</button>
        <button onClick={() => void toggleFullscreen()}>Fullscreen</button>
        <span className="quote-chip">Bid: {typeof bid === "number" ? bid.toFixed(2) : "-"}</span>
        <span className="quote-chip">Ask: {typeof ask === "number" ? ask.toFixed(2) : "-"}</span>
        <span className="quote-chip">Spread: {typeof spreadPoints === "number" ? spreadPoints.toFixed(1) : "-"} pt</span>
        <span className="quote-chip">{tf} close in: {countdown}</span>
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

      <div ref={priceRootRef} className="chart-root" />
      <div ref={osmaRootRef} className="osma-root" />
    </section>
  );
}
