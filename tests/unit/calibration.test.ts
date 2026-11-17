import { describe, expect, it } from "vitest";
import { CALIBRATION_V0 } from "@/lib/config/scoring";
import { calibrate, calibrateV0, interpolate } from "@/lib/score/calibration";

describe("kalibrasyon v0 (SPEC 8.4)", () => {
  it("ham ortalama → 5,5", () => {
    expect(calibrate(CALIBRATION_V0.rawMean, "v0")).toBe(5.5);
  });
  it("formül: 5.5 + (raw − 6.5) × 1.4, tek ondalık", () => {
    expect(calibrate(7.5, "v0")).toBe(6.9);
    expect(calibrate(5.5, "v0")).toBe(4.1);
  });
  it("1,0–9,8 arasına sıkıştırılır", () => {
    expect(calibrate(1, "v0")).toBe(1);
    expect(calibrate(10, "v0")).toBe(9.8);
    expect(calibrateV0(100)).toBe(9.8);
  });
  it("ödeme/plan girdisi yoktur: aynı ham → aynı skor (D03)", () => {
    expect(calibrate(6.8, "v0")).toBe(calibrate(6.8, "v0"));
  });
});

describe("kalibrasyon v1 (yüzdelik tablo)", () => {
  const table: [number, number][] = [[5, 2], [6.5, 5.5], [8, 9]];
  it("parça parça doğrusal, uçlarda sabit", () => {
    expect(interpolate(table, 6.5)).toBe(5.5);
    expect(interpolate(table, 5.75)).toBeCloseTo(3.75, 6);
    expect(interpolate(table, 4)).toBe(2);
    expect(interpolate(table, 9)).toBe(9);
  });
  it("tablo yoksa hata; sahte tablo kullanılmaz", () => {
    expect(() => calibrate(6.5, "v1")).toThrow(/table_missing/);
    expect(calibrate(7.25, "v1", { table: { overall: table } })).toBe(7.3);
  });
  it("alt skor için kendi tablosu, yoksa genel", () => {
    const t = { overall: table, subscores: { skin: [[5, 1], [8, 9.8]] as [number, number][] } };
    expect(calibrate(6.5, "v1", { table: t, sub: "skin" })).toBe(5.4);
    expect(calibrate(6.5, "v1", { table: t, sub: "hair" })).toBe(5.5);
  });
});

describe("kalibrasyon h1 (engine spec §5.1)", () => {
  it("kimlik + 1,0–9,8 kenetleme, tek ondalık", () => {
    expect(calibrate(6.5, "h1")).toBe(6.5);
    expect(calibrate(5.449, "h1")).toBe(5.4);
    expect(calibrate(-3, "h1")).toBe(1);
    expect(calibrate(10, "h1")).toBe(9.8);
  });
  it("alt skor seçeneği h1'i değiştirmez (alt skor başına tablo yok)", () => {
    expect(calibrate(6.2, "h1", { sub: "skin" })).toBe(calibrate(6.2, "h1"));
  });
});
