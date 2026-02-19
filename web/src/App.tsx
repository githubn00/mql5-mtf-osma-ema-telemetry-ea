import { useEffect, useMemo, useState } from "react";
import { CandlestickChart, Clock3, DollarSign, FileText, RefreshCw, Server, Target, Timer } from "lucide-react";
import "./App.css";
import { ChartPanel } from "./components/ChartPanel";
import { EventInspector } from "./components/EventInspector";
import { SignalPanel } from "./components/SignalPanel";
import { TelemetryTable } from "./components/TelemetryTable";
import { TradePanel } from "./components/TradePanel";
import { postChartRequestProfile } from "./api/client";
import { useActions } from "./hooks/useActions";
import { useTelemetry } from "./hooks/useTelemetry";
import type { ChartEvent, TfName } from "./types";

const TF_LIST: TfName[] = ["M1", "M5", "M15", "H1", "H4", "D1"];
const PREF_DARK_KEY = "telemetry_dark_mode";
const PREF_TF_KEY = "telemetry_tf";
const IDLE_HISTORY_BARS = 120;
const ACTIVE_HISTORY_BARS = 600;

function App() {
  const { state, error } = useTelemetry(1000);
  const { actions, error: actionError, busy, submit } = useActions();

  const [tf, setTf] = useState<TfName>(() => {
    const saved = window.localStorage.getItem(PREF_TF_KEY);
    return (TF_LIST.includes(saved as TfName) ? saved : "M1") as TfName;
  });
  const [selectedEvent, setSelectedEvent] = useState<ChartEvent | null>(null);
  const [toast, setToast] = useState("");
  const [darkMode, setDarkMode] = useState(() => {
    const saved = window.localStorage.getItem(PREF_DARK_KEY);
    if (saved === "1") return true;
    if (saved === "0") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
  });
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
    window.localStorage.setItem(PREF_DARK_KEY, darkMode ? "1" : "0");
    return () => document.body.classList.remove("dark-page");
  }, [darkMode]);

  useEffect(() => {
    window.localStorage.setItem(PREF_TF_KEY, tf);
  }, [tf]);

  useEffect(() => {
    const perTfBars = TF_LIST.reduce((acc, name) => {
      acc[name] = name === tf ? ACTIVE_HISTORY_BARS : IDLE_HISTORY_BARS;
      return acc;
    }, {} as Record<TfName, number>);

    void postChartRequestProfile(IDLE_HISTORY_BARS, perTfBars).catch(() => {
      // keep UI responsive even if request endpoint is temporarily unavailable
    });
  }, [tf]);

  const onAction = async (action: "buy" | "sell" | "close_all") => {
    await submit(action, symbol);
    setToast(`Action ${action.toUpperCase()} accepted`);
    window.setTimeout(() => setToast(""), 1800);
  };

  return (
    <main className={`layout ${darkMode ? "layout-dark" : ""}`}>
      <header className="panel hero">
        <h1>
          <CandlestickChart size={24} className="icon" />
          MTF OsMA EMA Telemetry UI
        </h1>
        <div className="status-row">
          <span className="status-item"><Target size={13} className="icon" />Symbol: {symbol}</span>
          <span className="status-item"><Clock3 size={13} className="icon" />Updated: {state.meta?.updatedAt ? new Date(state.meta.updatedAt * 1000).toLocaleString() : "-"}</span>
          <span className="status-item"><RefreshCw size={13} className="icon" />Recommendation: {state.meta?.recommendation || "-"}</span>
        </div>
        <div className="status-row">
          <span className="chip icon-chip"><Server size={12} className="icon" />Source: {state._source || "-"}</span>
          <span className="chip icon-chip"><Clock3 size={12} className="icon" />Freshness: {freshness}</span>
          <span className="chip icon-chip"><FileText size={12} className="icon" />File: {state._selectedFile || "-"}</span>
          <span className="chip icon-chip"><DollarSign size={12} className="icon" />Bid: {state.live?.quote?.bid?.toFixed?.(2) ?? "-"}</span>
          <span className="chip icon-chip"><DollarSign size={12} className="icon" />Ask: {state.live?.quote?.ask?.toFixed?.(2) ?? "-"}</span>
          <span className="chip icon-chip"><DollarSign size={12} className="icon" />Spread: {state.live?.quote?.spreadPoints?.toFixed?.(1) ?? "-"} pt</span>
          <span className="chip icon-chip"><Timer size={12} className="icon" />{tf} close in: {countdown}</span>
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

      <div className="dashboard-grid">
        <div className="main-column">
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
          <TelemetryTable state={state} />
        </div>
        <div className="side-column">
          <SignalPanel state={state} />
          <TradePanel symbol={symbol} busy={busy} onAction={onAction} />
          <EventInspector event={selectedEvent} actions={actions} />
        </div>
      </div>
    </main>
  );
}

export default App;
