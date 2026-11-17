// Anket v2 sihirbazının saf durumu (KB §3.2/5–6, R2-C13/C14, Ç17; PLAN 4c): adımlar, devam koşulu, taslak → şema.
// Web components/onboarding/QuestionnaireWizardV2 ile aynı kurallar. SKORU DEĞİŞTİRMEZ. Birim testli.
import { QuestionnaireV2Schema, emptyQuestionnaireV2, type PhotoConfirm, type QuestionnaireV2 } from "@/lib/questionnaireV2";

export const STEPS_V2 = ["goals", "direction", "budget", "time", "activity", "hairBeard", "skin", "jaw", "photo", "body"] as const;
export type StepV2 = (typeof STEPS_V2)[number];

export type DraftV2 = QuestionnaireV2 & { bodyDraft: { heightCm: string; weightKg: string }; bodySkipped: boolean };

export type Prefill = { glassesDetected: boolean | null; headCoveringDetected: boolean | null };

/** Tahmin her açılışta güncel analizden gelir; kullanıcı cevabı korunur. */
export function initialDraftV2(initial: QuestionnaireV2 | undefined, prefill: Prefill): DraftV2 {
  const base = initial ?? emptyQuestionnaireV2(prefill);
  const glasses: PhotoConfirm = { detected: prefill.glassesDetected, value: base.glasses.value };
  const headCovering: PhotoConfirm = { detected: prefill.headCoveringDetected, value: base.headCovering.value };
  return {
    ...base,
    glasses,
    headCovering,
    bodyDraft: { heightCm: base.body ? String(base.body.heightCm) : "", weightKg: base.body ? String(base.body.weightKg) : "" },
    bodySkipped: !base.body,
  };
}

export function canContinueV2(step: StepV2, draft: DraftV2): boolean {
  switch (step) {
    case "goals":
      return draft.goals.length > 0;
    case "photo":
      // Ç17: tahmin varsa onaylanmış sayılır (value null olabilir); tahmin yoksa seçim şart.
      return (draft.glasses.detected !== null || draft.glasses.value !== null) && (draft.headCovering.detected !== null || draft.headCovering.value !== null);
    case "body": {
      if (draft.bodySkipped) return true;
      const h = Number(draft.bodyDraft.heightCm);
      const w = Number(String(draft.bodyDraft.weightKg).replace(",", "."));
      return h >= 100 && h <= 250 && w >= 30 && w <= 300;
    }
    default:
      return true;
  }
}

/** Taslağı sunucu şemasına çevirir; geçersizse null (sunucu yine Zod ile doğrular). */
export function toPayloadV2(draft: DraftV2): QuestionnaireV2 | null {
  const { bodyDraft, bodySkipped, ...rest } = draft;
  const body = !bodySkipped && bodyDraft.heightCm && bodyDraft.weightKg ? { heightCm: Number(bodyDraft.heightCm), weightKg: Number(String(bodyDraft.weightKg).replace(",", ".")) } : undefined;
  const parsed = QuestionnaireV2Schema.safeParse({ ...rest, body });
  return parsed.success ? parsed.data : null;
}

export function progressPct(index: number): number {
  return Math.round(((index + 1) / STEPS_V2.length) * 100);
}

// Taslak yalnız bellekte (uygulama yeniden başlayınca sunucudaki kayıt esas): fotoğraf tahmini her açılışta tazelenir.
let memoryDraft: { key: string; draft: DraftV2 } | null = null;
export function loadDraftV2(key: string): DraftV2 | null {
  return memoryDraft && memoryDraft.key === key ? memoryDraft.draft : null;
}
export function saveDraftV2(key: string, draft: DraftV2 | null): void {
  memoryDraft = draft ? { key, draft } : null;
}
