import { describe, expect, it } from "vitest";
import { barPosition } from "@/components/analysis/result/MeasuresCard";
import { cardOrder } from "@/components/analysis/result/ResultV2View";
import { orderSubsV2, rowsFromAnalysis } from "@/components/analysis/result/SubscoresCard";
import { fixtureAnalysis } from "@/tests/fixtures/analysisV2";

describe("ödeme sonrası sonuç: sıra ve satırlar (KB §4.8, §4.9)", () => {
  it("4,0 altında gelişim alanları (ilk adımlar, alt skorlar) genel skordan önce", () => {
    expect(cardOrder(false)).toEqual(["overall", "subscores", "improveFirst", "faceShape", "device", "report"]);
    expect(cardOrder(true)).toEqual(["improveFirst", "subscores", "overall", "faceShape", "device", "report"]);
  });
  it("7 satır (Kaşlar dahil); düşük skorda geliştirilebilir alanlar düşükten yükseğe önce, yapısal sonda", () => {
    const low = fixtureAnalysis("low");
    const rows = rowsFromAnalysis(low);
    expect(rows.map((r) => r.k)).toEqual(["harmony", "eyes", "jawline", "skin", "hair", "grooming", "brows"]);
    const ordered = orderSubsV2(rows, true).map((r) => r.k);
    expect(ordered.slice(0, 4)).toEqual(["skin", "hair", "grooming", "brows"]);
    expect(ordered.slice(4)).toEqual(["jawline", "harmony", "eyes"]);
    expect(orderSubsV2(rows, false).map((r) => r.k)).toEqual(rows.map((r) => r.k));
  });
  it("her satırda değer + aralık ve 5 satırlık açıklama (tamamlanmış sabit veri)", () => {
    const a = fixtureAnalysis("completed");
    for (const r of rowsFromAnalysis(a)) {
      expect(r.score?.range).toHaveLength(2);
      expect(r.explanation?.lookedAt.length).toBeGreaterThan(0);
      expect(typeof r.explanation?.confidenceNote).toBe("string");
    }
    expect(a.overall).toMatchObject({ locked: false, value: { value: 5.8, range: [5.6, 6], percentile: 61.5 } });
    expect(a.potential).toMatchObject({ locked: false, value: { value: 6.9, delta: 1.1 } });
  });
  it("yarı açılmış sabit veri: yalnız device/overall/subscores hazır; potansiyel ve rapor henüz yok", () => {
    const a = fixtureAnalysis("reveal");
    expect(a.stage).toBe("running");
    expect(a.sectionsReady).toEqual(["device", "overall", "subscores"]);
    expect(a.potential).toEqual({ value: null, locked: false });
    expect(a.report).toEqual({ value: null, locked: false });
  });
  it("dengeli aralık çubuğu: aralık ortada, değer kenetli", () => {
    const b = barPosition(0.85, [0.75, 0.95]);
    expect(b.lo).toBeCloseTo(25);
    expect(b.hi).toBeCloseTo(75);
    expect(b.at).toBeCloseTo(50);
    expect(barPosition(20, [-2, 6]).at).toBe(100);
    expect(barPosition(-20, [-2, 6]).at).toBe(0);
  });
});
