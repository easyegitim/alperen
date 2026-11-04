import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { ProcessingCard } from "@/components/analysis/ProcessingCard";
import { ScoreView, ScoreViewV2 } from "@/components/analysis/ScoreView";
import { PaywallProvider } from "@/components/paywall/PaywallSheet";
import { getPublicEngineInfo } from "@/lib/ai/disclosure.server";
import { getPremiumStatus } from "@/lib/api/premium";
import { isFeatureEnabled } from "@/lib/config/flags";
import { getTeaserConfig } from "@/lib/config/teaser";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { engineOf, toClientAnalysis, toClientAnalysisV2, type AnalysisRow, type AnalysisRowV2 } from "@/lib/score/present";
import { selectAnalysisRowsV2 } from "@/lib/score/rowColumns";

/** /analiz/[id]: sunucu kırpılmış görünümü üretir; kilitli değerler HTML'e ve istemciye girmez. */
export default async function AnalysisPage({ params }: PageProps<"/analiz/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const admin = createAdminClient();
  const { data } = await selectAnalysisRowsV2((cols) => admin.from("analyses").select(cols).eq("id", id).eq("user_id", user.id).maybeSingle());
  if (!data) notFound();

  const t = await getTranslations("analysis");
  const row = data as AnalysisRowV2;
  const teaser = getTeaserConfig();

  // v2 (KB §3.3): ödeme öncesi cihaz sonucu ve hak yokken tamamlanmış hybrid.v2 satırı kilitli ekranda. Hak (AccessV2)
  // hesabı W2'nin lib/billing/entitlement.ts genişletmesini bekler; o gelene kadar hak yok (hiçbir skor açılmaz).
  if (row.status === "device_only" || (engineOf(row) === "hybrid.v2" && row.status === "completed")) {
    const a = toClientAnalysisV2(row, { entitled: false, referralUnlock: false, percentile: false });
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-6">
        <h1 className="sr-only">{t("pageTitle")}</h1>
        <PaywallProvider teaserMode={teaser.mode} analysisId={a.id} weekPassEnabled={isFeatureEnabled("weekPass")}>
          <ScoreViewV2 a={a} />
        </PaywallProvider>
      </div>
    );
  }

  if (row.status !== "completed") {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-6">
        <h1 className="sr-only">{t("pageTitle")}</h1>
        <ProcessingCard status={row.status === "failed" ? "failed" : "processing"} />
      </div>
    );
  }
  const { premium } = await getPremiumStatus(supabase, user.id);
  const a = toClientAnalysis(row as AnalysisRow, premium, teaser.mode, teaser.subscore);
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <h1 className="sr-only">{t("pageTitle")}</h1>
      <PaywallProvider teaserMode={teaser.mode} analysisId={a.id} weekPassEnabled={isFeatureEnabled("weekPass")}>
        <ScoreView a={a} premium={premium} currentEngine={getPublicEngineInfo().engine} />
      </PaywallProvider>
    </div>
  );
}
