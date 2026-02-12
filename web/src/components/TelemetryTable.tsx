import { ArrowDown, ArrowUp, Table2 } from "lucide-react";
import type { TelemetryState } from "../types";

interface Props {
  state: TelemetryState;
}

export function TelemetryTable({ state }: Props) {
  const tfs = Object.entries(state.live?.per_tf_state ?? {});

  return (
    <section className="panel">
      <div className="panel-head">
        <h3><Table2 size={15} className="icon" />Per TF State</h3>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>TF</th>
              <th>Direction</th>
              <th>Phase</th>
              <th>Stabilized</th>
              <th>EMA Score</th>
              <th>OsMA Score</th>
              <th>Cross1334 Age</th>
              <th>Cross150/200 Age</th>
              <th>Extremum1334</th>
              <th>ExtBar</th>
            </tr>
          </thead>
          <tbody>
            {tfs.length === 0 && (
              <tr>
                <td colSpan={10}>No telemetry yet</td>
              </tr>
            )}
            {tfs.map(([tf, r]) => (
              <tr key={tf}>
                <td>{tf}</td>
                <td className={r.direction === "Up" ? "dir-up" : r.direction === "Down" ? "dir-down" : ""}>
                  {r.direction === "Up" && <ArrowUp size={12} className="icon" />}
                  {r.direction === "Down" && <ArrowDown size={12} className="icon" />}
                  {r.direction}
                </td>
                <td>{r.phase}</td>
                <td>{r.directionStabilized ? "YES" : "NO"}</td>
                <td>{(r.ema1334AboutScore ?? 0).toFixed(4)}</td>
                <td>{(r.osmaAboutScore ?? 0).toFixed(4)}</td>
                <td>{r.barsAfterCross1334}</td>
                <td>{r.barsAfterCross150200}</td>
                <td>{r.extremum1334 || "-"}</td>
                <td>{r.extremumBar1334 >= 0 ? r.extremumBar1334 : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
