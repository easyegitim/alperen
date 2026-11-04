import { describe, expect, it } from "vitest";
import { ALL_PRESETS } from "@/content/presets";
import { EXERCISES } from "@/content/exercises";
import { HABITS } from "@/content/habits";
import { SKIN_STEPS } from "@/content/skin-steps";
import {
  CatalogKnowledgeSource,
  KNOWLEDGE_RETRIEVE_LIMIT,
  MethodRecord,
  MethodsFile,
  TSV_FLAW_COLUMNS,
  TSV_METHOD_COLUMNS,
  catalogMethodRecords,
  filterByConstraints,
  validateMethodIds,
  type KnowledgeConstraints,
  type KnowledgeQuery,
} from "@/lib/coach/knowledge";

const base: KnowledgeConstraints = {
  headCovering: false,
  presentation: "male",
  jawHealth: "none",
  beardPreference: "some",
  budgetBand: "1000_2500",
  timeBand: 20,
  under18: false,
  bodyFatAllowed: true,
  restrictionSignal: false,
  glasses: false,
  doctorLayer: false,
};
const query = (over: Partial<KnowledgeQuery> = {}): KnowledgeQuery => ({ observations: [], areas: ["skin"], goals: ["skin"], constraints: base, ...over });

describe("CatalogKnowledgeSource (PLAN_V2 Faz 0; KB Ç2, K6–K10)", () => {
  const src = new CatalogKnowledgeSource();
  const all = catalogMethodRecords();

  it("katalogdaki her öğe bir MethodRecord; kimlikler katalogla birebir; her kayıt şemadan geçer", async () => {
    const ids = await src.ids();
    for (const s of SKIN_STEPS) expect(ids.has(s.id)).toBe(true);
    for (const h of HABITS) expect(ids.has(h.id)).toBe(true);
    for (const e of EXERCISES) expect(ids.has(e.id)).toBe(true);
    for (const p of ALL_PRESETS) expect(ids.has(p.id)).toBe(true);
    expect(all.length).toBe(SKIN_STEPS.length + HABITS.length + EXERCISES.length + ALL_PRESETS.length);
    for (const r of all) expect(MethodRecord.safeParse(r).success, r.id).toBe(true);
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
  });

  it("retrieve en çok 40 kayıt döner ve alanla ilgili olanlar önde", async () => {
    const out = await src.retrieve(query({ observations: ["Yanaklarda parlama ve gözenek görünümü"], areas: ["skin"] }));
    expect(out.length).toBeLessThanOrEqual(KNOWLEDGE_RETRIEVE_LIMIT);
    expect(out[0]!.area).toBe("skin");
    expect(out.slice(0, 5).some((r) => r.id === "st_clay_mask_weekly")).toBe(true);
    const limited = await src.retrieve(query(), 5);
    expect(limited).toHaveLength(5);
    const over = await src.retrieve(query({ areas: [...["skin", "hair", "beard", "habit", "exercise", "color"] as const] }), 999);
    expect(over.length).toBeLessThanOrEqual(KNOWLEDGE_RETRIEVE_LIMIT);
  });

  it("K9/Ç17: başörtüsü varsa ya da bilinmiyorsa saç ve renk kaydı yok", () => {
    const covered = filterByConstraints(all, { ...base, headCovering: true });
    expect(covered.some((r) => r.area === "hair" || r.area === "color")).toBe(false);
    const unknown = filterByConstraints(all, { ...base, headCovering: null });
    expect(unknown.some((r) => r.area === "hair" || r.area === "color")).toBe(false);
    expect(unknown.some((r) => r.area === "skin")).toBe(true);
  });

  it("K10: çene sağlığı cevabı varsa egzersiz yok; kadın sunumu ya da 'sakal yok' tercihinde sakal yok", () => {
    expect(filterByConstraints(all, { ...base, jawHealth: "issue" }).some((r) => r.area === "exercise")).toBe(false);
    expect(filterByConstraints(all, base).some((r) => r.area === "exercise")).toBe(true);
    expect(filterByConstraints(all, { ...base, presentation: "female" }).some((r) => r.area === "beard")).toBe(false);
    expect(filterByConstraints(all, { ...base, beardPreference: "none" }).some((r) => r.area === "beard")).toBe(false);
  });

  it("K8/Ç1: kilo ile ilgili alışkanlıklar yalnız yağ oranı izni varken ve 18+; kuvvet antrenmanı her modda", () => {
    const noBmi = filterByConstraints(all, { ...base, bodyFatAllowed: false });
    expect(noBmi.some((r) => r.id === "hb_walk" || r.id === "hb_protein")).toBe(false);
    expect(noBmi.some((r) => r.id === "hb_strength")).toBe(true);
    expect(filterByConstraints(all, { ...base, under18: true }).some((r) => r.id === "hb_protein")).toBe(false);
    expect(filterByConstraints(all, { ...base, restrictionSignal: true }).some((r) => r.id === "hb_walk")).toBe(false);
    // yürüyüş günde 30 dk: 20 dk bandında süre kuralıyla düşer, 30 dk bandında kalır
    expect(filterByConstraints(all, base).some((r) => r.id === "hb_walk")).toBe(false);
    expect(filterByConstraints(all, { ...base, timeBand: 30 }).some((r) => r.id === "hb_walk")).toBe(true);
  });

  it("doktor katmanı kayıtları yalnız doctorLayer açıkken; katalogda hiç yok", () => {
    const doc: MethodRecord = { ...all[0]!, id: "m_doc_x", tier: "doctor", source: { kind: "tsv", ref: "row:1" } };
    expect(filterByConstraints([doc], base)).toEqual([]);
    expect(filterByConstraints([doc], { ...base, doctorLayer: true })).toHaveLength(1);
    expect(all.some((r) => r.tier === "doctor")).toBe(false);
  });

  it("günlük süre bandı: günlük adım süreyi aşarsa düşer", () => {
    const long: MethodRecord = { ...all[0]!, id: "m_long", minutesPerDay: 45, frequency: { per: "day", times: 1 } };
    expect(filterByConstraints([long], { ...base, timeBand: 20 })).toEqual([]);
    expect(filterByConstraints([long], { ...base, timeBand: 20 }).length).toBe(0);
  });

  it("validateMethodIds: bilinmeyen düşer, sıra korunur, tekrarlar tekilleşir", async () => {
    const known = await src.ids();
    expect(validateMethodIds(["st_spf", "uydurma_yontem", "buzz_cut", "st_spf"], known)).toEqual({ valid: ["st_spf", "buzz_cut"], dropped: ["uydurma_yontem"] });
    expect(await src.get("st_spf")).not.toBeNull();
    expect(await src.get("uydurma_yontem")).toBeNull();
  });

  it("kayıtlarda ilaç/işlem terimi yok (K7 kullanıcı kanalı); kullanıcı adı nötr", () => {
    for (const r of all) expect(`${r.title} ${r.summary}`).not.toMatch(/botoks|dolgu\b|finasterid|minoksidil|steroid|mewing/i);
  });
});

describe("TSV sözleşmesi (VARSAYIM) ve content/methods dosya biçimi", () => {
  it("zorunlu sütunlar ve liste ayırıcı sabit", () => {
    expect(TSV_METHOD_COLUMNS.required).toContain("evidence_grade");
    expect(TSV_METHOD_COLUMNS.required).toContain("tier");
    expect(TSV_METHOD_COLUMNS.optional).toContain("user_label_tr");
    expect(TSV_METHOD_COLUMNS.listSeparator).toBe(";");
    expect(TSV_FLAW_COLUMNS.required).toEqual(["flaw_id", "region", "internal_name_tr", "user_label_tr"]);
  });

  it("MethodsFile: sürüm, kaynak dosya ve kayıt listesi; bozuk kayıt dosyayı reddeder", () => {
    const rec = catalogMethodRecords()[0]!;
    const ok = { version: "methods.v1", importedAt: "2026-11-04T00:00:00Z", sourceFile: "aura-yontem-kutuphanesi.tsv", records: [{ ...rec, source: { kind: "tsv", ref: "row:2" } }] };
    expect(MethodsFile.safeParse(ok).success).toBe(true);
    expect(MethodsFile.safeParse({ ...ok, records: [{ ...rec, tier: "surgeon" }] }).success).toBe(false);
    expect(MethodsFile.safeParse({ ...ok, version: "methods.v0" }).success).toBe(false);
  });
});
