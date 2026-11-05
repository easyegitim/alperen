import type { FaceShape } from "@/lib/face/types";
import { BEARD_PRESETS } from "./beard-presets";
import { HAIR_PRESETS } from "./hair-presets";

/** Her şekil için nötr tarif ve uygun preset id'leri (presets.suits'ten türetilir). */
export const FACE_SHAPES: Record<FaceShape, { nameTr: string; descriptionTr: string; hairIds: string[]; beardIds: string[] }> = Object.fromEntries(
  (
    [
      ["oval", "Oval", "Uzunluk genişlikten biraz fazla; alın ve çene yumuşak geçişli. Çoğu stil dengeli durur."],
      ["round", "Yuvarlak", "Uzunluk ve genişlik birbirine yakın; hatlar yumuşak. Üstte hacim ve kenarlarda kısalık dengeyi artırır."],
      ["square", "Kare", "Çene ve alın genişliği birbirine yakın, çene hattı belirgin. Yumuşak doku ve orta uzunluk dengeler."],
      ["long", "Uzun", "Uzunluk genişlikten belirgin fazla. Kâkül ve yanlarda hacim dengeler; üstte fazla yükseklikten kaçınılır."],
      ["heart", "Kalp", "Alın çeneden daha geniş. Çene çevresinde hacim ve yumuşak kâkül dengeler."],
      ["diamond", "Elmas", "Elmacıklar alın ve çeneden geniş. Alında dolgunluk ve çene çevresinde hacim dengeler."],
    ] as [FaceShape, string, string][]
  ).map(([shape, nameTr, descriptionTr]) => [
    shape,
    {
      nameTr,
      descriptionTr,
      hairIds: HAIR_PRESETS.filter((p) => p.suits.includes(shape)).map((p) => p.id),
      beardIds: BEARD_PRESETS.filter((p) => p.suits.includes(shape)).map((p) => p.id),
    },
  ]),
) as Record<FaceShape, { nameTr: string; descriptionTr: string; hairIds: string[]; beardIds: string[] }>;
