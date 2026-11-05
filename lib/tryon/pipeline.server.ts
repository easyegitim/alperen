import "server-only";

import type { TryonResult } from "@/lib/ai/tryonProvider";
import type { QcProvider, QcRequest } from "@/lib/ai/tryonQc";
import type { QcVerdict } from "./types";

// Üretim + kalite kontrolü döngüsü (KB §7.3 R2-C10/3, Ç10; PLAN 5c). Sağlayıcıdan bağımsız; sahte sağlayıcıyla test edilir.
// Kontrolden geçmeyen görsel en çok maxRegen kez yeniden üretilir; yine geçmezse "qc_failed": gösterilmez, hak düşmez.
// Kontrol KAPALIYSA (TRYON_QC=off, qc null) görsel "unchecked" döner (yalnız geliştirme/test; istemci sapma kontrolü yine çalışır).
// Kontrol AÇIK ama yapılamadıysa (sağlayıcı hatası, zaman aşımı, şema) bir kez daha denenir; yine olmazsa "qc_unavailable":
// kapı kapalı sayılır, görsel GÖSTERİLMEZ (Ç10: Claude kontrolü kapıdır), rota status=failed yazar (hak iade).

export type PipelineOutcome = "pass" | "qc_failed" | "qc_unavailable" | "unchecked";

export type PipelineResult = {
  outcome: PipelineOutcome;
  /** qc_failed ve qc_unavailable'da null: görsel asla istemciye gitmez. */
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
  /** Toplam süre bütçesi (ms): aşıldıysa yeniden üretim (ve kontrol tekrarı) yapılmaz, son karar uygulanır. */
  budgetMs?: number;
  now?: () => number;
  signal?: AbortSignal;
};

export async function generateWithQc(a: PipelineArgs): Promise<PipelineResult> {
  const now = a.now ?? Date.now;
  const start = now();
  const timeLeft = () => a.budgetMs === undefined || now() - start < a.budgetMs;
  let regenCount = 0;
  let qcEstUsd = 0;
  let last: { result: TryonResult; verdict: QcVerdict } | null = null;
  for (let attempt = 0; attempt <= a.maxRegen; attempt++) {
    const result = await a.generate(attempt);
    if (!a.qc) return { outcome: "unchecked", result, verdict: null, regenCount, qcEstUsd };
    let out = await a.qc.check(a.qcRequest(result), a.signal);
    qcEstUsd += out.estUsd;
    if (!out.verdict && !a.signal?.aborted && timeLeft()) {
      // Geçici hata: bir kez daha sor (görsel bellekte; yeniden üretim yok).
      console.warn(`[tryon-qc] kontrol yapılamadı (${out.reason ?? "-"}); bir kez daha deneniyor`);
      out = await a.qc.check(a.qcRequest(result), a.signal);
      qcEstUsd += out.estUsd;
    }
    if (!out.verdict) {
      console.warn(`[tryon-qc] kontrol yapılamadı (${out.reason ?? "-"}); görsel gösterilmedi (qc_unavailable)`);
      return { outcome: "qc_unavailable", result: null, verdict: null, regenCount, qcEstUsd, qcReason: out.reason };
    }
    if (out.verdict.pass) return { outcome: "pass", result, verdict: out.verdict, regenCount, qcEstUsd };
    last = { result, verdict: out.verdict };
    if (attempt < a.maxRegen && timeLeft() && !a.signal?.aborted) regenCount++;
    else break;
  }
  return { outcome: "qc_failed", result: null, verdict: last?.verdict ?? null, regenCount, qcEstUsd };
}
