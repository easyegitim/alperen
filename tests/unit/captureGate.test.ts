import { describe, expect, it } from "vitest";
import { classifyFaceShape } from "@/lib/face/faceShape";
import { checkServerCapture, withServerFaceShape } from "@/lib/score/engine/captureGate";
import { GEO, geo } from "../helpers/engineFixtures";

describe("sunucu çekim kapısı v2 (KB R1-E12/E14: yalnız 'yüz yok' durdurur)", () => {
  it("iyi çekim geçer", () => {
    expect(checkServerCapture(GEO).ok).toBe(true);
  });

  it("poz, ışık ve netlik artık reddetmez (istemcide uyarı pop-up'ı; kullanıcı 'Evet' dediyse kabul)", () => {
    expect(checkServerCapture(geo({ quality: { yaw: 40, pitch: -25, roll: 20 } })).ok).toBe(true);
    expect(checkServerCapture(geo({ quality: { brightness: 30, sharpness: 5 } })).ok).toBe(true);
    expect(checkServerCapture(geo({ quality: { yaw: Number.NaN } })).ok).toBe(true);
  });

  it("yüz yok: oranlar sonlu değilse veya pozitif değilse NO_FACE (hak düşmez)", () => {
    expect(checkServerCapture(geo({ metrics: { lengthRatio: Number.NaN } }))).toEqual({ ok: false, reason: "no_face" });
    expect(checkServerCapture(geo({ metrics: { jawRatio: 0 } }))).toEqual({ ok: false, reason: "no_face" });
    expect(checkServerCapture(geo({ metrics: { thirds: { upper: null, middle: Number.POSITIVE_INFINITY, lower: 0.5 } } }))).toEqual({ ok: false, reason: "no_face" });
  });

  it("yanlış yüz şekli reddedilmez, sunucu hesabıyla (fs-v2) değiştirilir (face_shape ve geometry.faceShape aynı)", () => {
    const tampered = { ...GEO, faceShape: { primary: "diamond" as const, confidence: 1 } };
    const r = checkServerCapture(tampered);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.faceShape).toEqual(classifyFaceShape(GEO.metrics));
    const stored = withServerFaceShape(tampered, r.faceShape);
    expect(stored.faceShape).toEqual(r.faceShape);
    expect(stored.metrics).toBe(tampered.metrics);
  });

  it("üçte bir toplamı kontrolü yok: tutarsız üçte birler reddedilmez", () => {
    expect(checkServerCapture(geo({ metrics: { thirds: { upper: 0.6, middle: 0.6, lower: 0.6 }, lowerToMiddle: 3 } })).ok).toBe(true);
  });
});
