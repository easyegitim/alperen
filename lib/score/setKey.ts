import { createHmac } from "node:crypto";

// Set önbelleği anahtarı (KB §4.2/6, Ç11; CONTRACTS_V2 §2.3/5): HMAC-SHA-256(secret, sıralı sha256'lar "\n" ile birleşik),
// hex. Fotoğraf değil; istemcinin ORİJİNAL dosyalar üzerinden hesapladığı sha256 listesinden türetilir. Sıra bağımsız
// (aynı set farklı sırayla aynı anahtar); tek dosya değişirse yeni anahtar. Secret yoksa önbellek kapalı (null).

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function computeSetKey(secret: string | undefined | null, hashes: readonly string[] | null | undefined): string | null {
  const s = secret?.trim();
  if (!s || !hashes || hashes.length === 0) return null;
  const normalized = hashes.map((h) => h.trim().toLowerCase());
  if (normalized.some((h) => !SHA256_HEX.test(h))) return null;
  const material = [...normalized].sort().join("\n");
  return createHmac("sha256", s).update(material, "utf8").digest("hex");
}
