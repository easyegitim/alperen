"use client";

import { BadgeCheck, Check, CreditCard, Lock, ReceiptText, RefreshCw, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { LinkAccount } from "@/components/auth/LinkAccount";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { track } from "@/lib/analytics";
import { ApiClientError, postJson } from "@/lib/api/client";
import type { OfferResponse } from "@/lib/billing/offer";
import { PLANS, formatTry, type ProductId } from "@/lib/config/plans";
import { cn } from "@/lib/utils";
import { OfferCountdown } from "@/components/paywall/OfferCountdown";
import { productViews, type ProductView } from "@/components/paywall/PaywallSheet";
import { PlanBody, PlanCheck, PlanRibbon, planCardClass } from "@/components/billing/PlanOption";

type PlanChoice = ProductId | "week_pass";
type Props = {
  isAnonymous: boolean;
  /** Sunucunun hesapladığı ürün görünümleri (fiyat, tanıtım); yer tutucu fiyatla (null) satış yapılmaz. */
  products: ProductView[];
  initialProduct: PlanChoice;
  weekPassEnabled: boolean;
  alreadyPremium: boolean;
  analysisId?: string;
  /** Sunucu süreli teklif (KB P#18); null = teklif yok. */
  offer: OfferResponse | null;
};

/** SPEC 15.2 / KB §3.4: ürün → hesap bağlama (anonimse) → fatura formu + 2 onay → iyzico formu. Kart bilgisi iyzico formunda girilir. */
export function CheckoutFlow({ isAnonymous, products: initialProducts, initialProduct, weekPassEnabled, alreadyPremium, analysisId, offer }: Props) {
  const t = useTranslations("checkout");
  const tv = useTranslations("paywall.v2");
  const [plan, setPlan] = useState<PlanChoice>(initialProduct);
  const [skewMs] = useState(() => (offer ? new Date(offer.serverNow).getTime() - Date.now() : 0));
  // Sayaç 0'a inince tanıtım fiyatı ekrandan düşer: kartlar ve "Devam · ₺" düğmesi sunucunun o an tahsil edeceği normal
  // fiyatı gösterir (KB P#18: gösterilen fiyat gerçek fiyattır; checkout fiyatı gönderim anında yeniden hesaplar).
  const [offerEnded, setOfferEnded] = useState(false);
  const onOfferEnded = useCallback(() => setOfferEnded(true), []);
  const products = offerEnded && offer ? productViews(offer, false) : initialProducts;
  const selected = products.find((p) => p.id === plan);
  const amount: number | null = plan === "week_pass" ? PLANS.week_pass.priceTry : (selected?.priceTry ?? null);
  const [linked, setLinked] = useState(!isAnonymous);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", surname: "", gsmNumber: "", identityNumber: "", city: "", address: "" });
  const [terms, setTerms] = useState(false);
  const [waiver, setWaiver] = useState(false);
  const [formHtml, setFormHtml] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // iyzico checkoutFormContent: <script> + <div id="iyzipay-checkout-form">; innerHTML ile gelen script çalışmaz, elle eklenir.
  useEffect(() => {
    const host = formRef.current;
    if (!formHtml || !host) return;
    host.innerHTML = "";
    const tpl = document.createElement("template");
    tpl.innerHTML = formHtml;
    const scripts: HTMLScriptElement[] = [];
    tpl.content.querySelectorAll("script").forEach((s) => {
      scripts.push(s);
      s.remove();
    });
    host.appendChild(tpl.content);
    for (const s of scripts) {
      const el = document.createElement("script");
      if (s.src) el.src = s.src;
      el.textContent = s.textContent;
      host.appendChild(el);
    }
  }, [formHtml]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!terms || !waiver || amount == null) return;
    setBusy(true);
    try {
      track("checkout_started", { plan });
      const res = await postJson<{ checkoutFormContent: string; token: string }>("/api/billing/checkout", {
        plan,
        buyer: { ...form, identityNumber: form.identityNumber || undefined },
        accepted: { terms: true, waiver: true },
        ...(analysisId ? { analysisId } : {}),
      });
      if (res?.checkoutFormContent) setFormHtml(res.checkoutFormContent);
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : "NETWORK";
      toast.error(t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.GENERIC"));
    } finally {
      setBusy(false);
    }
  }

  const current: Step = formHtml ? "pay" : !linked ? "account" : "billing";

  if (alreadyPremium) {
    return (
      <Card className="bg-hero-glow">
        <CardContent className="flex flex-col items-center gap-3 text-center">
          <span aria-hidden="true" className="grid size-14 place-items-center rounded-full bg-brand-soft text-brand">
            <BadgeCheck className="size-7" />
          </span>
          <h1 className="text-xl font-bold tracking-tight">{t("alreadyTitle")}</h1>
          <p className="text-[13px] text-muted-foreground">{t("alreadyBody")}</p>
          <Button asChild size="lg" className="mt-1 w-full"><Link href="/analiz">{t("goAnalyses")}</Link></Button>
        </CardContent>
      </Card>
    );
  }

  if (formHtml) {
    return (
      <div className="space-y-4">
        <Stepper current={current} />
        <Card>
          <CardHeader>
            <CardTitle>{t("payTitle")}</CardTitle>
            <CardDescription>{t("payBody")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div ref={formRef} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Stepper current={current} />
      <section aria-labelledby="plan-h" className="space-y-2.5">
        <h2 id="plan-h" className="eyebrow">{t("chooseProduct")}</h2>
        {offer ? <OfferCountdown offer={offer} skewMs={skewMs} onEnded={onOfferEnded} /> : null}
        <div className="grid gap-2.5">
          {products.map((p) => (
            <PlanButton
              key={p.id}
              selected={plan === p.id}
              onSelect={() => setPlan(p.id)}
              featuredLabel={null}
              name={tv(`products.${p.id}.name`)}
              price={p.priceTry == null ? "–" : formatTry(p.priceTry)}
              per={p.id === "one_time_report" || p.priceTry == null ? undefined : tv(`perPeriod.${p.id}`)}
              detail={p.id === "one_time_report" && analysisId ? tv("thisAnalysisNote") : tv(`products.${p.id}.note`)}
              badge={p.priceTry == null ? tv("pricePending") : p.struckTry != null ? tv("regularStruck", { price: formatTry(p.struckTry), promo: formatTry(p.priceTry) }) : null}
            />
          ))}
          {weekPassEnabled ? (
            <PlanButton
              selected={plan === "week_pass"}
              onSelect={() => setPlan("week_pass")}
              featuredLabel={null}
              name={t("weekPass")}
              price={formatTry(PLANS.week_pass.priceTry)}
              detail={t("weekPassHint")}
              badge={null}
            />
          ) : null}
        </div>
        <p className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
          <CreditCard aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>{t("bankCardNote")}</span>
        </p>
      </section>

      {!linked ? (
        <LinkAccount returnPath={`/premium?plan=${plan}${analysisId ? `&analysis=${analysisId}` : ""}`} onLinked={() => setLinked(true)} />
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <span aria-hidden="true" className="grid size-8 place-items-center rounded-xl bg-brand-soft text-brand">
                  <ReceiptText className="size-4" />
                </span>
                {t("billingTitle")}
              </CardTitle>
              <CardDescription>{t("billingBody")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("fields.name")}><Input className={INPUT} required autoComplete="given-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <Field label={t("fields.surname")}><Input className={INPUT} required autoComplete="family-name" value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} /></Field>
              </div>
              <Field label={t("fields.phone")}><Input className={INPUT} required type="tel" inputMode="tel" autoComplete="tel" placeholder="+905xxxxxxxxx" value={form.gsmNumber} onChange={(e) => setForm({ ...form, gsmNumber: e.target.value })} /></Field>
              <Field label={t("fields.identity")} hint={t("fields.identityHint")}><Input className={INPUT} inputMode="numeric" maxLength={11} value={form.identityNumber} onChange={(e) => setForm({ ...form, identityNumber: e.target.value })} /></Field>
              <Field label={t("fields.city")}><Input className={INPUT} required autoComplete="address-level2" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
              <Field label={t("fields.address")}><Input className={INPUT} required autoComplete="street-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <span aria-hidden="true" className="grid size-8 place-items-center rounded-xl bg-brand-soft text-brand">
                  <ShieldCheck className="size-4" />
                </span>
                {t("consentTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border bg-muted/40 p-3 text-[13px] leading-relaxed">
                <Checkbox checked={terms} onCheckedChange={(v) => setTerms(v === true)} className="mt-0.5 size-5" />
                <span>
                  {t.rich("terms", {
                    sale: (c) => <Link href="/yasal/mesafeli-satis" target="_blank" className="font-medium text-brand underline underline-offset-2">{c}</Link>,
                    info: (c) => <Link href="/yasal/on-bilgilendirme" target="_blank" className="font-medium text-brand underline underline-offset-2">{c}</Link>,
                  })}
                </span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border bg-muted/40 p-3 text-[13px] leading-relaxed">
                <Checkbox checked={waiver} onCheckedChange={(v) => setWaiver(v === true)} className="mt-0.5 size-5" />
                <span>{t("waiver")}</span>
              </label>
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <RefreshCw aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>{plan === "one_time_report" || plan === "week_pass" ? tv("oneTimeNote") : t("renewalNote")}</span>
              </p>
              <Button type="submit" size="lg" className="w-full" disabled={!terms || !waiver || busy || amount == null}>
                <Lock aria-hidden="true" />
                {amount == null ? t("pricePendingCta") : t("continue", { amount: formatTry(amount) })}
              </Button>
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck aria-hidden="true" className="size-3.5" />
                {t("secure")}
              </p>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  );
}

const INPUT = "h-11 rounded-xl bg-background/60 text-[15px]";
const STEPS = ["plan", "account", "billing", "pay"] as const;
type Step = (typeof STEPS)[number];

/** Ödeme adımları göstergesi (SPEC 15.2 sırası): yalnız görsel yönlendirme; hiçbir kontrolü değiştirmez. */
function Stepper({ current }: { current: Step }) {
  const t = useTranslations("checkout");
  const at = STEPS.indexOf(current);
  return (
    <ol aria-label={t("stepsAria")} className="flex items-start">
      {STEPS.map((s, i) => {
        const done = i < at;
        const active = i === at;
        return (
          <li key={s} aria-current={active ? "step" : undefined} className="relative flex flex-1 flex-col items-center gap-1.5">
            {i > 0 ? (
              <span aria-hidden="true" className={cn("absolute top-3.5 right-[calc(50%+20px)] left-[calc(-50%+20px)] h-0.5 rounded-full", i <= at ? "bg-brand-gradient" : "bg-track")} />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "relative grid size-7 place-items-center rounded-full text-xs font-bold",
                done && "bg-cta-gradient text-primary-foreground",
                active && "bg-card text-brand ring-2 ring-brand shadow-glow",
                !done && !active && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={cn("text-[11px] font-medium", active ? "text-foreground" : "text-muted-foreground")}>
              {t(`steps.${s}`)}
              {done ? <span className="sr-only"> {t("stepDone")}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function PlanButton({
  selected,
  onSelect,
  featuredLabel,
  name,
  price,
  per,
  detail,
  badge,
}: {
  selected: boolean;
  onSelect: () => void;
  featuredLabel: string | null;
  name: string;
  price: string;
  per?: string;
  detail: string | null;
  badge: string | null;
}) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={planCardClass(selected, Boolean(featuredLabel))}>
      {featuredLabel ? <PlanRibbon>{featuredLabel}</PlanRibbon> : null}
      <PlanCheck selected={selected} />
      <PlanBody name={name} price={price} per={per} detail={detail} badge={badge} />
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="text-[13px] font-medium">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] leading-relaxed text-muted-foreground">{hint}</span> : null}
    </label>
  );
}
