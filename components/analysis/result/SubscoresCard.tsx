"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SUB_KIND_HYBRID } from "@/lib/config/scoring";
import { SUB_KEYS_V2, type SubKey } from "@/lib/config/teaser";
import type { ExplanationV2, NotAssessedReason, ScoreV2 } from "@/lib/score/contract";
import type { Locked } from "@/lib/score/present";
import { cn } from "@/lib/utils";
import { fmt1, formatRange } from "./format";

export type SubRowV2 = { k: SubKey; score: ScoreV2 | null; explanation: ExplanationV2 | null; notAssessed?: NotAssessedReason };

/** Düşük skorda (KB §4.8) geliştirilebilir alanlar önce, kendi içinde düşükten yükseğe; değerlendirilmeyen en sonda. Ayrım yalnız içeride. */
export function orderSubsV2(rows: readonly SubRowV2[], lowScore: boolean): SubRowV2[] {
  if (!lowScore) return [...rows];
  const rank = { modifiable: 0, partial: 1, structural: 2 } as const;
  return [...rows].sort((x, y) => {
    const s = Number(Boolean(x.notAssessed)) - Number(Boolean(y.notAssessed));
    if (s !== 0) return s;
    const d = rank[SUB_KIND_HYBRID[x.k]] - rank[SUB_KIND_HYBRID[y.k]];
    if (d !== 0) return d;
    return (x.score?.value ?? 99) - (y.score?.value ?? 99);
  });
}

export function rowsFromAnalysis(a: { subscores: Record<SubKey, Locked<ScoreV2 | null>>; explanations: Record<SubKey, Locked<ExplanationV2 | null>>; notAssessed: { sub: SubKey; reason: NotAssessedReason }[] }): SubRowV2[] {
  return SUB_KEYS_V2.map((k) => ({
    k,
    score: a.subscores[k].locked ? null : a.subscores[k].value,
    explanation: a.explanations[k].locked ? null : a.explanations[k].value,
    notAssessed: a.notAssessed.find((n) => n.sub === k)?.reason,
  }));
}

function Line({ label, items }: { label: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[13px] leading-relaxed">
          {items.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

/** KB §4.9 beş satır: neye baktık · ne tuttu · ne aşağı çekti · ne yapılırsa artar · güven notu; varsayılan açık, rozet yok. */
function Explanation({ k, e }: { k: SubKey; e: ExplanationV2 }) {
  const t = useTranslations("analysis.explain5");
  const tr = useTranslations("analysis.result");
  const structural = SUB_KIND_HYBRID[k] === "structural";
  return (
    <dl className="mt-3 space-y-2.5 rounded-xl bg-muted/40 p-3">
      <Line label={t("lookedAt")} items={e.lookedAt} />
      <Line label={t("held")} items={e.held} />
      <Line label={t("lowered")} items={e.lowered} />
      {e.raise.length ? (
        <div>
          <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t("raise")}</dt>
          <dd>
            <ul className="mt-0.5 space-y-1 text-[13px] leading-relaxed">
              {e.raise.map((r, i) => (
                <li key={i} className="flex flex-col rounded-lg border bg-card px-2.5 py-1.5">
                  <span className="font-medium">{r.step}</span>
                  <span className="text-xs text-muted-foreground">{r.effect}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ) : null}
      {structural ? <p className="text-xs text-muted-foreground">{tr("structuralNote")}</p> : null}
      <div>
        <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t("confidenceNote")}</dt>
        <dd className="text-[13px] text-muted-foreground">{e.confidenceNote}</dd>
      </div>
    </dl>
  );
}

function Row({ row, index, explanationsReady }: { row: SubRowV2; index: number; explanationsReady: boolean }) {
  const t = useTranslations("analysis");
  const tr = useTranslations("analysis.result");
  const name = t(`sub.${row.k}`);
  const range = row.score ? formatRange(row.score.range) : null;
  return (
    <li className="py-3.5 first:pt-0 last:pb-0 motion-safe:animate-fade-up" style={{ animationDelay: `${index * 50}ms` }}>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <span className="text-[15px] font-semibold">{name}</span>
        {row.notAssessed ? (
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            <span aria-hidden="true">– </span>
            {t("notAssessed.value")}
          </span>
        ) : row.score ? (
          <span className="flex shrink-0 flex-col items-end" aria-label={range ? tr("subscoreAria", { name, value: fmt1(row.score.value), lo: range.lo, hi: range.hi }) : undefined}>
            <span className="num text-2xl font-bold" aria-hidden="true">
              {fmt1(row.score.value)}
            </span>
            {range ? (
              <span className="num text-[11px] text-muted-foreground" aria-hidden="true">
                {tr("subscoreRange", { lo: range.lo, hi: range.hi })}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{tr("notReady")}</span>
        )}
      </div>
      {row.notAssessed ? (
        <p className="mt-1 text-xs text-muted-foreground">{t(`notAssessed.${row.notAssessed}`)}</p>
      ) : (
        <div className="h-2 w-full overflow-hidden rounded-full bg-track" role="presentation">
          {row.score ? <div className={cn("h-full origin-left rounded-full bg-brand-gradient motion-safe:animate-grow-x")} style={{ width: `${row.score.value * 10}%` }} /> : null}
        </div>
      )}
      {!row.notAssessed && row.score ? (
        row.explanation ? (
          <Explanation k={row.k} e={row.explanation} />
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">{explanationsReady ? tr("missing") : tr("notReady")}</p>
        )
      ) : null}
    </li>
  );
}

/** 7 alt skor (Kaşlar dahil), rozetsiz; her satırın altında 5 satırlık açıklama varsayılan açık (KB §4.9, P#10). */
export function SubscoresCard({ rows, explanationsReady, viewsUsed }: { rows: SubRowV2[]; explanationsReady: boolean; viewsUsed: number }) {
  const t = useTranslations("analysis");
  const tr = useTranslations("analysis.result");
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">{t("subscoresTitle")}</h2>
        {viewsUsed > 0 ? <span className="text-[11px] font-medium text-muted-foreground">{tr("viewsUsed", { n: viewsUsed })}</span> : null}
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {rows.map((row, i) => (
            <Row key={row.k} row={row} index={i} explanationsReady={explanationsReady} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
