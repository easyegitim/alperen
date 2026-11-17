"use client";

import { ChevronDown, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { LockedValue, fmtScore } from "@/components/analysis/LockedValue";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { PaywallTrigger } from "@/lib/config/paywall";
import type { SubKey } from "@/lib/config/teaser";
import { STRUCTURAL_EXPLAIN_KEYS, type ExplainItem, type ModExplainKey, type NotAssessed, type SubKind } from "@/lib/score/contract";
import type { Locked } from "@/lib/score/present";
import { cn } from "@/lib/utils";

type ModItem = Extract<ExplainItem, { key: ModExplainKey }>;
const isStructuralItem = (i: ExplainItem): i is Extract<ExplainItem, { status: "measured" | "not_measured" }> =>
  (STRUCTURAL_EXPLAIN_KEYS as readonly string[]).includes(i.key);

/** Değiştirilebilir alan çipleri: önce "Geliştirilebilir", sonra "İyi durumda"; "Net görünmedi" yalnız hepsi öyleyse. En fazla 3. */
function modChips(items: readonly ExplainItem[]): ModItem[] {
  const mod = items.filter((i): i is ModItem => !isStructuralItem(i));
  const partial = mod.filter((i) => i.status === "partial");
  const best = mod.filter((i) => i.status === "best");
  const chosen = partial.length + best.length > 0 ? [...partial, ...best] : mod;
  return chosen.slice(0, 3);
}

export type SubRow = {
  k: SubKey;
  v: Locked<number | null>;
  kind: SubKind;
  note: string | null;
  explain: Locked<ExplainItem[] | null>;
  notAssessed?: NotAssessed;
};

/** Kilitli satırdaki süs çubuğunun sabit genişliği: gerçek bir değerden türetilmez (değer istemcide yoktur). */
const LOCKED_BAR_WIDTH = "62%";

const KIND_STYLE: Record<SubKind, string> = {
  structural: "bg-kind-structural/12 text-kind-structural",
  partial: "bg-kind-partial/12 text-kind-partial",
  modifiable: "bg-kind-modifiable/12 text-kind-modifiable",
};

/** Alan türü rozeti: tür adı metinle yazılır (renk tek başına anlam taşımaz). */
export function KindBadge({ kind, label }: { kind: SubKind; label: string }) {
  return <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold tracking-wide", KIND_STYLE[kind])}>{label}</span>;
}

/** Satır içi açılır ayrıntı: uzun açıklamalar varsayılan olarak kapalı. */
function Details({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="-mx-1 -mb-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg px-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        {label}
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-2 pb-1 text-xs leading-relaxed text-muted-foreground">{children}</div>
    </details>
  );
}

function Row({ row, index, reveal, hybrid, onLocked }: { row: SubRow; index: number; reveal: boolean; hybrid: boolean; onLocked: (t: PaywallTrigger) => void }) {
  const t = useTranslations("analysis");
  const { k, v, kind, note, explain } = row;
  // Öncelik: kilit her şeyi geçer (ücretsiz kullanıcıya kilitli alanın değerlendirilmediği söylenmez); sonra "değerlendirilmedi".
  const notAssessed = !v.locked ? row.notAssessed : undefined;
  const items = !explain.locked && explain.value ? explain.value : [];
  const modifiable = kind === "modifiable";
  const chips = modifiable && !v.locked ? modChips(items) : [];
  const notMeasured = !v.locked && !modifiable ? items.filter(isStructuralItem).filter((i) => i.status === "not_measured") : [];
  const hasDetails = !v.locked && (hybrid || notAssessed || (modifiable && note) || notMeasured.length > 0);

  return (
    <li
      className={cn("py-3.5 first:pt-0 last:pb-0", reveal && "motion-safe:animate-fade-up")}
      style={reveal ? { animationDelay: `${1600 + index * 60}ms` } : undefined}
    >
      <div className="flex min-h-11 items-center justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[15px] font-semibold">{t(`sub.${k}`)}</span>
          <KindBadge kind={kind} label={t(`kind.${kind}`)} />
        </span>
        {v.locked ? (
          <LockedValue v={v} pop={reveal} onTap={() => onLocked(`sub_${k}`)} aria={t("lockedAriaFor", { name: t(`sub.${k}`) })} />
        ) : notAssessed ? (
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            <span aria-hidden="true">– </span>
            {t("notAssessed.value")}
          </span>
        ) : (
          <span className="num shrink-0 text-2xl font-bold">{v.value === null ? "–" : fmtScore(v.value)}</span>
        )}
      </div>
      {notAssessed ? null : (
        <div className="h-2 w-full overflow-hidden rounded-full bg-track" role="presentation">
          {v.locked ? (
            <div className="h-full rounded-full bg-brand-gradient opacity-35 blur-[2px]" style={{ width: LOCKED_BAR_WIDTH }} />
          ) : v.value !== null ? (
            <div
              className={cn("h-full origin-left rounded-full bg-brand-gradient", reveal && "motion-safe:animate-grow-x")}
              style={{ width: `${v.value * 10}%`, animationDelay: reveal ? `${1700 + index * 60}ms` : undefined }}
            />
          ) : null}
        </div>
      )}
      {chips.length ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {chips.map((i) => (
            <li key={i.key} className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[11px] font-medium">
              <span className={cn("size-1.5 rounded-full", i.status === "best" ? "bg-success" : i.status === "partial" ? "bg-info" : "bg-muted-foreground")} aria-hidden="true" />
              {t("explain.itemStatus", { item: t(`explain.items.${i.key}`), status: t(`explain.status.${i.status}`) })}
            </li>
          ))}
        </ul>
      ) : null}
      {hasDetails ? (
        <Details label={t("details")}>
          {notAssessed ? <p className="text-foreground">{t(`notAssessed.${notAssessed.reason}`)}</p> : null}
          {modifiable && note && !notAssessed ? <p className="text-foreground">{note}</p> : null}
          {notMeasured.map((i) => (
            <p key={i.key}>
              {t(`explain.items.${i.key}`)}: {t("explain.status.not_measured")}
            </p>
          ))}
          {hybrid ? <p>{t(`subWhat.${k}`)}</p> : null}
        </Details>
      ) : null}
    </li>
  );
}

/** Alt skor listesi (UI spec §2.6). Rozet sunucunun gönderdiği tür (a.kinds) ile; hybrid çene hattı "Yapısal". */
export function SubscoreList({
  rows,
  hybrid,
  reveal,
  onLocked,
}: {
  rows: SubRow[];
  /** Kaynak açıklamaları (subWhat) yalnız hybrid satırlarda doğrudur. */
  hybrid: boolean;
  reveal: boolean;
  onLocked: (t: PaywallTrigger) => void;
}) {
  const t = useTranslations("analysis");
  const locked = rows.some((r) => r.v.locked);
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">{t("subscoresTitle")}</h2>
        {locked ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand">
            <Lock className="size-3" aria-hidden="true" />
            {t("premiumTag")}
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {rows.map((row, i) => (
            <Row key={row.k} row={row} index={i} reveal={reveal} hybrid={hybrid} onLocked={onLocked} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ─── v2 kilitli liste (KB P#10, P#11): adlar açık, skorlar bulanık, herkeste aynı çubuk; rozet YOK ──────────────────

/** Ödeme öncesi 7 alt skor: her satırda aynı süs çubuğu (gerçek değerden türemez), "Yapısal/Geliştirilebilir" etiketi yok. */
export function LockedSubscoreList({ keys, onLocked }: { keys: readonly SubKey[]; onLocked: (t: PaywallTrigger) => void }) {
  const t = useTranslations("analysis");
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">{t("subscoresTitle")}</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand">
          <Lock className="size-3" aria-hidden="true" />
          {t("locked.tag")}
        </span>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {keys.map((k) => (
            <li key={k} className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex min-h-11 items-center justify-between gap-3">
                <span className="text-[15px] font-semibold">{t(`sub.${k}`)}</span>
                <LockedValue v={{ value: null, locked: true }} onTap={() => onLocked(`sub_${k}`)} aria={t("locked.subBarAria")} />
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-track" role="presentation">
                <div className="h-full rounded-full bg-brand-gradient opacity-35 blur-[2px]" style={{ width: LOCKED_BAR_WIDTH }} />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{t("locked.subscoresNote")}</p>
      </CardContent>
    </Card>
  );
}
