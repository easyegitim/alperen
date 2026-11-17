import { createApiClient, createAuraApi, isAnalysisSettled, nextPollDelayMs, waitForAnalysis } from "@/mobile/src/lib/api";

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body } as Response;
  }) as unknown as typeof fetch; // test çifti: yalnız kullanılan alanlar
  return { f, calls };
}

const body = (c: { init: RequestInit }) => JSON.parse(String(c.init.body)) as Record<string, unknown>;

describe("tipli v2 istemcisi (CONTRACTS_V2 Sprint 3 S3.2): yollar ve gövdeler web rotalarıyla birebir", () => {
  it("onboarding, billing, referral, plan, questionnaire yolları", async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const aura = createAuraApi(createApiClient(async () => "t", f, "https://api.test"));
    await aura.onboarding.age("25_34");
    await aura.onboarding.profile("female");
    await aura.onboarding.complete();
    await aura.billing.status("11111111-1111-4111-8111-111111111111");
    await aura.billing.status();
    await aura.billing.offer();
    await aura.billing.sync();
    await aura.referral.get();
    await aura.referral.claim("DV-AB12-CD34");
    await aura.plan.get("a1");
    await aura.plan.create("a1", true);
    await aura.doctor.get("a1");
    await aura.me.faceShape("oval");
    expect(calls.map((c) => `${c.init.method} ${c.url.replace("https://api.test", "")}`)).toEqual([
      "POST /api/onboarding/age",
      "POST /api/onboarding/profile",
      "POST /api/onboarding/complete",
      "GET /api/billing/status?analysis=11111111-1111-4111-8111-111111111111",
      "GET /api/billing/status",
      "GET /api/billing/offer",
      "POST /api/billing/sync",
      "GET /api/referral",
      "POST /api/referral",
      "GET /api/plan/a1",
      "POST /api/plan",
      "GET /api/doctor?analysisId=a1",
      "PATCH /api/me/face-shape",
    ]);
    expect(body(calls[0])).toEqual({ ageBand: "25_34" });
    expect(body(calls[1])).toEqual({ presentation: "female" });
    expect(body(calls[8])).toEqual({ code: "DV-AB12-CD34" });
    expect(body(calls[10])).toEqual({ analysisId: "a1", regenerate: true });
    expect(body(calls[12])).toEqual({ faceShape: "oval" });
  });

  it("analizler: device_only gövdesinde görsel yok; run görselleri [id]/run'a yollar; tryon v2 + flag", async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: {} }]);
    const aura = createAuraApi(createApiClient(async () => null, f, "https://api.test"));
    const geometry = { version: "geo-v1" } as unknown as Parameters<typeof aura.analyses.deviceOnly>[0]["geometry"]; // test çifti
    await aura.analyses.deviceOnly({ clientRequestId: "c1", geometry, sourceHashes: ["a".repeat(64)] });
    await aura.analyses.run("an1", { images: [{ view: "front", data: "/9j/x" }, { view: "profile_left", data: "/9j/y" }] });
    await aura.analyses.get("an1");
    await aura.tryon.run({ clientRequestId: "c2", presets: { hair: "h1", beard: "b1" }, image: "/9j/z" });
    await aura.tryon.flag("ev1");
    await aura.tryon.drift("ev1");
    expect(calls.map((c) => `${c.init.method} ${c.url.replace("https://api.test", "")}`)).toEqual([
      "POST /api/analyses",
      "POST /api/analyses/an1/run",
      "GET /api/analyses/an1",
      "POST /api/tryon",
      "POST /api/tryon/ev1/flag",
      "POST /api/tryon/ev1/drift",
    ]);
    const device = body(calls[0]);
    expect(device.mode).toBe("device_only");
    expect("image" in device || "images" in device).toBe(false);
    expect(JSON.stringify(device)).not.toContain("/9j/");
    expect((body(calls[1]).images as unknown[]).length).toBe(2);
    // Görsel yalnız /api/analyses/[id]/run ve /api/tryon gövdesinde (CLAUDE.md gizlilik kuralı)
    for (const c of calls) {
      const b = String(c.init.body ?? "");
      if (b.includes("/9j/")) expect(c.url).toMatch(/\/api\/(analyses\/[^/]+\/run|tryon)$/);
    }
  });

  it("yoklama: completed/failed durur, her yanıt onUpdate'e gider, aralık artar", async () => {
    const stages = ["queued", "running", "running", "completed"].map((stage) => ({ status: 200, body: { id: "an1", stage, sectionsReady: ["device"] } }));
    const { f, calls } = fakeFetch(stages);
    const aura = createAuraApi(createApiClient(async () => null, f, "https://api.test"));
    const seen: string[] = [];
    const waits: number[] = [];
    const final = await waitForAnalysis(aura, "an1", { onUpdate: (a) => seen.push(a.stage), sleep: async (ms) => void waits.push(ms) });
    expect(final?.stage).toBe("completed");
    expect(seen).toEqual(["queued", "running", "running", "completed"]);
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([2500, 2850, 3200]);
    expect(nextPollDelayMs(100)).toBe(6000);
    expect(isAnalysisSettled("failed")).toBe(true);
    expect(isAnalysisSettled("device_only")).toBe(false);
  });

  it("iptal sinyali yoklamayı bitirir; API hatası ApiClientError olarak yükselir", async () => {
    const { f } = fakeFetch([{ status: 402, body: { error: { code: "PREMIUM_REQUIRED", message: "Ödeme gerekiyor." } } }]);
    const aura = createAuraApi(createApiClient(async () => null, f, "https://api.test"));
    await expect(aura.plan.get("a1")).rejects.toMatchObject({ code: "PREMIUM_REQUIRED", status: 402 });
    const ac = new AbortController();
    ac.abort();
    expect(await waitForAnalysis(aura, "an1", { signal: ac.signal })).toBeNull();
  });
});
