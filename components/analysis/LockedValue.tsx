"use client";

import { Lock } from "lucide-react";
import type { Locked } from "@/lib/score/present";
import { cn } from "@/lib/utils";

export const fmtScore = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Kilitli değer: gerçek değer istemcide yoktur; "●,●" + kilit, dokununca paywall (SPEC 5.3).
 * aria adı alanı söyler ("Genel skorun kilitli; açmak için dokun"); dokunma hedefi ≥ 44 px.
 * Görsel yalnız süstür: genişlik, renk ve yazı değerden türetilmez.
 */
export function LockedValue({
  v,
  big = false,
  onTap,
  aria,
  pop = false,
  className,
}: {
  v: Locked<number | null>;
  big?: boolean;
  onTap: () => void;
  aria: string;
  /** Açılış gösteriminde kilit 0,9 → 1 ölçeklenir (azaltılmış harekette yok). */
  pop?: boolean;
  className?: string;
}) {
  if (v.locked) {
    return (
      <button
        type="button"
        onClick={onTap}
        aria-label={aria}
        className={cn(
          "num inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          big ? "flex-col gap-2 p-3" : "shrink-0 px-2 text-base",
          pop && "motion-safe:animate-in motion-safe:zoom-in-90 motion-safe:duration-300",
          className,
        )}
      >
        {big ? (
          <>
            <span className="grid size-14 place-items-center rounded-full bg-brand-soft text-brand ring-1 ring-brand/30" aria-hidden="true">
              <Lock className="size-6" />
            </span>
            <span aria-hidden="true" className="text-2xl tracking-[0.2em] text-muted-foreground">
              ●,●
            </span>
          </>
        ) : (
          <>
            <span aria-hidden="true">●,●</span>
            <Lock className="size-3.5 shrink-0" aria-hidden="true" />
          </>
        )}
      </button>
    );
  }
  return <span className={cn("num", big && "text-5xl font-bold", className)}>{v.value === null ? "–" : fmtScore(v.value)}</span>;
}
