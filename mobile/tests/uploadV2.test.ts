import type { ClientAnalysisV2 } from "@/lib/score/present";
import { bindPendingSet, clearPendingSet, getPendingSet, pendingSetFor, setPendingSet } from "@/mobile/src/features/capture/captureSession";
import type { EncodedView } from "@/mobile/src/features/capture/payload";
import { uploadPendingSet } from "@/mobile/src/features/capture/upload";
import { ApiClientError, type AnalysisRunInput, type AuraApi } from "@/mobile/src/lib/api";

/** Görsel kodlayıcı çifti: native kırpım yerine görünüm adına göre sabit base64 (yalnız /9j/ öneki ve bayt sayısı). */
const fakeEncode = async (_uri: string, _lm: unknown, _w: number, _h: number, view: EncodedView["view"], sourceHash: string | null): Promise<EncodedView> => ({ view, base64: `/9j/${view}`, bytes: 1000, sourceHash });

function fakeAura(run: (id: string, body: AnalysisRunInput) => Promise<ClientAnalysisV2 | null>) {
  const calls: { id: string; body: AnalysisRunInput }[] = [];
  const aura = {
    analyses: {
      run: async (id: string, body: AnalysisRunInput) => {
        calls.push({ id, body });
        return run(id, body);
      },
    },
  } as unknown as Pick<AuraApi, "analyses">; // test çifti: yalnız run kullanılır
  return { aura, calls };
}

const queued = { id: "an1", stage: "queued", sectionsReady: ["device"] } as unknown as ClientAnalysisV2; // test çifti

describe("ödeme sonrası set gönderimi (CONTRACTS_V2 §2.3/3-4; görseller yalnız /api/analyses/[id]/run)", () => {
  beforeEach(async () => {
    await clearPendingSet();
  });

  it("bellekte set yoksa 'no_set' (uygulama yeniden başladı → 'Çekime dön')", async () => {
    const { aura, calls } = fakeAura(async () => queued);
    expect(await uploadPendingSet(aura, "an1", { encode: fakeEncode })).toEqual({ ok: false, reason: "no_set" });
    expect(calls).toHaveLength(0);
  });

  it("set bu analize bağlıysa yalnız izinli görünümler sırasıyla gider; başarıda set bellekten düşer", async () => {
    setPendingSet({
      analysisId: null,
      capturedAt: 1,
      views: [
        { view: "front", uri: "file:///tmp/f.jpg", width: 1000, height: 1300, landmarksPx: [{ x: 1, y: 1 }], sourceHash: null },
        { view: "profile_left", uri: "file:///tmp/p.jpg", width: 1000, height: 1300, landmarksPx: null, sourceHash: null },
      ],
    });
    bindPendingSet("an1");
    expect(pendingSetFor("an1")).not.toBeNull();
    expect(pendingSetFor("an2")).toBeNull();
    const { aura, calls } = fakeAura(async () => queued);
    const r = await uploadPendingSet(aura, "an1", { encode: fakeEncode });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].id).toBe("an1");
    expect(calls[0].body.images.map((i) => i.view)).toEqual(["front", "profile_left"]);
    expect(calls[0].body.sourceHashes).toBeUndefined();
    // Gövdede landmark, uri ya da 478 nokta yok; yalnız view + data
    expect(Object.keys(calls[0].body).sort()).toEqual(["images"]);
    expect(JSON.stringify(calls[0].body)).not.toMatch(/landmarks|"x":|file:\/\//);
    expect(getPendingSet()).toBeNull();
  });

  it("profil eksikse gönderilmez; API hatasında set bellekte kalır (yeniden deneme) ve kod döner", async () => {
    setPendingSet({ analysisId: "an1", capturedAt: 1, views: [{ view: "front", uri: "file:///tmp/f.jpg", width: 1, height: 1, landmarksPx: null, sourceHash: null }] });
    const { aura, calls } = fakeAura(async () => queued);
    expect(await uploadPendingSet(aura, "an1", { encode: fakeEncode })).toEqual({ ok: false, reason: "profile_missing" });
    expect(calls).toHaveLength(0);

    setPendingSet({
      analysisId: "an1",
      capturedAt: 1,
      views: [
        { view: "front", uri: "f", width: 1, height: 1, landmarksPx: null, sourceHash: "a".repeat(64) },
        { view: "profile_right", uri: "p", width: 1, height: 1, landmarksPx: null, sourceHash: "b".repeat(64) },
      ],
    });
    const failing = fakeAura(async () => {
      throw new ApiClientError(402, { error: { code: "PREMIUM_REQUIRED", message: "Ödeme gerekiyor." } });
    });
    const r = await uploadPendingSet(failing.aura, "an1", { encode: fakeEncode });
    expect(r).toMatchObject({ ok: false, reason: "api", code: "PREMIUM_REQUIRED" });
    expect(failing.calls[0].body.sourceHashes).toEqual(["a".repeat(64), "b".repeat(64)]);
    expect(getPendingSet()).not.toBeNull();
  });
});
