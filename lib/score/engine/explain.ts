import "server-only";

import type { ScoreOutputV2, SubAssessment } from "@/lib/ai/scoreSchema.v2";
import { POTENTIAL_H2, SUB_WEIGHTS_H2 } from "@/lib/config/engine.h2.server";
import { SUB_KEYS_V2, type SubKey } from "@/lib/config/teaser";
import type { ExplanationV2, ImproveItemV2 } from "@/lib/score/contract";
import { PLAN_STEP_BY_ID, isStepAllowed, isStructuralSub } from "./planSteps";
import { TEMPLATES } from "./templates";

// Alt skor açıklamaları (KB §4.9 beş satır), kazançlar, potansiyel (K2) ve "önce odaklan" (P#13). Saf.
// Yapısal alt skorlarda kazanç 0: bu alanlar bakımla değişmez; son iki satır algı/stil anlatır.

const LIMITS = { line: 200, step: 160, effect: 120 } as const;

/** Alt skor başına ham kazanç tavanı (hybrid.v1 POTENTIAL_H1.caps ile aynı). */
export const SUB_GAIN_CAP_H2 = 2.0;
/** "Önce odaklan": en çok 3 madde, genel skora en az bu kadar katkı. */
export const IMPROVE_FIRST_H2 = { n: 3, minGain: 0.05 } as const;

export const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

export function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function cleanLines(lines: readonly string[], max: number, limit: number): string[] {
  return lines.map((l) => truncate(l, limit)).filter((l) => l.length > 0).slice(0, max);
}

/** Alt skorun geçerli (kataloğa bağlı) yükseltme adımları; yapısalda kazanç 0. */
export function validRaise(sub: SubKey, a: SubAssessment): { stepId: string; step: string; effect: string; gain: number }[] {
  const seen = new Set<string>();
  const out: { stepId: string; step: string; effect: string; gain: number }[] = [];
  for (const r of a.raise) {
    if (seen.has(r.stepId) || !isStepAllowed(sub, r.stepId)) continue;
    seen.add(r.stepId);
    const step = PLAN_STEP_BY_ID.get(r.stepId);
    if (!step) continue;
    out.push({ stepId: r.stepId, step: truncate(step.nameTr, LIMITS.step), effect: truncate(r.effect, LIMITS.effect), gain: isStructuralSub(sub) ? 0 : Math.max(0, Math.min(1.5, r.gain)) });
    if (out.length === 3) break;
  }
  return out;
}

export type ExplainContext = { viewsUsed: number; lighting: ScoreOutputV2["photo"]["lighting"] };

/** Beş satır: neye baktık · ne tuttu · ne aşağı çekti · ne yapılırsa artar · güven notu. Boş satır şablonla dolar. */
export function buildExplanation(sub: SubKey, a: SubAssessment, ctx: ExplainContext): ExplanationV2 {
  const lookedAt = cleanLines(a.lookedAt, 3, LIMITS.line);
  const held = cleanLines(a.held, 3, LIMITS.line);
  const lowered = cleanLines(a.lowered, 2, LIMITS.line);
  const raise = validRaise(sub, a).map((r) => ({ step: r.step, effect: r.effect }));
  return {
    lookedAt: lookedAt.length ? lookedAt : [TEMPLATES.lookedAt(sub)],
    held: held.length ? held : [TEMPLATES.held(sub)],
    lowered,
    raise: raise.length === 0 && isStructuralSub(sub) ? [{ step: TEMPLATES.structuralRaise, effect: "" }] : raise,
    confidenceNote: TEMPLATES.confidence(ctx.viewsUsed, ctx.lighting, a.confidence),
  };
}

/** Alt skor kazançları (ham puan, tavanlı); değerlendirilmeyen ve yapısal alt skorlarda 0. */
export function subGains(out: ScoreOutputV2, excluded: ReadonlySet<SubKey>): Record<SubKey, number> {
  return Object.fromEntries(
    SUB_KEYS_V2.map((k) => {
      if (excluded.has(k) || isStructuralSub(k)) return [k, 0];
      const sum = validRaise(k, out.subscores[k]).reduce((s, r) => s + r.gain, 0);
      return [k, round2(Math.min(SUB_GAIN_CAP_H2, sum))];
    }),
  ) as Record<SubKey, number>;
}

/** h2 ağırlıkları; saç hariçse (başörtüsü / görünür saç yok) saç ağırlığı diğerlerine orantılı dağıtılır (toplam 1). */
export function weightsH2(opts: { hairExcluded: boolean }): Record<SubKey, number> {
  if (!opts.hairExcluded) return { ...SUB_WEIGHTS_H2 };
  const rest = SUB_KEYS_V2.filter((k) => k !== "hair");
  const sum = rest.reduce((s, k) => s + SUB_WEIGHTS_H2[k], 0);
  return Object.fromEntries(SUB_KEYS_V2.map((k) => [k, k === "hair" ? 0 : SUB_WEIGHTS_H2[k] / sum])) as Record<SubKey, number>;
}

export function weightedOverall(raw: Record<SubKey, number>, weights: Record<SubKey, number>): number {
  return SUB_KEYS_V2.reduce((s, k) => s + weights[k] * raw[k], 0);
}

/**
 * Potansiyel (K2): her alt skora kazancı eklenmiş ağırlıklı ham → kalibrasyon → en fazla genel + 1,5 ve en çok 9,5;
 * genelden küçük olamaz. Her kazanç bir plan adımına bağlıdır (subGains yalnız kataloğa bağlı adımları sayar).
 */
export function computePotentialH2(args: { raw: Record<SubKey, number>; gains: Record<SubKey, number>; weights: Record<SubKey, number>; overall: number; calibrate: (raw: number) => number }): { potential: number; potentialRaw: number } {
  const potentialRaw = SUB_KEYS_V2.reduce((s, k) => s + args.weights[k] * Math.min(10, args.raw[k] + args.gains[k]), 0);
  const cal = args.calibrate(potentialRaw);
  const potential = round1(Math.max(args.overall, Math.min(cal, args.overall + POTENTIAL_H2.maxAboveOverall, POTENTIAL_H2.absoluteMax)));
  return { potential, potentialRaw: round2(potentialRaw) };
}

/**
 * "Önce odaklan" (P#13, en çok 3 satır): adım kazancı × ağırlık × kalibrasyon eğimi = genel skor katkısı.
 * Önce her alt skorun en iyi adayı (ekran sırasıyla), sonra kalan yerler kazanca göre; 0,05'in altı atılır.
 */
export function improveFirstV2(out: ScoreOutputV2, weights: Record<SubKey, number>, excluded: ReadonlySet<SubKey>, slope: number): ImproveItemV2[] {
  type Cand = ImproveItemV2 & { exact: number };
  const cands: Cand[] = [];
  for (const k of SUB_KEYS_V2) {
    if (excluded.has(k) || isStructuralSub(k)) continue;
    for (const r of validRaise(k, out.subscores[k])) {
      const exact = weights[k] * Math.min(r.gain, SUB_GAIN_CAP_H2) * slope;
      if (exact < IMPROVE_FIRST_H2.minGain) continue;
      cands.push({ sub: k, stepId: r.stepId, step: r.step, gain: Math.min(1.5, round1(exact)), exact });
    }
  }
  const byGain = (a: Cand, b: Cand) => b.exact - a.exact || SUB_KEYS_V2.indexOf(a.sub) - SUB_KEYS_V2.indexOf(b.sub);
  const picked: Cand[] = [];
  for (const k of SUB_KEYS_V2) {
    const best = cands.filter((c) => c.sub === k).sort(byGain)[0];
    if (best && picked.length < IMPROVE_FIRST_H2.n) picked.push(best);
  }
  for (const c of cands.sort(byGain)) {
    if (picked.length >= IMPROVE_FIRST_H2.n) break;
    if (!picked.some((p) => p.stepId === c.stepId && p.sub === c.sub)) picked.push(c);
  }
  return picked.sort(byGain).map((c) => ({ sub: c.sub, stepId: c.stepId, step: c.step, gain: c.gain }));
}
