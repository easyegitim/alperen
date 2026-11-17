import { Compass } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** 404 kartı (F08): marka kartı + tek CTA. Durum kodu Next'in not-found sınırından gelir (404 kalır). */
export async function NotFoundCard({ href, cta }: { href: string; cta: "toAnalyses" | "toHome" }) {
  const t = await getTranslations("common.notFound");
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10">
      <Card className="bg-hero-glow">
        <CardContent className="flex flex-col items-center gap-3 text-center">
          <span aria-hidden="true" className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand">
            <Compass className="size-7" />
          </span>
          <p className="num text-brand-gradient text-5xl font-bold" aria-hidden="true">
            {t("eyebrow")}
          </p>
          <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-[13px] text-muted-foreground">{t("body")}</p>
          <Button asChild size="lg" className="mt-2 w-full">
            <Link href={href}>{t(cta)}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
