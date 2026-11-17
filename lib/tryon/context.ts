// /dene bağlamı (saf): "Sana önerilen" stiller ve sunum. Web /dene sayfası ve GET /api/tryon/status (mobil) aynı kuralı
// kullanır; ikisi ayrışınca mobil v2 kullanıcısı önerisiz ve cinsiyet süzgeçsiz katalog görüyordu (canlı duman testi).
import { CoachReport } from "@/lib/ai/reportSchema";
import { PlanV2 } from "@/lib/coach/planTypes";
import { PRESENTATIONS, QuestionnaireSchema } from "@/lib/questionnaire";

export type TryonPresentation = (typeof PRESENTATIONS)[number];

/** Önerilenler: plan v2 adımlarının tryonPresetId'leri (doktor katmanı hariç), sonra v1 rapor seçimleri; tekrarsız. */
export function tryonRecommended(planV2: unknown, reportV1: unknown): string[] {
  const plan = PlanV2.safeParse(planV2);
  const v2 = plan.success ? plan.data.steps.flatMap((s) => (s.tryonPresetId && s.tier !== "doctor" ? [s.tryonPresetId] : [])) : [];
  const parsed = reportV1 ? CoachReport.safeParse(reportV1) : null;
  const v1 = parsed?.success ? [...parsed.data.hair, ...parsed.data.beard, ...(parsed.data.hairColor ? [parsed.data.hairColor] : [])].map((p) => p.presetId) : [];
  return [...new Set([...v2, ...v1])];
}

/** Sunum: profiles.presentation (v2 tek kaynak, 0010); yoksa eski anket cevabı; o da yoksa "unspecified". */
export function tryonPresentation(profile: { presentation?: unknown; questionnaire?: unknown } | null | undefined): TryonPresentation {
  const p = profile?.presentation;
  if (typeof p === "string" && (PRESENTATIONS as readonly string[]).includes(p)) return p as TryonPresentation;
  const q = QuestionnaireSchema.safeParse(profile?.questionnaire);
  return q.success ? q.data.presentation : "unspecified";
}
