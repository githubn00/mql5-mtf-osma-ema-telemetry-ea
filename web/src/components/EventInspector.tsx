import type { ActionRecord, ChartEvent } from "../types";

interface Props {
  event: ChartEvent | null;
  actions: ActionRecord[];
}

export function EventInspector({ event, actions }: Props) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Event Inspector</h3>
      </div>
      {!event ? <div className="muted">Click a marker/candle to inspect nearest event.</div> : (
        <pre className="code">{JSON.stringify(event, null, 2)}</pre>
      )}

      <h4>Recent Actions</h4>
      <div className="actions-list">
        {actions.length === 0 && <div className="muted">No actions yet.</div>}
        {actions.map((a) => (
          <div key={a.id} className="action-item">
            <strong>{a.action.toUpperCase()}</strong> {a.symbol}
            {typeof a.lot === "number" ? ` lot=${a.lot}` : ""}
            {typeof a.ticket === "number" ? ` ticket=${a.ticket}` : ""}
            {" "}
            <span className="muted">{a.acceptedAt}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

