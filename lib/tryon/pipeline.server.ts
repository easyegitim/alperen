import "server-only";

import type { TryonResult } from "@/lib/ai/tryonProvider";
import type { QcProvider, QcRequest } from "@/lib/ai/tryonQc";
import type { QcVerdict } from "./types";

// Üretim + kalite kontrolü döngüsü (KB §7.3 R2-C10/3, Ç10; PLAN 5c). Sağlayıcıdan bağımsız; sahte sağlayıcıyla test edilir.
// Kontrolden geçmeyen görsel en çok maxRegen kez yeniden üretilir; yine geçmezse "qc_failed": gösterilmez, hak düşmez.
// Kontrol yapılamadıysa (kapalı / sağlayıcı hatası) görsel "unchecked" olarak döner (qc null; istemci sapma kontrolü yine çalışır).

export type PipelineOutcome = "pass" | "qc_failed" | "unchecked";

export type PipelineResult = {
  outcome: PipelineOutcome;
  /** qc_failed'da null: görsel asla istemciye gitmez. */
  result: TryonResult | null;
  verdict: QcVerdict | null;
  regenCount: number;
  qcEstUsd: number;
  qcReason?: string;
};

export type PipelineArgs = {
  generate: (attempt: number) => Promise<TryonResult>;
  qc: QcProvider | null;
  qcRequest: (r: TryonResult) => QcRequest;
  maxRegen: number;
  /** Toplam süre bütçesi (ms): aşıldıysa yeniden üretim yapılmaz, son karar uygulanır. */
  budgetMs?: number;
  now?: () => number;
  signal?: AbortSignal;
};

export async function generateWithQc(a: PipelineArgs): Promise<PipelineResult> {
  const now = a.now ?? Date.now;
  const start = now();
  let regenCount = 0;
  let qcEstUsd = 0;
  let last: { result: TryonResult; verdict: QcVerdict } | null = null;
  for (let attempt = 0; attempt <= a.maxRegen; attempt++) {
    const result = await a.generate(attempt);
    if (!a.qc) return { outcome: "unchecked", result, verdict: null, regenCount, qcEstUsd };
    const out = await a.qc.check(a.qcRequest(result), a.signal);
    qcEstUsd += out.estUsd;
    if (!out.verdict) {
      console.warn(`[tryon-qc] kontrol yapılamadı (${out.reason ?? "-"}); görsel kontrolsüz döndü`);
      return { outcome: "unchecked", result, verdict: null, regenCount, qcEstUsd, qcReason: out.reason };
    }
    if (out.verdict.pass) return { outcome: "pass", result, verdict: out.verdict, regenCount, qcEstUsd };
    last = { result, verdict: out.verdict };
    const timeLeft = a.budgetMs === undefined || now() - start < a.budgetMs;
    if (attempt < a.maxRegen && timeLeft) regenCount++;
    else break;
  }
  return { outcome: "qc_failed", result: null, verdict: last?.verdict ?? null, regenCount, qcEstUsd };
}
