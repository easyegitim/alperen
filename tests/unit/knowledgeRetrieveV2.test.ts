import { describe, expect, it } from "vitest";
import { HAIR_LOSS_SPECIALTIES, AI_ALLOWED_SPECIALTIES, EXPERT_SPECIALTIES, specialtiesForArea } from "@/content/expert-specialties";
import { costBandsWithinBudget, exceedsBudget } from "@/content/budget";
import { SKIN_STEPS } from "@/content/skin-steps";
import { HABITS } from "@/content/habits";
import { CatalogKnowledgeSource, catalogMethodRecords, filterByConstraints, relevanceScore, type KnowledgeConstraints, type KnowledgeQuery } from "@/lib/coach/knowledge";
import { getKnowledgeSource } from "@/lib/coach/knowledgeSource";
import { normalizeTr } from "@/lib/ai/safety";

const base: KnowledgeConstraints = { headCovering: false, presentation: "male", jawHealth: "none", beardPreference: "some", budgetBand: "1000_2500", timeBand: 20, under18: false, bodyFatAllowed: true, restrictionSignal: false, glasses: false, doctorLayer: false };
const q = (over: Partial<KnowledgeQuery> = {}): KnowledgeQuery => ({ observations: [], areas: ["hair"], goals: ["hair"], constraints: base, ...over });

describe("katalog genişletmesi ve erişim sıralaması (PLAN 4e; KB §6.1 Ö7)", () => {
  const all = catalogMethodRecords();

  it("yeni adımlar doğru alanda ve kısıtlarla: şekillendirme → hair (başörtüsü yok), tıraş seti → beard, kaş/burun-kulak → brows", () => {
    const by = (id: string) => all.find((r) => r.id === id)!;
    expect(by("st_matte_clay")).toMatchObject({ area: "hair", contraindications: ["head_covering", "head_covering_unknown"] });
    expect(by("st_aftershave_balm")).toMatchObject({ area: "beard", contraindications: ["female_presentation", "no_beard_preference"] });
    expect(by("st_brow_tidy")).toMatchObject({ area: "brows", regions: ["brows", "eyeArea"] });
    expect(by("st_nose_ear_trim").regions).toContain("nose");
    expect(by("hb_hair_wash_rhythm")).toMatchObject({ area: "habit", contraindications: ["head_covering", "head_covering_unknown"] });
    expect(by("st_spf").evidence).toEqual({ level: "many_studies", grade: "A" });
    // egzersiz yapısal bölgeye bağlanmaz (planTypes kural 2)
    for (const r of all.filter((x) => x.area === "exercise")) expect(r.regions).toEqual(["skin"]);
    for (const s of SKIN_STEPS) expect(normalizeTr(`${s.nameTr} ${s.noteTr}`)).not.toMatch(/finasterid|minoksidil|retinoid|izotretinoin|botoks|dolgu/);
    for (const h of HABITS) expect(normalizeTr(`${h.nameTr} ${h.defaultTargetTr}`)).not.toMatch(/kalori|kcal|ac kal/);
  });

  it("hedef yönü stil sıralamasını değiştirir: 'daha keskin ve olgun' keskin kesim/sakalı, 'daha yumuşak' yumuşak dokuyu öne alır", () => {
    const sharp = all.find((r) => r.id === "short_boxed")!;
    const soft = all.find((r) => r.id === "mid_length_wavy")!;
    expect(relevanceScore(sharp, q({ areas: ["beard"], goals: ["beard"], goalDirection: "sharper_mature" }))).toBeGreaterThan(relevanceScore(sharp, q({ areas: ["beard"], goals: ["beard"], goalDirection: "softer_younger" })));
    expect(relevanceScore(soft, q({ goalDirection: "softer_younger" }))).toBeGreaterThan(relevanceScore(soft, q({ goalDirection: "sharper_mature" })));
    // Süre ve kanıt payı
    const spf = all.find((r) => r.id === "st_spf")!;
    expect(relevanceScore(spf, q({ areas: ["skin"], goals: ["skin"] }))).toBeGreaterThan(relevanceScore(all.find((r) => r.id === "st_clay_mask_weekly")!, q({ areas: ["skin"], goals: ["skin"] })));
  });

  it("retrieve: başörtüsüyle saç alışkanlığı da düşer; getKnowledgeSource katalogdur (yöntem dosyası yok)", async () => {
    const covered = filterByConstraints(all, { ...base, headCovering: true });
    expect(covered.some((r) => r.id === "hb_hair_wash_rhythm")).toBe(false);
    const src = getKnowledgeSource();
    expect(src.name).toBe("catalog");
    expect(src).toBeInstanceOf(CatalogKnowledgeSource);
    const out = await src.retrieve(q({ observations: ["Kaşlarda çizgi dışı birkaç kıl"], areas: ["brows"], goals: ["general"], regions: ["brows"] }), 5);
    expect(out[0]!.area).toBe("brows");
  });

  it("bütçe yardımcıları ve uzman dizini", () => {
    expect(costBandsWithinBudget("upto_1000")).toEqual(["none", "low", "medium"]);
    expect(costBandsWithinBudget("5000_plus")).toEqual(["none", "low", "medium", "high"]);
    expect(exceedsBudget({ min: 3000, max: null }, "1000_2500")).toBe(true);
    expect(exceedsBudget({ min: 3000, max: null }, "5000_plus")).toBe(false);
    expect(AI_ALLOWED_SPECIALTIES).toEqual(["dermatoloji", "sac_sagligi", "dis_ortodonti", "diyetisyen", "psikolog"]);
    expect(EXPERT_SPECIALTIES.find((s) => s.id === "plastik_cerrahi")!.aiMayRecommend).toBe(false);
    expect(HAIR_LOSS_SPECIALTIES).toEqual(["sac_sagligi", "dermatoloji"]);
    expect(specialtiesForArea("hair").map((s) => s.id)).toEqual(expect.arrayContaining(["sac_sagligi", "berber"]));
    for (const s of EXPERT_SPECIALTIES) expect(normalizeTr(s.descriptionTr)).not.toMatch(/fiyat|kampanya|indirim|once\/sonra/);
  });
});
