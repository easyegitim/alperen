import { describe, expect, it } from "vitest";
import { BEARD_PRESETS } from "@/content/beard-presets";
import { getPreset } from "@/content/presets";
import { SKIN_STEP_IDS } from "@/content/skin-steps";
import { SKIN_STEP_EFFECTS, TRYON_PROMPT_VERSION_V2, buildTryonPromptV2, describeExpectation, skinEffectLines } from "@/lib/ai/prompts/tryon.v2";
import { resolvePresets } from "@/lib/tryon/combo";

const P = (p: Record<string, string>) => resolvePresets(p);
const buzz = getPreset("buzz_cut")!, vanDyke = getPreset("van_dyke")!, jet = getPreset("jet_black")!;

describe("deneme istemi v2 (PLAN 5a–5d; KB §7.3, Ç9)", () => {
  it("sürüm sabiti ve ortak kurallar: kimlik, kemik yapısı, ten rengi, saç çizgisi korunur", () => {
    expect(TRYON_PROMPT_VERSION_V2).toBe("tryon.v2");
    const s = buildTryonPromptV2({ mode: "style", presets: P({ hair: "buzz_cut" }) });
    expect(s).toContain(`Hair: ${buzz.prompt}.`);
    expect(s).toMatch(/Do not change the face shape or bone structure/);
    expect(s).toMatch(/skin color or hairline/);
    expect(s).toContain("Do not change the beard or any facial hair.");
    expect(s).not.toContain("Beard:");
  });
  it("sakal: bölge adıyla söylenir (yanak, favori, çene hattı, boyun) ve stil dışı kıl tamamen temizlenir; saç değişmez", () => {
    const s = buildTryonPromptV2({ mode: "style", presets: P({ beard: "van_dyke" }) });
    expect(s).toContain(`Beard: ${vanDyke.prompt}.`);
    expect(s).toMatch(/cheeks, jawline, sideburns below the ear, chin, upper lip and the neck/);
    expect(s).toMatch(/Remove every hair outside the described style completely/);
    expect(s).toContain("Do not change the hair cut, length, texture or color.");
    for (const b of BEARD_PRESETS) expect(buildTryonPromptV2({ mode: "style", presets: P({ beard: b.id }) })).toContain(b.prompt);
  });
  it("kombin: saç + sakal (+ renk) tek görselde, üç parça da listelenir; 'değişmez' satırları düşer", () => {
    const s = buildTryonPromptV2({ mode: "combo", presets: P({ hair: "buzz_cut", beard: "van_dyke", color: "jet_black" }) });
    expect(s).toContain("all in one consistent look");
    expect(s).toContain(`Hair: ${buzz.prompt}.`);
    expect(s).toContain(`Beard: ${vanDyke.prompt}.`);
    expect(s).toContain(`Hair color: ${jet.prompt}.`);
    expect(s).not.toContain("Do not change the beard");
    expect(s).not.toContain("Do not change the hair cut");
    expect(s).toContain("Keep skin tone and skin texture exactly as they are");
  });
  it("glow_up: plana bağlı cilt etkileri; ben/çil/iz/gözenek korunur; işlem yok; bilinmeyen adım etki üretmez", () => {
    const s = buildTryonPromptV2({ mode: "glow_up", presets: P({ hair: "buzz_cut" }), glowUp: { layers: ["hair", "skin"], skinStepIds: ["st_spf", "st_eye_area", "uydurma", "st_spf"] } });
    expect(s).toContain("a few months after following a personal grooming plan");
    expect(s).toContain(SKIN_STEP_EFFECTS.st_spf);
    expect(s).toContain(SKIN_STEP_EFFECTS.st_eye_area);
    expect(s).toMatch(/Keep every mole, freckle, scar and pore/);
    expect(s).toMatch(/No cosmetic procedures: no fillers/);
    expect(s).toContain("Do not change the beard or any facial hair."); // sakal katmanı kapalı
    expect(s).not.toContain("Keep skin tone and skin texture exactly"); // cilt katmanı açık
    expect(skinEffectLines(["uydurma"])).toEqual([]);
    expect(skinEffectLines(["st_spf", "hb_sun"])).toHaveLength(1); // aynı etki tekilleşir
    // cilt katmanı kapalıysa cilt satırı yok
    const noSkin = buildTryonPromptV2({ mode: "glow_up", presets: P({ hair: "buzz_cut" }), glowUp: { layers: ["hair"], skinStepIds: ["st_spf"] } });
    expect(noSkin).not.toContain("Skin (from the plan");
    expect(noSkin).toContain("Keep skin tone and skin texture exactly");
  });
  it("katalogdaki her cilt adımının etkisi tanımlı; etkilerde marka, ilaç ve işlem adı yok (K7)", () => {
    for (const id of SKIN_STEP_IDS) expect(SKIN_STEP_EFFECTS[id], id).toBeTruthy();
    for (const v of Object.values(SKIN_STEP_EFFECTS)) expect(v).not.toMatch(/retinol|tretinoin|minoxidil|finasteride|botox|filler|surgery|steroid|laser/i);
  });
  it("kalite kontrolü beklentisi: parçalar + sakalda tıraşlı alan şartı; glow_up'ta ben/çil koruması", () => {
    const e = describeExpectation({ mode: "combo", presets: P({ hair: "buzz_cut", beard: "clean_shaven" }) });
    expect(e).toContain(`Hair: ${buzz.prompt}`);
    expect(e).toMatch(/must be fully clean/);
    const g = describeExpectation({ mode: "glow_up", presets: P({}), glowUp: { layers: ["skin"], skinStepIds: ["st_spf"] } });
    expect(g).toMatch(/moles, freckles, scars and pores must stay/);
    expect(g).toMatch(/no cosmetic procedures/);
    expect(describeExpectation({ mode: "style", presets: P({ hair: "buzz_cut" }) })).not.toMatch(/fully clean/);
  });
});
