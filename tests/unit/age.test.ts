import { describe, expect, it } from "vitest";
import { currentYearIstanbul, isAdultByBirthYear, selectableBirthYears } from "@/lib/onboarding/age";

describe("isAdultByBirthYear (SPEC 4.1 adım 3, muhafazakâr kural)", () => {
  it("17 yaş engellenir", () => {
    expect(isAdultByBirthYear(2009, 2026)).toBe(false);
  });
  it("yıl farkı tam 18 belirsizdir ve 18+ sayılmaz", () => {
    expect(isAdultByBirthYear(2008, 2026)).toBe(false);
  });
  it("yıl farkı 19 ve üstü 18+ sayılır", () => {
    expect(isAdultByBirthYear(2007, 2026)).toBe(true);
    expect(isAdultByBirthYear(1980, 2026)).toBe(true);
  });
  it("tam sayı olmayan yıl reddedilir", () => {
    expect(isAdultByBirthYear(1990.5, 2026)).toBe(false);
    expect(isAdultByBirthYear(Number.NaN, 2026)).toBe(false);
  });
  it("yıl listesi en yeni önce ve 1900'e kadar", () => {
    const years = selectableBirthYears(2026);
    expect(years[0]).toBe(2026);
    expect(years.at(-1)).toBe(1900);
    expect(years).toHaveLength(127);
  });
  it("Europe/Istanbul yılı UTC yılbaşı gecesinde ileri gider", () => {
    // 31 Aralık 2026 22:30 UTC = 1 Ocak 2027 01:30 İstanbul
    expect(currentYearIstanbul(new Date("2026-12-31T22:30:00Z"))).toBe(2027);
  });
});
