import "server-only";

import type { FaceShape, GeometryResult } from "@/lib/face/types";
import type { ClientSignalsV2 } from "@/lib/score/contract";

// Yüz şekli uzlaştırma (KB §4.10, Ç8): ön değerlendirme (cihaz geometrisi) kalır; Claude'un çoklu açı görüşü
// "detaylı sonuç"tur. Ayrışırsa sessizce değiştirilmez: ikisi birlikte ve nedeniyle gösterilir (agree=false → "emin
// değiliz"). Kullanıcının "Bence değil" seçimi (profiles.face_shape_override) her ikisinin önüne geçer. Saf.

export type FaceShapeDetailed = NonNullable<ClientSignalsV2["faceShapeDetailed"]>;
export type FaceShapeOpinion = { shape: FaceShape; secondary: FaceShape | null; reason: string } | null;

const MAX_REASON = 300;

export function reconcileFaceShape(prelim: GeometryResult["faceShape"], opinion: FaceShapeOpinion): { detailed: FaceShapeDetailed | null; agree: boolean | null } {
  if (!opinion) return { detailed: null, agree: null };
  const detailed: FaceShapeDetailed = {
    shape: opinion.shape,
    ...(opinion.secondary && opinion.secondary !== opinion.shape ? { secondary: opinion.secondary } : {}),
    reason: opinion.reason.trim().slice(0, MAX_REASON),
  };
  return { detailed, agree: detailed.shape === prelim.primary };
}

/**
 * Saç/sakal önerilerinin süzüleceği şekil: kullanıcı düzeltmesi > uyuşan detaylı sonuç > ön değerlendirme. Ayrışmada
 * ön değerlendirme kalır (sessiz değişiklik yok); kullanıcı isterse "Bence değil" ile seçer.
 */
export function effectiveFaceShape(prelim: GeometryResult["faceShape"], detailed: FaceShapeDetailed | null, override: FaceShape | null | undefined): FaceShape {
  if (override) return override;
  if (detailed && detailed.shape === prelim.primary) return detailed.shape;
  return prelim.primary;
}
