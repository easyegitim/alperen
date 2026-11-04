import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { track } from "@/lib/analytics";
import type { OfferResponse } from "@/lib/billing/offer";
import { TEASER_ANALYTICS_CODE, type PaywallTrigger } from "@/lib/config/paywall";
import { formatTry, type ProductId } from "@/lib/config/plans";
import { SUB_KEYS_V2, type SubKey, type TeaserMode } from "@/lib/config/teaser";
import { Button } from "@/mobile/src/components/ui/Button";
import { OptionRow } from "@/mobile/src/components/ui/OptionRow";
import { Text } from "@/mobile/src/components/ui/Text";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import type { Presentation } from "@/mobile/src/lib/api";
import { scoped, t as tt } from "@/mobile/src/lib/i18n";
import { radius, spacing, touchTarget, useTheme } from "@/mobile/src/theme";
import { IllustrativeBeforeAfter } from "./IllustrativeBeforeAfter";
import { OfferCountdown } from "./OfferCountdown";
import { ReferralBlock } from "./ReferralBlock";
import { isOfferActive, offerSkewMs, productViews, type ProductView } from "./offer";

const t = scoped("paywall");
const tv = scoped("paywall.v2");
const ta = scoped("analysis");

type Step = "benefits" | "products";
type Ctx = { open: (trigger: PaywallTrigger | string) => void };
const PaywallCtx = createContext<Ctx>({ open: () => undefined });
type ContextKey = "score" | "potential" | "sub" | "improve" | "measurements" | "plan";

/** Tetikleyiciye göre sayfa 1'deki bağlam satırı (web paywallContext ile aynı). */
export function paywallContext(trigger: string): { key: ContextKey; sub?: SubKey } {
  switch (trigger) {
    case "score_main":
    case "overall":
      return { key: "score" };
    case "score_potential":
    case "potential":
      return { key: "potential" };
    case "improve_first":
      return { key: "improve" };
    case "measurements":
    case "ratios":
      return { key: "measurements" };
    case "plan":
    case "plan_page":
      return { key: "plan" };
    default: {
      const sub = SUB_KEYS_V2.find((k) => trigger === `sub_${k}`);
      return sub ? { key: "sub", sub } : { key: "score" };
    }
  }
}

const BENEFITS = [
  { k: "b1", icon: "stats-chart-outline" },
  { k: "b2", icon: "sparkles-outline" },
  { k: "b3", icon: "document-text-outline" },
  { k: "b4", icon: "scan-outline" },
] as const;

type OfferFetch = { status: "idle" | "loading" | "ready" | "error"; offer: OfferResponse | null; skewMs: number };

/**
 * Kısa paywall v2 (KB §3.4; web components/paywall/PaywallSheet.tsx): sayfa 1 fayda listesi, illüstratif önce/sonra,
 * sunucu süreli teklif sayacı, davet bloğu; sayfa 2 tek seferlik rapor (bu analiz) + haftalık + aylık (+ yıllık bayrakla).
 * İstemci kilit açmaz; satın alma /premium'da (RevenueCat), hak yalnız sunucu doğrulamasıyla. "Ücretsiz" sözü yok.
 */
export function PaywallProvider({ children, teaserMode, analysisId, presentation, ageBand }: PropsWithChildren<{ teaserMode: TeaserMode | string; analysisId?: string; presentation?: Presentation | null; ageBand?: string | null }>) {
  const { colors } = useTheme();
  const { aura } = useSession();
  const [visible, setVisible] = useState(false);
  const [trigger, setTrigger] = useState<string>("score_main");
  const [step, setStep] = useState<Step>("benefits");
  const defaultProduct: ProductId = analysisId ? "one_time_report" : "weekly";
  const [product, setProduct] = useState<ProductId>(defaultProduct);
  const [offerFetch, setOfferFetch] = useState<OfferFetch>({ status: "idle", offer: null, skewMs: 0 });
  const [offerEnded, setOfferEnded] = useState(false);
  const onEnded = useCallback(() => setOfferEnded(true), []);

  /** Teklif sheet ilk açılınca bir kez okunur (olay işleyicisinden; sunucuda tutulur, burada yalnız okunur). */
  const fetchOffer = useCallback(() => {
    setOfferFetch((cur) => (cur.status === "idle" ? { status: "loading", offer: null, skewMs: 0 } : cur));
    void aura.billing
      .offer()
      .then((offer) => {
        if (!offer) setOfferFetch({ status: "error", offer: null, skewMs: 0 });
        else {
          const now = Date.now();
          const skewMs = offerSkewMs(offer, now);
          setOfferEnded(!isOfferActive(offer, skewMs, now));
          setOfferFetch({ status: "ready", offer, skewMs });
        }
      })
      .catch(() => setOfferFetch({ status: "error", offer: null, skewMs: 0 }));
  }, [aura]);
  const offerStatus = offerFetch.status;

  const value = useMemo<Ctx>(
    () => ({
      open: (tr) => {
        setTrigger(tr);
        setStep("benefits");
        setProduct(defaultProduct);
        setVisible(true);
        if (offerStatus === "idle") fetchOffer();
        const code = (TEASER_ANALYTICS_CODE as Record<string, string>)[teaserMode] ?? teaserMode;
        track("paywall_viewed", { trigger: tr, teaserMode: code });
      },
    }),
    [defaultProduct, teaserMode, offerStatus, fetchOffer],
  );

  const offer = offerFetch.offer;
  const offerActive = Boolean(offer?.active) && !offerEnded;
  const views = useMemo(() => productViews(offer, offerActive), [offer, offerActive]);
  const selected = views.find((v) => v.id === product) ?? views[0];
  const oneTime = views.find((v) => v.id === "one_time_report");
  const weekly = views.find((v) => v.id === "weekly");
  const ctx = paywallContext(trigger);
  const contextLine = ctx.key === "sub" && ctx.sub ? t("context.sub", { name: ta(`sub.${ctx.sub}`) }) : t(`context.${ctx.key}`);
  const priceText = (v: ProductView | undefined) => (v && v.priceTry != null ? formatTry(v.priceTry) : tv("pricePending").toLocaleLowerCase("tr-TR"));

  function close() {
    track("paywall_dismissed", { step: step === "products" ? "plans" : "benefits" });
    setVisible(false);
  }
  function goProducts() {
    setStep("products");
    track("paywall_step_viewed", { step: "plans", trigger });
  }
  function choose(id: ProductId) {
    setProduct(id);
    track("paywall_plan_selected", { plan: id });
  }
  function goPremium() {
    setVisible(false);
    router.push({ pathname: "/premium", params: { product, from: trigger, ...(analysisId ? { analysis: analysisId } : {}) } });
  }

  return (
    <PaywallCtx.Provider value={value}>
      {children}
      <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }} onPress={close} accessibilityLabel={tt("common.close")} accessibilityRole="button" />
        <View style={{ maxHeight: "92%", backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl }} accessibilityViewIsModal>
          <View style={{ alignItems: "center", paddingTop: 10 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={tt("common.close")} onPress={close} hitSlop={8} style={{ position: "absolute", right: 8, top: 8, width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center", zIndex: 1 }}>
            <Ionicons name="close" size={22} color={colors.mutedForeground} />
          </Pressable>
          {step === "benefits" ? (
            <>
              <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
                <View style={{ alignItems: "center", gap: spacing.xs }}>
                  <View style={{ width: 56, height: 56, borderRadius: radius.lg, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="lock-closed" size={28} color={colors.primaryForeground} />
                  </View>
                  <Text variant="small" style={{ textTransform: "uppercase", letterSpacing: 1 }}>{tv("eyebrow")}</Text>
                  <Text variant="title" accessibilityRole="header" style={{ textAlign: "center" }}>{tv("title")}</Text>
                  <Text variant="muted" style={{ textAlign: "center" }}>{tv("lead")}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brandSoft }}>
                  <Ionicons name="lock-closed" size={16} color={colors.brand} />
                  <Text variant="small" style={{ flex: 1, color: colors.foreground, fontWeight: "500" }}>{contextLine}</Text>
                </View>
                <View style={{ gap: spacing.xs }} accessibilityLabel={tv("benefitsAria")}>
                  <Text variant="small" style={{ textTransform: "uppercase", letterSpacing: 1 }}>{tv("benefitsTitle")}</Text>
                  {BENEFITS.map(({ k, icon }) => (
                    <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: touchTarget, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card }}>
                      <View style={{ width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name={icon} size={16} color={colors.brand} />
                      </View>
                      <Text variant="small" style={{ flex: 1, color: colors.foreground, fontWeight: "600" }}>{tv(`benefits.${k}`)}</Text>
                      <Ionicons name="checkmark" size={16} color={colors.success} />
                    </View>
                  ))}
                </View>
                <IllustrativeBeforeAfter presentation={presentation} ageBand={ageBand} />
                {offerFetch.status === "ready" && offer ? <OfferCountdown offer={offer} skewMs={offerFetch.skewMs} onEnded={onEnded} /> : null}
                {offerFetch.status === "error" ? <Text variant="small">{tv("offerUnavailable")}</Text> : null}
                {analysisId ? <ReferralBlock /> : null}
              </ScrollView>
              <View style={{ padding: spacing.lg, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text variant="small" style={{ textAlign: "center", fontWeight: "600", color: colors.foreground }}>{tv("anchor", { oneTime: priceText(oneTime), weekly: priceText(weekly) })}</Text>
                <Button title={tv("seeProducts")} size="lg" onPress={goProducts} />
                <Text variant="small" style={{ textAlign: "center" }}>{tv("paidNote")}</Text>
              </View>
            </>
          ) : (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingRight: touchTarget + 8 }}>
                <Pressable accessibilityRole="button" accessibilityLabel={t("backAria")} onPress={() => setStep("benefits")} style={{ width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="arrow-back" size={22} color={colors.foreground} />
                </Pressable>
                <Text variant="heading" accessibilityRole="header">{tv("productsTitle")}</Text>
              </View>
              <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
                {offerFetch.status === "ready" && offer ? <OfferCountdown offer={offer} skewMs={offerFetch.skewMs} onEnded={onEnded} /> : null}
                {views.map((v) => (
                  <OptionRow
                    key={v.id}
                    kind="radio"
                    selected={product === v.id}
                    onPress={() => choose(v.id)}
                    label={`${tv(`products.${v.id}.name`)} · ${v.priceTry == null ? tv("pricePending") : `${v.struckTry != null ? `${formatTry(v.struckTry)} → ` : ""}${formatTry(v.priceTry)}${v.id === "one_time_report" ? "" : ` ${tv(`perPeriod.${v.id}`)}`}`}`}
                    hint={v.id === "one_time_report" && analysisId ? tv("thisAnalysisNote") : tv(`products.${v.id}.note`)}
                  />
                ))}
                <Text variant="small">{t("storeNote")}</Text>
              </ScrollView>
              <View style={{ padding: spacing.lg, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Button title={selected && selected.priceTry != null ? tv("unlockWith", { price: formatTry(selected.priceTry) }) : tv("cta")} size="lg" onPress={goPremium} />
                <Text variant="small" style={{ textAlign: "center" }}>{selected?.id === "one_time_report" ? tv("oneTimeNote") : tv("subscriptionNote")}</Text>
              </View>
            </>
          )}
        </View>
      </Modal>
    </PaywallCtx.Provider>
  );
}

export function usePaywall(): Ctx {
  return useContext(PaywallCtx);
}
