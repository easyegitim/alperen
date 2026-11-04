// Plan v2 sabit (sahte) verisi: testler ve /debug/plan önizlemesi. Gerçek kullanıcı, fotoğraf ya da model çıktısı değildir;
// kimlikler content/* kataloğundan gelir (buildPlanV2 ile kurulur, bu yüzden her adım kodun kurallarından geçmiştir).
import { CatalogKnowledgeSource } from "@/lib/coach/knowledge";
import { buildPlanV2, type PlanSelection } from "@/lib/coach/plan";
import type { PlanContextV2 } from "@/lib/coach/planBasisV2";
import type { PlanViewV2 } from "@/lib/coach/planTypes";
import { emptyQuestionnaireV2, type QuestionnaireV2 } from "@/lib/questionnaireV2";
import { FIXTURE_REPORT } from "./analysisV2";

export const FIXTURE_QUESTIONNAIRE_V2: QuestionnaireV2 = {
  ...emptyQuestionnaireV2({ glassesDetected: false, headCoveringDetected: false }),
  goals: ["skin", "hair"],
  goalDirection: "sharper_mature",
  budget: "1000_2500",
  oneTimeBudget: "none",
  minutesPerDay: 10,
  activity: { sportDays: "2_3", work: "desk" },
  hairLengthPref: "short",
  beardLengthPref: "stubble",
  skinType: "combination",
  jawHealth: [],
  glasses: { detected: false, value: null },
  headCovering: { detected: false, value: false },
  body: { heightCm: 178, weightKg: 82 },
};

export function fixturePlanContext(over: Partial<PlanContextV2> = {}): PlanContextV2 {
  return {
    questionnaire: FIXTURE_QUESTIONNAIRE_V2,
    presentation: "male",
    ageBand: "25_34",
    faceShape: "square",
    faceShapeSource: "detailed",
    viewsUsed: 3,
    photoFacts: ["Saç uçları dağınık", "T bölgesinde parlama"],
    bodyImageScreen: null,
    doctorLayerEnabled: false,
    ...over,
  };
}

export const FIXTURE_SELECTIONS: PlanSelection[] = [
  { id: "st_spf", phase: "weeks_0_4", region: "skin", rationale: "T bölgesindeki parlama ve ton farkı için en etkili tek adım." },
  { id: "st_cleanser_foaming", phase: "weeks_0_4", region: "skin", rationale: "Karma ciltte fazla yağı alır, parlamayı azaltır." },
  { id: "st_moisturizer_light", phase: "weeks_0_4", region: "skin", rationale: "Jel nemlendirici parlama yapmadan dengeler." },
  { id: "textured_crop", phase: "weeks_0_4", region: "hair", rationale: "Kare yüzde üstte doku ve kısa yanlar keskin bir çerçeve verir." },
  { id: "st_matte_clay", phase: "weeks_0_4", region: "hair", rationale: "Dağınık uçları mat tutuşla toplar." },
  { id: "stubble_heavy", phase: "weeks_0_4", region: "jawline", rationale: "Belirgin kirli sakal çene hattının algısını netleştirir." },
  { id: "st_brow_tidy", phase: "weeks_0_4", region: "brows", rationale: "Çizgi dışı kıllar alınınca kaşlar daha düzenli okunur." },
  { id: "st_clay_mask_weekly", phase: "months_1_3", region: "skin", rationale: "Haftalık kil maskesi gözenek görünümünü azaltır." },
  { id: "hb_sleep", phase: "months_1_3", region: "skin", rationale: "Düzenli uyku göz altı tonunu dengeler." },
  { id: "hb_pillowcase", phase: "months_1_3", region: "skin", rationale: "Temiz kılıf cilt yüzeyini korur." },
  { id: "ex_chin_tuck", phase: "months_3_6", region: "skin", rationale: "Masa başı duruş için boyun hizası." },
  { id: "hb_protein", phase: "months_3_6", region: "skin", rationale: "Her öğünde protein kaynağı toparlanmayı destekler." },
];

export function fixturePlanView(over: { ctx?: Partial<PlanContextV2>; doctorState?: PlanViewV2["doctor"]["state"]; basisStale?: boolean } = {}): PlanViewV2 {
  const ctx = fixturePlanContext(over.ctx);
  const records = new CatalogKnowledgeSource();
  const { plan } = buildPlanV2({
    selections: FIXTURE_SELECTIONS,
    records: [...recordsOf(records)],
    report: FIXTURE_REPORT,
    ctx,
    meta: { analysisId: "11111111-1111-4111-8111-111111111111", generatedAt: "2026-11-04T12:00:00.000Z", model: "fixture", promptVersion: "plan.v2", knowledgeSource: "catalog", retrievedIds: FIXTURE_SELECTIONS.map((s) => s.id), droppedUnknownIds: 0 },
  });
  return { plan, doctor: { state: over.doctorState ?? "off", steps: [], disclosure: true }, basisStale: over.basisStale ?? false };
}

function recordsOf(src: CatalogKnowledgeSource) {
  // Katalog kaynağı eşzamanlı listeleme sunmaz; sabit veride tüm katalog kayıtları kullanılır.
  return src.allRecords();
}
