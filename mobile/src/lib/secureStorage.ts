// Supabase oturumu için güvenli depo (iOS Keychain / Android Keystore). SecureStore tek değerde ~2 KB
// sınırı uyarır; oturum JSON'u daha büyük olabileceği için değer parçalara bölünür. Saf parçalama
// mantığı test edilir; SecureStore çağrıları enjekte edilir.
export const CHUNK_SIZE = 1800;

export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

type RawStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

/** SecureStore anahtarları yalnız [A-Za-z0-9._-] olabilir. */
export function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function splitChunks(value: string, size = CHUNK_SIZE): string[] {
  const out: string[] = [];
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
  return out.length ? out : [""];
}

export function createChunkedStore(raw: RawStore, size = CHUNK_SIZE): KeyValueStore {
  const countKey = (k: string) => `${safeKey(k)}.n`;
  const partKey = (k: string, i: number) => `${safeKey(k)}.${i}`;
  return {
    async getItem(key) {
      const n = Number(await raw.getItemAsync(countKey(key)));
      if (!Number.isInteger(n) || n <= 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const p = await raw.getItemAsync(partKey(key, i));
        if (p === null) return null; // eksik parça: bozuk kayıt, oturum yok sayılır
        parts.push(p);
      }
      return parts.join("");
    },
    async setItem(key, value) {
      const prev = Number(await raw.getItemAsync(countKey(key))) || 0;
      const chunks = splitChunks(value, size);
      for (let i = 0; i < chunks.length; i++) await raw.setItemAsync(partKey(key, i), chunks[i]);
      await raw.setItemAsync(countKey(key), String(chunks.length));
      for (let i = chunks.length; i < prev; i++) await raw.deleteItemAsync(partKey(key, i));
    },
    async removeItem(key) {
      const n = Number(await raw.getItemAsync(countKey(key))) || 0;
      for (let i = 0; i < n; i++) await raw.deleteItemAsync(partKey(key, i));
      await raw.deleteItemAsync(countKey(key));
    },
  };
}
