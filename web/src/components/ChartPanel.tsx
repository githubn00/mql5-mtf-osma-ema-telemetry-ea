import { useEffect, useMemo, useRef } from "react";
import {
  ColorType,
  CrosshairMode,
  
  LineStyle,
  createChart,
} from "lightweight-charts";
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
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);

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
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#1f2937" },
      width: ref.current.clientWidth,
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

    candle.setData(bars);

    const indicators = data?.indicators;
    if (indicators) {
      const addLine = (values: { time: number; value: number }[], color: string, width = 2, style = LineStyle.Solid) => {
        const s = chart.addLineSeries({ color, lineWidth: width as any, lineStyle: style, priceLineVisible: false });
        s.setData(values.map((p) => ({ time: p.time as any, value: p.value })));
      };

      addLine(indicators.ema13 ?? [], "#2563eb", 2);
      addLine(indicators.ema34 ?? [], "#9333ea", 2);
      addLine(indicators.ema150 ?? [], "#f59e0b", 1, LineStyle.Dashed);
      addLine(indicators.ema200 ?? [], "#ef4444", 1, LineStyle.Dashed);
      addLine(indicators.sma2 ?? [], "#0ea5e9", 1);
      addLine(indicators.sma5 ?? [], "#14b8a6", 1);
    }

    const markers = (data?.events ?? []).map((ev) => ({
      time: ev.time as any,
      position: ev.direction > 0 ? "belowBar" : "aboveBar",
      color: ev.direction > 0 ? "#16a34a" : "#dc2626",
      shape: ev.type === "extremum" ? "circle" : "arrowDown",
      text: ev.type,
    }));

    candle.setMarkers(markers as any);

    chart.subscribeClick((param: any) => {
      if (!param || !param.time) {
        onSelectEvent(null);
        return;
      }
      const cp = param.seriesData?.get(candle);
      const close = cp?.close;
      const ev = nearestEvent(data?.events ?? [], Number(param.time), close);
      onSelectEvent(ev);
    });

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const onResize = () => {
      if (!ref.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: ref.current.clientWidth });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, data, onSelectEvent]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Chart {tf}</h3>
        <span className="muted">Bars: {data?.historyBarsExported ?? 0}</span>
      </div>
      <div ref={ref} className="chart-root" />
    </section>
  );
}

