import { describe, expect, it } from "vitest";
import { alignPointsFor, driftOk, driftPolicyFor, driftPolicyForPresets, TRYON_LIMITS } from "@/lib/tryon/composite";
import { ALIGN_POINTS, IDX } from "@/lib/face/indices";

describe("deneme geometri sapması kuralı (SPEC 10.5)", () => {
  it("saç ve renk stilleri iki yönde %3 ile sınırlı", () => {
    expect(driftPolicyFor({ kind: "hair", id: "buzz" })).toBe("symmetric");
    expect(driftPolicyFor({ kind: "color", id: "ash" })).toBe("symmetric");
    expect(driftOk({ length: 0.029, jaw: -0.029 })).toBe(true);
    expect(driftOk({ length: 0.031, jaw: 0 })).toBe(false);
    expect(driftOk({ length: 0, jaw: -0.031 })).toBe(false);
  });

  it("sakal eklemek: hacim yönünde %15'e kadar, incelme yönünde %3", () => {
    const p = driftPolicyFor({ kind: "beard", id: "short_boxed" });
    expect(p).toBe("beard_add");
    expect(driftOk({ length: 0.12, jaw: 0.08 }, p)).toBe(true);
    expect(driftOk({ length: TRYON_LIMITS.maxBeardVolumeDrift + 0.001, jaw: 0 }, p)).toBe(false);
    // çene incelirse kemik değişimi işareti: reddedilir
    expect(driftOk({ length: 0.05, jaw: -0.04 }, p)).toBe(false);
  });

  it("sakalsız stil: küçülme yönünde %15'e kadar, büyüme yönünde %3", () => {
    const p = driftPolicyFor({ kind: "beard", id: "clean_shaven" });
    expect(p).toBe("beard_remove");
    expect(driftOk({ length: -0.1, jaw: -0.06 }, p)).toBe(true);
    expect(driftOk({ length: 0.04, jaw: 0 }, p)).toBe(false);
  });

  it("sakal stillerinde hizalama çene ucunu kullanmaz", () => {
    expect(alignPointsFor("above_lip")).not.toContain(IDX.menton);
    expect(alignPointsFor("above_lip")).toHaveLength(ALIGN_POINTS.length - 1);
    expect(alignPointsFor("below_brows")).toEqual(ALIGN_POINTS);
  });
});

describe("v2: kombin sapma kuralı ve hizalama noktaları (PLAN 5a/5b; Sprint 0 tek yönlü politika aynen)", () => {
  it("driftPolicyForPresets: sakal yoksa simetrik; sakalsız stil küçülme, diğer sakal büyüme yönü", () => {
    expect(driftPolicyForPresets({ hair: "buzz_cut" })).toBe("symmetric");
    expect(driftPolicyForPresets({ hair: "buzz_cut", color: "jet_black" })).toBe("symmetric");
    expect(driftPolicyForPresets({ hair: "buzz_cut", beard: "clean_shaven" })).toBe("beard_remove");
    expect(driftPolicyForPresets({ beard: "van_dyke" })).toBe("beard_add");
    expect(driftPolicyForPresets({})).toBe("symmetric");
  });
  it("alignPointsFor: sakal bölgesini modele bırakan maskelerde çene ucu (152) hizalamaya girmez", () => {
    for (const p of ["above_lip", "features_cheeks", "beard_only"] as const) expect(alignPointsFor(p)).not.toContain(IDX.menton);
    for (const p of ["below_brows", "features_only", "hair_only"] as const) expect(alignPointsFor(p)).toContain(IDX.menton);
  });
});
