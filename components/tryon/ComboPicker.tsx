"use client";

import { Check, Palette, Scissors, Smile, Sparkles, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { visiblePresets } from "@/content/presets";
import type { Preset, PresetKind } from "@/content/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TryonPresets } from "@/lib/tryon/types";
import { cn } from "@/lib/utils";

type Props = {
  value: TryonPresets;
  onChange: (v: TryonPresets) => void;
  onRun: () => void;
  recommended: readonly string[];
  presentation: "male" | "female" | "unspecified";
  disabled?: boolean;
  /** Mod: style → tek yuva dolu olabilir; combo → saç + sakal zorunlu. */
  mode: "style" | "combo";
};

const KIND_ICON: Record<PresetKind, LucideIcon> = { hair: Scissors, beard: Smile, color: Palette };
const SLOTS: PresetKind[] = ["hair", "beard", "color"];

/** Kombin seçimi (KB §7.1; PLAN 5b): üç yuva (saç, sakal, renk), yuva başına tek seçim; 44 px hedefler, AA kontrast. */
export function ComboPicker({ value, onChange, onRun, recommended, presentation, disabled, mode }: Props) {
  const t = useTranslations("tryon");
  const [slot, setSlot] = useState<PresetKind>("hair");
  const byPres = (p: Preset) => !p.presentation || presentation === "unspecified" || p.presentation.includes(presentation);
  const list = visiblePresets(slot).filter(byPres);
  const parts = SLOTS.filter((k) => value[k]).length;
  const canRun = mode === "combo" ? Boolean(value.hair && value.beard) : parts === 1;

  function pick(p: Preset) {
    const next = { ...value, [p.kind]: value[p.kind] === p.id ? undefined : p.id };
    if (mode === "style") onChange({ [p.kind]: next[p.kind] });
    else onChange(next);
  }

  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-3 gap-2" aria-label={t("v2.combo.title")}>
        {SLOTS.map((k) => {
          const Icon = KIND_ICON[k];
          const chosen = value[k] ? visiblePresets(k).find((p) => p.id === value[k]) : undefined;
          return (
            <li key={k}>
              <button
                type="button"
                onClick={() => setSlot(k)}
                aria-pressed={slot === k}
                className={cn("flex min-h-16 w-full flex-col items-start gap-1 rounded-2xl border p-2.5 text-left transition-colors", slot === k ? "border-brand-gradient shadow-glow" : "bg-card shadow-card hover:bg-accent", chosen && "bg-brand-soft/40")}
              >
                <span className="flex w-full items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                    <Icon aria-hidden="true" className="size-3.5" /> {t(`v2.combo.slot.${k}`)}
                  </span>
                  {chosen ? <Check aria-label={t("v2.combo.selected")} className="size-3.5 text-brand" /> : null}
                </span>
                <span className={cn("line-clamp-2 text-[13px] leading-tight font-semibold", !chosen && "text-muted-foreground")}>{chosen?.nameTr ?? t("v2.combo.none")}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <Tabs value={slot} onValueChange={(v) => setSlot(v as PresetKind)}>
        <TabsList className="w-full rounded-xl p-1 group-data-[orientation=horizontal]/tabs:h-11">
          {SLOTS.map((k) => (
            <TabsTrigger key={k} value={k} className="flex-1 rounded-lg text-[13px]">{t(`tabs.${k}`)}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <ul className="grid grid-cols-2 gap-2.5">
        {list.map((p, i) => {
          const selected = value[p.kind] === p.id;
          const rec = recommended.includes(p.id);
          const Icon = KIND_ICON[p.kind];
          return (
            <li key={p.id} className="motion-safe:animate-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => pick(p)}
                className={cn(
                  "flex h-full min-h-24 w-full flex-col items-start gap-2 rounded-2xl p-3.5 text-left transition-colors active:scale-[0.98] disabled:opacity-50",
                  selected ? "border-brand-gradient shadow-glow" : "border bg-card shadow-card hover:bg-accent",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span aria-hidden="true" className="grid size-8 place-items-center rounded-xl bg-brand-soft text-brand">
                    {selected ? <Check className="size-4" /> : <Icon className="size-4" />}
                  </span>
                  {rec ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand">
                      <Sparkles aria-hidden="true" className="size-3" />
                      {t("recommendedBadge")}
                    </span>
                  ) : null}
                </span>
                <span className="text-[15px] leading-tight font-semibold">{p.nameTr}</span>
                {p.noteTr ? <span className="line-clamp-2 text-xs text-muted-foreground">{p.noteTr}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {mode === "combo" ? (
        <div className="sticky bottom-20 z-10 space-y-2 rounded-2xl border bg-card/95 p-3 shadow-card backdrop-blur">
          <p className="text-[12px] text-muted-foreground">{canRun ? t("v2.combo.hint") : t("v2.combo.needBoth")}</p>
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button variant="outline" size="lg" aria-label={t("v2.combo.clear")} onClick={() => onChange({})} disabled={parts === 0 || disabled}><X aria-hidden="true" /></Button>
            <Button size="lg" onClick={onRun} disabled={!canRun || disabled}>{t("v2.combo.run")}</Button>
          </div>
        </div>
      ) : (
        <div className="sticky bottom-20 z-10 rounded-2xl border bg-card/95 p-3 shadow-card backdrop-blur">
          <Button size="lg" className="w-full" onClick={onRun} disabled={!canRun || disabled}>{t("retry")}</Button>
        </div>
      )}
    </div>
  );
}
