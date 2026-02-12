import { useEffect, useMemo, useRef } from "react";
import { ColorType, CrosshairMode, LineStyle, createChart } from "lightweight-charts";
import type { ChartEvent, ChartTfData, TfName } from "../types";

interface Props {
  tf: TfName;
  data?: ChartTfData;
  onSelectEvent: (ev: ChartEvent | null) => void;
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const candleRef = useRef<any>(null);
  const linesRef = useRef<Record<string, any>>({});
  const eventsRef = useRef<ChartEvent[]>([]);
  const didInitialFitRef = useRef(false);

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
      height: 380,
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

    const makeLine = (key: string, color: string, width = 2, style = LineStyle.Solid) => {
      linesRef.current[key] = chart.addLineSeries({
        color,
        lineWidth: width as any,
        lineStyle: style,
        priceLineVisible: false,
      });
    };

    makeLine("ema13", "#2563eb", 2);
    makeLine("ema34", "#9333ea", 2);
    makeLine("ema150", "#f59e0b", 1, LineStyle.Dashed);
    makeLine("ema200", "#ef4444", 1, LineStyle.Dashed);
    makeLine("sma2", "#0ea5e9", 1);
    makeLine("sma5", "#14b8a6", 1);
    makeLine("osma", "#111827", 1);

    chart.subscribeClick((param: any) => {
      if (!param || !param.time) {
        onSelectEvent(null);
        return;
      }
      const cp = param.seriesData?.get(candleRef.current);
      const close = cp?.close;
      const ev = nearestEvent(eventsRef.current, Number(param.time), close);
      onSelectEvent(ev);
    });

    const onResize = () => {
      if (!rootRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: rootRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);

    chartRef.current = chart;
    candleRef.current = candle;

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      linesRef.current = {};
    };
  }, [onSelectEvent]);

  useEffect(() => {
    if (!chartRef.current || !candleRef.current) return;

    eventsRef.current = data?.events ?? [];

    const visible = chartRef.current.timeScale().getVisibleLogicalRange();

    candleRef.current.setData(bars);

    const indicators = data?.indicators;
    const setLine = (key: string, points?: { time: number; value: number }[]) => {
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

    const markers = (data?.events ?? []).map((ev) => ({
      time: ev.time as any,
      position: ev.direction > 0 ? "belowBar" : "aboveBar",
      color: ev.direction > 0 ? "#16a34a" : "#dc2626",
      shape: ev.type === "extremum" ? "circle" : "arrowDown",
      text: ev.type,
    }));
    candleRef.current.setMarkers(markers as any);

    if (!didInitialFitRef.current) {
      chartRef.current.timeScale().fitContent();
      didInitialFitRef.current = true;
    } else if (visible) {
      chartRef.current.timeScale().setVisibleLogicalRange(visible);
    }
  }, [bars, data, tf]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Chart {tf}</h3>
        <span className="muted">Bars: {data?.historyBarsExported ?? 0}</span>
      </div>
      <div ref={rootRef} className="chart-root" />
    </section>
  );
}
