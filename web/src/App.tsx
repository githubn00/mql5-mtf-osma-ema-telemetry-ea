import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { ChartPanel } from "./components/ChartPanel";
import { EventInspector } from "./components/EventInspector";
import { SignalPanel } from "./components/SignalPanel";
import { TelemetryTable } from "./components/TelemetryTable";
import { TradePanel } from "./components/TradePanel";
import { useActions } from "./hooks/useActions";
import { useTelemetry } from "./hooks/useTelemetry";
import type { ChartEvent, TfName } from "./types";

const TF_LIST: TfName[] = ["M1", "M5", "M15", "H1", "H4", "D1"];

function App() {
  const { state, error } = useTelemetry(1000);
  const { actions, error: actionError, busy, submit } = useActions();
  const [tf, setTf] = useState<TfName>("M1");
  const [selectedEvent, setSelectedEvent] = useState<ChartEvent | null>(null);
  const [toast, setToast] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));

  const chartData = (state.live?.chart?.[tf] as any) ?? undefined;
  const symbol = state.meta?.symbol || "UNKNOWN";

  const freshness = useMemo(() => {
    if (!state._stateUpdatedAt) return "-";
    const s = Math.max(0, Math.floor(Date.now() / 1000 - state._stateUpdatedAt));
    return `${s}s`;
  }, [state._stateUpdatedAt]);

  useEffect(() => {
    const id = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  const tfSecMap: Record<TfName, number> = {
    M1: 60,
    M5: 300,
    M15: 900,
    H1: 3600,
    H4: 14400,
    D1: 86400,
  };

  const countdown = useMemo(() => {
    const bars = chartData?.bars ?? [];
    if (!bars.length) return "-";
    const lastBar = bars[bars.length - 1];
    if (!lastBar?.time) return "-";
    const remain = Math.max(0, lastBar.time + tfSecMap[tf] - nowSec);
    const mm = Math.floor(remain / 60);
    const ss = remain % 60;
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }, [chartData, nowSec, tf]);

  useEffect(() => {
    document.body.classList.toggle("dark-page", darkMode);
    return () => document.body.classList.remove("dark-page");
  }, [darkMode]);
  const onAction = async (action: "buy" | "sell" | "close_all") => {
    await submit(action, symbol);
    setToast(`Action ${action.toUpperCase()} accepted`);
    window.setTimeout(() => setToast(""), 1800);
  };

  return (
    <main className={`layout ${darkMode ? "layout-dark" : ""}`}>
      <header className="panel hero">
        <h1>MTF OsMA EMA Telemetry UI</h1>
        <div className="status-row">
          <span>Symbol: {symbol}</span>
          <span>Updated: {state.meta?.updatedAt ? new Date(state.meta.updatedAt * 1000).toLocaleString() : "-"}</span>
          <span>Recommendation: {state.meta?.recommendation || "-"}</span>
        </div>
        <div className="status-row">
          <span className="chip">Source: {state._source || "-"}</span>
          <span className="chip">Freshness: {freshness}</span>
          <span className="chip">File: {state._selectedFile || "-"}</span>
          <span className="chip">Bid: {state.live?.quote?.bid?.toFixed?.(2) ?? "-"}</span>
          <span className="chip">Ask: {state.live?.quote?.ask?.toFixed?.(2) ?? "-"}</span>
          <span className="chip">Spread: {state.live?.quote?.spreadPoints?.toFixed?.(1) ?? "-"} pt</span>
          <span className="chip">{tf} close in: {countdown}</span>
        </div>
        {error && <div className="error">State error: {error}</div>}
        {actionError && <div className="error">Action error: {actionError}</div>}
        {toast && <div className="toast">{toast}</div>}
      </header>

      <section className="panel tfbar">
        {TF_LIST.map((x) => (
          <button key={x} className={x === tf ? "active" : ""} onClick={() => setTf(x)}>{x}</button>
        ))}
      </section>

      <ChartPanel
        tf={tf}
        data={chartData}
        onSelectEvent={setSelectedEvent}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((v) => !v)}
        bid={state.live?.quote?.bid}
        ask={state.live?.quote?.ask}
        spreadPoints={state.live?.quote?.spreadPoints}
        countdown={countdown}
      />
      <SignalPanel state={state} />
      <TelemetryTable state={state} />
      <TradePanel symbol={symbol} busy={busy} onAction={onAction} />
      <EventInspector event={selectedEvent} actions={actions} />
    </main>
  );
}

export default App;


