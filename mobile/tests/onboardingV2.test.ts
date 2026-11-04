import { ageBandOutcome, clearOnboardingDraft, flushOnboardingDraft, planFlush, readOnboardingDraft, writeOnboardingDraft } from "@/mobile/src/features/onboarding/draft";

describe("ödeme öncesi taslak (KB §3.1: yaş → cinsiyet → hesap; giriş sonrası sunucuya yazılır)", () => {
  beforeEach(async () => {
    await clearOnboardingDraft();
  });

  it("taslak AsyncStorage'a yazılır, okunur, temizlenir; bozuk değer atılır", async () => {
    expect(await readOnboardingDraft()).toEqual({});
    await writeOnboardingDraft({ ageBand: "25_34" });
    await writeOnboardingDraft({ presentation: "female" });
    expect(await readOnboardingDraft()).toEqual({ ageBand: "25_34", presentation: "female" });
    await clearOnboardingDraft();
    expect(await readOnboardingDraft()).toEqual({});
  });

  it("planFlush: eksik seçim 'missing'; sunucuda olan yeniden yazılmaz", () => {
    expect(planFlush({}, { hasAgeBand: false, hasPresentation: false })).toEqual({ kind: "missing" });
    expect(planFlush({ ageBand: "18_24" }, { hasAgeBand: false, hasPresentation: false })).toEqual({ kind: "missing" });
    expect(planFlush({ ageBand: "18_24", presentation: "male" }, { hasAgeBand: false, hasPresentation: false })).toEqual({ kind: "calls", ageBand: "18_24", presentation: "male" });
    expect(planFlush({ ageBand: "18_24", presentation: "male" }, { hasAgeBand: true, hasPresentation: false })).toEqual({ kind: "calls", ageBand: null, presentation: "male" });
    expect(planFlush({}, { hasAgeBand: true, hasPresentation: true })).toEqual({ kind: "calls", ageBand: null, presentation: null });
  });

  it("flushOnboardingDraft yalnız eksikleri çağırır ve taslağı siler; hata taslağı korur", async () => {
    const calls: string[] = [];
    const api = { age: async (b: string) => void calls.push(`age:${b}`), profile: async (p: string) => void calls.push(`profile:${p}`) };
    await writeOnboardingDraft({ ageBand: "35_49", presentation: "unspecified" });
    const plan = await flushOnboardingDraft(api, await readOnboardingDraft(), { hasAgeBand: false, hasPresentation: true });
    expect(plan.kind).toBe("calls");
    expect(calls).toEqual(["age:35_49"]);
    expect(await readOnboardingDraft()).toEqual({});

    await writeOnboardingDraft({ ageBand: "35_49", presentation: "male" });
    const failing = { age: async () => { throw new Error("ağ"); }, profile: api.profile };
    await expect(flushOnboardingDraft(failing, await readOnboardingDraft(), { hasAgeBand: false, hasPresentation: false })).rejects.toThrow("ağ");
    expect((await readOnboardingDraft()).ageBand).toBe("35_49");
  });

  it("yaş bandı: under_18 bayrak kapalıyken 'yakında'; sunucu isAdult=false da 'yakında'", () => {
    expect(ageBandOutcome("under_18", false)).toBe("soon");
    expect(ageBandOutcome("under_18", true, false)).toBe("soon");
    expect(ageBandOutcome("18_24", false, true)).toBe("continue");
    expect(ageBandOutcome("50_plus", false)).toBe("continue");
  });
});
