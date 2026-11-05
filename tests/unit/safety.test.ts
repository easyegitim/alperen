import { describe, expect, it } from "vitest";
import { normalizeTr, scanReport, stripViolations } from "@/lib/ai/safety";

const base = {
  summary: "Cilt ve saç tarafında net adımlar var.",
  scoreNarrative: "Skor nötr bir tahmindir.",
  hair: [{ presetId: "buzz_cut", why: "uyar", barberScript: "x", maintenance: "y" }],
  beard: [],
  hairColor: null,
  skincare: { morning: [{ stepType: "st_spf", note: "her sabah" }], evening: [], weekly: [] },
  faceContours: { enabled: false, tips: [] },
  exercises: [],
  habits: [],
  style: [],
  linkedActions: { skin: [], hair: [], grooming: [], jawline: [] },
  seeProfessional: null as null | { specialty: string; text: string },
};

describe("normalizeTr", () => {
  it("İ/ı/ş/ğ/ç/ö/ü sadeleşir", () => {
    expect(normalizeTr("ÇİRKİN Iğdır ŞÖĞÜ")).toBe("cirkin igdir sogu");
  });
});

describe("scanReport (SPEC 9.9 tablosu)", () => {
  it("temiz rapor ihlalsiz", () => {
    expect(scanReport(base, { faceContoursEnabled: false })).toEqual([]);
  });
  it("aşağılayıcı dil ve argo hiçbir yerde", () => {
    const r = { ...base, style: ["Chad gibi görünmek için"] };
    expect(scanReport(r, { faceContoursEnabled: false }).map((v) => v.rule)).toContain("slur");
    expect(scanReport({ ...base, summary: "yüzün çirkin değil" }, { faceContoursEnabled: false })[0].rule).toBe("slur");
    // "mog" sözcük sınırı: "mogol" eşleşmez
    expect(scanReport({ ...base, summary: "Moğol tarihi" }, { faceContoursEnabled: false })).toEqual([]);
  });
  it("cerrahi, ilaç, zararlı pratik", () => {
    expect(scanReport({ ...base, style: ["rinoplasti düşünebilirsin"] }, { faceContoursEnabled: false })[0].rule).toBe("medical_procedure");
    expect(scanReport({ ...base, hair: [{ ...base.hair[0], why: "minoksidil kullan" }] }, { faceContoursEnabled: false })[0].rule).toBe("drugs");
    expect(scanReport({ ...base, exercises: [{ id: "ex_chin_tuck", why: "mewing ile birlikte" }] }, { faceContoursEnabled: false })[0].rule).toBe("harmful_practice");
    expect(scanReport({ ...base, habits: [{ id: "hb_water", target: "öğün atla" }] }, { faceContoursEnabled: false })[0].rule).toBe("harmful_practice");
  });
  it("hastalık adı yalnız seeProfessional.text ve 'olabilir' kalıbıyla", () => {
    const ok = { ...base, seeProfessional: { specialty: "dermatoloji", text: "Rosacea gibi durumlar için bir dermatoloğa göstermek faydalı olabilir." } };
    expect(scanReport(ok, { faceContoursEnabled: false })).toEqual([]);
    const bad1 = { ...base, seeProfessional: { specialty: "dermatoloji", text: "Sende rosacea var." } };
    expect(scanReport(bad1, { faceContoursEnabled: false })[0].rule).toBe("diagnosis");
    const bad2 = { ...base, summary: "Egzama olabilir." };
    expect(scanReport(bad2, { faceContoursEnabled: false })[0].rule).toBe("diagnosis");
  });
  it("kalori: yalnız faceContours.enabled ve tips içinde ve ≤ 500", () => {
    const tipsOk = { ...base, faceContours: { enabled: true, tips: ["Günlük 300–500 kcal ılımlı açık"] } };
    expect(scanReport(tipsOk, { faceContoursEnabled: true })).toEqual([]);
    const tooMuch = { ...base, faceContours: { enabled: true, tips: ["Günlük 800 kcal açık"] } };
    expect(scanReport(tooMuch, { faceContoursEnabled: true })[0].rule).toBe("calorie");
    const disabled = { ...base, habits: [{ id: "hb_walk", target: "günde 400 kalori yak" }] };
    expect(scanReport(disabled, { faceContoursEnabled: false })[0].rule).toBe("calorie");
    const wordOnly = { ...base, summary: "kalori saymak gerekir" };
    expect(scanReport(wordOnly, { faceContoursEnabled: false })[0].rule).toBe("calorie");
  });
  it("plastik cerrahi uzmanlığı asla", () => {
    const r = { ...base, seeProfessional: { specialty: "plastik_cerrahi", text: "bir uzmana danışmak faydalı olabilir" } };
    expect(scanReport(r, { faceContoursEnabled: false }).map((v) => v.rule)).toContain("specialty");
  });
});

describe("stripViolations", () => {
  it("ihlalli dizi öğesini çıkarır, diğerlerini korur", () => {
    const r = { ...base, style: ["temiz", "botoks yaptır", "temiz2"] };
    const v = scanReport(r, { faceContoursEnabled: false });
    const s = stripViolations(r, v)!;
    expect(s.style).toEqual(["temiz", "temiz2"]);
  });
  it("seeProfessional ihlalliyse null; summary ihlalliyse null döner (fallback)", () => {
    const r = { ...base, seeProfessional: { specialty: "dermatoloji", text: "sende sedef var" } };
    expect(stripViolations(r, scanReport(r, { faceContoursEnabled: false }))!.seeProfessional).toBeNull();
    const r2 = { ...base, summary: "yüzün kusurlu" };
    expect(stripViolations(r2, scanReport(r2, { faceContoursEnabled: false }))).toBeNull();
  });
});
