import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { ProcessingCard } from "@/components/analysis/ProcessingCard";
import { ScoreView, ScoreViewV2 } from "@/components/analysis/ScoreView";
import { ResultV2View } from "@/components/analysis/result/ResultV2View";
import { PaywallProvider } from "@/components/paywall/PaywallSheet";
import { getPublicEngineInfo } from "@/lib/ai/disclosure.server";
import { getPremiumStatus } from "@/lib/api/premium";
import { getAccessV2 } from "@/lib/billing/purchases";
import { isFeatureEnabled } from "@/lib/config/flags";
import { getTeaserConfig } from "@/lib/config/teaser";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { toClientAnalysis, type AnalysisRow } from "@/lib/score/present";
import { canConsumePurchaseFor } from "@/lib/billing/entitlement";
import { isPresentation } from "@/lib/onboarding/presentation";
import { isV2Row, loadProfile, loadRowById, presentV2 } from "@/app/api/analyses/v2";

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
  // 0010 sütunlarıyla okur; sütun yoksa (migration uygulanmamış) eski listeye düşer (app/api/analyses/v2.ts).
  const row = await loadRowById(admin, user.id, id);
  if (!row) notFound();

  const t = await getTranslations("analysis");
  const teaser = getTeaserConfig();

  // hybrid.v2 satırı (device_only/queued/running/completed/failed): hak (AccessV2, sunucuda purchases/subscriptions/referrals)
  // varsa kart kart açılan sonuç (W2 ResultV2View); yoksa kilitli ekran (W1 ScoreViewV2, KB §3.3). Rapor yalnız hak varken okunur.
  if (isV2Row(row)) {
    const [access, profile] = await Promise.all([getAccessV2(admin, user.id, row.id), loadProfile(admin, user.id)]);
    const a = await presentV2(admin, user.id, row, access, profile);
    // Hak yoksa ama henüz başlamamış satıra bağlanacak ödenmiş rapor varsa: paywall değil, "fotoğraf setini gönder" kartı.
    const proceed = canConsumePurchaseFor(access, row.status);
    // Paywall illüstrasyonu kullanıcının beyan ettiği cinsiyet ve yaş bandını izler (KB P#17); skor girdisi değildir.
    const presentation = isPresentation(profile?.presentation) ? profile.presentation : null;
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-6">
        <h1 className="sr-only">{t("pageTitle")}</h1>
        {proceed ? (
          <ResultV2View initial={a} />
        ) : (
          <PaywallProvider teaserMode={teaser.mode} analysisId={a.id} presentation={presentation} ageBand={profile?.age_band ?? null}>
            <ScoreViewV2 a={a} />
          </PaywallProvider>
        )}
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
