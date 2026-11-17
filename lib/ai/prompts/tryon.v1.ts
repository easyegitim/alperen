// SPEC 10.6 görsel promptu (birebir). Yalnız saç/sakal/renk değişir; yüz istemcide orijinal piksellerle geri yazılır.
import type { Preset } from "@/content/types";

export const TRYON_PROMPT_VERSION = "tryon.v1";

const KIND_WORD: Record<Preset["kind"], string> = { hair: "hair", beard: "beard", color: "hair color" };

export function buildTryonPrompt(preset: Preset): string {
  return `Edit this photo. Change ONLY the ${KIND_WORD[preset.kind]} to: ${preset.prompt}.
Keep the same person, head pose, framing, camera angle, lighting, background and clothing.
Do not change the face shape, eyes, nose, lips, skin tone or skin texture. Do not beautify or slim the face.
Do not add makeup or accessories. Keep the output the same aspect ratio as the input.
Photorealistic, natural result that a barber or colorist could achieve in one visit.`;
}
