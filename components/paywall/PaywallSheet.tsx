"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight, Check, ChartLine, FileText, Lock, ScanFace, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { track } from "@/lib/analytics";
import type { OfferResponse } from "@/lib/billing/offer";
import { TEASER_ANALYTICS_CODE, type PaywallTrigger } from "@/lib/config/paywall";
import { PRODUCTS, PRODUCT_ORDER, PRODUCT_PRICE_PLACEHOLDERS, formatTry, type ProductId, type ProductPrice } from "@/lib/config/plans";
import { SUB_KEYS_V2, type SubKey, type TeaserMode } from "@/lib/config/teaser";
import { cn } from "@/lib/utils";
import { PlanCheck, planCardClass } from "@/components/billing/PlanOption";
import { IllustrativeBeforeAfter, type Presentation } from "./IllustrativeBeforeAfter";
import { OfferCountdown } from "./OfferCountdown";
import { ReferralBlock } from "./ReferralBlock";
import { useOffer } from "./useOffer";

type Step = "benefits" | "products";
type Ctx = { open: (trigger: PaywallTrigger) => void };
const PaywallContext = createContext<Ctx | null>(null);

type ContextKey = "score" | "potential" | "sub" | "improve" | "measurements" | "plan";

/** Tetikleyiciye göre sayfa 1'deki bağlam satırı (UI spec §4.1). sub_<k> yalnız kilitli bir alt skor için vardır. */
export function paywallContext(trigger: PaywallTrigger): { key: ContextKey; sub?: SubKey } {
  switch (trigger) {
    case "score_main":
      return { key: "score" };
    case "score_potential":
      return { key: "potential" };
    case "improve_first":
      return { key: "improve" };
    case "measurements":
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

/** "Eline geçecekler" (KB P#16): dört madde, sosyal kanıt yok, garanti yok, "ücretsiz" yok. */
const BENEFITS = [
  { k: "b1", icon: ChartLine },
  { k: "b2", icon: Sparkles },
  { k: "b3", icon: FileText },
  { k: "b4", icon: ScanFace },
] as const;

/** Bayraksız varsayılan liste (yıllık yalnız sunucunun gönderdiği fiyat listesinde varsa görünür). */
const DEFAULT_PRODUCTS: ProductId[] = PRODUCT_ORDER.filter((id) => !PRODUCTS[id].featureFlag);

export type ProductView = {
  id: ProductId;
  /** Gösterilecek fiyat (tanıtım aktifse tanıtım, değilse normal); null = fiyat belirlenecek, satış yok. */
  priceTry: number | null;
  /** Tanıtım uygulanıyorsa üstü çizili normal fiyat. */
  struckTry: number | null;
  promo: boolean;
};

/** Saf: ürün listesi + fiyat görünümü (teklif yoksa yer tutucu fiyatlar). Testlenebilir. */
export function productViews(offer: OfferResponse | null, offerActive: boolean, fallback: ProductId[] = DEFAULT_PRODUCTS): ProductView[] {
  const ids = offer ? (PRODUCT_ORDER.filter((id) => id in offer.prices) as ProductId[]) : fallback;
  return ids.map((id) => {
    const price: ProductPrice = offer?.prices[id] ?? PRODUCT_PRICE_PLACEHOLDERS[id];
    // lib/billing/offer.ts effectivePriceTry ile aynı kural; istemcide env yok, fiyat nesnesi sunucudan gelir.
    const promoApplies = Boolean(offer && offerActive && offer.promoProduct === id && price.promoTry != null);
    return { id, priceTry: promoApplies ? price.promoTry : price.regularTry, struckTry: promoApplies ? price.regularTry : null, promo: promoApplies };
  });
}

/**
 * Kısa paywall (KB §3.4, F14 v2). Sayfa 1: fayda listesi, illüstratif önce/sonra, sunucu süreli teklif sayacı, tek
 * ₺ satırı. Sayfa 2: tek seferlik rapor (bu analiz) + haftalık + aylık (+ yıllık bayrakla). İstemci kilit açmaz;
 * ödeme /premium'da, hak yalnız sunucu doğrulamasıyla (purchases/subscriptions).
 */
export function PaywallProvider({
  teaserMode,
  analysisId,
  presentation,
  ageBand,
  children,
}: {
  teaserMode: TeaserMode;
  analysisId?: string;
  /** Eski prop (week_pass); v2 paywall'da kullanılmaz, çağıranlar için geriye uyumlu. */
  weekPassEnabled?: boolean;
  presentation?: Presentation | null;
  ageBand?: string | null;
  children: ReactNode;
}) {
  const t = useTranslations("paywall");
  const tv = useTranslations("paywall.v2");
  const ta = useTranslations("analysis");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<PaywallTrigger>("score_main");
  const [step, setStep] = useState<Step>("benefits");
  const defaultProduct: ProductId = analysisId ? "one_time_report" : "weekly";
  const [product, setProduct] = useState<ProductId>(defaultProduct);
  const [offerEnded, setOfferEnded] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const seeRef = useRef<HTMLButtonElement>(null);
  const movedRef = useRef(false);
  const headingId = useId();
  const { status: offerStatus, offer, skewMs } = useOffer(open);
  const offerActive = Boolean(offer?.active) && !offerEnded;
  const onEnded = useCallback(() => setOfferEnded(true), []);

  const show = useCallback(
    (tr: PaywallTrigger) => {
      setTrigger(tr);
      setStep("benefits");
      setProduct(defaultProduct);
      movedRef.current = false;
      setOpen(true);
      track("paywall_viewed", { trigger: tr, teaserMode: TEASER_ANALYTICS_CODE[teaserMode] });
    },
    [defaultProduct, teaserMode],
  );
  const ctxValue = useMemo(() => ({ open: show }), [show]);

  function onOpenChange(next: boolean) {
    if (!next && open) track("paywall_dismissed", { step: step === "products" ? "plans" : "benefits" });
    setOpen(next);
  }

  function goProducts() {
    movedRef.current = true;
    setStep("products");
    track("paywall_step_viewed", { step: "plans", trigger });
  }

  function goBenefits() {
    movedRef.current = true;
    setStep("benefits");
  }

  useEffect(() => {
    if (!movedRef.current) return;
    if (step === "products") headingRef.current?.focus();
    else seeRef.current?.focus();
  }, [step]);

  const views = useMemo(() => productViews(offer, offerActive), [offer, offerActive]);
  const selected = views.find((v) => v.id === product) ?? views[0];
  const oneTime = views.find((v) => v.id === "one_time_report");
  const weekly = views.find((v) => v.id === "weekly");

  function choose(value: string) {
    const next = views.find((v) => v.id === value);
    if (!next) return;
    setProduct(next.id);
    track("paywall_plan_selected", { plan: next.id });
  }

  const ctx = paywallContext(trigger);
  const contextLine = ctx.key === "sub" && ctx.sub ? t("context.sub", { name: ta(`sub.${ctx.sub}`) }) : t(`context.${ctx.key}`);
  const href = `/premium?product=${product}&from=${encodeURIComponent(trigger)}${analysisId ? `&analysis=${encodeURIComponent(analysisId)}` : ""}`;
  const priceText = (v: ProductView | undefined) => (v && v.priceTry != null ? formatTry(v.priceTry) : tv("pricePending").toLocaleLowerCase("tr-TR"));

  return (
    <PaywallContext.Provider value={ctxValue}>
      {children}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" showCloseButton={false} className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-3xl border-t bg-background p-0">
          <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
          <SheetClose asChild>
            <Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2 rounded-full text-muted-foreground" aria-label={tCommon("close")}>
              <X aria-hidden="true" className="size-5" />
            </Button>
          </SheetClose>
          {step === "benefits" ? (
            <>
              <SheetHeader className="items-center bg-hero-glow px-5 pt-5 pb-4 text-center">
                <span aria-hidden="true" className="mb-1 grid size-14 place-items-center rounded-2xl bg-cta-gradient text-primary-foreground shadow-glow">
                  <Lock className="size-7" />
                </span>
                <p className="eyebrow">{tv("eyebrow")}</p>
                <SheetTitle className="text-2xl font-bold tracking-tight">{tv("title")}</SheetTitle>
                <SheetDescription className="text-[13px]">{tv("lead")}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-5 pb-5">
                <p className="flex items-start gap-2.5 rounded-xl bg-brand-soft px-3.5 py-3 text-[13px] font-medium">
                  <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
                  <span>{contextLine}</span>
                </p>
                <section aria-labelledby={`${headingId}-benefits`} className="space-y-2">
                  <h3 id={`${headingId}-benefits`} className="eyebrow">
                    {tv("benefitsTitle")}
                  </h3>
                  <ul aria-label={tv("benefitsAria")} className="space-y-1.5">
                    {BENEFITS.map(({ k, icon: Icon }, i) => (
                      <li key={k} className="flex min-h-11 items-center gap-3 rounded-xl border bg-card px-3 py-2 motion-safe:animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
                        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                          <Icon className="size-4" />
                        </span>
                        <span className="text-[13px] leading-snug font-semibold">{tv(`benefits.${k}`)}</span>
                        <Check aria-hidden="true" className="ml-auto size-4 shrink-0 text-success" />
                      </li>
                    ))}
                  </ul>
                </section>
                <IllustrativeBeforeAfter presentation={presentation} ageBand={ageBand} />
                {offerStatus === "ready" && offer ? <OfferCountdown offer={offer} skewMs={skewMs} onEnded={onEnded} /> : null}
                {offerStatus === "error" ? <p className="text-[11px] text-muted-foreground">{tv("offerUnavailable")}</p> : null}
                {analysisId ? <ReferralBlock /> : null}
                <Link href="/yontem?from=paywall" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-brand underline-offset-4 hover:underline">
                  {t("methodLink")}
                  <ArrowUpRight aria-hidden="true" className="size-4" />
                </Link>
              </div>
              <div className="sticky bottom-0 space-y-2.5 border-t bg-background/90 px-5 pt-3.5 pb-[max(1.25rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
                {/* Sayfa 1'de tek fiyat satırı (e2e: dialog içinde bir ₺ öğesi). */}
                <p className="num text-center text-sm font-semibold">{tv("anchor", { oneTime: priceText(oneTime), weekly: priceText(weekly) })}</p>
                <Button ref={seeRef} type="button" size="lg" className="w-full" onClick={goProducts} data-paywall-see-products="">
                  {tv("seeProducts")}
                  <ArrowRight aria-hidden="true" />
                </Button>
                <p className="text-center text-[11px] leading-relaxed text-muted-foreground">{tv("paidNote")}</p>
              </div>
            </>
          ) : (
            <>
              <SheetHeader className="px-3 pt-1 pb-3">
                <SheetTitle className="sr-only">{tv("title")}</SheetTitle>
                <SheetDescription className="sr-only">{tv("lead")}</SheetDescription>
                <div className="flex items-center gap-1 pr-12">
                  <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label={t("backAria")} onClick={goBenefits}>
                    <ArrowLeft aria-hidden="true" className="size-5" />
                  </Button>
                  <h3 id={headingId} ref={headingRef} tabIndex={-1} className="text-xl font-bold tracking-tight outline-none">
                    {tv("productsTitle")}
                  </h3>
                </div>
              </SheetHeader>
              <div className="space-y-3 px-5 pb-5">
                {offerStatus === "ready" && offer ? <OfferCountdown offer={offer} skewMs={skewMs} onEnded={onEnded} /> : null}
                <RadioGroup aria-labelledby={headingId} value={product} onValueChange={choose} className="gap-2.5">
                  {views.map((v) => (
                    <ProductOption key={v.id} view={v} selected={product === v.id} name={tv(`products.${v.id}.name`)} note={v.id === "one_time_report" && analysisId ? tv("thisAnalysisNote") : tv(`products.${v.id}.note`)} />
                  ))}
                </RadioGroup>
              </div>
              <div className="sticky bottom-0 space-y-2.5 border-t bg-background/90 px-5 pt-3.5 pb-[max(1.25rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
                {selected && selected.priceTry != null ? (
                  <Button asChild size="lg" className="w-full">
                    <Link href={href}>{tv("unlockWith", { price: formatTry(selected.priceTry) })}</Link>
                  </Button>
                ) : (
                  <Button type="button" size="lg" className="w-full" disabled>
                    {tv("unlockPending")}
                  </Button>
                )}
                <p className="text-center text-[11px] leading-relaxed text-muted-foreground">{selected?.id === "one_time_report" ? tv("oneTimeNote") : tv("subscriptionNote")}</p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PaywallContext.Provider>
  );
}

function ProductOption({ view, selected, name, note }: { view: ProductView; selected: boolean; name: string; note: string }) {
  const tv = useTranslations("paywall.v2");
  const base = useId();
  const nameId = `${base}-name`;
  const descId = `${base}-desc`;
  const per = view.id === "one_time_report" ? null : tv(`perPeriod.${view.id}`);
  return (
    <label className={cn(planCardClass(selected, false), "cursor-pointer has-[[role=radio]:focus-visible]:ring-[3px] has-[[role=radio]:focus-visible]:ring-ring/50")}>
      <RadioGroupItem value={view.id} aria-labelledby={nameId} aria-describedby={descId} className="absolute inset-0 size-full rounded-2xl border-0 opacity-0 shadow-none" />
      <PlanCheck selected={selected} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span id={nameId} className="text-[15px] font-semibold">
            {name}
          </span>
          <span className="num text-right whitespace-nowrap">
            {view.priceTry == null ? (
              <span className="text-sm font-semibold text-muted-foreground">{tv("pricePending")}</span>
            ) : (
              <>
                {view.struckTry != null ? (
                  <span className="mr-1.5 text-xs text-muted-foreground line-through" aria-hidden="true">
                    {formatTry(view.struckTry)}
                  </span>
                ) : null}
                <span className="text-lg font-bold">{formatTry(view.priceTry)}</span>
                {per ? <span className="ml-1 text-xs text-muted-foreground">{per}</span> : null}
              </>
            )}
          </span>
        </span>
        <span id={descId} className="mt-1 block text-xs text-muted-foreground">
          {note}
          {view.struckTry != null && view.priceTry != null ? <span className="sr-only"> {tv("regularStruck", { price: formatTry(view.struckTry), promo: formatTry(view.priceTry) })}</span> : null}
        </span>
      </span>
    </label>
  );
}

export function usePaywall(): Ctx {
  const ctx = useContext(PaywallContext);
  if (!ctx) throw new Error("usePaywall PaywallProvider içinde kullanılmalı");
  return ctx;
}
