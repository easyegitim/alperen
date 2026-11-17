import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MethodsFile, MethodsKnowledgeSource, TSV_METHOD_COLUMNS } from "@/lib/coach/knowledge";
import { attachFlawIds, importFlawsTsv, importMethodsTsv, missingRequired, normalizeHeader, parseTsv, rowToRecord } from "@/scripts/import-methods";

// Örnek fikstürler (tests/fixtures/*-sample.tsv): sütun sözleşmesi VARSAYIMI ve betik; ürün verisi değildir.
const METHODS = readFileSync("tests/fixtures/methods-sample.tsv", "utf8");
const FLAWS = readFileSync("tests/fixtures/flaws-sample.tsv", "utf8");

describe("scripts/import-methods (PLAN 4e / Sprint 3; KB Ç2 'uydurma yöntem yok')", () => {
  it("başlık eşleşir; geçerli satırlar MethodRecord olur; geçersiz satır nedeniyle atlanır; tekrar sayılır", () => {
    const r = importMethodsTsv(METHODS, "methods-sample.tsv", "2026-11-04T00:00:00.000Z");
    expect(r.missingColumns).toEqual([]);
    expect(r.file).not.toBeNull();
    expect(r.imported).toBe(9);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(["area", "evidence_grade", "safety:drugs", "source_url", "tryon_preset_id", "weight_content"]);
    expect(r.duplicates).toEqual(["m_sample_spf_tinted"]);
    expect(MethodsFile.safeParse(r.file).success).toBe(true);
    const spf = r.file!.records.find((x) => x.id === "m_sample_spf_tinted")!;
    expect(spf).toMatchObject({ area: "skin", tier: "diy", costBand: "low", costTryRange: { min: 150, max: 600 }, frequency: { per: "day", times: 1 }, minutesPerDay: 1 });
    expect(spf.evidence).toEqual({ level: "many_studies", grade: "A", source: "https://doi.org/10.1016/j.jaad.2012.12.973" });
    expect(spf.tags).toContain("gunes");
    expect(spf.source).toEqual({ kind: "tsv", ref: "methods-sample.tsv#2" });
    // user_label_tr iç ad yerine kullanıcı etiketi; notes_internal hiçbir alana girmez
    expect(JSON.stringify(r.file)).not.toContain("ORNEK");
    const doctor = r.file!.records.find((x) => x.id === "m_sample_doctor_topical")!;
    expect(doctor.tier).toBe("doctor");
    const walk = r.file!.records.find((x) => x.id === "m_sample_posture_walk")!;
    expect(walk.contraindications).toEqual(["bmi_below_25", "under_18", "restriction_signal"]);
    expect(walk.costTryRange).toEqual({ min: 0, max: 0 });
    // alan varsayılanı: boş kontrendikasyon sütunlu saç satırı K9/Ç17 etiketlerini kodla alır; sakal/egzersiz de aynı
    expect(r.file!.records.find((x) => x.id === "m_sample_hair_no_contra")!.contraindications).toEqual(["head_covering", "head_covering_unknown"]);
    expect(r.file!.records.find((x) => x.id === "m_sample_barber_lineup")!.contraindications).toEqual(["female_presentation", "no_beard_preference"]);
    expect(r.file!.records.find((x) => x.id === "m_sample_brow_shape_expert")!.contraindications).toEqual([]);
    // düşen satırların hiçbiri dosyaya girmez; tryon_preset_id yalnız katalogdaki (gizli olmayan) stil
    expect(JSON.stringify(r.file)).not.toMatch(/Retinoid|foo_style|ders kitabı|kalori/);
    expect(r.file!.records.find((x) => x.id === "m_sample_barber_lineup")!.tryonPresetId).toBe("stubble_heavy");
  });

  it("satır kuralları: kaynak yalnız https; bilinmeyen/gizli preset; kullanıcı kanalında ilaç/işlem/teşhis adı; K8 etiketi olmayan kalori içeriği", () => {
    const base = { id: "m_x", area: "skin", title_tr: "X", summary_tr: "y", tier: "diy", evidence_grade: "B", cost_band: "low", frequency_per: "week", frequency_times: "2", minutes_per_day: "3", difficulty: "1", impact: "2", effort: "1" };
    const reason = (row: Record<string, string>) => {
      const r = rowToRecord(row, 2, "f");
      return r.ok ? "ok" : r.reason;
    };
    expect(reason({ ...base, source_url: "javascript:alert(1)" })).toBe("source_url");
    expect(reason({ ...base, source_url: "http://example.com/x" })).toBe("source_url");
    expect(reason({ ...base, source_url: "https://doi.org/10.1000/x" })).toBe("ok");
    expect(reason({ ...base, area: "hair", tryon_preset_id: "foo" })).toBe("tryon_preset_id");
    expect(reason({ ...base, area: "hair", tryon_preset_id: "buzz_cut" })).toBe("ok");
    expect(reason({ ...base, title_tr: "Botoks alternatifi" })).toBe("safety:medical_procedure");
    expect(reason({ ...base, summary_tr: "Rozasea için" })).toBe("safety:diagnosis");
    expect(reason({ ...base, user_label_tr: "Minoksidil losyonu" })).toBe("safety:drugs");
    expect(reason({ ...base, summary_tr: "Günde 2 kez, 5 dakika" })).toBe("ok"); // rakam serbest
    // doktor katmanı ayrı kanal: ilaç adı taşıyabilir (hekim kuyruğu doğrular)
    expect(reason({ ...base, tier: "doctor", title_tr: "Retinoid (hekim kararı)" })).toBe("ok");
    expect(reason({ ...base, area: "habit", summary_tr: "Haftada yarım kilo ver" })).toBe("weight_content");
    expect(reason({ ...base, area: "habit", summary_tr: "Haftada yarım kilo ver", contraindications: "bmi_below_25;under_18" })).toBe("ok");
    expect(reason({ ...base, area: "habit", summary_tr: "Günlük kalori açığı", contraindications: "bmi_below_25" })).toBe("safety:calorie"); // kalori kullanıcı kanalında hiç yok
    expect(reason({ ...base, area: "exercise", contraindications: "" })).toBe("ok");
    const ex = rowToRecord({ ...base, area: "exercise" }, 2, "f");
    expect(ex.ok && ex.record.contraindications).toEqual(["jaw_health_issue"]);
  });

  it("eksik zorunlu sütunda durur ve raporlar; başlık normalizasyonu", () => {
    const r = importMethodsTsv("id\tarea\ttitle_tr\n1\tskin\tx\n", "x.tsv");
    expect(r.file).toBeNull();
    expect(r.missingColumns).toEqual(TSV_METHOD_COLUMNS.required.filter((c) => !["id", "area", "title_tr"].includes(c)));
    expect(normalizeHeader(" Cost Band ")).toBe("cost_band");
    expect(normalizeHeader("Evidence-Grade")).toBe("evidence_grade");
    expect(missingRequired(["id"], ["id", "area"])).toEqual(["area"]);
    expect(parseTsv("﻿a\tb\r\n1\t2\r\n\r\n").rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("satır doğrulaması: her alan sözleşmeye göre; uydurma yok", () => {
    const base = { id: "m_x", area: "skin", title_tr: "X", summary_tr: "y", tier: "diy", evidence_grade: "B", cost_band: "low", frequency_per: "week", frequency_times: "2", minutes_per_day: "3", difficulty: "1", impact: "2", effort: "1" };
    expect(rowToRecord(base, 2, "f").ok).toBe(true);
    for (const [k, v] of [["tier", "wizard"], ["frequency_per", "hourly"], ["frequency_times", "0"], ["minutes_per_day", "999"], ["impact", "5"], ["regions", "forehead"], ["contraindications", "left_handed"], ["id", "Bad Id!"]] as const) {
      const r = rowToRecord({ ...base, [k]: v }, 3, "f");
      expect(r.ok, k).toBe(false);
    }
  });

  it("kusur dosyası: iç ad ürüne girmez; yöntem bağları ters indeksle flawIds'e yazılır", () => {
    const flaws = importFlawsTsv(FLAWS);
    expect(flaws.missingColumns).toEqual([]);
    expect(flaws.rows).toHaveLength(2);
    expect(flaws.skipped).toBe(1);
    expect(JSON.stringify(flaws.rows)).not.toContain("iç ad");
    const file = attachFlawIds(importMethodsTsv(METHODS, "m.tsv").file!, flaws.rows);
    expect(file.records.find((r) => r.id === "m_sample_niacin_serum")!.flawIds).toEqual(["f_sample_tone"]);
    expect(file.records.find((r) => r.id === "m_sample_spf_tinted")!.flawIds).toEqual(["f_sample_tone"]);
    expect(file.records.find((r) => r.id === "m_sample_scalp_massage")!.flawIds).toEqual(["f_sample_density"]);
  });

  it("içe aktarılan dosya AYNI arayüzden sunulur (MethodsKnowledgeSource) ve katalogla birleşir", async () => {
    const file = importMethodsTsv(METHODS, "m.tsv").file!;
    const src = new MethodsKnowledgeSource([file]);
    expect(src.name).toBe("methods");
    const ids = await src.ids();
    expect(ids.has("m_sample_spf_tinted")).toBe(true);
    expect(ids.has("st_spf")).toBe(true);
    const base = { headCovering: false as boolean | null, presentation: "male" as const, jawHealth: "none" as const, beardPreference: "some" as const, budgetBand: "1000_2500" as const, timeBand: 20 as const, under18: false, bodyFatAllowed: true, restrictionSignal: false, glasses: false, doctorLayer: false };
    const out = await src.retrieve({ observations: ["gözenek görünümü ve parlama"], areas: ["skin"], goals: ["skin"], constraints: base }, 10);
    expect(out.some((r) => r.id === "m_sample_niacin_serum")).toBe(true);
    // TSV etiketleri ("spf", "ton", "sac derisi") gözlemle eşleşir ve sıralamayı öne çeker
    const tagged = await src.retrieve({ observations: ["Saç derisi kuru görünüyor", "SPF kullanımı düzensiz; ton farkı var"], areas: ["hair", "skin"], goals: ["general"], constraints: base }, 6);
    expect(tagged.slice(0, 4).map((r) => r.id)).toEqual(expect.arrayContaining(["m_sample_scalp_massage", "m_sample_spf_tinted"]));
    // doctor katmanı kaydı plan retrieve'inde asla; yalnız doctorLayer:true ile
    expect(out.some((r) => r.tier === "doctor")).toBe(false);
    const withDoctor = await src.retrieve({ observations: [], areas: ["skin"], goals: ["skin"], constraints: { ...base, doctorLayer: true } }, 40);
    expect(withDoctor.some((r) => r.id === "m_sample_doctor_topical")).toBe(true);
    // bozuk dosya şemadan geçmez (MethodsKnowledgeSource geçmeyen dosyayı atlar)
    expect(MethodsFile.safeParse({ ...file, version: "nope" }).success).toBe(false);
    expect(MethodsFile.safeParse({ ...file, records: [{ id: "x" }] }).success).toBe(false);
  });
});
