import { describe, expect, it } from "vitest";
import { safeReturnPath } from "@/lib/onboarding/returnPath";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("safeReturnPath (UI spec §7)", () => {
  it("yalnız /plan/<uuid>", () => {
    expect(safeReturnPath(`/plan/${ID}`)).toBe(`/plan/${ID}`);
  });
  it("dış adresleri ve protokolsüz host'u reddeder", () => {
    for (const v of ["https://evil.example/plan/" + ID, "//evil.example", `//evil.example/plan/${ID}`, "javascript:alert(1)", `/\\evil.example/plan/${ID}`]) {
      expect(safeReturnPath(v)).toBeNull();
    }
  });
  it("başka yolları, ek parçaları ve uuid olmayan kimlikleri reddeder", () => {
    for (const v of ["/tara", "/plan", "/plan/", "/plan/abc", `/plan/${ID}/x`, `/plan/${ID}?a=1`, `/plan/${ID}#x`, `/analiz/${ID}`, `/plan/${ID.toUpperCase()}x`, ` /plan/${ID}`]) {
      expect(safeReturnPath(v)).toBeNull();
    }
  });
  it("dizgi olmayan değerleri reddeder", () => {
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath([`/plan/${ID}`])).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
  });
});
