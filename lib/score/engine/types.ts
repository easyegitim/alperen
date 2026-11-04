import "server-only";

import type { ScoreOutput } from "@/lib/ai/scoreSchema";
import type { Observation } from "@/lib/ai/observationSchema";
import type { SampleReason } from "@/lib/ai/anthropic";
import type { ComponentKey, ItemKey, StructSub } from "@/lib/config/engine.server";
import type { SubKeyV1 } from "@/lib/config/teaser";
import type { ClientSignals, ModSub } from "@/lib/score/contract";
import type { Questionnaire } from "@/lib/questionnaire";

// hybrid.v1 motor tipleri (engine spec §1.1, §7.3; sözleşme C4). Yalnız sunucu.

export type { ComponentKey, ItemKey, StructSub };

/** Anketten gelen ve motoru etkileyen tek bağlam. Yapısal skora hiçbiri girmez (scoreStructural bunu almaz). */
export type HybridContext = {
  headCovering: boolean;
  presentation: Questionnaire["presentation"];
  beardPreference: Questionnaire["beardPreference"];
};

/** analyses.ai_usage (§7.1). cacheWrite = 5 dk + 1 sa yazımı. estUsd: lib/config/ai.server.ts AI_PRICING ile. */
export type AiUsage = {
  /** İstenen paralel örnek sayısı (OBSERVE_CALLS). */
  calls: number;
  /** Başlatılan toplam deneme (yeniden denemeler dahil). */
  attempts: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  estUsd: number;
  servedModels: string[];
};

export type ComponentSignal = { key: ComponentKey; sub: StructSub; pen: number; gate: number; status: "measured" | "not_measured" };
export type ItemSignal = { key: ItemKey; sub: ModSub; value: string; delta: number; status: "best" | "partial" | "unclear" | "not_applicable" };

/** analyses.signals (§7.3). ClientSignals kısmı tam contract.ts biçimindedir; geri kalanı yalnız sunucuda kalır. */
export type SignalsV1 = ClientSignals & {
  v: 1;
  provider: "claude" | "gemini";
  model: string;
  servedModels: string[];
  effort: string;
  promptVersion: "observe.v2";
  norms: string;
  modGain: number;
  weights: Record<SubKeyV1, number>;
  samples: { ok: number; failed: number; reasons: SampleReason[]; fallbackServed: number; earlyStop: boolean; attempts: number };
  obs: Observation;
  agreement: number;
  components: ComponentSignal[];
  items: ItemSignal[];
  raw: Record<SubKeyV1, number>;
  gains: Record<ModSub, number>;
};

/** Eski depolama biçimindeki kazançlar (generate.ts, buildFallbackReport ve effectiveGain okur). */
export type LegacyGains = ScoreOutput["achievableGain"];

/** Satıra yazılacak sonuç (iz E bunu ScoredAnalysis'e çevirir). */
export type HybridScored = {
  /** Kalibre (h1), hiçbiri null değil; hariç saç = referans 5,5. */
  subscores: Record<SubKeyV1, number>;
  rawSubscores: Record<SubKeyV1, number>;
  rawOverall: number;
  overall: number;
  potential: number;
  gains: LegacyGains;
  /** Yalnız skin, hair, brows, facialHair anahtarları; tam, büyük harfle başlayan cümleler. */
  observations: Record<string, string>;
  flags: { visibleSkinConcern: boolean; skinConcernNote: string | null; multiplePeopleOrNotAFace: false };
  /** Başarılı örnek sayısı. */
  samples: number;
  /** analyses.scoring_model: model veya "model+fallback:<sunulan>". */
  model: string;
  promptVersion: "observe.v2";
  calibrationVersion: "h1";
  engineVersion: "hybrid.v1";
  signals: SignalsV1;
  aiUsage: AiUsage;
};
