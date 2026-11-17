import { Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Boş / kilitli / bilgi durum kartı (F08 deseni): ortada simge çipi, kısa başlık, tek satır açıklama, tam genişlikte CTA.
 * locked=true iken simge kilit dairesi olur ve CTA kilit simgesiyle başlar. Değer taşımaz; yalnız sabit metin.
 */
export function StateCard({
  icon,
  title,
  body,
  locked = false,
  feature = false,
  children,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  locked?: boolean;
  /** Gradyan çerçeve (öne çıkan durum). */
  feature?: boolean;
  /** CTA'lar (StateCardLink veya Button). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl text-center shadow-card",
        feature ? "border-brand-gradient" : "border bg-card",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-hero-glow" aria-hidden="true" />
      <div className="relative flex flex-col items-center gap-4 px-5 py-7">
        <span
          className={cn("grid size-14 place-items-center bg-brand-soft text-brand", locked ? "rounded-full" : "rounded-2xl")}
          aria-hidden="true"
        >
          {locked ? <Lock className="size-6" /> : icon}
        </span>
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold">{title}</h2>
          {body ? <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p> : null}
        </div>
        {children ? <div className="grid w-full gap-2">{children}</div> : null}
      </div>
    </section>
  );
}

/** Durum kartındaki bağlantı CTA'sı. */
export function StateCardLink({ href, locked = false, variant, children }: { href: string; locked?: boolean; variant?: "default" | "outline"; children: ReactNode }) {
  return (
    <Button asChild variant={variant} className="w-full">
      <Link href={href}>
        {locked ? <Lock aria-hidden="true" /> : null}
        {children}
      </Link>
    </Button>
  );
}
