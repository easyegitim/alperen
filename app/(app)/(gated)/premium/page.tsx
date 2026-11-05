import { ArrowLeft, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckoutFlow } from "@/components/billing/CheckoutFlow";
import type { ProductView } from "@/components/paywall/PaywallSheet";
import { getPremiumStatus } from "@/lib/api/premium";
import { effectivePriceTry, offerPrices, type OfferResponse } from "@/lib/billing/offer";
import { loadOrStartOffer } from "@/lib/billing/offerStore";
import { getAccessV2 } from "@/lib/billing/purchases";
import { isUuid } from "@/lib/billing/returnAnalysis";
import { isFeatureEnabled } from "@/lib/config/flags";
import { PRODUCT_IDS, listedProducts, type ProductId } from "@/lib/config/plans";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";

const LEGACY_PLAN_TO_PRODUCT: Record<string, ProductId> = { weekly: "weekly", monthly: "monthly", yearly: "yearly" };

/**
 * /premium (F14 v2): ürünler (tek seferlik rapor / haftalık / aylık / yıllık bayrakla), fatura formu, iki onay, iyzico
 * formu. `analysis` ile aynı analize dönülür; tek seferlik rapor o analize bağlanır. Fiyatlar sunucudaki teklif
 * durumuna göre (KB P#18); yer tutucu fiyatla satış yapılmaz.
 */
export default async function PremiumPage({ searchParams }: PageProps<"/premium">) {
  const { plan, product, analysis } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const admin = createAdminClient();
  const [t, tc, { premium }] = await Promise.all([getTranslations("paywall"), getTranslations("checkout"), getPremiumStatus(supabase, user.id)]);
  const weekPass = isFeatureEnabled("weekPass");

  // analyses tarayıcıya kapalı (RLS okuma politikası yok): sahiplik admin istemcisi + user_id ile doğrulanır; değilse yok sayılır.
  let analysisId: string | undefined;
  if (isUuid(analysis)) {
    const { data } = await admin.from("analyses").select("id").eq("id", analysis).eq("user_id", user.id).maybeSingle();
    if (data) analysisId = analysis;
  }
  const access = await getAccessV2(admin, user.id, analysisId ?? null);
  if (access.entitled && analysisId) redirect(`/analiz/${analysisId}`);

  const offer = await loadOrStartOffer(admin, user.id);
  const listed = listedProducts();
  const products: ProductView[] = listed.map((id) => {
    const { priceTry, promo } = effectivePriceTry(id, offer);
    const regular = effectivePriceTry(id, null).priceTry;
    return { id, priceTry, struckTry: promo && regular != null && regular !== priceTry ? regular : null, promo };
  });
  const requested = typeof product === "string" && (PRODUCT_IDS as readonly string[]).includes(product) ? (product as ProductId) : typeof plan === "string" ? LEGACY_PLAN_TO_PRODUCT[plan] : undefined;
  const initial: ProductId | "week_pass" =
    plan === "week_pass" && weekPass ? "week_pass" : requested && listed.includes(requested) ? requested : analysisId ? "one_time_report" : "weekly";
  const offerForClient: OfferResponse | null = offer ? { ...offer, prices: offerPrices() } : null;

  return (
    <div className="mx-auto w-full max-w-lg space-y-5 px-4 py-6">
      {analysisId ? (
        <Link href={`/analiz/${analysisId}`} className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-1 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("backToAnalysis")}
        </Link>
      ) : null}
      {/* Premium kullanıcıya satın alma başlığı ve ödeme rozeti gösterilmez; CheckoutFlow "Zaten premiumsun" kartını (h1) çizer. */}
      {premium ? null : (
        <header className="space-y-2">
          <p className="eyebrow text-brand">{t("v2.eyebrow")}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t("v2.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("v2.lead")}</p>
          <p className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[11px] font-medium">
            <ShieldCheck aria-hidden="true" className="size-3.5 text-success" />
            {tc("secure")}
          </p>
        </header>
      )}
      <CheckoutFlow isAnonymous={user.is_anonymous ?? false} products={products} initialProduct={initial} weekPassEnabled={weekPass} alreadyPremium={premium} analysisId={analysisId} offer={offerForClient} />
    </div>
  );
}
