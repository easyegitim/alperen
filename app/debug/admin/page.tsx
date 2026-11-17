import { notFound } from "next/navigation";
import { MetricsPanel, type Metrics } from "@/components/admin/MetricsPanel";
import { istanbulDate } from "@/lib/routine/streak";
import { addDays } from "@/lib/routine/streak";

/** Yalnız development: /admin metrik paneli sabit veriyle (kullanıcı, Supabase yok). Production'da 404. /debug/admin?alert=1 */
export default async function AdminDebugPage({ searchParams }: PageProps<"/debug/admin">) {
  if (process.env.NODE_ENV !== "development") notFound();
  const sp = await searchParams;
  const today = istanbulDate();
  const alert = sp.alert === "1";
  const fixture: Metrics = {
    days: 30,
    dailyActivity: [0, 1, 2].map((i) => ({ day: addDays(today, -i), analyses_completed: 12 - i, analyses_failed: i, reports: 10 - i, fallback_reports: 1, tryons_success: 30 - i * 3, tryons_identity_drift: 1, tryons_failed: 2 })),
    dailyAiCost: [0, 1, 2].map((i) => ({ day: addDays(today, -i), analysis_calls: 36, reports: 10, tryon_generations: 30, est_cost_usd: 6.4 - i })),
    activeSubscriptions: [{ plan: "monthly", active_count: 41, canceling_count: 3 }, { plan: "weekly", active_count: 17, canceling_count: 2 }],
    funnel: { profiles: 900, adults: 870, questionnaire_completed: 400, analyzed_users: 350, ever_checked_out: 120, premium_now: 58 },
    reportedContent: [],
    tryonQuality: [
      { day: today, mode: "style", success: 40, qc_failed: 3, identity_drift: 1, flagged_broken: alert ? 4 : 1, broken_rate: alert ? 0.1 : 0.025 },
      { day: today, mode: "combo", success: 12, qc_failed: 2, identity_drift: 0, flagged_broken: 0, broken_rate: 0 },
      { day: addDays(today, -1), mode: "style", success: 35, qc_failed: 1, identity_drift: 2, flagged_broken: alert ? 3 : 1, broken_rate: alert ? 0.0857 : 0.0286 },
      { day: addDays(today, -1), mode: "glow_up", success: 8, qc_failed: 1, identity_drift: 0, flagged_broken: alert ? 1 : 0, broken_rate: alert ? 0.125 : 0 },
    ],
    tryonQualityAvailable: sp.rpc !== "0",
    tryonBrokenRateAlert: 0.05,
  };
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
      <h1 className="sr-only">/debug/admin</h1>
      <MetricsPanel initial={fixture} />
    </div>
  );
}
