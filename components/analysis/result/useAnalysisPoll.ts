"use client";

import { useEffect, useState } from "react";
import { pollIntervalMs } from "@/components/analysis/reveal";
import { ANALYSIS_STAGES, type AnalysisStage } from "@/lib/score/contract";
import type { ClientAnalysisV2 } from "@/lib/score/present";

/** fail_stuck_jobs 2 saatte takılı sayar; istemci en çok 3 saat yoklar. */
const MAX_POLL_MS = 3 * 3_600_000;

function isClientAnalysisV2(v: unknown): v is ClientAnalysisV2 {
  if (!v || typeof v !== "object") return false;
  const r = v as { engine?: unknown; stage?: unknown; id?: unknown; sectionsReady?: unknown };
  return r.engine === "hybrid.v2" && typeof r.id === "string" && (ANALYSIS_STAGES as readonly string[]).includes(r.stage as string) && Array.isArray(r.sectionsReady);
}

/**
 * GET /api/analyses/[id] yoklaması (CONTRACTS_V2 §2.3/4): queued 3 sn, running 2 sn; completed/failed'de durur.
 * Sekme gizliyken atlanır. Yanıt sunucunun kilit kurallarından geçmiş ClientAnalysisV2'dir; istemci kilit açmaz.
 */
export function useAnalysisPoll(initial: ClientAnalysisV2): { a: ClientAnalysisV2; pollError: boolean } {
  const [a, setA] = useState(initial);
  const [pollError, setPollError] = useState(false);
  const stage: AnalysisStage = a.stage;
  const interval = pollIntervalMs(stage);

  useEffect(() => {
    if (interval === null) return;
    const started = Date.now();
    let busy = false;
    let cancelled = false;
    const tick = async () => {
      if (busy || cancelled || document.visibilityState === "hidden") return;
      if (Date.now() - started > MAX_POLL_MS) return;
      busy = true;
      try {
        const res = await fetch(`/api/analyses/${a.id}`, { credentials: "same-origin", cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json: unknown = await res.json();
        if (!cancelled && isClientAnalysisV2(json)) {
          setA(json);
          setPollError(false);
        }
      } catch {
        if (!cancelled) setPollError(true);
      } finally {
        busy = false;
      }
    };
    const id = window.setInterval(() => void tick(), interval);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [a.id, interval]);

  return { a, pollError };
}
