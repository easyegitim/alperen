"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const REFRESH_MS = 3_000;
const REFRESH_FOR_MS = 60_000;

/** Tamamlanmamış analiz (UI spec §2.2): işleniyorsa 60 sn boyunca 3 sn'de bir sayfayı yeniler. */
export function ProcessingCard({ status }: { status: "processing" | "failed" }) {
  const t = useTranslations("analysis");
  const router = useRouter();

  useEffect(() => {
    if (status !== "processing") return;
    const started = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - started > REFRESH_FOR_MS) {
        clearInterval(id);
        return;
      }
      router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [status, router]);

  return (
    <Card className="bg-hero-glow">
      <CardContent className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-brand-soft text-brand" aria-hidden="true">
          {status === "failed" ? <RotateCcw className="size-6" /> : <Loader2 className="size-6 motion-safe:animate-spin" />}
        </span>
        <p className="text-base font-semibold" role="status">
          {status === "failed" ? t("statusFailed") : t("statusProcessing")}
        </p>
        {status === "processing" ? <p className="text-xs text-muted-foreground">{t("processingRefresh")}</p> : null}
        <Button asChild variant={status === "failed" ? "default" : "outline"} className="w-full">
          <Link href="/tara">{t("newAnalysis")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
