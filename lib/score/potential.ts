// SPEC 8.5 potansiyel skor. Saf fonksiyon.
import { POTENTIAL, SUB_WEIGHTS } from "@/lib/config/scoring";
import { SUB_KEYS, type SubKeyV1 } from "@/lib/config/teaser";
import type { ScoreOutput } from "@/lib/ai/scoreSchema";
import { round1 } from "./calibration";

export type PotentialInput = {
  /** Ham (kalibre edilmemiş) alt skorlar. */
  rawSubscores: Record<SubKeyV1, number>;
  gains: ScoreOutput["achievableGain"];
  /** Kalibre genel skor. */
  overall: number;
  bodyFatContextAllowed: boolean;
  /** Kullanıcının sakal seçeneği var mı (anket beardPreference ≠ none)? */
  beardOption: boolean;
  /** Rapor varsa: kazancı plana bağlanmayan alan 0 sayılır (linkedActions). */
  linkedActions?: Partial<Record<keyof ScoreOutput["achievableGain"], string[]>>;
  calibrate: (raw: number) => number;
  /** hybrid.v1: satırın ağırlıkları (WEIGHTS_H1 veya saç hariç seti). Verilmezse SUB_WEIGHTS. */
  weights?: Record<SubKeyV1, number>;
  /** hybrid.v1: skin/hair/grooming tavanları (POTENTIAL_H1.caps). Verilmezse POTENTIAL.caps. Çene hattı jawlineCap() ile kalır. */
  caps?: Partial<Record<"skin" | "hair" | "grooming", number>>;
};

export function jawlineCap(bodyFatContextAllowed: boolean, beardOption: boolean): number {
  return bodyFatContextAllowed || beardOption ? POTENTIAL.caps.jawline : POTENTIAL.jawlineCapWithoutLever;
}

export function effectiveGain(key: SubKeyV1, input: PotentialInput): number {
  if (key === "harmony" || key === "eyes") return 0;
  const g = input.gains[key];
  if (input.linkedActions && (input.linkedActions[key]?.length ?? 0) === 0) return 0;
  const cap = key === "jawline" ? jawlineCap(input.bodyFatContextAllowed, input.beardOption) : (input.caps?.[key] ?? POTENTIAL.caps[key]);
  return Math.min(Math.max(g.value, 0), cap);
}

export function computePotentialRaw(input: PotentialInput): number {
  const w = input.weights ?? SUB_WEIGHTS;
  return SUB_KEYS.reduce((sum, k) => sum + w[k] * Math.min(10, input.rawSubscores[k] + effectiveGain(k, input)), 0);
}

export function computePotential(input: PotentialInput): number {
  const raw = computePotentialRaw(input);
  const p = Math.min(input.calibrate(raw), input.overall + POTENTIAL.maxAboveOverall, POTENTIAL.absoluteMax);
  return round1(Math.max(p, input.overall));
}
