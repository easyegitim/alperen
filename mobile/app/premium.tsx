import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import type { PurchasesPackage } from "react-native-purchases";
import { track } from "@/lib/analytics";
import type { OfferResponse } from "@/lib/billing/offer";
import { PRODUCT_ORDER, type ProductId } from "@/lib/config/plans";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { OptionRow } from "@/mobile/src/components/ui/OptionRow";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { LinkAccount } from "@/mobile/src/features/auth/LinkAccount";
import { afterPurchase, defaultProduct, packagesToProducts, type ProductOption } from "@/mobile/src/features/billing/products";
import { ensurePurchases, isPurchasesConfigured, loadPackages, purchase, restore } from "@/mobile/src/features/billing/purchases";
import { pendingSetFor } from "@/mobile/src/features/capture/captureSession";
import { uploadPendingSet } from "@/mobile/src/features/capture/upload";
import { OfferCountdown } from "@/mobile/src/features/paywall/OfferCountdown";
import { isOfferActive, offerSkewMs, productViews } from "@/mobile/src/features/paywall/offer";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import type { BillingStatusDto } from "@/mobile/src/lib/api";
import { scoped } from "@/mobile/src/lib/i18n";
import { spacing } from "@/mobile/src/theme";

const t = scoped("paywall");
const tv = scoped("paywall.v2");
const ta = scoped("analysis");

/**
 * /premium v2 (KB §3.4; SPEC-MOBILE M6): ürünler tek seferlik rapor (bu analiz) + haftalık + aylık (+ yıllık bayrakla),
 * mağaza paketleri RevenueCat'ten, teklif sayacı sunucudan. Satın alma sonucu İSTEMCİDE PREMİUM AÇMAZ: POST /api/billing/sync
 * sunucuda RevenueCat'ten çeker; hak GET /api/billing/status?analysis= ile okunur. Hak gelince bellekteki set
 * POST /api/analyses/[id]/run ile gider ve sonuç ekranı (W7b) kart kart açar. Fatura formu yok (mağaza faturalar).
 */
export default function PremiumScreen() {
  const { user, aura } = useSession();
  const params = useLocalSearchParams<{ product?: string; analysis?: string; from?: string }>();
  const analysisId = typeof params.analysis === "string" && params.analysis.length > 0 ? params.analysis : null;
  const [linked, setLinked] = useState(Boolean(user && !user.is_anonymous));
  const [status, setStatus] = useState<BillingStatusDto | null>(null);
  const [offer, setOffer] = useState<{ offer: OfferResponse; skewMs: number } | null>(null);
  const [offerEnded, setOfferEnded] = useState(false);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [options, setOptions] = useState<ProductOption[] | null>(() => (isPurchasesConfigured() ? null : []));
  const [selected, setSelected] = useState<ProductId | null>(null);
  const [busy, setBusy] = useState<"buy" | "restore" | "upload" | null>(null);
  const onEnded = useCallback(() => setOfferEnded(true), []);

  useEffect(() => {
    let active = true;
    void aura.billing
      .status(analysisId ?? undefined)
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => undefined);
    void aura.billing
      .offer()
      .then((o) => {
        if (!active || !o) return;
        const now = Date.now();
        const skewMs = offerSkewMs(o, now);
        setOfferEnded(!isOfferActive(o, skewMs, now));
        setOffer({ offer: o, skewMs });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [aura, analysisId]);

  const offerActive = Boolean(offer?.offer.active) && !offerEnded;
  /** Listelenen ürünler: sunucunun fiyat listesi (yıllık yalnız bayrakla gelir); teklif yoksa bayraksız varsayılan. */
  const listed = useMemo<ProductId[]>(() => (offer ? (PRODUCT_ORDER.filter((id) => id in offer.offer.prices) as ProductId[]) : productViews(null, false).map((v) => v.id)), [offer]);
  const requested = params.product;

  useEffect(() => {
    if (!linked || !user || !isPurchasesConfigured()) return;
    let active = true;
    void (async () => {
      await ensurePurchases(user.id);
      const { packages: pk, storeV2 } = await loadPackages().catch(() => ({ packages: [], storeV2: [] }));
      if (!active) return;
      setPackages(pk);
      const opts = packagesToProducts(storeV2, listed, { promoPreferred: offerActive });
      setOptions(opts);
      setSelected((cur) => cur ?? defaultProduct(opts, analysisId, requested));
    })();
    return () => {
      active = false;
    };
  }, [linked, user, analysisId, requested, offerActive, listed]);

  /** Mağaza sonucu → sunucu eşitleme → durum okuma. Yalnız sunucu hak verir; set varsa gönderilir. */
  async function syncAndFinish(after: "purchase" | "restore", product: ProductId | null) {
    const synced = await aura.billing.sync().catch(() => null);
    const st = await aura.billing.status(analysisId ?? undefined).catch(() => null);
    setStatus(st);
    const outcome = afterPurchase("purchased", synced, st, analysisId);
    if (outcome !== "entitled") {
      Alert.alert(t("pending"));
      return;
    }
    if (after === "purchase") {
      if (product === "one_time_report") track("purchase_completed", { product });
      else if (product) track("subscription_activated", { plan: product });
    } else {
      Alert.alert(t("restored"));
    }
    if (analysisId) {
      if (pendingSetFor(analysisId)) {
        setBusy("upload");
        const up = await uploadPendingSet(aura, analysisId);
        if (!up.ok && up.reason === "api") Alert.alert(ta(`errors.${up.code ?? "GENERIC"}`) === `analysis.errors.${up.code}` ? ta("errors.GENERIC") : ta(`errors.${up.code ?? "GENERIC"}`));
      }
      router.replace(`/analiz/${analysisId}`);
      return;
    }
    router.back();
  }

  async function buy() {
    const opt = options?.find((o) => o.product === selected);
    const pkg = packages.find((p) => p.identifier === opt?.packageId);
    if (!pkg || !opt) return;
    setBusy("buy");
    try {
      track("checkout_started", { plan: opt.product });
      const outcome = await purchase(pkg);
      if (outcome === "cancelled") {
        Alert.alert(t("purchaseCancelled"));
        return;
      }
      if (outcome === "error") {
        Alert.alert(t("purchaseError"));
        return;
      }
      await syncAndFinish("purchase", opt.product);
    } finally {
      setBusy(null);
    }
  }

  async function restoreAll() {
    setBusy("restore");
    try {
      if (!(await restore())) {
        Alert.alert(t("purchaseError"));
        return;
      }
      await syncAndFinish("restore", null);
    } finally {
      setBusy(null);
    }
  }

  const entitledHere = analysisId ? status?.analysisEntitled === true : status?.premium === true;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("pageTitle"), headerBackTitle: "Geri" }} />
      <Screen>
        <Text variant="title" accessibilityRole="header">{tv("title")}</Text>
        <Text variant="muted">{tv("lead")}</Text>
        <View style={{ gap: spacing.xs }}>
          {(["b1", "b2", "b3", "b4"] as const).map((k) => (
            <Text key={k}>• {tv(`benefits.${k}`)}</Text>
          ))}
        </View>
        {offer ? <OfferCountdown offer={offer.offer} skewMs={offer.skewMs} onEnded={onEnded} /> : null}

        {entitledHere ? (
          <Card description={t("alreadyPremium")}>
            {analysisId ? <Button title={t("backToAnalysis")} onPress={() => router.replace(`/analiz/${analysisId}`)} /> : null}
          </Card>
        ) : null}

        {!linked ? (
          <Card title={t("linkFirstTitle")} description={t("linkFirstBody")}>
            <LinkAccount onLinked={() => setLinked(true)} />
          </Card>
        ) : null}

        {linked && !entitledHere ? (
          <Card title={tv("productsTitle")} description={t("pageLead")}>
            {!isPurchasesConfigured() ? <Text variant="muted">{t("noOfferings")}</Text> : null}
            {options === null && isPurchasesConfigured() ? <Text variant="muted">…</Text> : null}
            {options && options.length === 0 && isPurchasesConfigured() ? <Text variant="muted">{t("noOfferings")}</Text> : null}
            <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
              {options?.map((o) => (
                <OptionRow
                  key={o.packageId}
                  kind="radio"
                  selected={selected === o.product}
                  onPress={() => {
                    setSelected(o.product);
                    track("paywall_plan_selected", { plan: o.product });
                  }}
                  label={`${tv(`products.${o.product}.name`)} · ${o.priceString}${o.promo ? ` · ${tv("offerTitle")}` : ""}`}
                  hint={o.product === "one_time_report" && analysisId ? tv("thisAnalysisNote") : tv(`products.${o.product}.note`)}
                />
              ))}
            </View>
            <Button title={busy === "upload" ? ta("stage.queued") : t("buy")} size="lg" disabled={!selected || busy !== null || !options?.length} busy={busy !== null} onPress={() => void buy()} />
            <Button title={t("restore")} variant="ghost" disabled={busy !== null} onPress={() => void restoreAll()} />
            <Text variant="small">{selected === "one_time_report" ? tv("oneTimeNote") : tv("subscriptionNote")}</Text>
            <Text variant="small">{t("storeNote")}</Text>
            <Text variant="small">{tv("paidNote")}</Text>
          </Card>
        ) : null}
      </Screen>
    </>
  );
}
