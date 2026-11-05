"use client";

import { ArrowRight, BadgeCheck, CircleAlert, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

type Props = {
  status: "ok" | "failed" | "pending";
  analysisId?: string;
  /** Tek seferlik rapor (F14 v2): hak analize bağlı, abonelik yok. */
  product?: "one_time_report";
  /** Satır henüz tam analiz görmedi (device_only/failed): fotoğraf seti çekim ekranından yeniden gönderilir. */
  needsCapture?: boolean;
};

/**
 * /premium/sonuc: başarılı/başarısız; callback gecikmesinde durum birkaç kez sorgulanır (SPEC 4.2). Tek seferlik raporda
 * hak analiz bazında sorgulanır. needsCapture: CTA doğrudan /tara?analysis=… ve metin "set yeniden gönderilir".
 */
export function PaymentResult({ status: initial, analysisId, product, needsCapture = false }: Props) {
  const t = useTranslations("checkout.result");
  const tc = useTranslations("checkout");
  const tp = useTranslations("pricing");
  const [status, setStatus] = useState(initial);
  const [plan, setPlan] = useState<string | null>(null);
  const oneTime = product === "one_time_report";
  const statusUrl = oneTime && analysisId ? `/api/billing/status?analysis=${encodeURIComponent(analysisId)}` : "/api/billing/status";

  useEffect(() => {
    if (status !== "pending") {
      if (status === "ok" && oneTime) track("purchase_completed", { product: "one_time_report" });
      else if (status === "ok") fetch(statusUrl).then((r) => r.json()).then((s: { plan?: string | null }) => {
        setPlan(s.plan ?? null);
        if (s.plan) track("subscription_activated", { plan: s.plan });
      }).catch(() => undefined);
      return;
    }
    let tries = 0;
    const id = setInterval(async () => {
      tries++;
      try {
        const s = (await (await fetch(statusUrl)).json()) as { premium: boolean; plan: string | null; analysisEntitled: boolean | null };
        if (oneTime ? s.analysisEntitled === true : s.premium) {
          setPlan(oneTime ? null : s.plan);
          setStatus("ok");
          if (oneTime) track("purchase_completed", { product: "one_time_report" });
          else if (s.plan) track("subscription_activated", { plan: s.plan });
          clearInterval(id);
        }
      } catch {
        // tekrar dene
      }
      if (tries >= 10) {
        clearInterval(id);
        setStatus("failed");
      }
    }, 3000);
    return () => clearInterval(id);
  }, [status, statusUrl, oneTime]);

  const planName = plan === "weekly" || plan === "monthly" || plan === "yearly" ? tp(`plans.${plan}.name`) : plan === "week_pass" ? tc("weekPass") : null;
  const Icon = status === "ok" ? BadgeCheck : status === "failed" ? CircleAlert : Loader2;
  return (
    <Card className="bg-hero-glow">
      <CardContent className="flex flex-col items-center gap-3 pt-4 text-center">
        <span
          aria-hidden="true"
          className={cn(
            "grid size-16 place-items-center rounded-full",
            status === "ok" && "bg-cta-gradient text-primary-foreground shadow-glow",
            status === "failed" && "bg-destructive/12 text-destructive",
            status === "pending" && "bg-brand-soft text-brand",
          )}
        >
          <Icon className={cn("size-8", status === "pending" && "motion-safe:animate-spin")} />
        </span>
        <div role="status" aria-live="polite" className="space-y-1.5">
          <h1 className="text-xl font-bold tracking-tight">{status === "ok" && oneTime ? t("okOneTime.title") : t(`${status}.title`)}</h1>
          <p className="text-[13px] text-muted-foreground">
            {status === "ok" ? t(oneTime ? (needsCapture ? "okOneTime.bodyCapture" : "okOneTime.body") : needsCapture ? "ok.bodyCapture" : "ok.body") : t(`${status}.body`)}
            {planName ? ` (${planName})` : ""}
          </p>
        </div>
        <div className="mt-2 grid w-full gap-2">
          {status === "ok" ? (
            <Button asChild size="lg">
              <Link href={analysisId ? (needsCapture ? `/tara?analysis=${encodeURIComponent(analysisId)}` : `/analiz/${analysisId}`) : "/analiz"}>
                {analysisId ? (needsCapture ? t("ok.ctaCapture") : t("ok.cta")) : t("ok.ctaList")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          ) : status === "failed" ? (
            <Button asChild size="lg"><Link href={analysisId ? `/premium?analysis=${analysisId}${oneTime ? "&product=one_time_report" : ""}` : "/premium"}>{t("failed.cta")}</Link></Button>
          ) : null}
          <Button asChild variant="outline"><Link href="/hesap">{t("account")}</Link></Button>
        </div>
      </CardContent>
    </Card>
  );
}
