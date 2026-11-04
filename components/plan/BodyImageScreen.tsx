"use client";

import { HeartHandshake } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { postJson } from "@/lib/api/client";
import { BODY_IMAGE_SCREEN_QUESTIONS, type BodyImageScreenQuestion, type BodyImageScreenResult } from "@/lib/config/plan";

type Props = { onResult: (r: BodyImageScreenResult) => void; expertNetworkEnabled: boolean };

/**
 * Beden algısı taraması (KB §6.4, R2-Ö4; PLAN 4f): 4 evet/hayır sorusu. YALNIZ sonuç sunucuya gider ve saklanır; cevaplar
 * ne saklanır ne analitiğe gider. Riskli cevapta doktor katmanı kapanır, uzmanla konuşma önerisi çıkar. Teşhis değildir.
 */
export function BodyImageScreen({ onResult, expertNetworkEnabled }: Props) {
  const t = useTranslations("doctor.screen");
  const [answers, setAnswers] = useState<Partial<Record<BodyImageScreenQuestion, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BodyImageScreenResult | null>(null);
  const complete = BODY_IMAGE_SCREEN_QUESTIONS.every((q) => typeof answers[q] === "boolean");

  async function submit() {
    if (!complete) return;
    setBusy(true);
    try {
      const r = await postJson<{ result: BodyImageScreenResult }>("/api/doctor/screen", { answers });
      if (!r) throw new Error("empty");
      setResult(r.result);
      onResult(r.result);
    } catch {
      toast.error(t("error"));
    } finally {
      setBusy(false);
    }
  }

  if (result === "risk") {
    return (
      <div className="space-y-3 rounded-2xl border border-dashed p-4">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold">
          <HeartHandshake className="size-4 text-brand" aria-hidden="true" />
          {t("riskTitle")}
        </h3>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{t("riskBody")}</p>
        <p className="text-[11px] text-muted-foreground">{t("riskNote")}</p>
        {expertNetworkEnabled ? (
          <Button asChild variant="outline" className="w-full">
            <Link href="/uzman?alan=psikolog">{t("talkToExpert")}</Link>
          </Button>
        ) : null}
      </div>
    );
  }
  if (result === "ok") {
    return (
      <div className="space-y-1 rounded-2xl border border-dashed p-4">
        <h3 className="text-[15px] font-semibold">{t("okTitle")}</h3>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{t("okBody")}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-2xl border border-dashed p-4">
      <h3 className="text-[15px] font-semibold">{t("title")}</h3>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{t("intro")}</p>
      <ol className="space-y-3">
        {BODY_IMAGE_SCREEN_QUESTIONS.map((q, i) => (
          <li key={q} className="space-y-1.5">
            <p id={`bis-${q}`} className="text-sm font-medium">
              {i + 1}. {t(q)}
            </p>
            <RadioGroup aria-labelledby={`bis-${q}`} value={answers[q] === undefined ? "" : answers[q] ? "yes" : "no"} onValueChange={(v) => setAnswers((a) => ({ ...a, [q]: v === "yes" }))} className="grid grid-cols-2 gap-2">
              {(["yes", "no"] as const).map((v) => (
                <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 text-sm has-[[data-state=checked]]:border-brand has-[[data-state=checked]]:bg-brand-soft">
                  <RadioGroupItem value={v} />
                  {t(v)}
                </label>
              ))}
            </RadioGroup>
          </li>
        ))}
      </ol>
      <Button className="w-full" disabled={!complete || busy} onClick={submit}>
        {t("submit")}
      </Button>
    </div>
  );
}
