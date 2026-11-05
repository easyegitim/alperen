// SPEC 9.7: şema/güvenlik başarısızlığında kural tabanlı rapor; model kesintisinde ürün çalışmaya devam eder.
import type { CoachReport } from "@/lib/ai/reportSchema";
import type { AllowedCatalog } from "@/lib/coach/catalog";
import type { BodyRules } from "@/lib/coach/bodyRules";
import type { Questionnaire } from "@/lib/questionnaire";
import { FACE_SHAPES } from "./face-shapes";
import type { FaceShape } from "@/lib/face/types";

export type FallbackInput = {
  overall: number;
  potential: number;
  faceShape: FaceShape;
  questionnaire: Questionnaire;
  catalog: AllowedCatalog;
  body: BodyRules;
  flags: { visibleSkinConcern: boolean; skinConcernNote: string | null };
  gains: Record<"skin" | "hair" | "grooming" | "jawline", { value: number }>;
};

const f1 = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Yüz hatları ipuçları (SPEC 9.4): yalnız VKİ ≥ 25 ve kısıtlama notu yokken (mode "deficit"), günlük açık ≤ 500 kcal.
 * Kodla yazılır; koç raporunda da (report.v2, enforceRules) model metni yerine bu dizi kullanılır (engine spec §9.6).
 */
export function contourTips(body: BodyRules): string[] {
  if (body.mode !== "deficit") return [];
  return [
    "Günlük ılımlı bir açık (en fazla 500 kcal) ve haftada vücut ağırlığının %0,5–1'i kadar kayıp sürdürülebilir hedeftir.",
    "Her öğünde yeterli protein ve haftada 2–3 kuvvet antrenmanı kas kaybını önler.",
    "Uyku, akşam tuzu ve alkolü azaltmak yüz şişliğini düşürür.",
    "Yüz yağ oranı azaldıkça elmacık ve çene hatları belirginleşebilir.",
    ...(body.dietitianSuggested ? ["Bir diyetisyenle planlamak daha güvenli ve kalıcı olur."] : []),
  ];
}

export function buildFallbackReport(i: FallbackInput): CoachReport {
  const shape = FACE_SHAPES[i.faceShape];
  const hair = i.catalog.hair.slice(0, 3).map((p) => ({
    presetId: p.id,
    why: `${shape.nameTr} yüz şekline uyar.${p.noteTr ? ` ${p.noteTr}.` : ""}`,
    barberScript: `Berbere: "${p.nameTr}" istiyorum; ${p.noteTr ? p.noteTr.toLowerCase() : "yüz şeklime göre dengeli"}.`,
    maintenance: "3–5 haftada bir kesim.",
  }));
  const beard = i.catalog.beard
    .filter((p) => (i.questionnaire.beardGrowth === "sparse" ? ["stubble_light", "clean_shaven", "stubble_heavy", "goatee"].includes(p.id) : true))
    .slice(0, 2)
    .map((p) => ({
      presetId: p.id,
      why: `${shape.nameTr} yüz şeklinde ${p.noteTr ? p.noteTr.toLowerCase() : "dengeli durur"}.`,
      barberScript: `Berbere: "${p.nameTr}", kenarları temiz.`,
      maintenance: "Haftada 1–2 düzeltme.",
    }));
  const steps = (slot: "morning" | "evening" | "weekly", max: number) =>
    i.catalog.skinSteps.filter((s) => s.slot === slot).slice(0, max).map((s) => ({ stepType: s.id, note: s.noteTr }));
  const exercises = i.catalog.exercises.filter((e) => ["ex_chin_tuck", "ex_face_massage", "ex_neck_stretch"].includes(e.id)).slice(0, 3).map((e) => ({ id: e.id, why: e.noteTr }));
  const habitIds = i.body.mode === "deficit" ? ["hb_sleep", "hb_water", "hb_protein", "hb_strength", "hb_salt_alcohol"] : ["hb_sleep", "hb_water", "hb_sun", "hb_salt_alcohol"];
  const habits = i.catalog.habits.filter((h) => habitIds.includes(h.id)).map((h) => ({ id: h.id, target: h.defaultTargetTr }));

  const contoursTips = contourTips(i.body);

  const seeProfessional = i.flags.visibleSkinConcern
    ? { specialty: "dermatoloji", text: `Cildinde belirgin bir durum görülüyor${i.flags.skinConcernNote ? ` (${i.flags.skinConcernNote})` : ""}; bir dermatoloğa göstermek faydalı olabilir.` }
    : i.body.gentleProfessionalNote
      ? { specialty: "diyetisyen", text: "Beslenme hedeflerin için bir hekim veya diyetisyenle konuşmak faydalı olabilir." }
      : null;

  return {
    summary: `Genel skorun ${f1(i.overall)}, potansiyelin ${f1(i.potential)}. Bu plan saç, ${beard.length ? "sakal, " : ""}cilt ve alışkanlıklara odaklanır; 8–12 haftada en çok fark cilt ve bakım tarafında görülür.`,
    scoreNarrative: `Skor yapay zekânın fotoğraf üzerinden tahminidir. Potansiyel, geliştirilebilir alanlardaki gerçekçi kazançların toplamıdır: cilt ${f1(i.gains.skin.value)}, saç ${f1(i.gains.hair.value)}, bakım ${f1(i.gains.grooming.value)}, çene hattı ${f1(i.gains.jawline.value)} puan.`,
    hair,
    beard,
    hairColor: null,
    skincare: { morning: steps("morning", 4), evening: steps("evening", 4), weekly: steps("weekly", 2) },
    faceContours: { enabled: i.body.faceContoursEnabled, tips: contoursTips },
    exercises,
    habits,
    style: ["Yüzüne yakın tonlarda (siyah, lacivert, kum) sade üstler yüz hatlarını öne çıkarır.", "Yaka çizgisi çene şekliyle zıt olsun: yuvarlak yüze V yaka, uzun yüze yuvarlak/bisiklet yaka."],
    linkedActions: {
      skin: i.catalog.skinSteps.slice(0, 3).map((s) => s.id),
      hair: hair.map((h) => h.presetId),
      grooming: [...beard.map((b) => b.presetId), ...(i.catalog.skinSteps.find((s) => s.id === "st_beard_oil") ? ["st_beard_oil"] : [])],
      jawline: [...exercises.map((e) => e.id), ...(i.body.mode === "deficit" ? ["hb_strength", "hb_salt_alcohol"] : ["hb_salt_alcohol"])],
    },
    seeProfessional,
  };
}
