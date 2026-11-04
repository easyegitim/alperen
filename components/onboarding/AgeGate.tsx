"use client";

import { CalendarDays, Check, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { ApiClientError, postJson } from "@/lib/api/client";
import { AGE_BANDS, type AgeBand } from "@/lib/onboarding/age";
import { writeDraft } from "@/lib/onboarding/draft";
import { cn } from "@/lib/utils";

type Props = {
  /** Umax tarzı serbest liste (KB P#1). under_18 bayrak kapalıyken seçilince "yakında" ekranı (PLAN Ç-G). */
  under18Enabled: boolean;
  /** Oturum varsa seçim hemen sunucuya yazılır; yoksa sessionStorage taslağına girer ve girişten sonra yazılır. */
  signedIn: boolean;
  initial?: AgeBand | null;
  nextPath: string;
};

/** KB §3.1 adım 1: yaş bandı. Yaş sınırı yok; 18 altı bandı bayrakla açılır. Doğum yılı artık sorulmaz. */
export function AgeGate({ under18Enabled, signedIn, initial, nextPath }: Props) {
  const t = useTranslations("onboarding.age");
  const router = useRouter();
  const [band, setBand] = useState<AgeBand | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [soon, setSoon] = useState(false);

  async function submit() {
    if (!band) return;
    if (band === "under_18" && !under18Enabled) {
      track("onboarding_step_completed", { step: "age_under18_soon" });
      setSoon(true);
      return;
    }
    setBusy(true);
    try {
      writeDraft({ ageBand: band });
      if (signedIn) await postJson("/api/onboarding/age", { ageBand: band });
      track("onboarding_step_completed", { step: "age" });
      router.push(nextPath);
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "FEATURE_DISABLED") setSoon(true);
      else toast.error(t("error"));
    } finally {
      setBusy(false);
    }
  }

  if (soon) {
    return (
      <div className="space-y-6 rounded-2xl border bg-card bg-hero-glow p-6 text-center shadow-card">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand" aria-hidden="true">
          <Clock className="size-6" />
        </span>
        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight">{t("under18SoonTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("under18SoonBody")}</p>
        </div>
        <div className="grid gap-2">
          <Button variant="outline" className="w-full" onClick={() => setSoon(false)}>
            {t("changeBand")}
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/">{t("backHome")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-6"
    >
      <div className="space-y-4">
        <span className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand" aria-hidden="true">
          <CalendarDays className="size-6" />
        </span>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{t("bandTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("bandDescription")}</p>
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="sr-only">{t("bandTitle")}</legend>
        {AGE_BANDS.map((b) => {
          const selected = band === b;
          const soonBand = b === "under_18" && !under18Enabled;
          return (
            <label
              key={b}
              className={cn(
                "flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 shadow-card transition-colors",
                selected ? "border-brand/60 bg-brand-soft/40" : "hover:bg-accent",
              )}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="ageBand"
                  value={b}
                  checked={selected}
                  onChange={() => setBand(b)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-5 place-items-center rounded-full border-2 transition-colors",
                    selected ? "border-brand bg-brand text-primary-foreground" : "border-muted-foreground/50",
                  )}
                >
                  {selected ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
                <span className="num text-[15px] font-semibold">{t(`bands.${b}`)}</span>
              </span>
              {soonBand ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{t("soonTag")}</span> : null}
            </label>
          );
        })}
      </fieldset>
      <Button type="submit" className="w-full" size="lg" disabled={!band || busy}>
        {t("continue")}
      </Button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{t("bandNote")}</p>
    </form>
  );
}
