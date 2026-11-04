import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { PaywallProvider } from "@/components/paywall/PaywallSheet";
import { PlanView, type PlanPayload } from "@/components/plan/PlanView";
import { PlanLocked } from "@/components/report/PlanLocked";
import { ReportV3 } from "@/components/report/ReportV3";
import { ReportView } from "@/components/report/ReportView";
import type { StepLink } from "@/components/plan/StepCard";
import { getPremiumStatus } from "@/lib/api/premium";
import { CoachReport } from "@/lib/ai/reportSchema";
import { getAccessV2 } from "@/lib/billing/purchases";
import { planBasis, planSkips } from "@/lib/coach/planBasis";
import { buildPlanView, loadAnalysisPlanRow, loadProfilePlanRow, loadReportRowV3 } from "@/lib/coach/planStore";
import { getLatestReport } from "@/lib/coach/reportsStore";
import { isFeatureEnabled } from "@/lib/config/flags";
import { getTeaserConfig } from "@/lib/config/teaser";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { QuestionnaireSchema } from "@/lib/questionnaire";
import { linksForSteps } from "@/lib/referral/links";
import { toClientAnalysis, type AnalysisRow } from "@/lib/score/present";
import { selectAnalysisRows } from "@/lib/score/rowColumns";
import type { ImproveItem } from "@/lib/score/contract";
import { isPresentation } from "@/lib/onboarding/presentation";
import { isV2Row, loadProfile, loadRowById } from "@/app/api/analyses/v2";

/**
 * /plan/[analysisId] (F09). hybrid.v2 satırı: rapor v3 iskeleti + plan v2 (PLAN 4a/4d); anket v2 yoksa önce /plan/[id]/anket
 * (PLAN 4c). Hak: AccessV2 (bu analize bağlı tek seferlik rapor ya da abonelik). Eski motor satırları v1 koç raporunda kalır.
 */
export default async function PlanPage({ params }: PageProps<"/plan/[analysisId]">) {
  const { analysisId } = await params;
  if (!z.uuid().safeParse(analysisId).success) notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const admin = createAdminClient();
  const row = await loadRowById(admin, user.id, analysisId);
  if (!row) notFound();
  const teaser = getTeaserConfig();

  if (isV2Row(row)) {
    const [t, access, profile] = await Promise.all([getTranslations("plan.v2"), getAccessV2(admin, user.id, row.id), loadProfile(admin, user.id)]);
    if (!access.entitled) {
      return (
        <div className="mx-auto w-full max-w-lg space-y-5 px-4 py-6">
          <PageTitle eyebrow={t("eyebrow")} title={t("title")} />
          <PaywallProvider teaserMode={teaser.mode} analysisId={analysisId} presentation={isPresentation(profile?.presentation) ? profile.presentation : null} ageBand={profile?.age_band ?? null}>
            <PlanLocked />
          </PaywallProvider>
        </div>
      );
    }
    if (row.status !== "completed") {
      return (
        <div className="mx-auto w-full max-w-lg space-y-5 px-4 py-6">
          <PageTitle eyebrow={t("eyebrow")} title={t("title")} />
          <p className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{t("empty")}</p>
        </div>
      );
    }
    const planProfile = await loadProfilePlanRow(admin, user.id);
    if (!planProfile.questionnaire) redirect(`/plan/${analysisId}/anket`);
    const [reportRow, analysis] = await Promise.all([loadReportRowV3(admin, user.id, analysisId), loadAnalysisPlanRow(admin, user.id, analysisId)]);
    const view = reportRow?.planV2 ? await buildPlanView({ admin, userId: user.id, analysisId, plan: reportRow.planV2, profile: planProfile }) : null;
    const initial: PlanPayload | null = view ? { view, hairLossSignal: analysis?.hairLossSignal ?? null } : null;
    const links = view ? await linksForSteps(admin, view.plan.steps.map((s) => s.id)) : {};
    const stepLinks: Record<string, StepLink[]> = Object.fromEntries(Object.entries(links).map(([k, v]) => [k, v.map((l) => ({ id: l.id, label: l.label, url: l.url, isAd: l.isAd, merchant: l.merchant }))]));
    const expertNetworkEnabled = isFeatureEnabled("expertNetwork");
    const glowUpEnabled = isFeatureEnabled("glowUp");
    return (
      <div className="mx-auto w-full max-w-lg space-y-5 px-4 py-6">
        <PageTitle eyebrow={t("eyebrow")} title={t("title")} />
        <ReportV3 report={reportRow?.report ?? null} analysisId={analysisId} viewsUsed={analysis?.viewsUsed ?? 0} planHref="#section-plan" glowUpEnabled={glowUpEnabled} expertNetworkEnabled={expertNetworkEnabled} />
        <div id="section-plan" className="scroll-mt-32">
          <PlanView analysisId={analysisId} reportId={reportRow?.id ?? null} initial={initial} expertNetworkEnabled={expertNetworkEnabled} doctorLayerEnabled={isFeatureEnabled("doctorLayer")} glowUpEnabled={glowUpEnabled} links={stepLinks} />
        </div>
      </div>
    );
  }

  // ── Eski motor (legacy / hybrid.v1): v1 koç raporu aynen ───────────────────────────────────────────────────────────
  const [t, { premium }, profile] = await Promise.all([getTranslations("report"), getPremiumStatus(supabase, user.id), supabase.from("profiles").select("questionnaire, updated_at").eq("id", user.id).maybeSingle()]);
  const paywallProfile = premium ? null : await loadProfile(admin, user.id);
  const q = QuestionnaireSchema.safeParse(profile.data?.questionnaire);
  const skipped = q.success ? planSkips(q.data) : {};

  if (!premium) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-5 px-4 py-6">
        <PageTitle eyebrow={t("eyebrow")} title={t("title")} />
        <PaywallProvider teaserMode={teaser.mode} analysisId={analysisId} presentation={isPresentation(paywallProfile?.presentation) ? paywallProfile.presentation : null} ageBand={paywallProfile?.age_band ?? null}>
          <PlanLocked skipped={skipped} />
        </PaywallProvider>
      </div>
    );
  }

  const stored = await getLatestReport(user.id, analysisId);
  const parsed = stored ? CoachReport.safeParse(stored.report) : null;
  const initial = stored && parsed?.success ? { reportId: stored.id, report: parsed.data, isFallback: stored.isFallback } : null;
  const improveFirst = await loadImproveFirst(admin, analysisId, user.id, teaser);
  const updatedAt = typeof profile.data?.updated_at === "string" ? Date.parse(profile.data.updated_at) : NaN;
  const basisStale = Boolean(stored) && !Number.isNaN(updatedAt) && updatedAt > Date.parse(stored?.createdAt ?? "");

  return (
    <div className="mx-auto w-full max-w-lg space-y-5 px-4 py-6">
      <PageTitle eyebrow={t("eyebrow")} title={t("title")} />
      <ReportView analysisId={analysisId} initial={initial} expertNetworkEnabled={isFeatureEnabled("expertNetwork")} basis={q.success ? planBasis(q.data) : undefined} improveFirst={improveFirst} skipped={skipped} basisStale={basisStale} />
    </div>
  );
}

async function loadImproveFirst(admin: ReturnType<typeof createAdminClient>, analysisId: string, userId: string, teaser: ReturnType<typeof getTeaserConfig>): Promise<ImproveItem[] | null> {
  const { data, error } = await selectAnalysisRows((cols) => admin.from("analyses").select(cols).eq("id", analysisId).eq("user_id", userId).maybeSingle());
  if (error || !data) return null;
  const row = data as AnalysisRow;
  if (row.status !== "completed") return null;
  const v = toClientAnalysis(row, true, teaser.mode, teaser.subscore).improveFirst;
  return v.locked ? null : v.value;
}

function PageTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="space-y-1">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
    </header>
  );
}
