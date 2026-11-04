import { fixtureAnalysis } from "@/tests/fixtures/analysisV2";
import { barPosition, fmt1, fmtMeasure, formatPercentile, formatRange } from "@/mobile/src/features/analysis/format";
import { REVEAL_ORDER, cardOrder, effectiveReady, isLowScore, nextReveals, pollIntervalMs, revealProgress, sectionReady } from "@/mobile/src/features/analysis/reveal";
import { orderSubsV2, rowsFromAnalysis, shareSubsFromRows } from "@/mobile/src/features/analysis/subs";

describe("kart kart açılış durumu (KB P#23; CONTRACTS_V2 §2.3/4) — sectionsReady'den türetilir", () => {
  it("sunucu listesinde olan ve açılmamış kartlar REVEAL_ORDER sırasıyla açılır; listede olmayan açılmaz", () => {
    expect(REVEAL_ORDER[0]).toBe("device");
    expect(nextReveals(["subscores", "device", "overall"], ["device"])).toEqual(["overall", "subscores"]);
    expect(nextReveals(["report"], ["report"])).toEqual([]);
  });
  it("tamamlanan analizde eksik kalan bölümler de açılır; çalışırken yalnız hazır olanlar", () => {
    expect(effectiveReady("completed", ["device"])).toEqual([...REVEAL_ORDER]);
    expect(effectiveReady("running", ["overall", "device"])).toEqual(["device", "overall"]);
    expect(sectionReady("running", ["device"], "report")).toBe(false);
    expect(sectionReady("completed", [], "report")).toBe(true);
  });
  it("yoklama aralığı: sırada 3 sn, çalışırken 2 sn, bitince durur", () => {
    expect(pollIntervalMs("queued")).toBe(3000);
    expect(pollIntervalMs("running")).toBe(2000);
    expect(pollIntervalMs("completed")).toBeNull();
    expect(pollIntervalMs("failed")).toBeNull();
    expect(pollIntervalMs("device_only")).toBeNull();
  });
  it("düşük skorda (< 4,0) gelişim alanları önce; ilerleme sayacı hazır kartları sayar", () => {
    expect(isLowScore(3.9)).toBe(true);
    expect(isLowScore(4.0)).toBe(false);
    expect(cardOrder(true)[0]).toBe("improveFirst");
    expect(cardOrder(false)[0]).toBe("overall");
    const reveal = fixtureAnalysis("reveal");
    expect(reveal.stage).toBe("running");
    expect(revealProgress(reveal.stage, cardOrder(false), reveal.sectionsReady)).toEqual({ done: 3, total: 6 });
    expect(revealProgress("completed", cardOrder(false), ["device"])).toEqual({ done: 6, total: 6 });
  });
});

describe("skor biçimleri ve alt skor satırları", () => {
  it("tek ondalık, aralık, yüzdelik eki, ölçü biçimi, dengeli aralık çubuğu", () => {
    expect(fmt1(5.84)).toBe("5,8");
    expect(formatRange([5.6, 6.0])).toEqual({ lo: "5,6", hi: "6,0" });
    expect(formatPercentile(61.5)).toEqual({ p: 62, suffix: "sinden" });
    expect(formatPercentile(100)?.p).toBe(99);
    expect(formatPercentile(null)).toBeNull();
    expect(fmtMeasure("canthalTiltDeg", 3)).toBe("3°");
    expect(fmtMeasure("thirds", 0.34)).toBe("%34");
    expect(fmtMeasure("jawRatio", 0.84)).toBe("0,84");
    const pos = barPosition(0.84, [0.75, 0.95]);
    expect(pos.lo).toBeCloseTo(25);
    expect(pos.hi).toBeCloseTo(75);
    expect(pos.at).toBeGreaterThan(pos.lo);
    expect(barPosition(99, [1, 2]).at).toBe(100);
  });
  it("satırlar sunucu kilidini izler; düşük skorda geliştirilebilir önce; paylaşım için en yüksek 3", () => {
    const a = fixtureAnalysis("completed");
    const rows = rowsFromAnalysis(a);
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.k === "skin")?.score?.value).toBe(6.3);
    expect(rows.find((r) => r.k === "skin")?.explanation?.lookedAt.length).toBeGreaterThan(0);
    const low = orderSubsV2(rows, true);
    expect(["skin", "hair", "grooming", "brows"]).toContain(low[0].k);
    expect(orderSubsV2(rows, false).map((r) => r.k)).toEqual(rows.map((r) => r.k));
    const subs = shareSubsFromRows(rows, (k) => k);
    expect(subs).toHaveLength(3);
    expect(subs[0]).toEqual({ key: "skin", label: "skin", value: 6.3 });
    // kilitli satırda değer yok
    const queued = rowsFromAnalysis(fixtureAnalysis("queued"));
    expect(queued.every((r) => r.score === null && r.explanation === null)).toBe(true);
  });
});
