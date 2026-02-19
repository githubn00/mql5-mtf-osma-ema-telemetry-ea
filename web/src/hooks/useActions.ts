import { useEffect, useState } from "react";
import { fetchActions, postAction } from "../api/client";
import type { ActionRecord } from "../types";

export function useActions() {
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const items = await fetchActions(50);
      setActions(items.reverse());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const submit = async (
    action: "buy" | "sell" | "close_all" | "close_ticket",
    symbol: string,
    options?: { lot?: number; ticket?: number }
  ) => {
    setBusy(true);
    setError("");
    try {
      await postAction(action, symbol, options);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };

  return { actions, error, busy, submit, refresh };
}

