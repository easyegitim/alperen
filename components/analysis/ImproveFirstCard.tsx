"use client";

import { ChevronRight, Lock, Target } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { KindBadge } from "@/components/analysis/SubscoreList";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { track } from "@/lib/analytics";
import type { PaywallTrigger } from "@/lib/config/paywall";
import { leverSection } from "@/lib/coach/planBasis";
import type { ImproveItem, SubKind } from "@/lib/score/contract";
import type { Locked } from "@/lib/score/present";
import { fmtScore } from "@/components/analysis/LockedValue";

/** Kilitli yer tutucu satırların sabit genişlikleri: gerçek bir değerden türetilmez. */
const PLACEHOLDER_WIDTHS = ["72%", "58%", "66%"] as const;

/**
 * "Önce odaklanacağın adımlar" (UI spec §2.7). Veri yalnız sunucudan; sıra ve dışlamalar motorda (C9).
 * Kilitliyken her zaman 3 yer tutucu satır: gerçek sayı veya alan sırası kilitli alt skorları ele vermesin.
 */
export function ImproveFirstCard({
  v,
  analysisId,
  onLocked,
  kinds,
}: {
  v: Locked<ImproveItem[] | null>;
  analysisId: string;
  onLocked: (t: PaywallTrigger) => void;
  /** Alt skor türleri (rozet rengi için); yoksa nötr rozet. */
  kinds?: Partial<Record<ImproveItem["sub"], SubKind>>;
}) {
  const t = useTranslations("analysis");
  if (!v.locked && v.value === null) return null; // eski satır

  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
            <Target className="size-4" />
          </span>
          <span className="flex-1">{t("improveFirst.title")}</span>
          {v.locked ? <Lock className="size-4 text-muted-foreground" aria-hidden="true" /> : null}
        </h2>
      </CardHeader>
      <CardContent className="space-y-4">
        {v.locked ? (
          <>
            <ol className="space-y-2" aria-hidden="true">
              {PLACEHOLDER_WIDTHS.map((w, i) => (
                <li key={w} className="flex h-14 items-center gap-3 rounded-xl bg-muted/60 px-3">
                  <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">{i + 1}</span>
                  <span className="h-2.5 rounded-full bg-muted-foreground/25 blur-[1.5px]" style={{ width: w }} />
                  <Lock className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                </li>
              ))}
            </ol>
            <p className="text-sm text-muted-foreground">{t("improveFirst.lockedBody")}</p>
            <Button className="w-full" onClick={() => onLocked("improve_first")}>
              <Lock aria-hidden="true" />
              {t("unlock")}
            </Button>
          </>
        ) : v.value && v.value.length > 0 ? (
          <ol className="space-y-2">
            {v.value.slice(0, 3).map((item, i) => {
              const section = leverSection(item.lever);
              const kind = kinds?.[item.sub];
              return (
                <li key={item.lever}>
                  <Link
                    href={`/plan/${analysisId}${section ? `#section-${section}` : ""}`}
                    className="flex min-h-16 items-center gap-3 rounded-xl border bg-muted/40 px-3 py-3 transition-colors hover:bg-accent"
                    onClick={() => track("improve_first_clicked", { position: (i + 1) as 1 | 2 | 3 })}
                  >
                    <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-cta-gradient text-xs font-bold text-primary-foreground" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="block text-sm leading-snug font-semibold">{t(`levers.${item.lever}`)}</span>
                      {kind ? (
                        <KindBadge kind={kind} label={t(`sub.${item.sub}`)} />
                      ) : (
                        <span className="text-xs text-muted-foreground">{t(`sub.${item.sub}`)}</span>
                      )}
                    </span>
                    <span className="flex shrink-0 flex-col items-end">
                      <span className="num text-brand-gradient text-lg font-bold" aria-hidden="true">
                        +{fmtScore(item.gain)}
                      </span>
                      <span className="text-[10px] text-muted-foreground" aria-hidden="true">
                        {t("improveFirst.gainShort")}
                      </span>
                      <span className="sr-only">{t("improveFirst.gain", { gain: fmtScore(item.gain) })}. {t("improveFirst.toPlan")}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">{t("improveFirst.empty")}</p>
        )}
      </CardContent>
    </Card>
  );
}
