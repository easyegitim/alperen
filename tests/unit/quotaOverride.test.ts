import { describe, expect, it } from "vitest";
import { UNLIMITED_LIMIT, effectiveLimit } from "@/lib/billing/entitlement";

describe("test hesabı sınırsız hak (profiles.unlimited_quota)", () => {
  it("bayrak kapalıyken limit aynen, açıkken fiilen sınırsız", () => {
    expect(effectiveLimit(1, false)).toBe(1);
    expect(effectiveLimit(10, true)).toBe(UNLIMITED_LIMIT);
    expect(UNLIMITED_LIMIT).toBeLessThan(2_147_483_647);
  });
});
