"use client";

import { ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ImproveItemV2 } from "@/lib/score/contract";
import { fmt1 } from "./format";

/** "Önce odaklan" (KB P#13): en fazla 3 adım, her biri bir plan adımına bağlı; kazanç genel skor puanı (toplam ≤ +1,5). */
export function ImproveFirstV2Card({ items, analysisId }: { items: ImproveItemV2[] | null; analysisId: string }) {
  const t = useTranslations("analysis");
  const tr = useTranslations("analysis.result.improve");
  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <ListChecks aria-hidden="true" className="size-4 text-brand" />
          {tr("title")}
        </h2>
      </CardHeader>
      <CardContent className="space-y-3">
        {items && items.length ? (
          <ol className="space-y-2">
            {items.slice(0, 3).map((it, i) => (
              <li key={`${it.sub}-${it.stepId}`} className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5">
                <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold">{it.step}</span>
                  <span className="block text-xs text-muted-foreground">{t(`sub.${it.sub}`)}</span>
                </span>
                {it.gain > 0 ? (
                  <span className="num shrink-0 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-bold text-brand" aria-label={tr("gainAria", { gain: fmt1(it.gain) })}>
                    {tr("gain", { gain: fmt1(it.gain) })}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">{tr("empty")}</p>
        )}
        <Button asChild variant="outline" className="w-full">
          <Link href={`/plan/${analysisId}`}>{t("seePlan")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
