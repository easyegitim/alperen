"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Kilitli bölüm: başlık ve adlandırılmış satırlar görünür (SPEC 5.3), değerler yoktur; "Kilidi aç" paywall açar.
 * preview yalnız kilitliyken gösterilir ve değer taşımaz (ör. "●,●" satırları).
 */
export function LockedSection({
  title,
  description,
  icon,
  locked,
  onTap,
  preview,
  feature = false,
  ctaVariant = "default",
  children,
}: {
  title: string;
  description?: string;
  /** Başlığın solundaki küçük simge (aria-hidden). */
  icon?: ReactNode;
  locked: boolean;
  onTap: () => void;
  preview?: ReactNode;
  /** Öne çıkan kart: gradyan kenarlık ve parıltı. */
  feature?: boolean;
  /** Ekranda tek birincil (gradyan) "Kilidi aç" kalsın diye ikincil kartlar "outline" kullanır. */
  ctaVariant?: "default" | "outline";
  children: ReactNode;
}) {
  const t = useTranslations("analysis");
  return (
    <Card className={cn(feature && "border-brand-gradient bg-hero-glow")}>
      <CardHeader>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          {icon ? (
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <span className="flex-1">{title}</span>
          {locked ? <Lock className="size-4 text-muted-foreground" aria-hidden="true" /> : null}
        </h2>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {locked ? (
          <>
            {preview}
            <Button className="w-full" variant={ctaVariant} onClick={onTap}>
              <Lock aria-hidden="true" />
              {t("unlock")}
            </Button>
          </>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
