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
        <h3>Trade Controls (Signal-only)</h3>
      </div>
      <div className="buttons">
        <button disabled={busy} className="buy" onClick={() => void run("buy")}>Buy</button>
        <button disabled={busy} className="sell" onClick={() => void run("sell")}>Sell</button>
        <button disabled={busy} className="close" onClick={() => void run("close_all")}>Close All</button>
      </div>
    </section>
  );
}
