import type { ActionRecord, TelemetryState, TfName } from "../types";

const API_BASE = "";

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  return (await res.json()) as T;
}

export async function fetchState(): Promise<TelemetryState> {
  const res = await fetch(`${API_BASE}/api/state`, { cache: "no-store" });
  return parseJson<TelemetryState>(res);
}

export async function postAction(
  action: "buy" | "sell" | "close_all" | "close_ticket",
  symbol: string,
  options?: { lot?: number; ticket?: number }
) {
  const payload = {
    action,
    symbol,
    source: "web_ui",
    ts: Date.now(),
    lot: options?.lot,
    ticket: options?.ticket,
    meta: {},
  };
  const res = await fetch(`${API_BASE}/api/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ ok: boolean; id: string; acceptedAt: string }>(res);
}

export async function fetchActions(limit = 50): Promise<ActionRecord[]> {
  const res = await fetch(`${API_BASE}/api/actions?limit=${limit}`, { cache: "no-store" });
  const payload = await parseJson<{ items: ActionRecord[] }>(res);
  return payload.items ?? [];
}

export async function postChartRequest(tf: TfName, bars: number) {
  const payload = { tf, bars, ts: Date.now(), source: "web_chart_scroll" };
  const res = await fetch(`${API_BASE}/api/chart-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ ok: boolean; request: { updatedAt: number; globalBars: number; perTfBars: Record<string, number> } }>(res);
}
