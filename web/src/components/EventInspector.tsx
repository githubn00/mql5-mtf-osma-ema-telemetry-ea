import { Copy, History, Search, MousePointerClick } from "lucide-react";
import type { ActionRecord, ChartEvent } from "../types";

interface Props {
  event: ChartEvent | null;
  actions: ActionRecord[];
}

export function EventInspector({ event, actions }: Props) {
  const copyEvent = async () => {
    if (!event) return;
    await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h3><Search size={15} className="icon" />Event Inspector</h3>
      </div>
      {!event ? <div className="muted"><MousePointerClick size={13} className="icon" />Click a marker/candle to inspect nearest event.</div> : (
        <>
          <div className="event-grid">
            <div><strong>Type</strong>: {event.type}</div>
            <div><strong>TF</strong>: {event.tf}</div>
            <div><strong>Pair</strong>: {event.pair || "-"}</div>
            <div><strong>Direction</strong>: {event.direction}</div>
            <div><strong>Time</strong>: {new Date(event.time * 1000).toLocaleString()}</div>
            <div><strong>Price</strong>: {Number.isFinite(event.price) ? event.price : "-"}</div>
            <div><strong>Value</strong>: {Number.isFinite(event.value) ? event.value : "-"}</div>
            <div><strong>Bars Since Prev</strong>: {event.barsSincePrev}</div>
            <div><strong>Extremum</strong>: {event.extremumType || "-"}</div>
            <div><strong>Extremum Price</strong>: {Number.isFinite(event.extremumPrice) ? event.extremumPrice : "-"}</div>
            <div><strong>Extremum Bar</strong>: {Number.isFinite(event.extremumBar) ? event.extremumBar : "-"}</div>
            <div><strong>Phase</strong>: {event.phase || "-"}</div>
          </div>
          <div className="controls-row">
            <button onClick={() => void copyEvent()}><Copy size={13} className="icon" />Copy JSON</button>
          </div>
          <pre className="code">{JSON.stringify(event, null, 2)}</pre>
        </>
      )}

      <h4><History size={14} className="icon" />Recent Actions</h4>
      <div className="actions-list">
        {actions.length === 0 && <div className="muted">No actions yet.</div>}
        {actions.map((a) => (
          <div key={a.id} className="action-item">
            <strong>{a.action.toUpperCase()}</strong> {a.symbol} <span className="muted">{a.acceptedAt}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
