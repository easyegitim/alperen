import { z } from "zod";
import {
  BEARD_LENGTH_PREFS,
  BUDGET_BANDS,
  GOAL_DIRECTIONS,
  HAIR_LENGTH_PREFS,
  ONE_TIME_BUDGET_BANDS,
  SPORT_DAYS,
  TIME_BANDS,
  WORK_TYPES,
} from "@/lib/config/plan";
import { GOALS, JAW_HEALTH_ISSUES, SKIN_TYPES } from "@/lib/questionnaire";

// Ödeme sonrası "Planını kişiselleştir" anketi (KB §3.2/5–6, R2-C13, R2-C14, Ç17; PLAN_V2 Faz 4c). Saf, paylaşılan.
// KARAR (R1-E4, R2-C13): bu cevaplar SKORU DEĞİŞTİRMEZ; yalnız planı kişiselleştirir. Sunum (cinsiyet) burada sorulmaz
// (profiles.presentation tek kaynak). Boy/kilo isteğe bağlı (K8: yağ oranı yalnız VKİ ≥ 25; 18 altına hiç).
// Gözlük ve başörtüsü: fotoğraftan tahminle dolu gelir (SignalsV2.observations.glassesDetected/headCoveringDetected),
// kullanıcı onaylar ya da değiştirir; tahmin yoksa seçim yapılmadan saç önerisi üretilmez (Ç17).
// Saklama: profiles.questionnaire_v2 jsonb (migration 0013); yazma yalnız sunucu rotası (Zod) ile.

export const QUESTIONNAIRE_V2_VERSION = "q.v2" as const;

export const BodyV2Schema = z.object({
  heightCm: z.number().int().min(100).max(250),
  weightKg: z.number().min(30).max(300),
});

/** Ç17: fotoğraftan gelen tahmin ve kullanıcının onayı birlikte saklanır (hangisi plana girdi, basis çipinde görünür). */
export const PhotoConfirmSchema = z.object({
  /** Fotoğraftan tahmin; null = tahmin yok (eski satır ya da görünmedi). */
  detected: z.boolean().nullable(),
  /** Kullanıcının cevabı; null = henüz seçmedi. detected null ve value null ise saç önerisi üretilmez. */
  value: z.boolean().nullable(),
});
export type PhotoConfirm = z.infer<typeof PhotoConfirmSchema>;

export const QuestionnaireV2Schema = z.object({
  version: z.literal(QUESTIONNAIRE_V2_VERSION),
  goals: z.array(z.enum(GOALS)).min(1).max(GOALS.length),
  /** KB R2-Ö7: Daha keskin ve olgun · Daha yumuşak ve genç · Olduğum gibi, daha bakımlı. */
  goalDirection: z.enum(GOAL_DIRECTIONS),
  budget: z.enum(BUDGET_BANDS),
  /** Tek seferlik uzman/klinik bütçesi; AÇIK (§6.6) — "unknown" varsayılan. */
  oneTimeBudget: z.enum(ONE_TIME_BUDGET_BANDS),
  minutesPerDay: z.union(TIME_BANDS.map((n) => z.literal(n)) as [z.ZodLiteral<5>, z.ZodLiteral<10>, z.ZodLiteral<20>, z.ZodLiteral<30>]),
  activity: z.object({ sportDays: z.enum(SPORT_DAYS), work: z.enum(WORK_TYPES) }),
  hairLengthPref: z.enum(HAIR_LENGTH_PREFS),
  beardLengthPref: z.enum(BEARD_LENGTH_PREFS),
  skinType: z.enum(SKIN_TYPES),
  /** Boş dizi = "hiçbiri" (K10: egzersiz yalnız o zaman). */
  jawHealth: z.array(z.enum(JAW_HEALTH_ISSUES)).max(JAW_HEALTH_ISSUES.length),
  glasses: PhotoConfirmSchema,
  headCovering: PhotoConfirmSchema,
  body: BodyV2Schema.optional(),
});
export type QuestionnaireV2 = z.infer<typeof QuestionnaireV2Schema>;

/** Çözümlenmiş evet/hayır: kullanıcı cevabı > fotoğraf tahmini > null (bilinmiyor). */
export function resolvePhotoConfirm(c: PhotoConfirm): boolean | null {
  return c.value ?? c.detected;
}

/** Ç17: başörtüsü bilinmiyorsa (tahmin yok, seçim yok) saç önerisi üretilmez; biliniyorsa yalnız "hayır" ise üretilir. */
export function hairAdviceAllowedV2(q: Pick<QuestionnaireV2, "headCovering">): boolean {
  return resolvePhotoConfirm(q.headCovering) === false;
}

/** K10: egzersizler yalnız çene sağlığı "hiçbiri" iken. */
export function exerciseEligibleV2(q: Pick<QuestionnaireV2, "jawHealth">): boolean {
  return q.jawHealth.length === 0;
}

/** Boş/eksik tahminle başlayan varsayılan form (W4 sihirbazı bunu doldurur). */
export function emptyQuestionnaireV2(prefill: { glassesDetected?: boolean | null; headCoveringDetected?: boolean | null } = {}): QuestionnaireV2 {
  return {
    version: QUESTIONNAIRE_V2_VERSION,
    goals: ["general"],
    goalDirection: "as_is_groomed",
    budget: "upto_1000",
    oneTimeBudget: "unknown",
    minutesPerDay: 10,
    activity: { sportDays: "0_1", work: "desk" },
    hairLengthPref: "keep",
    beardLengthPref: "keep",
    skinType: "unknown",
    jawHealth: [],
    glasses: { detected: prefill.glassesDetected ?? null, value: null },
    headCovering: { detected: prefill.headCoveringDetected ?? null, value: null },
  };
}
