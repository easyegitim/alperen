import { describe, expect, it } from "vitest";
import { SCORE_V2_PROMPT_VERSION, SCORE_V2_SYSTEM, buildScoreV2UserText } from "@/lib/ai/prompts/score.v2";
import { ScoreOutputV2 } from "@/lib/ai/scoreSchema.v2";
import { normalizeTr } from "@/lib/ai/safety";
import { SUB_KEYS_V2 } from "@/lib/config/teaser";
import { planStepsForPrompt } from "@/lib/score/engine/planSteps";
import { deviceResultFromGeometry } from "@/lib/score/present";
import { GEO } from "../helpers/engineFixtures";
import { scoreOutput } from "../helpers/engineV2Fixtures";

// score.v2 istemi (PLAN_V2 3c): cetvel (7 × 5 çapa), AUP koruyucuları, Ek B dili, çoklu açı; bağlam yalnız beyan + cihaz.

describe("SCORE_V2_SYSTEM", () => {
  it("yedi alt skor için beş çapalı cetvel var", () => {
    for (const k of SUB_KEYS_V2) expect(SCORE_V2_SYSTEM).toMatch(new RegExp(`^${k} \\(`, "m"));
    const anchors = SCORE_V2_SYSTEM.match(/^\s+[1-5]: /gm) ?? [];
    expect(anchors.length).toBe(SUB_KEYS_V2.length * 5);
    expect(SCORE_V2_SYSTEM).toContain("1 ≈ 2,0 · 2 ≈ 3,8 · 3 ≈ 5,5 · 4 ≈ 7,3 · 5 ≈ 9,0");
  });
  it("sert kurallar: beden/kemik eleştirisi yok, korumalı özellik çıkarımı yok, hastalık adı yok, düz yazıda sayı yok, katalog dışı yöntem yok, tarif et-yargılama", () => {
    const n = normalizeTr(SCORE_V2_SYSTEM);
    for (const needle of ["beden boyutu, kilo, beden sekli veya kemik yapisi hakkinda elestiri", "tarif et, yargilama", "yas, cinsiyet, etnik koken, irk", "teshis yok, hastalik adi yok", "duz yazida sayi yazma", "yalniz kullanici mesajindaki plan adimi listesinden", "karsilastirma yok", "cerrahi, estetik islem", "mewing"]) {
      expect(n).toContain(needle);
    }
    expect(SCORE_V2_SYSTEM).toContain("için bir dermatoloğa göstermek faydalı olabilir");
    expect(SCORE_V2_PROMPT_VERSION).toBe("score.v2");
  });
  it("statik: içinde kullanıcı verisi, tarih veya rastgele değer yok (önbellek için bayt sabit)", () => {
    expect(SCORE_V2_SYSTEM).toBe(SCORE_V2_SYSTEM.trim());
    expect(SCORE_V2_SYSTEM).not.toMatch(/\{\{|\$\{|20\d\d-\d\d/);
  });
});

describe("buildScoreV2UserText", () => {
  const steps = planStepsForPrompt({ hairAllowed: true, beardAllowed: true });
  it("açı etiketleri sırayla, yaş bandı ve sunum beyan olarak, cihaz oranları tarif notuyla, plan adımı listesi", () => {
    const t = buildScoreV2UserText({ ageBand: "25_34", presentation: "male", device: deviceResultFromGeometry(GEO), views: ["front", "profile_left", "left45"], planSteps: steps });
    expect(t).toContain("Fotoğraf 1: Ön (düz bakış)");
    expect(t).toContain("Fotoğraf 2: Sol yan profil");
    expect(t).toContain("Fotoğraf 3: Sol 45° yarım profil");
    expect(t).toContain("Yaş bandı: 25–34");
    expect(t).toContain("Sunum: erkek");
    expect(t).toContain("iyi ya da kötü anlamı taşımaz");
    expect(t).toContain("çene/elmacık genişliği: 0,85");
    expect(t).toContain("Ön yüz şekli değerlendirmesi: oval");
    expect(t).toContain("skin: st_cleanser_gentle — Nazik temizleyici");
    expect(t).toContain("brows: lv_brow_tidy — Kaş düzeni");
    // Landmark, görsel verisi veya 478 nokta yok.
    expect(t).not.toMatch(/landmarks|"x":|AAAA/);
  });
  it("yaş bandı yoksa 'belirtilmedi'; cihaz yoksa oran bloğu yok; deterministik", () => {
    const t = buildScoreV2UserText({ ageBand: null, presentation: "unspecified", device: null, views: ["front"], planSteps: steps });
    expect(t).toContain("Yaş bandı: belirtilmedi");
    expect(t).not.toContain("oranlar");
    expect(t).toBe(buildScoreV2UserText({ ageBand: null, presentation: "unspecified", device: null, views: ["front"], planSteps: steps }));
  });
});

describe("ScoreOutputV2 şeması", () => {
  it("örnek çıktı geçer; puan 1–10 dışı, bilinmeyen bölge ya da fazla fırsat reddedilir", () => {
    expect(ScoreOutputV2.safeParse(scoreOutput()).success).toBe(true);
    const bad = scoreOutput();
    bad.subscores.skin.score = 11;
    expect(ScoreOutputV2.safeParse(bad).success).toBe(false);
    const region = scoreOutput();
    region.report.regions[0].improvements = ["a", "b", "c"];
    expect(ScoreOutputV2.safeParse(region).success).toBe(false);
    expect(ScoreOutputV2.safeParse({ ...scoreOutput(), report: { ...scoreOutput().report, regions: [{ key: "forehead", strength: "", seen: "", improvements: [] }] } }).success).toBe(false);
  });
});
