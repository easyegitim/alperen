import { z } from "zod";
import type { Protect } from "@/content/types";

// Sanal deneme v2 sözlüğü (KB §7.1–7.5, Ç9, Ç10; PLAN_V2 Faz 5a–5e; CONTRACTS_V2 Sprint 2). Saf, paylaşılan (mobil ortak).
// Değişmez: yüz orijinal piksellerle geri yazılır; kemik yapısı değişmez; kontrolden geçmeyen görsel gösterilmez ve hak düşmez.
// Tek istisna "iyileşmiş halin" (glow_up): plana bağlı cilt değişimi (ton eşitliği, kızarıklık); ben/çil/iz/gözenek, yüz
// şekli, ten rengi, saç çizgisi ve kimlik korunur (Ç9). Doktor katmanındaki işlemler hiçbir görselde gösterilmez.

/** style: tek stil (eski akış) · combo: saç + sakal (+ renk) tek görselde (R1-E7) · glow_up: iyileşmiş halin (R2-C4, Ç9). */
export const TRYON_MODES = ["style", "combo", "glow_up"] as const;
export type TryonMode = (typeof TRYON_MODES)[number];

/** Seçilen presetler (content/presets kimlikleri); mod başına zorunluluk lib/api/tryonInput.ts'te. */
export const TryonPresets = z.object({
  hair: z.string().max(80).optional(),
  beard: z.string().max(80).optional(),
  color: z.string().max(80).optional(),
});
export type TryonPresets = z.infer<typeof TryonPresets>;

/** Glow-up adım anahtarları (KB §7.2): yalnız saç · yalnız sakal · cilt bakımı · hepsi. */
export const GLOW_UP_LAYERS = ["hair", "beard", "skin"] as const;
export type GlowUpLayer = (typeof GLOW_UP_LAYERS)[number];

/**
 * Bölge maskesi anahtarları (PLAN 5a/5d). below_brows ve above_lip bugünkü Protect; yenileri W5 lib/tryon/mask.ts'e ekler:
 * - features_only: göz/kaş/burun/dudak poligonları (0,8 opaklık; glow_up): cilt modele kalır, kimlik öğeleri korunur.
 * - features_cheeks: features_only + orta yanak; yanak dışı, favori, çene altı, bıyık modele kalır (sakal stilleri).
 * - hair_only: yalnız saç bölgesi değişir (yüz ovali + boyun korunur).
 * - beard_only: yalnız sakal bölgesi değişir (kaş üstü ve saç korunur).
 */
export const MASK_REGIONS = ["below_brows", "above_lip", "features_only", "features_cheeks", "hair_only", "beard_only"] as const;
export type MaskRegion = (typeof MASK_REGIONS)[number];
/** Derleme zamanı kontrolü: mevcut Protect değerleri MaskRegion'ın alt kümesi. */
const _protectIsMaskRegion: MaskRegion = "below_brows" satisfies Protect;
void _protectIsMaskRegion;

/**
 * Moda, parçalara ve glow-up katmanlarına göre maske (saf): combo'da sakal varsa yanak/favori modele kalır. glow_up yalnız
 * CİLT katmanı açıkken özellikleri korur (features_only: cilt modele kalır, KB Ç9 plana bağlı cilt değişimi); cilt katmanı
 * kapalıysa saç/sakal denemesi gibi yüz orijinal piksellerle geri yazılır (sakal varsa features_cheeks, yoksa below_brows).
 */
export function maskRegionFor(mode: TryonMode, presets: TryonPresets, layers?: readonly GlowUpLayer[]): MaskRegion {
  if (mode === "glow_up" && glowUpSkinActive(mode, layers)) return "features_only";
  if (presets.beard) return "features_cheeks";
  return "below_brows";
}

/** glow_up'ta cilt katmanı açık mı (doku kapısı ve ince doku geri yazımı yalnız o zaman). layers verilmezse hepsi açık sayılır. */
export function glowUpSkinActive(mode: TryonMode, layers?: readonly GlowUpLayer[]): boolean {
  if (mode !== "glow_up") return false;
  return layers === undefined || layers.length === 0 || layers.includes("skin");
}

/** Claude kalite kontrolü nedenleri (R2-C10/3; kapalı liste; analitik ve admin yalnız bu kodları görür). */
export const QC_REASONS = [
  "identity_changed",
  "style_not_applied",
  "stray_hair_left",
  "artifacts",
  "face_shape_changed",
  "skin_over_smoothed",
  "no_face",
  "multiple_faces",
  "unsafe_content",
] as const;
export type QcReason = (typeof QC_REASONS)[number];

/**
 * Kalite kontrolü sonucu (lib/ai/tryonQc.ts, W5). Claude'a sonuç + orijinal verilir; küçük ve düz şema (hepsi zorunlu):
 * identityKept · styleApplied · strayHairCleared · artifacts · reasons. pass'ı KOD türetir (qcPass), model değil.
 */
export const QcVerdict = z.object({
  pass: z.boolean(),
  reasons: z.array(z.enum(QC_REASONS)).max(QC_REASONS.length),
  identityKept: z.boolean(),
  styleApplied: z.boolean(),
  /** Sakalsız / Van Dyke gibi stillerde stil dışı sakal (yanak, favori) temizlendi mi (R1-E10). Saç modunda true. */
  strayHairCleared: z.boolean(),
  artifacts: z.enum(["none", "minor", "major"]),
});
export type QcVerdict = z.infer<typeof QcVerdict>;

/** Geçiş kuralı (saf): kimlik korunmuş, stil uygulanmış, stil dışı sakal temiz, büyük bozukluk yok. */
export function qcPass(v: Omit<QcVerdict, "pass">): boolean {
  return v.identityKept && v.styleApplied && v.strayHairCleared && v.artifacts !== "major" && !v.reasons.some((r) => r === "no_face" || r === "multiple_faces" || r === "unsafe_content" || r === "face_shape_changed");
}

/** tryon_events.status (migration 0014): qc_failed = kontrolden geçmedi, gösterilmedi, hak düşmedi (Ç10). */
export const TRYON_EVENT_STATUSES = ["pending", "success", "failed", "identity_drift", "qc_failed"] as const;
export type TryonEventStatus = (typeof TRYON_EVENT_STATUSES)[number];

/** POST /api/tryon v2 yanıtı. image yalnız yanıtta (bellek); sunucu yazmaz. qc null = kontrol kapalı/yapılmadı. */
export type TryonResultV2 = {
  eventId: string;
  mode: TryonMode;
  presets: TryonPresets;
  image: string;
  mimeType: string;
  model: string;
  qc: QcVerdict | null;
  /** Kaç yeniden üretim yapıldı (≤ TRYON_QC_MAX_REGEN). */
  regenCount: number;
  /** Glow-up: görselin altında yazılan uygulanmış plan adımı kimlikleri. */
  appliedStepIds: string[];
  /** Glow-up: sunucunun uyguladığı katmanlar (istemci maske/doku kapısını buna göre seçer); diğer modlarda boş. */
  layers: GlowUpLayer[];
  /** Bu istek için kotadan düşen ağırlık (lib/config/tryon weights; 0014 öncesi 1). */
  weight: number;
  /** common.aiGenerated: "Aura ile oluşturuldu · YZ simülasyonu" (K16); istemci görsele gömer. */
  label: string;
};

/** Sürüm kapısı (KB §7.3/4): 30 rızalı yüz × 12 sakal stili = 360 görsel; ≥ %95 geçmeli; %90 altı stil gizlenir. */
export const TRYON_RELEASE_GATE = { faces: 30, beardStyles: 12, images: 360, minPassRate: 0.95, hideStyleBelow: 0.9 } as const;
