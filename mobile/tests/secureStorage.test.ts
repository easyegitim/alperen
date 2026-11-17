import { CHUNK_SIZE, createChunkedStore, safeKey, splitChunks } from "@/mobile/src/lib/secureStorage";

function memoryRaw() {
  const m = new Map<string, string>();
  return {
    m,
    getItemAsync: async (k: string) => m.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => {
      if (!/^[A-Za-z0-9._-]+$/.test(k)) throw new Error(`geçersiz anahtar: ${k}`);
      m.set(k, v);
    },
    deleteItemAsync: async (k: string) => {
      m.delete(k);
    },
  };
}

describe("SecureStore parçalı oturum deposu (SPEC-MOBILE M2)", () => {
  it("büyük değer parçalanır, birleştirilir, parça boyutu sınırı aşmaz", async () => {
    const raw = memoryRaw();
    const store = createChunkedStore(raw);
    const big = "x".repeat(CHUNK_SIZE * 3 + 17);
    await store.setItem("sb-auth-token", big);
    expect(await store.getItem("sb-auth-token")).toBe(big);
    for (const [k, v] of raw.m) if (!k.endsWith(".n")) expect(v.length).toBeLessThanOrEqual(CHUNK_SIZE);
    expect(raw.m.get("sb-auth-token.n")).toBe("4");
  });
  it("küçülen değer eski parçaları siler; removeItem her şeyi temizler", async () => {
    const raw = memoryRaw();
    const store = createChunkedStore(raw, 4);
    await store.setItem("k", "123456789");
    await store.setItem("k", "12");
    expect(raw.m.size).toBe(2);
    expect(await store.getItem("k")).toBe("12");
    await store.removeItem("k");
    expect(raw.m.size).toBe(0);
    expect(await store.getItem("k")).toBeNull();
  });
  it("anahtar güvenli karakterlere indirgenir; eksik parça null döner", async () => {
    expect(safeKey("sb:auth token")).toBe("sb_auth_token");
    expect(splitChunks("", 4)).toEqual([""]);
    const raw = memoryRaw();
    const store = createChunkedStore(raw, 4);
    await store.setItem("k", "abcdefgh");
    raw.m.delete("k.1");
    expect(await store.getItem("k")).toBeNull();
  });
});
