import { describe, expect, it } from "vitest";
import { testPasswordLoginEnabled } from "@/lib/auth/testLogin";

describe("test girişi bayrağı", () => {
  it("yalnız tam olarak \"true\" iken açık; tanımsız, boş ve diğer değerlerde kapalı (üretim varsayılanı)", () => {
    expect(testPasswordLoginEnabled("true")).toBe(true);
    for (const v of [undefined, "", "false", "1", "TRUE", "yes"]) expect(testPasswordLoginEnabled(v)).toBe(false);
  });
});
