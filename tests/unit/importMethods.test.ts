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
    expect(r.imported).toBe(8);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(["area", "evidence_grade"]);
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
    // doctor katmanı kaydı plan retrieve'inde asla; yalnız doctorLayer:true ile
    expect(out.some((r) => r.tier === "doctor")).toBe(false);
    const withDoctor = await src.retrieve({ observations: [], areas: ["skin"], goals: ["skin"], constraints: { ...base, doctorLayer: true } }, 40);
    expect(withDoctor.some((r) => r.id === "m_sample_doctor_topical")).toBe(true);
    // bozuk dosya şemadan geçmez (MethodsKnowledgeSource geçmeyen dosyayı atlar)
    expect(MethodsFile.safeParse({ ...file, version: "nope" }).success).toBe(false);
    expect(MethodsFile.safeParse({ ...file, records: [{ id: "x" }] }).success).toBe(false);
  });
});
