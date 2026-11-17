// Sanal deneme v2 istek kurulumu (KB §7.1–7.2; PLAN 5b/5d; CONTRACTS_V2 S2.6/S3.1). Saf; birim testli.
// Gövde TryonInputV2Raw ile birebir; gizli (sürüm kapısında %90 altı) presetler galeriye ve gövdeye hiç girmez.
import { getPreset, visiblePresets } from "@/content/presets";
import type { Preset, PresetKind } from "@/content/types";
import type { TryonInputV2Raw } from "@/lib/api/tryonInput";
import { presetNames, resolvePresets } from "@/lib/tryon/combo";
import { GLOW_UP_LAYERS, TRYON_MODES, type GlowUpLayer, type TryonMode, type TryonPresets } from "@/lib/tryon/types";
import type { PlanStepLite } from "@/mobile/src/features/plan/viewModel";

export type Presentation = "male" | "female" | "unspecified";
export const SLOTS: readonly PresetKind[] = ["hair", "beard", "color"];

export function newRequestId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Bayraklara göre modlar: combo (FEATURE_TRYON_COMBO) ve glow_up (FEATURE_GLOW_UP) kapatılabilir. */
export function modesFor(flags: { combo: boolean; glowUp: boolean }): TryonMode[] {
  return TRYON_MODES.filter((m) => (m === "combo" ? flags.combo : m === "glow_up" ? flags.glowUp : true));
}

/** Galeri listesi: yuvanın görünür presetleri, sunuma göre süzülmüş (hidden asla). */
export function pickablePresets(kind: PresetKind, presentation: Presentation): Preset[] {
  return visiblePresets(kind).filter((p) => !p.presentation || presentation === "unspecified" || p.presentation.includes(presentation));
}

/** Derin bağlantı (`?preset=`): gizli ya da bilinmeyen preset seçime girmez. */
export function initialSelection(presetId: string | undefined): TryonPresets {
  const p = presetId ? getPreset(presetId) : undefined;
  return p && !p.hidden ? { [p.kind]: p.id } : {};
}

/** Seçim: style modunda tek yuva; combo'da yuva başına tek seçim, tekrar dokunma kaldırır. */
export function togglePreset(mode: "style" | "combo", value: TryonPresets, p: Preset): TryonPresets {
  if (p.hidden) return value;
  const next = { ...value, [p.kind]: value[p.kind] === p.id ? undefined : p.id };
  return mode === "style" ? { [p.kind]: next[p.kind] } : next;
}

export function partCount(p: TryonPresets): number {
  return SLOTS.filter((k) => p[k]).length;
}

export function canRunSelection(mode: "style" | "combo", p: TryonPresets): boolean {
  return mode === "combo" ? Boolean(p.hair && p.beard) : partCount(p) === 1;
}

export type RunRequest = { mode: TryonMode; presets: TryonPresets; layers: GlowUpLayer[]; title: string };

export function styleRequest(mode: "style" | "combo", presets: TryonPresets): RunRequest {
  return { mode, presets, layers: [], title: presetNames(resolvePresets(presets)) };
}

export function glowUpRequest(layers: readonly GlowUpLayer[], title: string): RunRequest {
  return { mode: "glow_up", presets: {}, layers: [...layers], title };
}

/**
 * POST /api/tryon v2 gövdesi: style/combo → presets; glow_up → analysisId + layers (presets yok). Görsel yalnız burada.
 * Eski `presetId` takma adı gönderilmez (sunucu bir sürüm daha kabul eder; yeni istemci v2 gövdesi yollar).
 */
export function buildTryonBody(req: RunRequest, image: string, analysisId: string | null, clientRequestId: string = newRequestId()): TryonInputV2Raw {
  if (req.mode === "glow_up") {
    return { clientRequestId, mode: "glow_up", ...(analysisId ? { analysisId } : {}), layers: req.layers.length ? req.layers : [...GLOW_UP_LAYERS], image };
  }
  const presets: TryonPresets = {};
  for (const k of SLOTS) {
    const id = req.presets[k];
    const p = id ? getPreset(id) : undefined;
    if (p && !p.hidden && p.kind === k) presets[k] = p.id;
  }
  return { clientRequestId, mode: req.mode, presets, image };
}

/** Sonuç başlığı: glow-up istenen başlık; stil/kombinde sunucunun döndürdüğü presetlerden ad. */
export function resultTitle(mode: TryonMode, presets: TryonPresets, fallback: string): string {
  if (mode === "glow_up") return fallback;
  return presetNames(resolvePresets(presets)) || fallback;
}

export const LAYER_AREAS: Record<GlowUpLayer, readonly string[]> = { hair: ["hair", "color"], beard: ["beard"], skin: ["skin", "habit"] };

/** Glow-up panelinde gösterilen plan adımları: seçili katmanların alanları. */
export function visibleGlowSteps(planSteps: readonly PlanStepLite[], layers: readonly GlowUpLayer[]): PlanStepLite[] {
  return planSteps.filter((s) => layers.some((l) => LAYER_AREAS[l].includes(s.area)));
}

export function toggleLayer(layers: readonly GlowUpLayer[], l: GlowUpLayer, on: boolean): GlowUpLayer[] {
  return on ? [...new Set([...layers, l])] : layers.filter((x) => x !== l);
}

/** Göz hizası (0–1, görsel yüksekliğine oran): kırpım uzayındaki iris noktalarından. */
export function eyeLineRatio(landmarksC: readonly { x: number; y: number }[], size: number, irisR: number, irisL: number): number | null {
  const r = landmarksC[irisR], l = landmarksC[irisL];
  if (!r || !l || size <= 0) return null;
  return Math.min(1, Math.max(0, (r.y + l.y) / 2 / size));
}

/** Kota: sunucunun döndürdüğü ağırlık (mod başına; 0014 öncesi 1) düşer. */
export function nextUsed(used: number, weight: number | undefined): number {
  return used + Math.max(1, weight ?? 1);
}
