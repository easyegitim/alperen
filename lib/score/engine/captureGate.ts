import "server-only";

import { classifyFaceShape } from "@/lib/face/faceShape";
import type { GeometryResult } from "@/lib/face/types";

// Sunucu çekim kapısı, v2 (KB R1-E12/E14, PLAN 1d): ışık, netlik ve poz artık reddetmez (istemcide uyarı pop-up'ı;
// kullanıcı "Evet" dediyse çekim kabul edilir). Sunucu yalnız "yüz yok" durumunu durdurur: geometri oranları sonlu
// değilse ya da ölçek bozuksa (kurcalanmış/boş istemci) NO_FACE. reserve_analysis'ten ÖNCE çalışır; hak düşmez.
// Yüz şekli sunucuda aynı fs-v2 fonksiyonuyla yeniden hesaplanır (face_shape sütunu ve device_result tek kaynak).

export type CaptureGateResult = { ok: true; faceShape: GeometryResult["faceShape"] } | { ok: false; reason: "no_face" };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function checkServerCapture(g: GeometryResult): CaptureGateResult {
  const m = g.metrics;
  const core = [m.lengthRatio, m.jawRatio, m.foreheadRatio, m.fwhr, m.canthalTiltDeg, m.lowerToMiddle, m.thirds.middle, m.thirds.lower];
  if (!core.every(finite)) return { ok: false, reason: "no_face" };
  // Oranlar pozitif olmalı (yüz yoksa istemci bunları üretemez); şema zaten aralık uygular, burası son savunma.
  if (m.lengthRatio <= 0 || m.jawRatio <= 0 || m.foreheadRatio <= 0 || m.fwhr <= 0) return { ok: false, reason: "no_face" };
  return { ok: true, faceShape: classifyFaceShape(m) };
}

/** Rotanın satıra yazacağı geometri: geometry.faceShape sunucu hesabıyla değiştirilir (face_shape sütunuyla aynı). */
export function withServerFaceShape(g: GeometryResult, faceShape: GeometryResult["faceShape"]): GeometryResult {
  return { ...g, faceShape };
}
