"use client";

import { Lightbulb } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CaptureHint } from "@/lib/score/contract";

/** Bir sonraki çekim için öneriler (UI spec §2.7, C12). Sunucu kilitli cilt ipuçlarını zaten çıkarır; değer taşımaz. */
export function CaptureHintsCard({ hints }: { hints: CaptureHint[] }) {
  const t = useTranslations("analysis.captureHints");
  if (hints.length === 0) return null;
  return (
    <section aria-labelledby="capture-hints-title" className="flex gap-3 rounded-2xl border border-dashed p-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-warn/12 text-warn" aria-hidden="true">
        <Lightbulb className="size-4" />
      </span>
      <div className="min-w-0 space-y-1">
        <h2 id="capture-hints-title" className="text-sm font-semibold">
          {t("title")}
        </h2>
        <ul className="space-y-1 text-[13px] leading-snug text-muted-foreground">
          {hints.map((h) => (
            <li key={h}>{t(h)}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
