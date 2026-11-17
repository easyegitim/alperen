// İlerleme gürültü bandı (KB §4.2; CONTRACTS_V2 Sprint 3 S3.3): ±0,3 "değişim yok"; tek kaynak NOISE_BAND.
import { describe, expect, it } from "vitest";
import tr from "@/messages/tr.json";
import { NOISE_BAND as ENGINE_NOISE_BAND } from "@/lib/config/engine.h2.server";
import { NOISE_BAND as CONFIG_NOISE_BAND } from "@/lib/config/scoring";
import { CHANGE_LABEL_KEY, NOISE_BAND, classifyChange, formatBand, formatDelta, trendChanges } from "@/lib/progress/noise";
import { NOISE_BAND_CLIENT } from "@/lib/score/present";

describe("gürültü bandı", () => {
  it("tek kaynak: config = motor = istemci = ilerleme", () => {
    expect(NOISE_BAND).toBe(0.3);
    expect(CONFIG_NOISE_BAND).toBe(NOISE_BAND);
    expect(ENGINE_NOISE_BAND).toBe(NOISE_BAND);
    expect(NOISE_BAND_CLIENT).toBe(NOISE_BAND);
  });
  it("bant içi (sınır dahil) değişim yok; dışı yükseldi/düştü; tek ondalık", () => {
    expect(classifyChange(6.2, 6.5)).toEqual({ delta: 0.3, kind: "no_change", band: 0.3 });
    expect(classifyChange(6.2, 5.9)).toEqual({ delta: -0.3, kind: "no_change", band: 0.3 });
    expect(classifyChange(6.2, 6.6)).toMatchObject({ delta: 0.4, kind: "up" });
    expect(classifyChange(6.2, 5.8)).toMatchObject({ delta: -0.4, kind: "down" });
    expect(classifyChange(6.24, 6.26)).toMatchObject({ delta: 0, kind: "no_change" });
    expect(classifyChange(6.0, 6.5, 0.5)).toMatchObject({ kind: "no_change", band: 0.5 });
  });
  it("etiket anahtarları tr.json'da var; biçimler tr-TR", () => {
    const keys = Object.values(CHANGE_LABEL_KEY);
    for (const k of keys) expect(typeof k.split(".").reduce<unknown>((acc, p) => (acc as Record<string, unknown>)?.[p], tr)).toBe("string");
    expect(formatBand()).toBe("0,3");
    expect(formatDelta(0.4)).toBe("+0,4");
    expect(formatDelta(-0.5)).toBe("−0,5");
    expect(formatDelta(0)).toBe("0,0");
  });
  it("trend çiftleri tarihe göre", () => {
    const r = trendChanges([{ id: "b", date: "2026-11-02", overall: 6.6 }, { id: "a", date: "2026-10-01", overall: 6.2 }, { id: "c", date: "2026-12-01", overall: 6.7 }]);
    expect(r.map((x) => [x.from, x.to, x.change.kind])).toEqual([["a", "b", "up"], ["b", "c", "no_change"]]);
  });
});
