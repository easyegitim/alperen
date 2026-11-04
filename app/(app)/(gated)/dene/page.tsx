import { ScanFace, Scissors } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
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
import { QuestionnaireSchema } from "@/lib/questionnaire";
import { isMissingColumnError } from "@/lib/score/rowColumns";
import { tryonUsage } from "@/lib/tryon/quota";

const LOCKED_PERKS = [
  { k: "styles", icon: Scissors },
  { k: "face", icon: ScanFace },
] as const;

/** /dene (F11 v2): premium; ilk kullanımda tryon_generation rızası; "Sana önerilen" rapordan; glow-up için son analiz + plan adımları. */
export default async function TryonPage({ searchParams }: PageProps<"/dene">) {
  const { preset } = await searchParams;
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
  const [state, consentVersion, usage, profile, report, analysis] = await Promise.all([
    getConsentState(supabase),
    getLegalVersion(CONSENT_DOC.tryon_generation),
    tryonUsage(user.id),
    admin.from("profiles").select("questionnaire").eq("id", user.id).maybeSingle(),
    loadLatestReport(admin, user.id),
    admin.from("analyses").select("id").eq("user_id", user.id).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const c = state.tryon_generation;
  const hasConsent = Boolean(c?.granted && c.textVersion === consentVersion);
  const q = QuestionnaireSchema.safeParse(profile.data?.questionnaire);
  const parsed = report?.report ? CoachReport.safeParse(report.report) : null;
  const recommended = parsed?.success ? [...parsed.data.hair, ...parsed.data.beard, ...(parsed.data.hairColor ? [parsed.data.hairColor] : [])].map((p) => p.presetId) : [];
  const plan = PlanV2.safeParse(report?.plan_v2);
  const planSteps: PlanStepLite[] = plan.success ? plan.data.steps.filter((s) => s.tier !== "doctor").map((s) => ({ id: s.id, title: s.title, area: s.area })) : [];

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      <TryonScreen
        consentVersion={consentVersion}
        hasConsent={hasConsent}
        recommended={recommended}
        quota={{ used: usage.used, limit: usage.limit, nextAt: usage.nextAt }}
        initialPreset={typeof preset === "string" ? preset : undefined}
        presentation={q.success ? q.data.presentation : "unspecified"}
        analysisId={analysis.data?.id ? String(analysis.data.id) : null}
        planSteps={planSteps}
        flags={{ combo: isFeatureEnabled("tryonCombo"), glowUp: isFeatureEnabled("glowUp") }}
      />
    </div>
  );
}

/** En son koç raporu: rapor (v1 öneriler) + plan_v2 (0013; sütun yoksa yalnız rapor). Görsel yok. */
async function loadLatestReport(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<{ report: unknown; plan_v2: unknown } | null> {
  const q = () => admin.from("coach_reports").select("report, plan_v2").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const full = await q();
  if (!full.error) return full.data ? { report: full.data.report, plan_v2: full.data.plan_v2 } : null;
  if (!isMissingColumnError(full.error)) return null;
  const legacy = await admin.from("coach_reports").select("report").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return legacy.data ? { report: legacy.data.report, plan_v2: null } : null;
}
