import { describe, expect, it } from "vitest";
import { TRYON_RELEASE_GATE } from "@/lib/tryon/types";
import { GateManifest, IMAGE_USD, QC_USD_PER_CHECK, estimateGateCost, evaluateTryonGate, gateCsv, parseGateCsv, type GateRow } from "../../scripts/tryon-gate";

// Çevrimdışı: yalnız kapı hesabı, CSV ve maliyet tahmini. Ücretli koşu --confirm-paid ile ve kullanıcı onayıyla (test etmez).
const row = (face: string, style: string, outcome: GateRow["outcome"], reasons: GateRow["reasons"] = [], regenCount = 0): GateRow => ({ face, style, outcome, regenCount, reasons });

describe("tryon-gate (KB §7.3/4; TRYON_RELEASE_GATE)", () => {
  it("sabitler: 30 yüz × 12 sakal = 360; ≥ %95; stil %90 altı gizlenir", () => {
    expect(TRYON_RELEASE_GATE).toEqual({ faces: 30, beardStyles: 12, images: 360, minPassRate: 0.95, hideStyleBelow: 0.9 });
  });
  it("genel oran ve stil bazında gizleme; unchecked geçmiş sayılmaz", () => {
    const rows: GateRow[] = [];
    for (let f = 0; f < 10; f++) {
      rows.push(row(`f${f}`, "van_dyke", f < 8 ? "pass" : "qc_failed", f < 8 ? [] : ["stray_hair_left"]));
      rows.push(row(`f${f}`, "goatee", "pass"));
      rows.push(row(`f${f}`, "buzz_cut", f === 0 ? "unchecked" : "pass"));
    }
    const r = evaluateTryonGate(rows);
    expect(r.total).toBe(30);
    expect(r.passed).toBe(27);
    expect(r.rate).toBe(0.9);
    expect(r.pass).toBe(false);
    expect(r.unchecked).toBe(1);
    expect(r.styles.find((s) => s.style === "van_dyke")).toMatchObject({ total: 10, passed: 8, rate: 0.8, hide: true });
    expect(r.styles.find((s) => s.style === "goatee")).toMatchObject({ rate: 1, hide: false });
    expect(r.styles.find((s) => s.style === "buzz_cut")).toMatchObject({ rate: 0.9, hide: false });
    expect(r.hiddenStyles).toEqual(["van_dyke"]);
  });
  it("tamamı geçerse kapı geçer; boş satır kümesi geçmez", () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(`f${i % 20}`, i < 20 ? "a" : "b", i === 3 ? "qc_failed" : "pass"));
    expect(evaluateTryonGate(rows)).toMatchObject({ pass: true, rate: 0.975, hiddenStyles: [] });
    expect(evaluateTryonGate([]).pass).toBe(false);
  });
  it("CSV gidiş-dönüş yalnız takma ad, stil ve sonuç kodları taşır (görsel/dosya adı yok)", () => {
    const rows = [row("f1", "van_dyke", "qc_failed", ["stray_hair_left", "artifacts"], 2), row("f2", "goatee", "pass")];
    const csv = gateCsv(rows);
    expect(csv.split("\n")[0]).toBe("face,style,outcome,regenCount,reasons");
    expect(csv).not.toMatch(/\.jpg|base64/);
    expect(parseGateCsv(csv)).toEqual(rows);
  });
  it("maliyet tahmini: görsel + kontrol; en kötü durum (1 + maxRegen) kat; bilinmeyen model varsayılan fiyat", () => {
    const c = estimateGateCost(30, 12, { imageModel: "gemini-3.1-flash-image", maxRegen: 2 });
    expect(c.images).toBe(360);
    expect(c.perImageUsd).toBeCloseTo(IMAGE_USD["gemini-3.1-flash-image"] + QC_USD_PER_CHECK, 3);
    expect(c.worstUsd).toBeCloseTo(c.expectedUsd * 3, 1);
    expect(estimateGateCost(1, 1, { imageModel: "bilinmeyen", maxRegen: 0 }).perImageUsd).toBeCloseTo(IMAGE_USD["gemini-3.1-flash-lite-image"] + QC_USD_PER_CHECK, 3);
  });
  it("manifest şeması: dir + faces zorunlu; styles isteğe bağlı", () => {
    expect(GateManifest.safeParse({ dir: "/x", faces: [{ id: "f1", file: "a.jpg" }] }).success).toBe(true);
    expect(GateManifest.safeParse({ dir: "/x", faces: [] }).success).toBe(false);
  });
});
