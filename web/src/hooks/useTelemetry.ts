import { useEffect, useState } from "react";
import { fetchState } from "../api/client";
import type { TelemetryState } from "../types";

export function useTelemetry(intervalMs = 1000) {
  const [state, setState] = useState<TelemetryState>({});
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let active = true;

    const tick = async () => {
      try {
        const next = await fetchState();
        if (!active) return;
        setState(next);
        setError("");
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    tick();
    const id = window.setInterval(tick, intervalMs);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [intervalMs]);

  return { state, error };
}

