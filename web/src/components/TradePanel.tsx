import { ArrowDownRight, ArrowUpRight, Bot, CircleX } from "lucide-react";

interface Props {
  symbol: string;
  busy: boolean;
  onAction: (action: "buy" | "sell" | "close_all") => Promise<void>;
}

export function TradePanel({ symbol, busy, onAction }: Props) {
  const run = async (action: "buy" | "sell" | "close_all") => {
    const ok = window.confirm(`Send action ${action.toUpperCase()} for ${symbol}?`);
    if (!ok) return;
    await onAction(action);
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h3><Bot size={15} className="icon" />Trade Controls (Signal-only)</h3>
      </div>
      <div className="buttons">
        <button disabled={busy} className="buy" onClick={() => void run("buy")}>
          <ArrowUpRight size={14} className="icon" />Buy
        </button>
        <button disabled={busy} className="sell" onClick={() => void run("sell")}>
          <ArrowDownRight size={14} className="icon" />Sell
        </button>
        <button disabled={busy} className="close" onClick={() => void run("close_all")}>
          <CircleX size={14} className="icon" />Close All
        </button>
      </div>
    </section>
  );
}
