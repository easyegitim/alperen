"use client";

import { Check, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { postJson } from "@/lib/api/client";
import { writeDraft, type Presentation } from "@/lib/onboarding/draft";
import { PRESENTATIONS } from "@/lib/questionnaire";
import { cn } from "@/lib/utils";

type Props = { signedIn: boolean; initial?: Presentation | null; nextPath: string };

/** KB §3.1 adım 2: erkek / kadın / belirtmek istemiyorum. Yalnız öneri ve örnekler için; skor ölçeği herkese aynı (K1). */
export function GenderPicker({ signedIn, initial, nextPath }: Props) {
  const t = useTranslations("onboarding.gender");
  const router = useRouter();
  const [value, setValue] = useState<Presentation | null>(initial ?? null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!value) return;
    setBusy(true);
    try {
      writeDraft({ presentation: value });
      if (signedIn) await postJson("/api/onboarding/profile", { presentation: value });
      track("onboarding_step_completed", { step: "gender" });
      router.push(nextPath);
    } catch {
      toast.error(t("error"));
    } finally {
      setBusy(false);
    }
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
          <UserRound className="size-6" />
        </span>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="sr-only">{t("title")}</legend>
        {PRESENTATIONS.map((p) => {
          const selected = value === p;
          return (
            <label
              key={p}
              className={cn(
                "flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border bg-card px-4 py-3 shadow-card transition-colors",
                selected ? "border-brand/60 bg-brand-soft/40" : "hover:bg-accent",
              )}
            >
              <input type="radio" name="presentation" value={p} checked={selected} onChange={() => setValue(p)} className="sr-only" />
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-5 place-items-center rounded-full border-2 transition-colors",
                  selected ? "border-brand bg-brand text-primary-foreground" : "border-muted-foreground/50",
                )}
              >
                {selected ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
              <span className="text-[15px] font-semibold">{t(`options.${p}`)}</span>
            </label>
          );
        })}
      </fieldset>
      <Button type="submit" className="w-full" size="lg" disabled={!value || busy}>
        {t("continue")}
      </Button>
    </form>
  );
}
