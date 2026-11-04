import { describe, expect, it } from "vitest";
import { API_ERROR_STATUS } from "@/lib/api/errors";
import { loadGlowUpSteps } from "@/lib/tryon/glowUpPlan.server";
import { fixturePlanView } from "@/tests/fixtures/planV2";
import { FakePostgrest } from "@/tests/helpers/fakePostgrest";
import { legacyPresetId, presetNames, resolvePresets, selectGlowUpSteps, type GlowUpStepLike } from "@/lib/tryon/combo";
import { sumWeights } from "@/lib/tryon/quota";
import { TRYON_EVENT_STATUSES } from "@/lib/tryon/types";

const steps: GlowUpStepLike[] = [
  { id: "textured_crop", area: "hair", tier: "expert", tryonPresetId: "textured_crop" },
  { id: "st_spf", area: "skin", tier: "diy" },
  { id: "hb_sleep", area: "habit", tier: "diy" },
  { id: "stubble_light", area: "beard", tier: "diy" },
  { id: "ex_chin_tuck", area: "exercise", tier: "diy" },
  { id: "dr_x", area: "skin", tier: "doctor" },
  { id: "jet_black", area: "color", tier: "expert", tryonPresetId: "jet_black" },
];

describe("kombin yardımcıları (KB §7.1; CONTRACTS_V2 S2.7)", () => {
  it("resolvePresets yuva uyumunu zorlar; legacyPresetId saç > sakal > renk", () => {
    const r = resolvePresets({ hair: "buzz_cut", beard: "goatee", color: "jet_black" });
    expect(r.hair?.id).toBe("buzz_cut");
    expect(r.beard?.kind).toBe("beard");
    expect(resolvePresets({ hair: "goatee" }).hair).toBeUndefined();
    expect(legacyPresetId({ hair: "buzz_cut", beard: "goatee" })).toBe("buzz_cut");
    expect(legacyPresetId({ beard: "goatee", color: "jet_black" })).toBe("goatee");
    expect(legacyPresetId({ color: "jet_black" })).toBe("jet_black");
    expect(legacyPresetId({})).toBe("");
    expect(presetNames(r)).toBe("Buzz kesim + Keçi sakalı + Simsiyah");
  });
  it("kota: ağırlık toplamı (weight yoksa 1); qc_failed durumu ve TRYON_QC_FAILED 422", () => {
    expect(sumWeights([{ weight: 2 }, {}, { weight: null }, { weight: 0 }])).toBe(5);
    expect(TRYON_EVENT_STATUSES).toContain("qc_failed");
    expect(API_ERROR_STATUS.TRYON_QC_FAILED).toBe(422);
  });
});

describe("glow-up adım seçimi (KB §7.2 anahtarlar; doktor işlemi görselde yok)", () => {
  it("hepsi: saç/renk/sakal/cilt/alışkanlık uygulanır; egzersiz ve doktor adımı girmez; presetler plandan", () => {
    const s = selectGlowUpSteps(steps, [], ["hair", "beard", "skin"]);
    expect(s.appliedStepIds).toEqual(["textured_crop", "st_spf", "hb_sleep", "stubble_light", "jet_black"]);
    expect(s.hairPresetId).toBe("textured_crop");
    expect(s.beardPresetId).toBe("stubble_light");
    expect(s.colorPresetId).toBe("jet_black");
    expect(s.skinStepIds).toEqual(["st_spf", "hb_sleep"]);
    expect(s.droppedIds).toEqual(["dr_x"]);
  });
  it("yalnız saç: sakal ve cilt adımları uygulanmaz", () => {
    const s = selectGlowUpSteps(steps, [], ["hair"]);
    expect(s.appliedStepIds).toEqual(["textured_crop", "jet_black"]);
    expect(s.beardPresetId).toBeNull();
    expect(s.skinStepIds).toEqual([]);
  });
  it("yalnız cilt: preset yok, cilt + alışkanlık; istenen kimlikler süzülür, bilinmeyen ve doktor düşer", () => {
    const s = selectGlowUpSteps(steps, ["st_spf", "uydurma", "dr_x", "textured_crop"], ["skin"]);
    expect(s.appliedStepIds).toEqual(["st_spf"]);
    expect(s.hairPresetId).toBeNull();
    expect(s.droppedIds).toEqual(["uydurma", "dr_x"]);
  });
  it("gizli (sürüm kapısı) preset seçilmez; preset kimliği adım kimliğiyle de eşleşir", () => {
    const s = selectGlowUpSteps([{ id: "buzz_cut", area: "hair", tier: "diy" }], [], ["hair"]);
    expect(s.hairPresetId).toBe("buzz_cut");
    const t = selectGlowUpSteps([{ id: "x", area: "hair", tier: "diy", tryonPresetId: "yok" }], [], ["hair"]);
    expect(t.hairPresetId).toBeNull();
    expect(t.appliedStepIds).toEqual(["x"]);
  });
});

describe("glow-up adım kaynağı: YALNIZ plan_v2 (KB §7.2/Ç9; katalog yedeği yok)", () => {
  const USER = "22222222-2222-4222-8222-222222222222";
  const ANALYSIS = "11111111-1111-4111-8111-111111111111";
  it("plan yoksa null (rota plan_required der); başka kullanıcının planı okunmaz; plan varsa adımlar plandan", async () => {
    const db = new FakePostgrest();
    db.tables.coach_reports = [{ id: "r1", user_id: USER, analysis_id: ANALYSIS, plan_v2: null, created_at: "2026-11-04T10:00:00.000Z" }];
    expect(await loadGlowUpSteps(db.client, USER, ANALYSIS)).toBeNull();
    expect(await loadGlowUpSteps(db.client, USER, "33333333-3333-4333-8333-333333333333")).toBeNull();
    const plan = fixturePlanView().plan;
    db.tables.coach_reports = [{ id: "r1", user_id: USER, analysis_id: ANALYSIS, plan_v2: plan, created_at: "2026-11-04T10:00:00.000Z" }];
    expect(await loadGlowUpSteps(db.client, "44444444-4444-4444-8444-444444444444", ANALYSIS)).toBeNull();
    const steps = await loadGlowUpSteps(db.client, USER, ANALYSIS);
    expect(steps).not.toBeNull();
    expect(steps!.map((s) => s.id)).toEqual(plan.steps.map((s) => s.id));
    // bozuk plan JSON'u katalogla doldurulmaz
    db.tables.coach_reports = [{ id: "r1", user_id: USER, analysis_id: ANALYSIS, plan_v2: { version: "plan.v2", steps: "yok" }, created_at: "2026-11-04T10:00:00.000Z" }];
    expect(await loadGlowUpSteps(db.client, USER, ANALYSIS)).toBeNull();
  });
});
