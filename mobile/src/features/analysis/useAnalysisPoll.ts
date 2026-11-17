// GET /api/analyses/[id] yoklaması (CONTRACTS_V2 §2.3/4): queued 3 sn, running 2 sn; completed/failed'de durur. Uygulama
// arka plandayken atlanır. Yanıt sunucunun kilit kurallarından geçmiş ClientAnalysisV2'dir; istemci kilit açmaz.
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { ClientAnalysisV2 } from "@/lib/score/present";
import type { AuraApi } from "@/mobile/src/lib/api";
import { MAX_POLL_MS, pollIntervalMs } from "./reveal";

export function useAnalysisPoll(aura: Pick<AuraApi, "analyses">, initial: ClientAnalysisV2, onUpdate?: (a: ClientAnalysisV2) => void): { a: ClientAnalysisV2; pollError: boolean } {
  const [a, setA] = useState(initial);
  const [pollError, setPollError] = useState(false);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });
  const interval = pollIntervalMs(a.stage);

  useEffect(() => {
    if (interval === null) return;
    const started = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - started > MAX_POLL_MS) return;
      if (AppState.currentState === "active") {
        try {
          const next = await aura.analyses.get(a.id);
          if (!cancelled && next) {
            setA(next);
            onUpdateRef.current?.(next);
            setPollError(false);
          }
        } catch {
          if (!cancelled) setPollError(true);
        }
      }
      if (!cancelled) timer = setTimeout(() => void tick(), interval);
    };
    timer = setTimeout(() => void tick(), interval);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [aura, a.id, interval]);

  return { a, pollError };
}
