// Alt skor satırındaki gözlem cümlesi (UI spec §2.1, sözleşme C11). Saf, paylaşılan (web ve mobil).
// Yapısal alt skorlar (uyum, göz, çene) hiçbir zaman cümle almaz: satır hangi anahtarları taşırsa taşısın null.
import type { SubKey } from "@/lib/config/teaser";

/** Tam cümle: baştaki harf büyük (tr), sonda nokta yoksa eklenir. Boş veya metin olmayan değer → null. */
function sentence(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const head = s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1);
  return /[.!?…]$/.test(head) ? head : `${head}.`;
}

function field(obs: unknown, key: "skin" | "hair" | "brows" | "facialHair"): unknown {
  if (typeof obs !== "object" || obs === null || Array.isArray(obs)) return undefined;
  return (obs as Record<string, unknown>)[key];
}

/** skin→skin, hair→hair, grooming→brows + facialHair (tek boşlukla); harmony/eyes/jawline→null. */
export function observationFor(k: SubKey, obs: unknown): string | null {
  switch (k) {
    case "skin":
      return sentence(field(obs, "skin"));
    case "hair":
      return sentence(field(obs, "hair"));
    case "grooming": {
      const parts = [sentence(field(obs, "brows")), sentence(field(obs, "facialHair"))].filter((p): p is string => p !== null);
      return parts.length ? parts.join(" ") : null;
    }
    default:
      return null;
  }
}
