import { useEffect, useState } from "react";
import { CircleDollarSign, HandCoins, ShoppingCart, TrendingDown, TrendingUp } from "lucide-react";

const LOT_PREF_KEY = "telemetry_manual_lot";

interface Props {
  symbol: string;
  busy: boolean;
  onAction: (action: "buy" | "sell" | "close_all", options?: { lot?: number }) => Promise<void>;
}

export function TradePanel({ symbol, busy, onAction }: Props) {
  const [lot, setLot] = useState(() => {
    const raw = window.localStorage.getItem(LOT_PREF_KEY);
    const value = raw ? Number(raw) : 0.01;
    return Number.isFinite(value) && value > 0 ? value : 0.01;
  });

  useEffect(() => {
    window.localStorage.setItem(LOT_PREF_KEY, String(lot));
  }, [lot]);

  const run = async (action: "buy" | "sell" | "close_all") => {
    if (action === "buy" || action === "sell") {
      const ok = window.confirm(`Send ${action.toUpperCase()} ${symbol} lot=${lot.toFixed(2)} ?`);
      if (!ok) return;
      await onAction(action, { lot });
      return;
    }

    const ok = window.confirm(`Send CLOSE ALL for ${symbol}?`);
    if (!ok) return;
    await onAction(action);
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h3><ShoppingCart size={15} className="icon" /> Trade Controls</h3>
      </div>
      <div className="lot-row">
        <label htmlFor="lot-input"><HandCoins size={14} className="icon" /> Lot Size</label>
        <input
          id="lot-input"
          type="number"
          min={0.01}
          step={0.01}
          value={lot}
          onChange={(e) => setLot(Math.max(0.01, Number(e.target.value) || 0.01))}
        />
      </div>
      <div className="buttons">
        <button disabled={busy} className="buy" onClick={() => void run("buy")}><TrendingUp size={14} className="icon" /> Buy</button>
        <button disabled={busy} className="sell" onClick={() => void run("sell")}><TrendingDown size={14} className="icon" /> Sell</button>
        <button disabled={busy} className="close" onClick={() => void run("close_all")}><CircleDollarSign size={14} className="icon" /> Close All</button>
      </div>
    </section>
  );
}
