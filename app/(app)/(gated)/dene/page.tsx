import { ScanFace, Scissors } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LockedFeature } from "@/components/app/LockedFeature";
import { TryonScreen } from "@/components/tryon/TryonScreen";
import type { PlanStepLite } from "@/components/tryon/stepTitles";
import { CoachReport } from "@/lib/ai/reportSchema";
import { getConsentState } from "@/lib/api/guard";
import { getPremiumStatus } from "@/lib/api/premium";
import { PlanV2 } from "@/lib/coach/planTypes";
import { isFeatureEnabled } from "@/lib/config/flags";
import { CONSENT_DOC } from "@/lib/consent";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { getLegalVersion } from "@/lib/legal/docs";
import { isPresentation } from "@/lib/onboarding/presentation";
import { QuestionnaireSchema } from "@/lib/questionnaire";
import { isMissingColumnError } from "@/lib/score/rowColumns";
import { tryonUsage } from "@/lib/tryon/quota";
import { TRYON_MODES, type TryonMode } from "@/lib/tryon/types";
import { loadProfile } from "@/app/api/analyses/v2";

const LOCKED_PERKS = [
  { k: "styles", icon: Scissors },
  { k: "face", icon: ScanFace },
] as const;

type Admin = ReturnType<typeof createAdminClient>;

/**
 * /dene (F11 v2): premium; ilk kullanımda tryon_generation rızası. Derin bağlantılar (Sprint 2 entegrasyonu):
 * `?preset=<id>` adım kartındaki "Dene" (tek stil), `?mode=glow_up&analysis=<id>` rapor/plan "İyileşmiş halin" kartı.
 * "Sana önerilen" plan v2 adımlarının tryonPresetId'lerinden (v1 rapor yedek); glow-up adımları o analizin planından.
 */
export default async function TryonPage({ searchParams }: PageProps<"/dene">) {
  const { preset, mode, analysis } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const [t, { premium }] = await Promise.all([getTranslations("tryon"), getPremiumStatus(supabase, user.id)]);

  if (!premium) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-6">
        <LockedFeature
          title={t("lockedTitle")}
          href="/premium?from=tryon"
          perks={LOCKED_PERKS.map(({ k, icon: Icon }) => ({ icon: <Icon className="size-4" />, label: t(`lockedPerks.${k}`) }))}
        />
      </div>
    );
  }

  const admin = createAdminClient();
  const requestedAnalysis = typeof analysis === "string" && z.uuid().safeParse(analysis).success ? analysis : null;
  const [state, consentVersion, usage, profile, analysisId] = await Promise.all([
    getConsentState(supabase),
    getLegalVersion(CONSENT_DOC.tryon_generation),
    tryonUsage(user.id),
    loadProfile(admin, user.id),
    resolveAnalysisId(admin, user.id, requestedAnalysis),
  ]);
  const report = await loadReportFor(admin, user.id, analysisId);
  const c = state.tryon_generation;
  const hasConsent = Boolean(c?.granted && c.textVersion === consentVersion);
  // Sunum: profiles.presentation (v2 tek kaynak, 0010); sütun yoksa eski anket cevabı.
  const q = QuestionnaireSchema.safeParse(profile?.questionnaire);
  const presentation = isPresentation(profile?.presentation) ? profile.presentation : q.success ? q.data.presentation : "unspecified";
  const plan = PlanV2.safeParse(report?.plan_v2);
  const planSteps: PlanStepLite[] = plan.success ? plan.data.steps.filter((s) => s.tier !== "doctor").map((s) => ({ id: s.id, title: s.title, area: s.area })) : [];
  const parsed = report?.report ? CoachReport.safeParse(report.report) : null;
  const recommendedV1 = parsed?.success ? [...parsed.data.hair, ...parsed.data.beard, ...(parsed.data.hairColor ? [parsed.data.hairColor] : [])].map((p) => p.presetId) : [];
  const recommendedV2 = plan.success ? plan.data.steps.flatMap((s) => (s.tryonPresetId && s.tier !== "doctor" ? [s.tryonPresetId] : [])) : [];
  const recommended = [...new Set([...recommendedV2, ...recommendedV1])];
  const initialMode = TRYON_MODES.find((m): m is TryonMode => m === mode);

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      <TryonScreen
        consentVersion={consentVersion}
        hasConsent={hasConsent}
        recommended={recommended}
        quota={{ used: usage.used, limit: usage.limit, nextAt: usage.nextAt }}
        initialPreset={typeof preset === "string" ? preset : undefined}
        initialMode={initialMode}
        presentation={presentation}
        analysisId={analysisId}
        planSteps={planSteps}
        flags={{ combo: isFeatureEnabled("tryonCombo"), glowUp: isFeatureEnabled("glowUp") }}
      />
    </div>
  );
}

/** Glow-up bağı: istenen analiz (kullanıcının, tamamlanmış) yoksa en son tamamlanmış analiz. Görsel/landmark okunmaz. */
async function resolveAnalysisId(admin: Admin, userId: string, requested: string | null): Promise<string | null> {
  if (requested) {
    const own = await admin.from("analyses").select("id").eq("id", requested).eq("user_id", userId).eq("status", "completed").maybeSingle();
    if (own.data?.id) return String(own.data.id);
  }
  const latest = await admin.from("analyses").select("id").eq("user_id", userId).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return latest.data?.id ? String(latest.data.id) : null;
}

/** Analizin koç raporu: rapor (v1 öneriler ya da v3 metin) + plan_v2 (0013; sütun yoksa yalnız rapor). Analize bağlı satır yoksa en son satır. */
async function loadReportFor(admin: Admin, userId: string, analysisId: string | null): Promise<{ report: unknown; plan_v2: unknown } | null> {
  for (const scope of analysisId ? [analysisId, null] : [null]) {
    let full = admin.from("coach_reports").select("report, plan_v2").eq("user_id", userId);
    if (scope) full = full.eq("analysis_id", scope);
    const r = await full.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!r.error) {
      if (r.data) return { report: r.data.report, plan_v2: r.data.plan_v2 };
      continue;
    }
    if (!isMissingColumnError(r.error)) return null;
    let legacy = admin.from("coach_reports").select("report").eq("user_id", userId);
    if (scope) legacy = legacy.eq("analysis_id", scope);
    const l = await legacy.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (l.data) return { report: l.data.report, plan_v2: null };
  }
  return null;
}
