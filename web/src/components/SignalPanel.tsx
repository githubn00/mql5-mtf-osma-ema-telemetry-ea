import { Activity, ArrowDown, ArrowUp, ShieldCheck } from "lucide-react";
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
        <h3><Activity size={15} className="icon" />Signals</h3>
      </div>
      <div className="meta-grid">
        <div className="meta-row"><ArrowUp size={13} className="icon" />OsMA Buy/Sell: {aligned.osmaBuy ?? 0} / {aligned.osmaSell ?? 0}</div>
        <div className="meta-row"><ArrowDown size={13} className="icon" />EMA Buy/Sell: {aligned.emaBuy ?? 0} / {aligned.emaSell ?? 0}</div>
        <div className="meta-row">
          <ShieldCheck size={13} className="icon" />
          Strong: osmaBuy={String(!!strong.osmaBuy)} osmaSell={String(!!strong.osmaSell)} emaBuy={String(!!strong.emaBuy)} emaSell={String(!!strong.emaSell)}
        </div>
      </div>
    </section>
  );
}
