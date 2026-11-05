import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * Kilitli özellik kartı (F08; /dene, /plan, /rutin, /ilerleme): kilit dairesi, başlık, en fazla bir satır açıklama,
 * en fazla 2 fayda satırı (veya children ile ek içerik) ve tek CTA ("Kilidi aç"). Değer taşımaz; yalnız sabit metin.
 */
export function LockedFeature({
  title,
  body,
  perks = [],
  href,
  onUnlock,
  children,
}: {
  title: string;
  body?: string;
  /** En fazla 2 satır gösterilir. */
  perks?: { icon: ReactNode; label: string }[];
  /** Bağlantı CTA'sı (sunucu sayfaları) … */
  href?: string;
  /** … ya da paywall açan düğme (istemci). */
  onUnlock?: () => void;
  children?: ReactNode;
}) {
  const ta = useTranslations("analysis");
  const cta = (
    <>
      <Lock aria-hidden="true" />
      {ta("unlock")}
    </>
  );
  return (
    <section className="border-brand-gradient relative overflow-hidden rounded-2xl shadow-card">
      <div className="pointer-events-none absolute inset-0 bg-hero-glow" aria-hidden="true" />
      <div className="relative space-y-5 px-5 py-7">
        <div className="space-y-3 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-brand-soft text-brand" aria-hidden="true">
            <Lock className="size-6" />
          </span>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {body ? <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p> : null}
        </div>
        {perks.length ? (
          <ul className="grid gap-2">
            {perks.slice(0, 2).map((p) => (
              <li key={p.label} className="flex min-h-12 items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2.5 text-sm font-semibold">
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                  {p.icon}
                </span>
                {p.label}
              </li>
            ))}
          </ul>
        ) : null}
        {children}
        {href ? (
          <Button asChild size="lg" className="w-full">
            <Link href={href}>{cta}</Link>
          </Button>
        ) : (
          <Button type="button" size="lg" className="w-full" onClick={onUnlock}>
            {cta}
          </Button>
        )}
      </div>
    </section>
  );
}
