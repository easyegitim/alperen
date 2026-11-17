import { describe, expect, it } from "vitest";
import { AGE_BANDS, isAdultByAgeBand, isAgeBand } from "@/lib/onboarding/age";
import { ONBOARDING_DRAFT_KEY, clearDraft, parseDraft, readDraft, writeDraft } from "@/lib/onboarding/draft";
import { AGE_GATE_PATH, GENDER_PATH, PUBLIC_ONBOARDING_PATHS, SIGN_IN_PATH } from "@/lib/onboarding/gate";

describe("yaş bandı (KB P#1/Ç1, CONTRACTS_V2 §5)", () => {
  it("beş bant; yalnız under_18 reşit değil", () => {
    expect(AGE_BANDS).toEqual(["under_18", "18_24", "25_34", "35_49", "50_plus"]);
    expect(isAdultByAgeBand("under_18")).toBe(false);
    for (const b of AGE_BANDS.filter((x) => x !== "under_18")) expect(isAdultByAgeBand(b)).toBe(true);
  });
  it("isAgeBand bilinmeyen değeri reddeder", () => {
    expect(isAgeBand("18_24")).toBe(true);
    expect(isAgeBand("17")).toBe(false);
    expect(isAgeBand(null)).toBe(false);
  });
});

function fakeStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe("oturum öncesi taslak (sessionStorage)", () => {
  it("bozuk veya bilinmeyen değerler atılır; asla fırlatmaz", () => {
    expect(parseDraft(null)).toEqual({});
    expect(parseDraft("{")).toEqual({});
    expect(parseDraft(JSON.stringify({ ageBand: "17", presentation: "x", extra: 1 }))).toEqual({});
    expect(parseDraft(JSON.stringify({ ageBand: "25_34", presentation: "female" }))).toEqual({ ageBand: "25_34", presentation: "female" });
  });
  it("yazma birleştirir, okuma geri verir, temizleme siler", () => {
    const s = fakeStorage();
    expect(writeDraft({ ageBand: "18_24" }, s)).toEqual({ ageBand: "18_24" });
    expect(writeDraft({ presentation: "male" }, s)).toEqual({ ageBand: "18_24", presentation: "male" });
    expect(readDraft(s)).toEqual({ ageBand: "18_24", presentation: "male" });
    expect(s.map.has(ONBOARDING_DRAFT_KEY)).toBe(true);
    clearDraft(s);
    expect(readDraft(s)).toEqual({});
  });
  it("depolama yoksa (null) sessizce çalışır", () => {
    expect(writeDraft({ ageBand: "18_24" }, null)).toEqual({ ageBand: "18_24" });
    expect(readDraft(null)).toEqual({});
    expect(() => clearDraft(null)).not.toThrow();
  });
  it("taslak fotoğraf, skor veya e-posta taşımaz (yalnız iki alan)", () => {
    const keys = Object.keys(parseDraft(JSON.stringify({ ageBand: "18_24", presentation: "male", email: "a@b.c", image: "/9j/" })));
    expect(keys.sort()).toEqual(["ageBand", "presentation"]);
  });
});

describe("başlangıç yolları", () => {
  it("oturumsuz açılan üç ekran: yaş, cinsiyet, giriş", () => {
    expect(PUBLIC_ONBOARDING_PATHS).toEqual([AGE_GATE_PATH, GENDER_PATH, SIGN_IN_PATH]);
    expect(GENDER_PATH).toBe("/baslangic/cinsiyet");
    expect(SIGN_IN_PATH).toBe("/baslangic/giris");
  });
});
