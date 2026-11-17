// Kombin ve glow-up seçim yardımcıları (KB §7.1–7.2; PLAN 5b/5d). Saf, paylaşılan (mobil ortak). Birim testli.
import { PRESET_BY_ID } from "@/content/presets";
import type { Preset } from "@/content/types";
import type { PlanArea, PlanTier } from "@/lib/config/plan";
import type { GlowUpLayer, TryonPresets } from "./types";

export type ResolvedPresets = { hair?: Preset; beard?: Preset; color?: Preset };

/** Kimliklerden preset nesneleri; bilinmeyen ya da yuvaya uymayan kimlik düşer (girdi zaten Zod'da doğrulanır). */
export function resolvePresets(p: TryonPresets): ResolvedPresets {
  const out: ResolvedPresets = {};
  for (const slot of ["hair", "beard", "color"] as const) {
    const id = p[slot];
    const preset = id ? PRESET_BY_ID.get(id) : undefined;
    if (preset && preset.kind === slot) out[slot] = preset;
  }
  return out;
}

/** tryon_events.preset_id uyumluluğu: saç > sakal > renk ilk dolu değer (CONTRACTS_V2 S2.7). */
export function legacyPresetId(p: TryonPresets): string {
  return p.hair ?? p.beard ?? p.color ?? "";
}

/** Kombin parçalarının insan okunur listesi (analitik değil; yalnız UI başlığı). */
export function presetNames(p: ResolvedPresets): string {
  return [p.hair, p.beard, p.color].filter((x): x is Preset => Boolean(x)).map((x) => x.nameTr).join(" + ");
}

/** Plan adımının glow-up için gereken kısmı (PlanV2 StepCard ya da katalog MethodRecord alt kümesi). */
export type GlowUpStepLike = { id: string; area: PlanArea; tier: PlanTier; tryonPresetId?: string };

export type GlowUpSelection = {
  /** Görselin altında yazılan uygulanmış plan adımı kimlikleri (katman süzgecinden geçenler). */
  appliedStepIds: string[];
  hairPresetId: string | null;
  beardPresetId: string | null;
  colorPresetId: string | null;
  /** Cilt değişimi istemine giren adımlar (skin alanı + alışkanlık). */
  skinStepIds: string[];
  /** Bilinmeyen (planda/katalogda olmayan) ya da doktor katmanı kimlikler — asla uygulanmaz. */
  droppedIds: string[];
};

const LAYER_AREAS: Record<GlowUpLayer, readonly PlanArea[]> = {
  hair: ["hair", "color"],
  beard: ["beard"],
  skin: ["skin", "habit"],
};

/**
 * Glow-up adım seçimi (KB §7.2 anahtarlar: yalnız saç · yalnız sakal · cilt · hepsi):
 * - requestedIds boşsa plandaki tüm adımlar; doluysa yalnız bilinenler (bilinmeyen düşer, kod doğrular).
 * - tier:"doctor" adım hiçbir zaman uygulanmaz (doktor işlemleri görselde gösterilmez).
 * - Katman süzgeci: hair → hair+color, beard → beard, skin → skin+habit; egzersiz/kaş/stil görsele girmez.
 * - Saç/sakal/renk: ilk uygun adımın tryonPresetId'si (yoksa adım kimliği preset ise o).
 */
export function selectGlowUpSteps(steps: readonly GlowUpStepLike[], requestedIds: readonly string[], layers: readonly GlowUpLayer[]): GlowUpSelection {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const droppedIds: string[] = [];
  const wanted: GlowUpStepLike[] = [];
  if (requestedIds.length === 0) wanted.push(...steps);
  else {
    for (const id of requestedIds) {
      const s = byId.get(id);
      if (s) wanted.push(s);
      else droppedIds.push(id);
    }
  }
  const allowedAreas = new Set(layers.flatMap((l) => LAYER_AREAS[l]));
  const applied: GlowUpStepLike[] = [];
  for (const s of wanted) {
    if (s.tier === "doctor") {
      droppedIds.push(s.id);
      continue;
    }
    if (!allowedAreas.has(s.area)) continue;
    if (!applied.some((a) => a.id === s.id)) applied.push(s);
  }
  const presetFor = (area: PlanArea, kind: Preset["kind"]): string | null => {
    for (const s of applied) {
      if (s.area !== area) continue;
      const id = s.tryonPresetId ?? s.id;
      const p = PRESET_BY_ID.get(id);
      if (p && p.kind === kind && !p.hidden) return p.id;
    }
    return null;
  };
  return {
    appliedStepIds: applied.map((s) => s.id),
    hairPresetId: presetFor("hair", "hair"),
    beardPresetId: presetFor("beard", "beard"),
    colorPresetId: presetFor("color", "color"),
    skinStepIds: applied.filter((s) => s.area === "skin" || s.area === "habit").map((s) => s.id),
    droppedIds,
  };
}
