import { describe, expect, it } from "vitest";
import { REVEAL_ORDER, effectiveReady, isRevealPending, nextReveals, pollIntervalMs } from "@/components/analysis/reveal";
import { formatPercentile, formatRange, percentileSuffix } from "@/components/analysis/result/format";
import { SECTION_KEYS } from "@/lib/score/contract";

describe("kart kart açılış sırası (KB P#23)", () => {
  it("sıra SECTION_KEYS; sunucu listesinin sırası önemsiz; açılan tekrar açılmaz", () => {
    expect(REVEAL_ORDER).toEqual(SECTION_KEYS);
    expect(nextReveals(["subscores", "device", "overall"], [])).toEqual(["device", "overall", "subscores"]);
    expect(nextReveals(["subscores", "device", "overall"], ["device"])).toEqual(["overall", "subscores"]);
    expect(nextReveals(["device"], ["device"])).toEqual([]);
  });
  it("tamamlanmış analizde eksik bölüm de açılır (bekleme yok); diğer aşamalarda yalnız hazır olanlar", () => {
    expect(effectiveReady("completed", ["device"])).toEqual(SECTION_KEYS);
    expect(effectiveReady("running", ["overall", "device"])).toEqual(["device", "overall"]);
  });
  it("bekleme göstergesi ve yoklama aralığı", () => {
    expect(isRevealPending("running", ["device"])).toBe(true);
    expect(isRevealPending("completed", [...SECTION_KEYS])).toBe(false);
    expect(isRevealPending("failed", [])).toBe(false);
    expect(pollIntervalMs("queued")).toBe(3000);
    expect(pollIntervalMs("running")).toBe(2000);
    expect(pollIntervalMs("completed")).toBeNull();
    expect(pollIntervalMs("failed")).toBeNull();
  });
});

describe("yüzdelik ve aralık biçimi (KB §4.5–4.6)", () => {
  it("aralık tek ondalık, virgüllü", () => {
    expect(formatRange([5.6, 6])).toEqual({ lo: "5,6", hi: "6,0" });
  });
  it("yüzdelik yuvarlanır ve 1–99'a kırpılır; null/NaN gizlenir", () => {
    expect(formatPercentile(61.5)).toEqual({ p: 62, suffix: "sinden" });
    expect(formatPercentile(99.9)).toEqual({ p: 99, suffix: "undan" });
    expect(formatPercentile(0.2)).toEqual({ p: 1, suffix: "inden" });
    expect(formatPercentile(null)).toBeNull();
    expect(formatPercentile(Number.NaN)).toBeNull();
  });
  it("Türkçe ek sayının son kelimesine göre", () => {
    const cases: [number, string][] = [[88, "inden"], [50, "sinden"], [90, "ından"], [73, "ünden"], [46, "sından"], [10, "undan"], [30, "undan"], [20, "sinden"], [75, "inden"], [67, "sinden"], [40, "ından"], [60, "ından"], [70, "inden"], [80, "inden"]];
    for (const [p, s] of cases) expect(percentileSuffix(p), String(p)).toBe(s);
  });
});
