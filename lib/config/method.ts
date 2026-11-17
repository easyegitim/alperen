// /yontem sayfası yapılandırması (UI spec S5, §5.2).
/** method_viewed.from değerleri (kapalı liste). */
export const METHOD_FROM = ["guide", "result", "paywall", "footer", "pricing", "direct"] as const;
export type MethodFrom = (typeof METHOD_FROM)[number];

/**
 * `from` kapalı listede değilse "direct" (UI spec §5.2). Saf; birim testi var. Sunucu bileşeni (/yontem) çağırdığı için
 * "use client" modülünde değil burada durur: istemci modülünün dışa aktarımı sunucuda çağrılamaz.
 */
export function parseMethodFrom(raw: unknown): MethodFrom {
  return METHOD_FROM.find((f) => f === raw) ?? "direct";
}

/** Son onaylı `pnpm fairness` koşusunun tarihi (hybrid.v1, SPEC 8.8 kapısı). Onaylı bir koşu olana kadar null. */
export const FAIRNESS_LAST_RUN: string | null = null;
