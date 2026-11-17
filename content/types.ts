import type { FaceShape } from "@/lib/face/types";
import type { Questionnaire } from "@/lib/questionnaire";

export type PresetKind = "hair" | "beard" | "color";
/**
 * Koruma bölgesi (lib/tryon/mask.ts; CONTRACTS_V2 S2.6 MASK_REGIONS ile birebir):
 * below_brows · above_lip (Sprint 0) + features_only · features_cheeks · hair_only · beard_only (PLAN 5a/5d).
 */
export type Protect = "below_brows" | "above_lip" | "features_only" | "features_cheeks" | "hair_only" | "beard_only";

/** Sakal etiketi: growth = uzamış sakal gerektirir (PLAN 4e); kısa sakalla denenirse model hacim ekler. */
export type PresetTag = "growth" | "expert" | "low_maintenance";

/** SPEC 10.2: her preset { id, kind, nameTr, suits, hairTypes?, presentation?, prompt (İngilizce), protect }. */
export type Preset = {
  id: string;
  kind: PresetKind;
  nameTr: string;
  /** Uygun yüz şekilleri; boşsa hepsi. */
  suits: FaceShape[];
  hairTypes?: Questionnaire["hairType"][];
  presentation?: Array<"male" | "female">;
  /** Görsel modele verilen İngilizce açıklama (SPEC 10.6 {preset.prompt}). */
  prompt: string;
  protect: Protect;
  /** Kısa Türkçe not (rapor promptunda id + ad + not). */
  noteTr?: string;
  /** Sürüm kapısında (KB §7.3/4, scripts/tryon-gate.ts) %90 altı kalan stil: galeride gizli, rapor/plan önerisine girmez. */
  hidden?: boolean;
  tags?: PresetTag[];
};
