// Sanal deneme istemi v2 (PLAN 5a–5d; KB §7.1–7.3, Ç9). Saf; sunucuda kullanılır. Yalnız saç/sakal/renk değişir;
// sakal bölgesi (yanak, favori, çene altı, bıyık, boyun) adıyla söylenir; glow_up'ta plana bağlı cilt değişimi.
// Yüz istemciye orijinal piksellerle geri yazılır (lib/tryon/composite.ts); istem yine kimliği korumayı emreder.
import type { Preset } from "@/content/types";
import type { ResolvedPresets } from "@/lib/tryon/combo";
import type { GlowUpLayer, TryonMode } from "@/lib/tryon/types";

export const TRYON_PROMPT_VERSION_V2 = "tryon.v2";

export type GlowUpPromptInput = {
  layers: readonly GlowUpLayer[];
  /** Cilt değişimi adımları (content/skin-steps, habits kimlikleri) → İngilizce etki cümleleri. */
  skinStepIds: readonly string[];
};

export type TryonPromptInputV2 = { mode: TryonMode; presets: ResolvedPresets; glowUp?: GlowUpPromptInput };

/** Katalog adımı → görselde beklenen cilt etkisi (plana bağlı: ton eşitliği, kızarıklık, parlama, nem). Marka/ilaç yok. */
export const SKIN_STEP_EFFECTS: Record<string, string> = {
  st_cleanser_gentle: "clearer skin with fewer small blemishes",
  st_cleanser_foaming: "clearer, less oily skin with fewer small blemishes",
  st_cleanser_evening: "clearer skin with fewer small blemishes",
  st_moisturizer_light: "well-hydrated skin without flaky or tight-looking patches",
  st_moisturizer_rich: "well-hydrated skin without dry or flaky patches",
  st_spf: "more even skin tone with less sun-related redness",
  st_exfoliant_weekly: "smoother skin surface with fewer dull, rough patches",
  st_clay_mask_weekly: "less shine on the forehead, nose and chin",
  st_hydrating_serum: "plumper, well-hydrated skin",
  st_eye_area: "slightly less dark and puffy under-eye area",
  st_lip_balm: "smooth, not chapped lips",
  st_beard_oil: "softer, tidier, better-groomed beard hair",
  st_hair_conditioner: "shinier, healthier-looking hair",
  st_scalp_scrub_weekly: "a clean scalp and hairline with no visible flakes",
  // Sprint 2 katalog genişletmesi (PLAN 4e): şekillendirme, tıraş tahrişi seti, kaş/burun-kulak, gözlük hijyeni.
  st_styling_cream: "neatly styled hair with a soft, natural hold and no frizz",
  st_matte_clay: "neatly styled hair with a matte finish and visible texture, no greasy shine",
  st_sea_salt_spray: "hair with a little more natural volume and texture",
  st_heat_protect: "smoother, healthier-looking hair with less frizz and fewer split ends",
  st_shave_prep: "calm, smooth skin on the shaved areas with no razor irritation",
  st_aftershave_balm: "calm skin on the shaved areas with less redness",
  st_razor_hygiene: "clear skin on the shaved areas with no razor bumps or irritation",
  st_beard_trim_weekly: "a neatly defined beard outline on the cheeks and neck",
  st_brow_tidy: "tidy eyebrows with a clean natural outline, same thickness",
  st_brow_brush: "neatly brushed eyebrows that keep their natural shape",
  st_nose_ear_trim: "no visible nose or ear hair",
  st_glasses_clean: "clean, clear glasses lenses and no marks on the skin where they rest",
  hb_water: "fresher, less puffy-looking skin",
  hb_sleep: "fresher, more rested-looking skin and under-eye area",
  hb_sun: "more even skin tone with less sun-related redness",
  hb_salt_alcohol: "less puffy, less red-looking skin",
  hb_pillowcase: "clearer skin on the cheeks with fewer small blemishes",
  hb_no_touch: "clearer skin with fewer small blemishes",
  hb_lukewarm_shower: "well-hydrated skin and hair without dry, flaky patches",
  hb_hair_wash_rhythm: "clean, fresh-looking hair that is neither greasy nor dry",
};

const COMMON_RULES = `Keep the same person, head pose, framing, camera angle, lighting, background and clothing.
Do not change the face shape or bone structure, the eyes, nose, lips, ears, skin color or hairline. Do not slim, enlarge or reshape any part of the face.
Do not add makeup, glasses, jewelry or accessories. Keep the output the same size and aspect ratio as the input.
Photorealistic, natural result that a barber, colorist or skin-care routine could achieve.`;

/** Sakal parçası varsa: stil dışı alan tamamen temizlenir; kenarlar yumuşak, yoğunluk gerçekçi (KB §7.3). */
const BEARD_RULES = `The beard edit covers the entire beard area: cheeks, jawline, sideburns below the ear, chin, upper lip and the neck down to the collar.
Remove every hair outside the described style completely — no leftover stubble patches, no gray shadow — and show clean, naturally textured skin there.
Where the style has hair, blend soft natural edges, realistic density and direction, matching the lighting and skin tone.`;

const PART_LABEL: Record<keyof ResolvedPresets, string> = { hair: "Hair", beard: "Beard", color: "Hair color" };

function partLines(p: ResolvedPresets): string[] {
  return (["hair", "beard", "color"] as const).filter((k) => p[k]).map((k) => `${PART_LABEL[k]}: ${(p[k] as Preset).prompt}.`);
}

function untouched(p: ResolvedPresets, glow?: GlowUpPromptInput): string[] {
  const out: string[] = [];
  if (!p.hair && !p.color && !glow?.layers.includes("hair")) out.push("Do not change the hair cut, length, texture or color.");
  if (!p.beard && !glow?.layers.includes("beard")) out.push("Do not change the beard or any facial hair.");
  if (!glow?.layers.includes("skin")) out.push("Keep skin tone and skin texture exactly as they are outside the edited hair or beard area.");
  return out;
}

/** Cilt etkileri (plana bağlı); bilinen adım yoksa görsel değişmez (cilt katmanı istemde yer almaz). */
export function skinEffectLines(skinStepIds: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const id of skinStepIds) {
    const e = SKIN_STEP_EFFECTS[id];
    if (e) seen.add(e);
  }
  return [...seen];
}

export function buildTryonPromptV2(input: TryonPromptInputV2): string {
  const lines: string[] = [];
  if (input.mode === "glow_up") {
    const glow = input.glowUp ?? { layers: [], skinStepIds: [] };
    lines.push("Edit this photo to show the same person a few months after following a personal grooming plan. Apply only the changes listed below.");
    lines.push(...partLines(input.presets));
    const effects = glow.layers.includes("skin") ? skinEffectLines(glow.skinStepIds) : [];
    if (effects.length) {
      lines.push(`Skin (from the plan's skin-care steps only): ${effects.join("; ")}.`);
      lines.push("Keep every mole, freckle, scar and pore exactly where it is; keep natural pores and fine texture visible — no airbrushing, no plastic or blurred skin, no change of skin color.");
    }
    lines.push("No cosmetic procedures: no fillers, no lifts, no teeth or jaw reshaping, no whitening beyond the natural tone.");
    if (input.presets.beard) lines.push(BEARD_RULES);
    lines.push(...untouched(input.presets, glow));
  } else {
    const parts = partLines(input.presets);
    lines.push(parts.length > 1 ? "Edit this photo. Change ONLY the parts listed below, all in one consistent look:" : "Edit this photo. Change ONLY the following:");
    lines.push(...parts);
    if (input.presets.beard) lines.push(BEARD_RULES);
    lines.push(...untouched(input.presets));
  }
  lines.push(COMMON_RULES);
  return lines.join("\n");
}

/** Kalite kontrolü için beklenti cümlesi (lib/ai/tryonQc.ts). Görsel değil, yalnız stil açıklaması. */
export function describeExpectation(input: TryonPromptInputV2): string {
  const bits = partLines(input.presets).map((l) => l.replace(/\.$/, ""));
  if (input.mode === "glow_up") {
    const effects = input.glowUp?.layers.includes("skin") ? skinEffectLines(input.glowUp.skinStepIds) : [];
    if (effects.length) bits.push(`Skin: ${effects.join("; ")} (moles, freckles, scars and pores must stay)`);
    bits.push("Same person a few months into a grooming plan; no cosmetic procedures");
  }
  if (input.presets.beard) bits.push("Areas the beard style describes as shaved must be fully clean (cheeks, sideburns, neck, chin or upper lip as applicable)");
  return bits.join(". ") + ".";
}
