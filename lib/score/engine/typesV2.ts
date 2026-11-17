import "server-only";

import type { SampleReason } from "@/lib/ai/anthropic";
import type { ScoreOutputV2 } from "@/lib/ai/scoreSchema.v2";
import type { SafetyRule } from "@/lib/ai/safety";
import type { StructuralSource } from "@/lib/config/engine.h2.server";
import type { SubKey } from "@/lib/config/teaser";
import type { AnalysisFailure, ClientSignalsV2, ReportV3, ScoreRange } from "@/lib/score/contract";
import type { AiUsage } from "./types";
import type { StructuralSub } from "./blend";

// hybrid.v2 sunucu tipleri (CONTRACTS_V2 §3.1 "analyses.signals (v2) = ClientSignalsV2 + sunucu kısmı"). Yalnız sunucu.
// İstemciye yalnız ClientSignalsV2.safeParse ile geçen kısım gider (present.ts); runs, ham puanlar ve denetim özeti gitmez.

export type { AiUsage };

export type RunsSummary = {
  requested: number;
  ok: number;
  failed: number;
  reasons: SampleReason[];
  attempts: number;
  extraRun: "none" | "done" | "skipped_time" | "skipped_max";
  maxSpread: number;
  spread: Record<SubKey, number>;
  /** Metin ve bayrakların alındığı çalıştırma (ortancaya en yakın). */
  textRun: number;
};

export type ObservationsV2 = ScoreOutputV2["observations"] & {
  glassesDetected: boolean;
  headCoveringDetected: boolean;
  hairLossSignal: ScoreOutputV2["hairLossSignal"];
  /** "… için bir dermatoloğa göstermek faydalı olabilir" (K11); denetimden geçmiş. */
  seeProfessional: string | null;
};

export type SignalsV2 = ClientSignalsV2 & {
  v: 2;
  provider: "claude";
  model: string;
  servedModels: string[];
  effort: string;
  promptVersion: "score.v2";
  calibration: { version: "h2"; center: number; sd: number };
  structuralSource: StructuralSource;
  structuralUsed: Record<StructuralSub, StructuralSource>;
  weights: Record<SubKey, number>;
  raw: Record<SubKey, number>;
  rawOverall: number;
  claudeStructural: Record<StructuralSub, number>;
  geometryStructural: Record<StructuralSub, number | null>;
  gains: Record<SubKey, number>;
  confidence: Record<SubKey, ScoreOutputV2["subscores"][SubKey]["confidence"]>;
  photo: ScoreOutputV2["photo"];
  observations: ObservationsV2;
  runs: RunsSummary;
  audit: { audited: boolean; reason?: string; rewrites: number; fallbacks: number; flags: SafetyRule[] };
  cacheHit: boolean;
  /** Son ilerleme zamanı (ISO); takılı iş tespiti (retry-on-stale). */
  progressAt: string;
  failure?: AnalysisFailure;
};

export type ScoreRangesV2 = { overall: ScoreRange; potential: ScoreRange; subscores: Partial<Record<SubKey, ScoreRange>> };

/** Satıra yazılacak tam sonuç (jobs.ts analyses + coach_reports + analysis_sets'e yazar). */
export type ScoredV2 = {
  overall: number;
  potential: number;
  /** Hariç tutulan alt skor null (ağırlık 0). */
  subscores: Record<SubKey, number | null>;
  scoreRange: ScoreRangesV2;
  percentile: number;
  faceShape: string;
  gains: Record<SubKey, number>;
  observations: ObservationsV2;
  signals: SignalsV2;
  /** Çalıştırma başına ham alt skor vektörleri (yalnız sayı); analyses.runs. */
  runs: number[][];
  report: ReportV3;
  model: string;
  promptVersion: "score.v2";
  calibrationVersion: "h2";
  engineVersion: "hybrid.v2";
  aiUsage: AiUsage;
};

/** Kart kart ilerleme (P#23): her bölüm hazır olunca satıra yazılacak sütunlar. report bölümünde coach_reports yazılır. */
export type SectionPatchV2 = {
  overall?: number;
  potential?: number;
  subscores?: Record<SubKey, number | null>;
  score_range?: ScoreRangesV2;
  percentile?: number;
  face_shape?: string;
  gains?: Record<SubKey, number>;
  observations?: ObservationsV2;
  signals?: SignalsV2;
  report?: ReportV3;
};
