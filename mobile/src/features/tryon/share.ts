// Deneme paylaşımı (SPEC 10.7, K16): her paylaşılan görsele "Aura ile oluşturuldu · YZ simülasyonu" etiketi GÖMÜLÜR.
// Saf plan burada (birim testli); çizim ve sistem paylaşım sayfası shareTryonResult'ta (Skia + expo-sharing, cihazda).
import { t } from "@/mobile/src/lib/i18n";

export type TryonSharePlan = { label: string; title: string; fileName: string };

/** Etiket her zaman common.aiGenerated; dosya adı aura-deneme-<eventId8>.jpg. */
export function tryonSharePlan(result: { eventId: string; title: string }, label: string = t("common.aiGenerated")): TryonSharePlan {
  return { label, title: result.title, fileName: `aura-deneme-${result.eventId.slice(0, 8)}.jpg` };
}

/** Paylaşılacak görsel: etiket gömülmüş base64 JPEG (cihazda). Etiket boşsa çizilmez → geçersiz; çağıran etiketi sağlamalı. */
export async function shareTryonResult(afterUri: string, plan: TryonSharePlan, deps: { stamp: (uri: string, label: string) => Promise<string>; share: (base64: string, title: string) => Promise<"shared" | "unavailable"> }): Promise<"shared" | "unavailable"> {
  if (!plan.label.trim()) throw new Error("label_missing");
  const b64 = await deps.stamp(afterUri, plan.label);
  return deps.share(b64, plan.title);
}
