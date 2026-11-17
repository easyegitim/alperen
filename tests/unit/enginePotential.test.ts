import { describe, expect, it } from "vitest";
import { POTENTIAL } from "@/lib/config/scoring";
import { scoreFromVotes } from "@/lib/score/engine";
import { scoreModifiable } from "@/lib/score/engine/categories";
import { deriveGains, improveFirst, reachTarget } from "@/lib/score/engine/potential";
import { LEVER_KEYS } from "@/lib/score/contract";
import { BEST_OBS, CTX, GEO, REF_OBS, UNTENDED_OBS, geo, obs } from "../helpers/engineFixtures";

describe("erişim kuralları (engine spec §6.1)", () => {
  it("blemishes/texture bir kategori iyi; diğerleri en iyi; evenness yok; belirsiz yok", () => {
    expect(reachTarget("blemishes", "many")).toBe("several");
    expect(reachTarget("blemishes", "few")).toBe("none");
    expect(reachTarget("texture", "uneven")).toBe("slightly_uneven");
    expect(reachTarget("shine", "very")).toBe("balanced");
    expect(reachTarget("lips", "dry_cracked")).toBe("smooth");
    expect(reachTarget("evenness", "uneven")).toBeNull();
    expect(reachTarget("hairNeat", "unclear")).toBeNull();
  });
});

describe("kazançlar ve potansiyel (engine spec §6.2)", () => {
  it("referans profil: tavan 2,0; yapı kazancı 0; eski gains biçimi; potansiyel 6,5", () => {
    const mod = scoreModifiable(REF_OBS, CTX);
    const { gains, subGains } = deriveGains(REF_OBS, mod);
    expect(subGains).toEqual({ skin: 2, hair: 2, grooming: 0.8 });
    expect(gains.jawline).toEqual({ value: 0, lever: "" });
    expect(Object.keys(gains).sort()).toEqual(["grooming", "hair", "jawline", "skin"]);
    expect(scoreFromVotes(GEO, CTX, REF_OBS).potential).toBe(6.5);
    expect(scoreFromVotes(GEO, CTX, REF_OBS).gains.skin.lever).toBe("Nazik temizleme ve haftalık arındırma");
  });

  it("saç hariç 6,3; iyi bakımlı 6,6 (+0); bakımsız 5,4", () => {
    expect(scoreFromVotes(GEO, { ...CTX, headCovering: true }, REF_OBS).potential).toBe(6.3);
    const best = scoreFromVotes(GEO, CTX, BEST_OBS);
    expect(best.overall).toBe(6.6);
    expect(best.potential).toBe(6.6);
    expect(best.improveFirst).toEqual([]);
    expect(scoreFromVotes(GEO, CTX, UNTENDED_OBS).potential).toBe(5.4);
  });

  it("değerlendirilmeyen veya hariç alt skor ve belirsiz öğe kazanç vermez; hedef retouch ve κ'yı korur", () => {
    const hidden = obs({ hair: { visibility: "not_visible", neatness: "untidy", shape: "grown_out" } });
    expect(deriveGains(hidden, scoreModifiable(hidden, CTX)).subGains.hair).toBe(0);
    expect(deriveGains(REF_OBS, scoreModifiable(REF_OBS, { ...CTX, headCovering: true })).subGains.hair).toBe(0);
    const filtered = obs({ photo: { retouch: "likely" } });
    // likely: pozitif cilt deltaları 0 → hedef de 0 kazandırır; dudak (bakım) etkilenmez.
    const g = deriveGains(filtered, scoreModifiable(filtered, CTX));
    expect(g.subGains.skin).toBe(0);
    expect(g.subGains.grooming).toBeCloseTo(0.8, 9);
  });

  it("overall ≤ potansiyel ≤ min(overall + 1,5, 9,5) (geniş girdi taraması)", () => {
    const geos = [GEO, geo({ metrics: { jawRatio: 1.3, symmetry: { face: 0.2, eyes: 0.2, lower: 0.2 } } })];
    for (const g of geos) {
      for (const o of [REF_OBS, BEST_OBS, UNTENDED_OBS, obs({ photo: { skinVisibility: "obscured" } }, UNTENDED_OBS)]) {
        for (const headCovering of [false, true]) {
          const r = scoreFromVotes(g, { ...CTX, headCovering }, o);
          expect(r.potential).toBeGreaterThanOrEqual(r.overall);
          expect(r.potential).toBeLessThanOrEqual(Math.min(r.overall + POTENTIAL.maxAboveOverall, POTENTIAL.absoluteMax) + 1e-9);
        }
      }
    }
  });
});

describe("önce odaklan (engine spec §6.3, sözleşme C9)", () => {
  it("referans profil: blemish +0,2 · hair styling +0,2 · lip +0,2", () => {
    expect(scoreFromVotes(GEO, CTX, REF_OBS).improveFirst).toEqual([
      { sub: "skin", lever: "lv_blemish_care", gain: 0.2 },
      { sub: "hair", lever: "lv_hair_styling", gain: 0.2 },
      { sub: "grooming", lever: "lv_lip_care", gain: 0.2 },
    ]);
  });

  it("saç hariç: blemish +0,3 · texture +0,3 · lip +0,2; saç kaldıracı yok", () => {
    expect(scoreFromVotes(GEO, { ...CTX, headCovering: true }, REF_OBS).improveFirst).toEqual([
      { sub: "skin", lever: "lv_blemish_care", gain: 0.3 },
      { sub: "skin", lever: "lv_texture_smooth", gain: 0.3 },
      { sub: "grooming", lever: "lv_lip_care", gain: 0.2 },
    ]);
  });

  it("her alt skorun en iyisi önce, sonra kazanca göre; deterministik eşitlik; en çok 3; gain > 0, azalan", () => {
    const r = scoreFromVotes(GEO, CTX, UNTENDED_OBS).improveFirst;
    expect(r.length).toBe(3);
    expect(new Set(r.map((i) => i.sub)).size).toBe(3);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].gain).toBeGreaterThanOrEqual(r[i].gain);
    for (const i of r) expect(i.gain).toBeGreaterThan(0);
    // Saç: neatness ve shape eşit (+0,4) → LEVER_KEYS sırasıyla lv_hair_styling; dudak +0,32; parlama +0,22.
    expect(r).toEqual([
      { sub: "hair", lever: "lv_hair_styling", gain: 0.4 },
      { sub: "grooming", lever: "lv_lip_care", gain: 0.3 },
      { sub: "skin", lever: "lv_shine_balance", gain: 0.2 },
    ]);
    expect(LEVER_KEYS.indexOf("lv_hair_styling")).toBeLessThan(LEVER_KEYS.indexOf("lv_haircut_refresh"));
  });

  it("minGain altı, değerlendirilmeyen alt skor, plan yolu olmayan kaş, kadın/hiçbiri için sakal, SPF hiç girmez", () => {
    const rough = obs({ grooming: { brows: "unruly", facialHair: "stubble", facialHairEdges: "untidy" }, skin: { evenness: "uneven" } });
    const male = scoreFromVotes(GEO, CTX, rough).improveFirst.map((i) => i.lever);
    expect(male).not.toContain("lv_brow_tidy");
    expect(male).not.toContain("lv_daily_spf");
    const forbidden = (ctx: typeof CTX) => {
      const mod = scoreModifiable(rough, ctx);
      return improveFirst(deriveGains(rough, mod).perItem, mod, ctx).map((i) => i.lever);
    };
    expect(forbidden({ ...CTX, presentation: "female" })).not.toContain("lv_beard_lineup");
    expect(forbidden({ ...CTX, beardPreference: "none" })).not.toContain("lv_beard_lineup");
    // Yalnız sakal hattı kazanç veriyorsa (erkek) listeye girer.
    const onlyEdges = obs({ grooming: { facialHair: "stubble", facialHairEdges: "untidy", lips: "smooth" } }, BEST_OBS);
    expect(scoreFromVotes(GEO, CTX, onlyEdges).improveFirst).toEqual([{ sub: "grooming", lever: "lv_beard_lineup", gain: 0.1 }]);
    const hidden = obs({ photo: { skinVisibility: "obscured" }, hair: { visibility: "not_visible" } });
    expect(scoreFromVotes(GEO, CTX, hidden).improveFirst.map((i) => i.sub)).toEqual(["grooming"]);
  });
});
