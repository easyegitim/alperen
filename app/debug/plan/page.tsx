import { notFound } from "next/navigation";
import { QuestionnaireWizardV2 } from "@/components/onboarding/QuestionnaireWizardV2";
import { BarberCard } from "@/components/plan/BarberCard";
import { PlanView } from "@/components/plan/PlanView";
import { StepCard } from "@/components/plan/StepCard";
import { ReportV3 } from "@/components/report/ReportV3";
import { FIXTURE_REPORT } from "@/tests/fixtures/analysisV2";
import { fixturePlanView } from "@/tests/fixtures/planV2";

const VIEWS = ["plan", "anket", "rapor", "adim", "berber", "doktor"] as const;
type View = (typeof VIEWS)[number];

/**
 * Yalnız development: plan v2 ekranları sabit veriyle (fotoğraf, kullanıcı, model, ücretli çağrı yok). Production'da 404.
 * /debug/plan?view=plan|anket|rapor|adim|berber|doktor&doctor=screen_required|available|pending_review
 */
export default async function PlanDebugPage({ searchParams }: PageProps<"/debug/plan">) {
  if (process.env.NODE_ENV !== "development") notFound();
  const sp = await searchParams;
  const view: View = VIEWS.find((v) => v === sp.view) ?? "plan";
  const doctorState = sp.doctor === "screen_required" || sp.doctor === "available" || sp.doctor === "pending_review" || sp.doctor === "screen_risk" ? sp.doctor : "off";
  const fixture = fixturePlanView({ doctorState, basisStale: sp.stale === "1" });
  const id = fixture.plan.meta.analysisId;
  const hairStep = fixture.plan.steps.find((s) => s.barberSpec) ?? fixture.plan.steps[0]!;
  return (
    <div className="mx-auto w-full max-w-lg space-y-5 px-4 py-6">
      <h1 className="sr-only">/debug/plan {view}</h1>
      {view === "plan" ? (
        <PlanView analysisId={id} reportId={null} initial={{ view: fixture, hairLossSignal: sp.hairloss === "1" ? "possible" : null }} expertNetworkEnabled={sp.expert === "1"} doctorLayerEnabled={doctorState !== "off"} glowUpEnabled />
      ) : null}
      {view === "anket" ? (
        <QuestionnaireWizardV2 nextPath={`/debug/plan`} prefill={{ glassesDetected: false, headCoveringDetected: sp.hc === "null" ? null : false }} presentation="male" under18={false} />
      ) : null}
      {view === "rapor" ? <ReportV3 report={FIXTURE_REPORT} analysisId={id} viewsUsed={3} glowUpEnabled expertNetworkEnabled={false} /> : null}
      {view === "adim" ? (
        <div className="space-y-2">
          {fixture.plan.steps.slice(0, 4).map((s, i) => (
            <StepCard key={s.id} step={s} index={i} links={sp.links === "1" ? [{ id: "lnk_1", label: "Örnek ürün bağlantısı", url: "https://example.com", isAd: true, merchant: "Örnek mağaza" }] : []} />
          ))}
        </div>
      ) : null}
      {view === "berber" && hairStep.barberSpec ? (
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-2 text-sm font-semibold">{hairStep.title}</p>
          <BarberCard spec={hairStep.barberSpec} />
        </div>
      ) : null}
      {view === "doktor" ? (
        <PlanView analysisId={id} reportId={null} initial={{ view: fixturePlanView({ doctorState: "screen_required" }), hairLossSignal: "visible" }} expertNetworkEnabled doctorLayerEnabled glowUpEnabled />
      ) : null}
    </div>
  );
}
