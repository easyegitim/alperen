import { ApiClientError, createApiClient } from "@/mobile/src/lib/api";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
  }) as unknown as typeof fetch; // test çifti: yalnız kullanılan alanlar
  return { f, calls };
}

describe("mobil API istemcisi (SPEC-MOBILE M2: Bearer)", () => {
  it("token varsa Authorization: Bearer gönderir, JSON gövdeyi yazar", async () => {
    const { f, calls } = fakeFetch(200, { ok: true });
    const api = createApiClient(async () => "tok.en.x", f, "https://api.test");
    const r = await api.post<{ ok: boolean }>("/api/consents", { type: "marketing" });
    expect(r).toEqual({ ok: true });
    expect(calls[0].url).toBe("https://api.test/api/consents");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer tok.en.x");
    expect(h["content-type"]).toBe("application/json");
    expect(calls[0].init.body).toBe(JSON.stringify({ type: "marketing" }));
  });
  it("token yoksa başlık yok; API hata gövdesi ApiClientError'a çevrilir; 204 null", async () => {
    const { f, calls } = fakeFetch(401, { error: { code: "UNAUTHENTICATED", message: "Oturum gerekli." } });
    const api = createApiClient(async () => null, f, "https://api.test");
    await expect(api.get("/api/billing/status")).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
    const noContent = createApiClient(async () => null, fakeFetch(204, null).f, "https://api.test");
    expect(await noContent.post("/x", {})).toBeNull();
    expect(new ApiClientError(500, null).code).toBe("NETWORK");
  });
});
