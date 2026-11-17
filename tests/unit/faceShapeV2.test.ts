import { describe, expect, it } from "vitest";
import { effectiveFaceShape, reconcileFaceShape } from "@/lib/score/engine/faceShapeV2";

// Ç8 / KB §4.10: ön değerlendirme kalır; ayrışma "emin değiliz"; kullanıcı düzeltmesi önde.

const prelim = { primary: "oval" as const, confidence: 0.7 };

describe("reconcileFaceShape", () => {
  it("görüş yok → detaylı yok, agree null", () => {
    expect(reconcileFaceShape(prelim, null)).toEqual({ detailed: null, agree: null });
  });
  it("aynı şekil → agree true; farklı → agree false ve ikisi birlikte (prelim değişmez)", () => {
    const same = reconcileFaceShape(prelim, { shape: "oval", secondary: "long", reason: "Uyumlu." });
    expect(same).toEqual({ detailed: { shape: "oval", secondary: "long", reason: "Uyumlu." }, agree: true });
    const diff = reconcileFaceShape(prelim, { shape: "square", secondary: null, reason: "Yan profilde köşeler belirgin." });
    expect(diff.agree).toBe(false);
    expect(diff.detailed?.shape).toBe("square");
    expect(diff.detailed).not.toHaveProperty("secondary");
    expect(prelim.primary).toBe("oval");
  });
  it("ikinci şekil birincisiyle aynıysa düşer; neden 300 karaktere kesilir", () => {
    const r = reconcileFaceShape(prelim, { shape: "round", secondary: "round", reason: "x".repeat(500) });
    expect(r.detailed).not.toHaveProperty("secondary");
    expect(r.detailed?.reason).toHaveLength(300);
  });
});

describe("effectiveFaceShape", () => {
  it("override > uyuşan detaylı > ön değerlendirme; ayrışmada ön değerlendirme kalır (sessiz değişiklik yok)", () => {
    expect(effectiveFaceShape(prelim, { shape: "square", reason: "r" }, "heart")).toBe("heart");
    expect(effectiveFaceShape(prelim, { shape: "oval", reason: "r" }, null)).toBe("oval");
    expect(effectiveFaceShape(prelim, { shape: "square", reason: "r" }, null)).toBe("oval");
    expect(effectiveFaceShape(prelim, null, undefined)).toBe("oval");
  });
});
