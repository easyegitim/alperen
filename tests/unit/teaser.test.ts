import { describe, expect, it } from "vitest";
import { SUB_KEYS, TEASER_MODES, getTeaserConfig } from "@/lib/config/teaser";

describe("getTeaserConfig (SPEC 5.3)", () => {
  it("varsayılan: shape_plus_one + skin", () => {
    expect(getTeaserConfig({})).toEqual({ mode: "shape_plus_one", subscore: "skin" });
  });

  it("geçerli env değerlerini okur", () => {
    expect(getTeaserConfig({ TEASER_MODE: "overall_only", TEASER_SUBSCORE: "hair" })).toEqual({
      mode: "overall_only",
      subscore: "hair",
    });
  });

  it("geçersiz değerde fırlatmaz, varsayılana döner", () => {
    expect(getTeaserConfig({ TEASER_MODE: "everything", TEASER_SUBSCORE: "nope" })).toEqual({
      mode: "shape_plus_one",
      subscore: "skin",
    });
  });

  it("boş string varsayılan sayılır", () => {
    expect(getTeaserConfig({ TEASER_MODE: "", TEASER_SUBSCORE: "" }).mode).toBe("shape_plus_one");
  });

  it("6 alt skor ve 3 mod tanımlı", () => {
    expect(SUB_KEYS).toHaveLength(6);
    expect(TEASER_MODES).toHaveLength(3);
  });
});
