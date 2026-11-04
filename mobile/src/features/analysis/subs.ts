// Alt skor satırları (KB §4.8–4.9): 7 alt skor + 5 satırlık açıklama; düşük skorda geliştirilebilir alanlar önce. Saf.
import { SUB_KIND_HYBRID } from "@/lib/config/scoring";
import { SUB_KEYS_V2, type SubKey } from "@/lib/config/teaser";
import type { ExplanationV2, NotAssessedReason, ScoreV2 } from "@/lib/score/contract";
import type { Locked } from "@/lib/score/present";
import { SHARE_RULES, type ScoreShareSpec } from "@/lib/share/spec";

export type SubRowV2 = { k: SubKey; score: ScoreV2 | null; explanation: ExplanationV2 | null; notAssessed?: NotAssessedReason };

/** Düşük skorda geliştirilebilir alanlar önce, kendi içinde düşükten yükseğe; değerlendirilmeyen en sonda. */
export function orderSubsV2(rows: readonly SubRowV2[], lowScore: boolean): SubRowV2[] {
  if (!lowScore) return [...rows];
  const rank = { modifiable: 0, partial: 1, structural: 2 } as const;
  return [...rows].sort((x, y) => {
    const s = Number(Boolean(x.notAssessed)) - Number(Boolean(y.notAssessed));
    if (s !== 0) return s;
    const d = rank[SUB_KIND_HYBRID[x.k]] - rank[SUB_KIND_HYBRID[y.k]];
    if (d !== 0) return d;
    return (x.score?.value ?? 99) - (y.score?.value ?? 99);
  });
}

export function rowsFromAnalysis(a: { subscores: Record<SubKey, Locked<ScoreV2 | null>>; explanations: Record<SubKey, Locked<ExplanationV2 | null>>; notAssessed: { sub: SubKey; reason: NotAssessedReason }[] }): SubRowV2[] {
  return SUB_KEYS_V2.map((k) => ({
    k,
    score: a.subscores[k].locked ? null : a.subscores[k].value,
    explanation: a.explanations[k].locked ? null : a.explanations[k].value,
    notAssessed: a.notAssessed.find((n) => n.sub === k)?.reason,
  }));
}

/** Paylaşım kartı için en yüksek 3 açık alt skor (değerlendirilmeyen hariç). */
export function shareSubsFromRows(rows: readonly SubRowV2[], labelOf: (k: SubKey) => string): ScoreShareSpec["subs"] {
  return rows
    .filter((r): r is SubRowV2 & { score: ScoreV2 } => Boolean(r.score) && !r.notAssessed)
    .sort((x, y) => y.score.value - x.score.value)
    .slice(0, SHARE_RULES.maxSubs)
    .map((r) => ({ key: r.k, label: labelOf(r.k), value: r.score.value }));
}
