"use client";

import { Crown, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { postJson } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type Props = { premium: boolean; plan: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean };

/** /hesap: plan ve tek tık iptal (SPEC 15.2 adım 9). */
export function SubscriptionCard(props: Props) {
  const t = useTranslations("account.subscription");
  const tp = useTranslations("pricing");
  const [cancelAtPeriodEnd, setCancel] = useState(props.cancelAtPeriodEnd);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const end = props.periodEnd ? new Date(props.periodEnd).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }) : null;

  async function cancel() {
    setBusy(true);
    try {
      await postJson("/api/billing/cancel", {});
      setCancel(true);
      setOpen(false);
      toast.success(t("canceled"));
    } catch {
      toast.error(t("cancelError"));
    } finally {
      setBusy(false);
    }
  }

  const planName = props.premium && props.plan ? (props.plan === "week_pass" ? t("weekPass") : tp(`plans.${props.plan}.name`)) : t("free");
  const statusKey = !props.premium ? "statusFree" : cancelAtPeriodEnd ? "statusCanceling" : "statusActive";
  return (
    <Card className={cn(props.premium && "bg-hero-glow")}>
      <CardHeader>
        <p className="eyebrow">{t("title")}</p>
        <CardTitle className="flex flex-wrap items-center gap-2.5">
          <span className="flex items-center gap-2.5">
            <span aria-hidden="true" className={cn("grid size-8 place-items-center rounded-xl", props.premium ? "bg-cta-gradient text-primary-foreground" : "bg-brand-soft text-brand")}>
              <Crown className="size-4" />
            </span>
            {planName}
          </span>
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[11px] font-medium">
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", !props.premium ? "bg-muted-foreground" : cancelAtPeriodEnd ? "bg-warn" : "bg-success")} />
            {t(statusKey)}
          </span>
        </CardTitle>
        {end ? <CardDescription className="num text-[13px]">{cancelAtPeriodEnd ? t("endsOn", { date: end }) : t("renewsOn", { date: end })}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-2">
        {props.premium ? (
          cancelAtPeriodEnd ? (
            <p className="text-[13px] text-muted-foreground">{t("cancelScheduled")}</p>
          ) : (
            <Button variant="outline" onClick={() => setOpen(true)}>{t("cancel")}</Button>
          )
        ) : (
          <Button asChild><Link href="/premium"><Sparkles aria-hidden="true" />{t("upgrade")}</Link></Button>
        )}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmTitle")}</DialogTitle>
            <DialogDescription>{t("confirmBody", { date: end ?? "—" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t("keep")}</Button>
            <Button variant="destructive" onClick={cancel} disabled={busy}>{t("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
