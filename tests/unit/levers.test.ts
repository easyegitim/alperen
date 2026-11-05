import { describe, expect, it } from "vitest";
import { HABITS } from "@/content/habits";
import { LEVERS, LEVER_ITEMS, hasPlanRoute } from "@/content/levers";
import { SKIN_STEPS } from "@/content/skin-steps";
import { LEVER_KEYS, LEVER_SUB, type LeverKey } from "@/lib/score/contract";
import tr from "@/messages/tr.json";

describe("kaldıraçlar (engine spec §6.4)", () => {
  it("LEVERS anahtarları = LEVER_KEYS = analysis.levers.* anahtarları", () => {
    const keys = Object.keys(LEVERS).sort();
    expect(keys).toEqual([...LEVER_KEYS].sort());
    expect(Object.keys(tr.analysis.levers).sort()).toEqual(keys);
  });

  it("alt skor sözleşmeyle aynı; her öğenin tek kaldıracı var", () => {
    for (const k of LEVER_KEYS) expect(LEVERS[k].sub).toBe(LEVER_SUB[k]);
    const items = LEVER_KEYS.map((k) => LEVERS[k].item);
    expect(new Set(items).size).toBe(items.length);
    expect([...items].sort()).toEqual([...LEVER_ITEMS].sort());
  });

  it("her adım content/ kataloğunda var (skin-steps veya habits)", () => {
    const ids = new Set([...SKIN_STEPS.map((s) => s.id), ...HABITS.map((h) => h.id)]);
    for (const k of LEVER_KEYS) for (const step of LEVERS[k].steps) expect(ids.has(step), `${k}: ${step}`).toBe(true);
  });

  it("plan yolu yalnız lv_brow_tidy için yok", () => {
    const without = LEVER_KEYS.filter((k: LeverKey) => !hasPlanRoute(k));
    expect(without).toEqual(["lv_brow_tidy"]);
  });
});
