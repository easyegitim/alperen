import { describe, expect, it } from "vitest";
import { ObservationOutput, type Observation } from "@/lib/ai/observationSchema";
import { normalizeTr, scanReport } from "@/lib/ai/safety";
import { scoreFromVotes } from "@/lib/score/engine";
import { scoreModifiable } from "@/lib/score/engine/categories";
import { capitalizeTr, composeObservations, skinConcernNote } from "@/lib/score/engine/text";
import type { HybridContext } from "@/lib/score/engine/types";
import tr from "@/messages/tr.json";
import { CTX, GEO, REF_OBS, geo, obs } from "../helpers/engineFixtures";

const BANNED = /cirkin|kotu|kusur|zayif|problem|sorun|mantar|ortalama|\bpsl\b|\bmog|chad|incel/;
const ALLOWED_KEYS = new Set(["skin", "hair", "brows", "facialHair"]);

/** Gözlem alanlarının değer listeleri (şemadan). */
const opts = (g: keyof Observation, k: string): readonly string[] => {
  const field: unknown = (ObservationOutput.shape[g].shape as Record<string, unknown>)[k];
  return typeof field === "object" && field !== null && "options" in field && Array.isArray(field.options) ? field.options : [];
};

/** Sınırlı ama tüm enum değerlerini kapsayan kombinasyonlar (her alan her değerini en az bir kez alır). */
function* fixtureMatrix(): Generator<Observation> {
  const fields: [keyof Observation, string][] = [
    ["skin", "blemishes"],
    ["skin", "blemishZone"],
    ["skin", "texture"],
    ["skin", "evenness"],
    ["skin", "shine"],
    ["skin", "shineZone"],
    ["skin", "concernZone"],
    ["hair", "visibility"],
    ["hair", "neatness"],
    ["hair", "shape"],
    ["grooming", "brows"],
    ["grooming", "lips"],
    ["grooming", "facialHair"],
    ["grooming", "facialHairEdges"],
    ["photo", "lighting"],
    ["photo", "skinVisibility"],
    ["photo", "retouch"],
  ];
  for (const [g, k] of fields) {
    for (const v of opts(g, k)) {
      yield obs({ [g]: { [k]: v } });
      yield obs({ [g]: { [k]: v }, grooming: { facialHair: "full_beard", facialHairEdges: "untidy" }, skin: { visibleSkinConcern: true } });
    }
  }
}

const CTXS: HybridContext[] = [
  CTX,
  { ...CTX, presentation: "female" },
  { ...CTX, presentation: "unspecified", beardPreference: "none" },
  { ...CTX, headCovering: true },
];

describe("deterministik Türkçe metin (engine spec §7.4)", () => {
  it("her kalıp anahtarı tr.json'da", () => {
    const o = tr.analysis.obs;
    for (const v of opts("skin", "blemishes").filter((x) => x !== "unclear")) expect(o.skin.blemishes).toHaveProperty(v);
    for (const v of ["smooth", "slightly_uneven", "uneven"]) expect(o.skin.texture).toHaveProperty(v);
    for (const v of ["even", "mostly_even", "uneven"]) expect(o.skin.evenness).toHaveProperty(v);
    for (const v of ["balanced", "some", "very"]) expect(o.skin.shine).toHaveProperty(v);
    for (const v of ["neat", "slightly_untidy", "untidy"]) expect(o.hair.neatness).toHaveProperty(v);
    for (const v of ["defined", "softening", "grown_out"]) expect(o.hair.shape).toHaveProperty(v);
    for (const v of opts("grooming", "brows")) expect(o.brows).toHaveProperty(v);
    for (const v of ["defined", "soft", "untidy"]) expect(o.facialHair.edges).toHaveProperty(v);
    for (const v of ["smooth", "slightly_dry", "dry_cracked"]) expect(o.facialHair.lips).toHaveProperty(v);
    for (const v of opts("skin", "blemishZone")) expect(o.zone).toHaveProperty(v);
    expect(o.skinConcernNote).toContain("{zone}");
  });

  it("örnek cümle: referans cilt", () => {
    expect(composeObservations(REF_OBS, scoreModifiable(REF_OBS, CTX), CTX).skin).toBe(
      "Yanaklarda birkaç küçük aktif sivilce var; dokuda hafif pürüzlülük var; renk dağılımı büyük ölçüde eşit.",
    );
    expect(capitalizeTr("ince")).toBe("İnce");
  });

  it("tüm kombinasyonlarda: anahtarlar ⊆ {skin, hair, brows, facialHair}; büyük harf + nokta; rakam yok; güvenlik taraması temiz", () => {
    let n = 0;
    for (const o of fixtureMatrix()) {
      for (const ctx of CTXS) {
        for (const g of [GEO, geo({ quality: { yaw: 11 }, metrics: { symmetry: null } })]) {
          const r = scoreFromVotes(g, ctx, o);
          const texts = { ...r.observations, note: skinConcernNote(o) ?? "Yok." };
          for (const k of Object.keys(r.observations)) expect(ALLOWED_KEYS.has(k)).toBe(true);
          for (const t of Object.values(texts)) {
            expect(t).toMatch(/^[A-ZÇĞİÖŞÜ]/);
            expect(t.endsWith(".")).toBe(true);
            expect(t).not.toMatch(/\d/);
            expect(normalizeTr(t)).not.toMatch(BANNED);
          }
          expect(scanReport(texts, { faceContoursEnabled: false })).toEqual([]);
          if (ctx.presentation === "female" || ctx.beardPreference === "none") expect(JSON.stringify(r.observations)).not.toMatch(/Sakal/);
          if (ctx.headCovering || o.hair.visibility === "no_visible_hair") expect(r.observations).not.toHaveProperty("hair");
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(500);
  });

  it("hariç saç hair anahtarı yazmaz; görünmeyen saç 'değerlendirilmedi' der; cilt notu 'olabilir' içerir", () => {
    const covered = scoreFromVotes(GEO, { ...CTX, headCovering: true }, REF_OBS);
    expect(covered.observations).not.toHaveProperty("hair");
    expect(scoreFromVotes(GEO, CTX, obs({ hair: { visibility: "not_visible" } })).observations.hair).toBe(tr.analysis.obs.hair.notVisible);
    const note = skinConcernNote(obs({ skin: { visibleSkinConcern: true, concernZone: "cheeks" } }))!;
    expect(note).toContain("olabilir");
    expect(note.startsWith("Yanaklarda")).toBe(true);
    expect(skinConcernNote(REF_OBS)).toBeNull();
  });

  it("retouch ve sert ışık ayrı cümle; sakal hattı yalnız puanlandığında", () => {
    const o = obs({ photo: { retouch: "possible", lighting: "harsh_or_dim" } });
    const skin = composeObservations(o, scoreModifiable(o, CTX), CTX).skin!;
    expect(skin).toContain(tr.analysis.obs.skin.retouch);
    expect(skin).toContain(tr.analysis.obs.skin.harshLight);
    expect(skin).not.toMatch(/parlama var/);
    const beard = obs({ grooming: { facialHair: "short_beard", facialHairEdges: "defined" } });
    expect(composeObservations(beard, scoreModifiable(beard, CTX), CTX).facialHair).toBe("Sakal hatları net. Dudaklar hafif kuru.");
  });
});
