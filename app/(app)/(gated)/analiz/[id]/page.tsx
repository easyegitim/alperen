import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { ProcessingCard } from "@/components/analysis/ProcessingCard";
import { ScoreView } from "@/components/analysis/ScoreView";
import { ResultV2View } from "@/components/analysis/result/ResultV2View";
import { PaywallProvider } from "@/components/paywall/PaywallSheet";
import { getPublicEngineInfo } from "@/lib/ai/disclosure.server";
import { getPremiumStatus } from "@/lib/api/premium";
import { getAccessV2 } from "@/lib/billing/purchases";
import { isFeatureEnabled } from "@/lib/config/flags";
import { getTeaserConfig } from "@/lib/config/teaser";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import type { AnalysisFailure } from "@/lib/score/contract";
import { engineOf, toClientAnalysis, toClientAnalysisV2, type AnalysisRow, type AnalysisRowV2 } from "@/lib/score/present";
import { ANALYSIS_ROW_COLUMNS_V2, isMissingColumnError, selectAnalysisRows } from "@/lib/score/rowColumns";

/** signals.failure (W3 motoru yazar); yalnız bilinen kodlar. */
function readFailure(signals: unknown): AnalysisFailure | null {
  if (typeof signals !== "object" || signals === null || !("failure" in signals)) return null;
  const f = (signals as { failure?: { code?: unknown; retryable?: unknown } }).failure;
  const code = f?.code;
  if (code !== "AI_FAILED" && code !== "AI_TIMEOUT" && code !== "AI_SAFETY_BLOCKED" && code !== "NO_FACE" && code !== "CAPTURE_QUALITY") return null;
  return { code, retryable: f?.retryable !== false };
}

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
  // 0010 sütunlarıyla okur; sütun yoksa (migration uygulanmamış) eski listeye düşer.
  const select = (cols: string) => admin.from("analyses").select(cols).eq("id", id).eq("user_id", user.id).maybeSingle();
  const full = await select(ANALYSIS_ROW_COLUMNS_V2);
  const { data } = isMissingColumnError(full.error) ? await selectAnalysisRows(select) : full;
  if (!data) notFound();

  const t = await getTranslations("analysis");
  const row = data as AnalysisRowV2;

  // hybrid.v2 satırı + hak (F14 v2: purchases/subscriptions, sunucuda): ödeme sonrası kart kart açılış.
  // Hak yokken kilitli v2 ekranı W1'in ScoreViewV2'si (bu dalda yok); o gelene kadar mevcut akış sürer.
  const v2 = engineOf(row) === "hybrid.v2" || row.status === "device_only" || row.status === "queued" || row.status === "running";
  if (v2) {
    const access = await getAccessV2(admin, user.id, row.id);
    if (access.entitled) {
      const [{ data: rep }, { data: prof }] = await Promise.all([
        admin.from("coach_reports").select("report").eq("user_id", user.id).eq("analysis_id", row.id).eq("prompt_version", "report.v3").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        admin.from("profiles").select("face_shape_override").eq("id", user.id).maybeSingle(),
      ]);
      const a = toClientAnalysisV2({ ...row, report: rep?.report ?? undefined, face_shape_override: typeof prof?.face_shape_override === "string" ? prof.face_shape_override : null, failure: readFailure(row.signals) }, access);
      return (
        <div className="mx-auto w-full max-w-lg px-4 py-6">
          <h1 className="sr-only">{t("pageTitle")}</h1>
          <ResultV2View initial={a} />
        </div>
      );
    }
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
  const teaser = getTeaserConfig();
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
