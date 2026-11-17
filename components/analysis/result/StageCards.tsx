"use client";

import { Camera, Loader2, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AnalysisFailure, AnalysisStage } from "@/lib/score/contract";

/** Ödeme alındı, görseller henüz gönderilmedi (device_only + hak): fotoğraf seti çekim ekranından gider (görsel sunucuda yok). */
export function PendingUploadCard({ analysisId }: { analysisId: string }) {
  const t = useTranslations("analysis.result.pending");
  return (
    <Card className="bg-hero-glow">
      <CardContent className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-brand-soft text-brand" aria-hidden="true">
          <Camera className="size-6" />
        </span>
        <p className="text-base font-semibold" role="status">
          {t("title")}
        </p>
        <p className="text-[13px] text-muted-foreground">{t("body")}</p>
        <Button asChild className="w-full">
          <Link href={`/tara?analysis=${encodeURIComponent(analysisId)}`}>{t("cta")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** Sıra / çalışıyor başlığı: gerçek aşama metni; süre vaadi yok (Ç16). */
export function StageBanner({ stage, done, total, pollError }: { stage: AnalysisStage; done: number; total: number; pollError: boolean }) {
  const t = useTranslations("analysis");
  const tr = useTranslations("analysis.result");
  if (stage !== "queued" && stage !== "running") return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-muted/40 px-3.5 py-2.5 text-[13px]" role="status" aria-live="polite">
      <Loader2 aria-hidden="true" className="size-4 shrink-0 text-brand motion-safe:animate-spin" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{t(`stage.${stage}`)}</span>
        <span className="block text-xs text-muted-foreground">
          {tr("progressLabel", { done, total })}
          {pollError ? ` · ${t("processingRefresh")}` : ""}
        </span>
      </span>
      <span aria-hidden="true" className="h-1.5 w-16 overflow-hidden rounded-full bg-track">
        <span className="block h-full rounded-full bg-brand-gradient transition-[width] duration-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </span>
    </div>
  );
}

/** Başarısız (KB P#22 notu): hak düşmedi; görseller saklanmadığı için yeniden deneme çekim ekranından. */
export function FailedCard({ failure, analysisId }: { failure: AnalysisFailure | null; analysisId: string }) {
  const t = useTranslations("analysis");
  const tr = useTranslations("analysis.result");
  const code = failure?.code ?? "AI_FAILED";
  return (
    <Card className="bg-hero-glow">
      <CardContent className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-brand-soft text-brand" aria-hidden="true">
          <RotateCcw className="size-6" />
        </span>
        <p className="text-base font-semibold" role="status">
          {t("stage.failed")}
        </p>
        <p className="text-[13px] text-muted-foreground">{t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.GENERIC")}</p>
        <p className="text-[11px] text-muted-foreground">{tr("retryHint")}</p>
        <Button asChild className="w-full">
          <Link href={`/tara?analysis=${encodeURIComponent(analysisId)}`}>{t("stage.retry")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
