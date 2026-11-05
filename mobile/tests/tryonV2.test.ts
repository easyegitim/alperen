import { TryonInputV2Raw } from "@/lib/api/tryonInput";
import { ALL_PRESETS, visiblePresets } from "@/content/presets";
import { IDX } from "@/lib/face/indices";
import { maskRegionFor } from "@/lib/tryon/types";
import { buildTryonBody, canRunSelection, eyeLineRatio, glowUpRequest, initialSelection, modesFor, nextUsed, pickablePresets, resultTitle, styleRequest, togglePreset, toggleLayer, visibleGlowSteps } from "@/mobile/src/features/tryon/request";
import { shareTryonResult, tryonSharePlan } from "@/mobile/src/features/tryon/share";
import { stepTitle } from "@/mobile/src/features/tryon/stepTitles";

const IMAGE = "/9j/" + "a".repeat(200);
const hair = visiblePresets("hair")[0];
const beard = visiblePresets("beard")[0];
const color = visiblePresets("color")[0];
const hiddenOrFake = ALL_PRESETS.find((p) => p.hidden) ?? { ...hair, id: "hidden_fake", hidden: true };

describe("deneme v2 gövdesi (CONTRACTS_V2 S2.6; KB §7.1–7.2)", () => {
  it("tek stil: mode style + tek yuva; sunucu Zod şemasından geçer; presetId takma adı yok", () => {
    const body = buildTryonBody(styleRequest("style", { hair: hair.id }), IMAGE, null, "11111111-1111-4111-8111-111111111111");
    expect(body).toMatchObject({ mode: "style", presets: { hair: hair.id }, image: IMAGE });
    expect("presetId" in body).toBe(false);
    expect(TryonInputV2Raw.safeParse(body).success).toBe(true);
  });
  it("kombin: saç + sakal (+ renk) tek gövdede; sakal varsa maske features_cheeks", () => {
    const body = buildTryonBody(styleRequest("combo", { hair: hair.id, beard: beard.id, color: color.id }), IMAGE, null, "11111111-1111-4111-8111-111111111111");
    expect(body.mode).toBe("combo");
    expect(body.presets).toEqual({ hair: hair.id, beard: beard.id, color: color.id });
    expect(TryonInputV2Raw.safeParse(body).success).toBe(true);
    expect(maskRegionFor("combo", body.presets ?? {}, [])).toBe("features_cheeks");
  });
  it("glow-up: analysisId + layers, presets yok; cilt katmanı açıkken features_only", () => {
    const body = buildTryonBody(glowUpRequest(["skin"], "İyileşmiş halin"), IMAGE, "22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111");
    expect(body).toMatchObject({ mode: "glow_up", analysisId: "22222222-2222-4222-8222-222222222222", layers: ["skin"] });
    expect("presets" in body).toBe(false);
    expect(TryonInputV2Raw.safeParse(body).success).toBe(true);
    expect(maskRegionFor("glow_up", {}, ["skin"])).toBe("features_only");
    expect(maskRegionFor("glow_up", {}, ["hair"])).toBe("below_brows");
    // katman boşsa hepsi gönderilir
    expect(buildTryonBody(glowUpRequest([], "x"), IMAGE, "22222222-2222-4222-8222-222222222222").layers).toEqual(["hair", "beard", "skin"]);
  });
  it("gizli presetler galeriye, seçime ve gövdeye girmez", () => {
    expect(pickablePresets("hair", "unspecified").some((p) => p.hidden)).toBe(false);
    expect(pickablePresets("beard", "male").every((p) => p.kind === "beard")).toBe(true);
    expect(initialSelection(hiddenOrFake.id)).toEqual({});
    expect(initialSelection(hair.id)).toEqual({ hair: hair.id });
    expect(initialSelection("yok_boyle_bir_stil")).toEqual({});
    expect(togglePreset("combo", { hair: hair.id }, hiddenOrFake)).toEqual({ hair: hair.id });
    const body = buildTryonBody({ mode: "style", presets: { hair: "yok_boyle_bir_stil" }, layers: [], title: "" }, IMAGE, null);
    expect(body.presets).toEqual({});
  });
  it("seçim kuralları: style tek yuva, combo saç+sakal zorunlu; tekrar dokunma kaldırır", () => {
    expect(togglePreset("style", { hair: hair.id }, beard)).toEqual({ beard: beard.id });
    expect(togglePreset("combo", { hair: hair.id }, beard)).toEqual({ hair: hair.id, beard: beard.id });
    expect(togglePreset("combo", { hair: hair.id, beard: beard.id }, beard)).toEqual({ hair: hair.id, beard: undefined });
    expect(canRunSelection("style", { hair: hair.id })).toBe(true);
    expect(canRunSelection("style", { hair: hair.id, beard: beard.id })).toBe(false);
    expect(canRunSelection("combo", { hair: hair.id })).toBe(false);
    expect(canRunSelection("combo", { hair: hair.id, beard: beard.id })).toBe(true);
  });
  it("modlar bayrakla süzülür; katman/adım yardımcıları; kota ağırlığı; göz hizası", () => {
    expect(modesFor({ combo: true, glowUp: true })).toEqual(["style", "combo", "glow_up"]);
    expect(modesFor({ combo: false, glowUp: false })).toEqual(["style"]);
    expect(toggleLayer(["hair"], "skin", true)).toEqual(["hair", "skin"]);
    expect(toggleLayer(["hair", "skin"], "hair", false)).toEqual(["skin"]);
    const steps = [{ id: "st_spf", title: "Günlük SPF", area: "skin" as const }, { id: hair.id, title: "Kesim", area: "hair" as const }];
    expect(visibleGlowSteps(steps, ["skin"]).map((s) => s.id)).toEqual(["st_spf"]);
    expect(stepTitle("st_spf", steps)).toBe("Günlük SPF");
    expect(stepTitle(hair.id)).toBe(hair.nameTr);
    expect(stepTitle("bilinmeyen")).toBe("bilinmeyen");
    expect(nextUsed(2, 3)).toBe(5);
    expect(nextUsed(2, undefined)).toBe(3);
    expect(nextUsed(2, 0)).toBe(3);
    const pts = Array.from({ length: 478 }, () => ({ x: 512, y: 512 }));
    pts[IDX.irisR] = { x: 400, y: 400 };
    pts[IDX.irisL] = { x: 600, y: 420 };
    expect(eyeLineRatio(pts, 1024, IDX.irisR, IDX.irisL)).toBeCloseTo(410 / 1024);
    expect(resultTitle("glow_up", {}, "İyileşmiş halin")).toBe("İyileşmiş halin");
    expect(resultTitle("style", { hair: hair.id }, "x")).toBe(hair.nameTr);
  });
});

describe("deneme paylaşımı: etiket her görsele gömülür (K16, SPEC 10.7)", () => {
  it("plan etiketi common.aiGenerated'dır; stamp etiketle çağrılır; etiketsiz paylaşım reddedilir", async () => {
    const plan = tryonSharePlan({ eventId: "abcdefgh-1234", title: "Kısa Kesim" });
    expect(plan.label).toBe("Aura ile oluşturuldu · YZ simülasyonu");
    expect(plan.fileName).toBe("aura-deneme-abcdefgh.jpg");
    const calls: string[] = [];
    const r = await shareTryonResult("file:///cache/out.jpg", plan, { stamp: async (_uri, label) => (calls.push(label), "b64"), share: async (b64, title) => (calls.push(`${b64}:${title}`), "shared") });
    expect(r).toBe("shared");
    expect(calls).toEqual(["Aura ile oluşturuldu · YZ simülasyonu", "b64:Kısa Kesim"]);
    await expect(shareTryonResult("file:///x", { ...plan, label: " " }, { stamp: async () => "b", share: async () => "shared" })).rejects.toThrow("label_missing");
  });
});
