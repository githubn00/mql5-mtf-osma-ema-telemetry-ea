import { X } from "lucide-react";
import type { PositionRecord } from "../types";

interface Props {
  symbol: string;
  positions: PositionRecord[];
  busy: boolean;
  onCloseTicket: (ticket: number) => Promise<void>;
}

function positionTypeLabel(type: number) {
  if (type === 0) return "BUY";
  if (type === 1) return "SELL";
  return String(type);
}

export function PositionsPanel({ symbol, positions, busy, onCloseTicket }: Props) {
  const rows = positions.filter((p) => p.symbol === symbol);

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Positions</h3>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Ticket</th>
              <th>Type</th>
              <th>Volume</th>
              <th>Open Time</th>
              <th>Open</th>
              <th>Current</th>
              <th>SL</th>
              <th>TP</th>
              <th>Profit</th>
              <th>Swap</th>
              <th>Commission</th>
              <th>Comment</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={14}>No open positions for {symbol}</td>
              </tr>
            )}
            {rows.map((p) => (
              <tr key={p.ticket}>
                <td>{p.symbol}</td>
                <td>{p.ticket}</td>
                <td className={p.type === 0 ? "buy-text" : p.type === 1 ? "sell-text" : ""}>{positionTypeLabel(p.type)}</td>
                <td>{p.volume?.toFixed?.(2) ?? "-"}</td>
                <td>{p.openTime ? new Date(p.openTime * 1000).toLocaleString() : "-"}</td>
                <td>{p.openPrice?.toFixed?.(2) ?? "-"}</td>
                <td>{p.currentPrice?.toFixed?.(2) ?? "-"}</td>
                <td>{p.sl?.toFixed?.(2) ?? "-"}</td>
                <td>{p.tp?.toFixed?.(2) ?? "-"}</td>
                <td className={p.profit >= 0 ? "profit-up" : "profit-down"}>{p.profit?.toFixed?.(2) ?? "-"}</td>
                <td>{p.swap?.toFixed?.(2) ?? "-"}</td>
                <td>{p.commission?.toFixed?.(2) ?? "-"}</td>
                <td>{p.comment || "-"}</td>
                <td>
                  <button
                    disabled={busy}
                    className="icon-close-btn"
                    onClick={() => void onCloseTicket(p.ticket)}
                    title={`Close ticket ${p.ticket}`}
                    aria-label={`Close ticket ${p.ticket}`}
                  >
                    <X size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
