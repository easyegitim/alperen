import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Plan rozeti ("Yılda 4 ay bedava"): paywall, /premium ve /fiyatlar'da aynı renk. */
export const PLAN_BADGE_CLASS = "inline-flex h-6 items-center rounded-full bg-brand-soft px-2.5 text-[11px] font-semibold text-brand";

/** Öne çıkan planın üst şeridi ("En avantajlı"). */
export function PlanRibbon({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="absolute -top-2.5 right-4 rounded-full bg-cta-gradient px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground shadow-glow">
      {children}
    </span>
  );
}

/** Seçim göstergesi (yalnız görsel; anlamı radyo/aria-pressed taşır). */
export function PlanCheck({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-full border-2",
        selected ? "border-transparent bg-cta-gradient text-primary-foreground" : "border-control",
      )}
    >
      {selected ? <Check className="size-3" strokeWidth={3} /> : null}
    </span>
  );
}

/** Seçilebilir plan kartının dış çerçevesi: seçiliyse gradyan kenar + parıltı. */
export function planCardClass(selected: boolean, featured: boolean) {
  return cn(
    "relative flex min-h-16 w-full items-center gap-3 rounded-2xl px-4 py-4 text-left text-sm transition-shadow",
    selected ? "border-brand-gradient shadow-glow" : "border bg-card hover:bg-accent",
    featured && "mt-2.5",
  );
}

/** Plan kartının gövdesi: ad + fiyat, altında haftalık karşılık ve rozet (tek satır). */
export function PlanBody({
  name,
  price,
  per,
  detail,
  badge,
  nameId,
  descId,
}: {
  name: string;
  price: string;
  per?: string;
  detail: string | null;
  badge: string | null;
  nameId?: string;
  descId?: string;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-baseline justify-between gap-2">
        <span id={nameId} className="text-[15px] font-semibold">
          {name}
        </span>
        <span className="num text-right whitespace-nowrap">
          <span className="text-lg font-bold">{price}</span>
          {per ? <span className="ml-1 text-xs text-muted-foreground">{per}</span> : null}
        </span>
      </span>
      {detail || badge ? (
        <span id={descId} className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
          {badge ? <span className={PLAN_BADGE_CLASS}>{badge}</span> : null}
          {detail ? <span className="num">{detail}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
