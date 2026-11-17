import "server-only";

import { BLEND_CLAUDE_WEIGHT, STRUCTURAL_SUBS_H2, type StructuralSource } from "@/lib/config/engine.h2.server";
import type { GeometryResult } from "@/lib/face/types";
import { scoreStructural } from "./geometry";

// Yapısal üçlü kaynağı (PLAN_V2 Ç-A, 3g): Claude cetvel puanı ile hybrid.v1 geometri bant puanı aynı ölçeğe eşlenip
// harmanlanır. Geometri bandı yalnız ceza üretir (referans 5,5; en çok −2,0) ve herkes için tek banttır; kimse bantta
// olduğu için ödül almaz. Saf; STRUCTURAL_SOURCE env ile tek ayarda claude | geometry | blend.

export type StructuralSub = (typeof STRUCTURAL_SUBS_H2)[number];

/** Geometri bant puanı (5,5 − ceza) → cetvel ölçeği: referans aynı (5,5), ceza bire bir. Ayarlanabilir tek sabit. */
export const GEOMETRY_TO_RUBRIC = { reference: 5.5, scale: 1 } as const;

export function geometryToRubric(g: number): number {
  return GEOMETRY_TO_RUBRIC.reference + (g - GEOMETRY_TO_RUBRIC.reference) * GEOMETRY_TO_RUBRIC.scale;
}

export type BlendResult = { value: number; used: StructuralSource };

/**
 * Tek alt skor için harman. geometryRaw null (ölçülemedi) ise her kaynakta Claude puanı kullanılır (ölçülemeyen
 * bileşen puan düşürmez, engine spec §3.2 ile tutarlı).
 */
export function blendStructural(claudeRaw: number, geometryRaw: number | null, source: StructuralSource, w: number = BLEND_CLAUDE_WEIGHT): BlendResult {
  if (geometryRaw === null || !Number.isFinite(geometryRaw) || source === "claude") return { value: claudeRaw, used: "claude" };
  const g = geometryToRubric(geometryRaw);
  if (source === "geometry") return { value: g, used: "geometry" };
  return { value: w * claudeRaw + (1 - w) * g, used: "blend" };
}

/** Geometriden üç yapısal ham puan (hybrid.v1 bant kodu). Hiçbir bileşen ölçülemediyse o alt skor null. */
export function structuralFromGeometry(geometry: GeometryResult, ctx: { beardOverJaw: boolean }): Record<StructuralSub, number | null> {
  const r = scoreStructural(geometry, ctx);
  const measured = (sub: StructuralSub) => r.components.some((c) => c.sub === sub && c.status === "measured");
  return Object.fromEntries(STRUCTURAL_SUBS_H2.map((s) => [s, measured(s) ? r.subs[s] : null])) as Record<StructuralSub, number | null>;
}
