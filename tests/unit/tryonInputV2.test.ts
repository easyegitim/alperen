import { describe, expect, it } from "vitest";
import { PRESET_BY_ID } from "@/content/presets";
import { TRYON_IMAGE_MAX_BYTES, TryonInput, TryonInputV2, TryonInputV2Raw, decodeJpegLimited, normalizeTryonInput } from "@/lib/api/tryonInput";
import { GLOW_UP_GATE, TRYON_COMBO_MIN_PARTS, TRYON_IMAGE_MODEL_DEFAULT, TRYON_QC_MAX_REGEN_DEFAULT, TRYON_QC_MODEL_DEFAULT, getTryonConfig } from "@/lib/config/tryon";
import { MASK_REGIONS, QC_REASONS, QcVerdict, TRYON_EVENT_STATUSES, TRYON_MODES, TRYON_RELEASE_GATE, maskRegionFor, qcPass, type QcReason } from "@/lib/tryon/types";

const jpeg = (bytes: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes - 4, 1)]).toString("base64");
const image = jpeg(400);
const id = () => crypto.randomUUID();

describe("TryonInput v2 (CONTRACTS_V2 Sprint 2; KB §7.1–7.2)", () => {
  it("eski { presetId, image } gövdesi bir sürüm daha kabul edilir ve style moduna normalize olur", () => {
    expect(TryonInput.safeParse({ clientRequestId: id(), presetId: "buzz_cut", image }).success).toBe(true);
    const r = TryonInputV2.safeParse({ clientRequestId: id(), presetId: "van_dyke", image });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.mode).toBe("style");
      expect(r.data.presets).toEqual({ beard: "van_dyke" });
      expect(r.data.legacy).toBe(true);
      expect(r.data.analysisId).toBeNull();
      expect(r.data.layers).toEqual([]);
    }
    expect(TryonInputV2Raw.safeParse({ clientRequestId: id(), presetId: "van_dyke", presets: { hair: "buzz_cut" }, image }).success).toBe(false);
  });

  it("style: tam bir preset; preset türü yuvaya uymalı; bilinmeyen preset reddedilir", () => {
    expect(TryonInputV2Raw.safeParse({ clientRequestId: id(), mode: "style", presets: { hair: "buzz_cut" }, image }).success).toBe(true);
    expect(TryonInputV2Raw.safeParse({ clientRequestId: id(), mode: "style", presets: {}, image }).success).toBe(false);
    expect(TryonInputV2Raw.safeParse({ clientRequestId: id(), mode: "style", presets: { hair: "van_dyke" }, image }).success).toBe(false);
    expect(TryonInputV2Raw.safeParse({ clientRequestId: id(), mode: "style", presets: { hair: "uydurma" }, image }).success).toBe(false);
    expect(TryonInputV2Raw.safeParse({ clientRequestId: id(), mode: "style", presets: { hair: "buzz_cut", beard: "goatee" }, image }).success).toBe(false);
  });

  it("sürüm kapısında gizlenen (hidden) stil hiçbir gövdede kabul edilmez (KB §7.3/4)", () => {
    const p = PRESET_BY_ID.get("buzz_cut")!;
    p.hidden = true;
    try {
      expect(TryonInputV2Raw.safeParse({ clientRequestId: id(), mode: "style", presets: { hair: "buzz_cut" }, image }).success).toBe(false);
      expect(TryonInputV2Raw.safeParse({ clientRequestId: id(), presetId: "buzz_cut", image }).success).toBe(false);
      expect(TryonInputV2Raw.safeParse({ clientRequestId: id(), mode: "combo", presets: { hair: "buzz_cut", beard: "goatee" }, image }).success).toBe(false);
    } finally {
      delete p.hidden;
    }
    expect(TryonInputV2Raw.safeParse({ clientRequestId: id(), mode: "style", presets: { hair: "buzz_cut" }, image }).success).toBe(true);
  });

  it("combo: saç + sakal zorunlu, renk isteğe bağlı; mode verilmezse parçalardan çıkarılır", () => {
    expect(TRYON_COMBO_MIN_PARTS).toBe(2);
    expect(TryonInputV2Raw.safeParse({ clientRequestId: id(), mode: "combo", presets: { hair: "buzz_cut", beard: "goatee", color: "jet_black" }, image }).success).toBe(true);
    expect(TryonInputV2Raw.safeParse({ clientRequestId: id(), mode: "combo", presets: { hair: "buzz_cut", color: "jet_black" }, image }).success).toBe(false);
    const inferred = TryonInputV2.safeParse({ clientRequestId: id(), presets: { hair: "buzz_cut", beard: "goatee" }, image });
    expect(inferred.success && inferred.data.mode).toBe("combo");
    const single = TryonInputV2.safeParse({ clientRequestId: id(), presets: { color: "jet_black" }, image });
    expect(single.success && single.data.mode).toBe("style");
  });

  it("glow_up: analysisId zorunlu; planStepIds ve layers yalnız bu modda; layers yoksa hepsi", () => {
    expect(TryonInputV2Raw.safeParse({ clientRequestId: id(), mode: "glow_up", image }).success).toBe(false);
    const r = TryonInputV2.safeParse({ clientRequestId: id(), mode: "glow_up", analysisId: id(), image, planStepIds: ["st_spf", "buzz_cut"] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.layers).toEqual(["hair", "beard", "skin"]);
      expect(r.data.planStepIds).toEqual(["st_spf", "buzz_cut"]);
      expect(r.data.presets).toEqual({});
    }
    const only = TryonInputV2.safeParse({ clientRequestId: id(), mode: "glow_up", analysisId: id(), image, layers: ["skin"] });
    expect(only.success && only.data.layers).toEqual(["skin"]);
    expect(TryonInputV2Raw.safeParse({ clientRequestId: id(), mode: "style", presets: { hair: "buzz_cut" }, image, planStepIds: ["st_spf"] }).success).toBe(false);
  });

  it("görsel: JPEG ≤ 1,5 MB; mask isteğe bağlı; normalize biçim görseli olduğu gibi taşır (bellek)", () => {
    const raw = TryonInputV2Raw.parse({ clientRequestId: id(), mode: "style", presets: { hair: "buzz_cut" }, image, mask: "AAAA" });
    const n = normalizeTryonInput(raw);
    expect(n.image).toBe(image);
    expect(n.mask).toBe("AAAA");
    expect(decodeJpegLimited(image, TRYON_IMAGE_MAX_BYTES)).toHaveProperty("bytes");
    expect(decodeJpegLimited(Buffer.from("not a jpeg at all, definitely").toString("base64"), TRYON_IMAGE_MAX_BYTES)).toEqual({ error: "BAD_INPUT" });
  });
});

describe("lib/tryon/types: modlar, maske bölgeleri, kalite kontrolü", () => {
  it("sözlükler sabit", () => {
    expect(TRYON_MODES).toEqual(["style", "combo", "glow_up"]);
    expect(MASK_REGIONS).toEqual(["below_brows", "above_lip", "features_only", "features_cheeks", "hair_only", "beard_only"]);
    expect(TRYON_EVENT_STATUSES).toContain("qc_failed");
    expect(QC_REASONS).toContain("stray_hair_left");
    expect(TRYON_RELEASE_GATE).toEqual({ faces: 30, beardStyles: 12, images: 360, minPassRate: 0.95, hideStyleBelow: 0.9 });
  });

  it("maske seçimi: glow_up → features_only; sakal varsa features_cheeks; yalnız saç/renk → below_brows", () => {
    expect(maskRegionFor("glow_up", {})).toBe("features_only");
    expect(maskRegionFor("combo", { hair: "buzz_cut", beard: "goatee" })).toBe("features_cheeks");
    expect(maskRegionFor("style", { beard: "clean_shaven" })).toBe("features_cheeks");
    expect(maskRegionFor("style", { hair: "buzz_cut" })).toBe("below_brows");
    expect(maskRegionFor("style", { color: "jet_black" })).toBe("below_brows");
  });

  it("qcPass kodda türetilir: kimlik, stil, stil dışı sakal ve büyük bozukluk; şema geçer", () => {
    const ok = { reasons: [] as QcReason[], identityKept: true, styleApplied: true, strayHairCleared: true, artifacts: "minor" as const };
    expect(qcPass(ok)).toBe(true);
    expect(qcPass({ ...ok, identityKept: false })).toBe(false);
    expect(qcPass({ ...ok, strayHairCleared: false })).toBe(false);
    expect(qcPass({ ...ok, artifacts: "major" })).toBe(false);
    expect(qcPass({ ...ok, reasons: ["face_shape_changed"] })).toBe(false);
    expect(qcPass({ ...ok, reasons: ["multiple_faces"] })).toBe(false);
    expect(QcVerdict.safeParse({ pass: true, ...ok }).success).toBe(true);
    expect(QcVerdict.safeParse({ pass: true, ...ok, reasons: ["uydurma"] }).success).toBe(false);
  });
});

describe("lib/config/tryon: env ve varsayılanlar (model uydurulmaz)", () => {
  it("varsayılanlar: bugünkü Gemini görsel modeli, Claude kalite kontrolü açık, ≤ 2 yeniden üretim, ağırlıklar 1 (yer tutucu)", () => {
    const c = getTryonConfig({});
    expect(c.imageModel).toBe(TRYON_IMAGE_MODEL_DEFAULT);
    expect(TRYON_IMAGE_MODEL_DEFAULT).toBe("gemini-3.1-flash-lite-image");
    expect(c.qc).toBe("on");
    expect(c.qcModel).toBe(TRYON_QC_MODEL_DEFAULT);
    expect(c.qcEffort).toBe("low");
    expect(c.qcMaxRegen).toBe(TRYON_QC_MAX_REGEN_DEFAULT);
    expect(TRYON_QC_MAX_REGEN_DEFAULT).toBe(2);
    expect(c.weights).toEqual({ style: 1, combo: 1, glow_up: 1 });
    expect(c.weightsPlaceholder).toBe(true);
  });

  it("env: TRYON_IMAGE_MODEL > GEMINI_IMAGE_MODEL; geçersiz değerler varsayılana düşer", () => {
    expect(getTryonConfig({ GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image" }).imageModel).toBe("gemini-3.1-flash-image");
    expect(getTryonConfig({ GEMINI_IMAGE_MODEL: "a", TRYON_IMAGE_MODEL: "b" }).imageModel).toBe("b");
    expect(getTryonConfig({ TRYON_QC: "off" }).qc).toBe("off");
    expect(getTryonConfig({ TRYON_QC: "maybe" }).qc).toBe("on");
    expect(getTryonConfig({ TRYON_QC_MAX_REGEN: "7" }).qcMaxRegen).toBe(2);
    expect(getTryonConfig({ TRYON_QC_MAX_REGEN: "0" }).qcMaxRegen).toBe(0);
    expect(getTryonConfig({ TRYON_QC_EFFORT: "high" }).qcEffort).toBe("high");
    expect(getTryonConfig({ TRYON_WEIGHT_GLOW_UP: "2", TRYON_WEIGHT_COMBO: "9" }).weights).toEqual({ style: 1, combo: 1, glow_up: 2 });
  });

  it("glow-up kapıları: doku oranı bandı ve ton kayması sınırı; yer tutucu işaretli", () => {
    expect(GLOW_UP_GATE.minTextureRatio).toBeLessThan(1);
    expect(GLOW_UP_GATE.maxTextureRatio).toBeGreaterThan(1);
    expect(GLOW_UP_GATE.featuresOnlyOpacity).toBe(0.8);
    expect(GLOW_UP_GATE.placeholder).toBe(true);
  });
});
