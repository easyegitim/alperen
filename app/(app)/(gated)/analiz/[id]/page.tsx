import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { ProcessingCard } from "@/components/analysis/ProcessingCard";
import { ScoreView } from "@/components/analysis/ScoreView";
import { PaywallProvider } from "@/components/paywall/PaywallSheet";
import { getPublicEngineInfo } from "@/lib/ai/disclosure.server";
import { getPremiumStatus } from "@/lib/api/premium";
import { isFeatureEnabled } from "@/lib/config/flags";
import { getTeaserConfig } from "@/lib/config/teaser";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { toClientAnalysis, type AnalysisRow } from "@/lib/score/present";
import { selectAnalysisRows } from "@/lib/score/rowColumns";

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
  const { data } = await selectAnalysisRows((cols) => admin.from("analyses").select(cols).eq("id", id).eq("user_id", user.id).maybeSingle());
  if (!data) notFound();

  const t = await getTranslations("analysis");
  const row = data as AnalysisRow;
  if (row.status !== "completed") {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-6">
        <h1 className="sr-only">{t("pageTitle")}</h1>
        <ProcessingCard status={row.status === "failed" ? "failed" : "processing"} />
      </div>
    );
  }
  const { premium } = await getPremiumStatus(supabase, user.id);
  const teaser = getTeaserConfig();
  const a = toClientAnalysis(row, premium, teaser.mode, teaser.subscore);
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <h1 className="sr-only">{t("pageTitle")}</h1>
      <PaywallProvider teaserMode={teaser.mode} analysisId={a.id} weekPassEnabled={isFeatureEnabled("weekPass")}>
        <ScoreView a={a} premium={premium} currentEngine={getPublicEngineInfo().engine} />
      </PaywallProvider>
    </div>
  );
}
