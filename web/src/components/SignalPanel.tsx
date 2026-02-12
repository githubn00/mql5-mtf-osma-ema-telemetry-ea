import type { TelemetryState } from "../types";

interface Props {
  state: TelemetryState;
}

export function SignalPanel({ state }: Props) {
  const aligned = state.live?.signals?.aligned ?? {};
  const strong = state.live?.signals?.strong ?? {};

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Signals</h3>
      </div>
      <div className="meta-grid">
        <div>OsMA Buy/Sell: {aligned.osmaBuy ?? 0} / {aligned.osmaSell ?? 0}</div>
        <div>EMA Buy/Sell: {aligned.emaBuy ?? 0} / {aligned.emaSell ?? 0}</div>
        <div>
          Strong: osmaBuy={String(!!strong.osmaBuy)} osmaSell={String(!!strong.osmaSell)}
          {" "}emaBuy={String(!!strong.emaBuy)} emaSell={String(!!strong.emaSell)}
        </div>
      </div>
    </section>
  );
}

