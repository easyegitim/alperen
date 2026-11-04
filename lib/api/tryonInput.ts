import { z } from "zod";
import { ALL_PRESETS, PRESET_BY_ID } from "@/content/presets";
import { TRYON_COMBO_MIN_PARTS } from "@/lib/config/tryon";
import { GLOW_UP_LAYERS, TRYON_MODES, TryonPresets, type TryonMode } from "@/lib/tryon/types";

/** SPEC 14: JPEG ≤ 1,5 MB; geçerli preset. */
export const TRYON_IMAGE_MAX_BYTES = 1.5 * 1024 * 1024;
const PRESET_IDS = ALL_PRESETS.map((p) => p.id) as [string, ...string[]];
const B64_MAX = Math.ceil((TRYON_IMAGE_MAX_BYTES * 4) / 3) + 4;

/** ESKİ gövde (v1): { clientRequestId, presetId, image, mask? }. Bir sürüm daha kabul edilir (mobil M9); yeni istemci v2 gönderir. */
export const TryonInput = z.object({
  clientRequestId: z.uuid(),
  presetId: z.enum(PRESET_IDS),
  /** base64 JPEG, 1024 px kare kırpım. */
  image: z.string().min(100).max(B64_MAX),
  /** TRYON_PROVIDER=fal için istemcide segmenter saç sınıfından üretilen maske (base64 PNG), isteğe bağlı. */
  mask: z.string().max(B64_MAX).optional(),
});
export type TryonInput = z.infer<typeof TryonInput>;

// ─── v2 gövde (CONTRACTS_V2 Sprint 2; KB §7.1–7.2, PLAN 5b/5d) ──────────────────────────────────────────────────
// { clientRequestId, analysisId?, mode: style|combo|glow_up, presets: {hair?, beard?, color?}, image, mask?, planStepIds?, layers? }
// + eski { presetId } takma adı: mode "style", presets[preset.kind] = presetId. Görsel yalnız bellekte; sunucu yazmaz.

export const TryonInputV2Raw = z
  .object({
    clientRequestId: z.uuid(),
    /** Glow-up ve "Dene" bağı için analiz kimliği (plan adımları bu analizin raporundan). */
    analysisId: z.uuid().optional(),
    mode: z.enum(TRYON_MODES).optional(),
    presets: TryonPresets.optional(),
    /** ESKİ takma ad: tek preset. presets ile birlikte gönderilemez. */
    presetId: z.enum(PRESET_IDS).optional(),
    image: z.string().min(100).max(B64_MAX),
    mask: z.string().max(B64_MAX).optional(),
    /** Glow-up: uygulanmış plan adımı kimlikleri (katalog/yöntem id; kod doğrular, bilinmeyen düşer). */
    planStepIds: z.array(z.string().max(80)).max(10).optional(),
    /** Glow-up adım anahtarları (KB §7.2): yoksa hepsi. */
    layers: z.array(z.enum(GLOW_UP_LAYERS)).max(GLOW_UP_LAYERS.length).optional(),
  })
  .superRefine((raw, ctx) => {
    if (raw.presetId && raw.presets) ctx.addIssue({ code: "custom", message: "preset_alias_with_presets" });
    const mode: TryonMode = raw.mode ?? (raw.presetId ? "style" : inferMode(raw.presets));
    const presets = raw.presetId ? presetsFromAlias(raw.presetId) : (raw.presets ?? {});
    for (const [slot, id] of Object.entries(presets) as [keyof TryonPresets, string | undefined][]) {
      if (!id) continue;
      const p = PRESET_BY_ID.get(id);
      if (!p) ctx.addIssue({ code: "custom", message: `unknown_preset_${slot}` });
      else if (p.kind !== slot) ctx.addIssue({ code: "custom", message: `preset_kind_mismatch_${slot}` });
      else if (p.hidden) ctx.addIssue({ code: "custom", message: `hidden_preset_${slot}` }); // sürüm kapısında gizlenen stil (KB §7.3/4) denenmez
    }
    const parts = countParts(presets);
    if (mode === "style" && parts !== 1) ctx.addIssue({ code: "custom", message: "style_needs_one_preset" });
    if (mode === "combo" && (parts < TRYON_COMBO_MIN_PARTS || !presets.hair || !presets.beard)) ctx.addIssue({ code: "custom", message: "combo_needs_hair_and_beard" });
    if (mode === "glow_up" && !raw.analysisId) ctx.addIssue({ code: "custom", message: "glow_up_needs_analysis" });
    if (mode !== "glow_up" && (raw.planStepIds?.length || raw.layers?.length)) ctx.addIssue({ code: "custom", message: "plan_fields_only_in_glow_up" });
  });
export type TryonInputV2Raw = z.infer<typeof TryonInputV2Raw>;

/** Rotaya giden tek normalize biçim. legacy: eski { presetId } gövdesi. */
export type TryonRequestV2 = {
  clientRequestId: string;
  analysisId: string | null;
  mode: TryonMode;
  presets: TryonPresets;
  image: string;
  mask: string | null;
  planStepIds: string[];
  layers: readonly (typeof GLOW_UP_LAYERS)[number][];
  legacy: boolean;
};

export function normalizeTryonInput(raw: TryonInputV2Raw): TryonRequestV2 {
  const legacy = raw.presetId !== undefined;
  const presets = legacy ? presetsFromAlias(raw.presetId as string) : (raw.presets ?? {});
  return {
    clientRequestId: raw.clientRequestId,
    analysisId: raw.analysisId ?? null,
    mode: raw.mode ?? (legacy ? "style" : inferMode(presets)),
    presets,
    image: raw.image,
    mask: raw.mask ?? null,
    planStepIds: raw.planStepIds ?? [],
    layers: raw.layers?.length ? raw.layers : raw.mode === "glow_up" ? GLOW_UP_LAYERS : [],
    legacy,
  };
}

export const TryonInputV2 = TryonInputV2Raw.transform(normalizeTryonInput);

function presetsFromAlias(presetId: string): TryonPresets {
  const p = PRESET_BY_ID.get(presetId);
  return p ? { [p.kind]: p.id } : {};
}
function countParts(p: TryonPresets): number {
  return [p.hair, p.beard, p.color].filter(Boolean).length;
}
/** mode verilmezse: saç+sakal (ve renk) → combo; tek parça → style. */
function inferMode(p: TryonPresets | undefined): TryonMode {
  return p && countParts(p) >= TRYON_COMBO_MIN_PARTS ? "combo" : "style";
}

export function decodeJpegLimited(base64: string, maxBytes: number): { bytes: Buffer } | { error: "IMAGE_TOO_LARGE" | "BAD_INPUT" } {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return { error: "BAD_INPUT" };
  }
  if (bytes.length > maxBytes) return { error: "IMAGE_TOO_LARGE" };
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return { error: "BAD_INPUT" };
  return { bytes };
}
