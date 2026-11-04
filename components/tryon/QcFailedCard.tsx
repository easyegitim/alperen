"use client";

import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Kalite kontrolü geçmedi (KB §7.3 R2-C10/3, Ç10): görsel gösterilmez, hak düşmedi. */
export function QcFailedCard({ onBack }: { onBack: () => void }) {
  const t = useTranslations("tryon.v2.qc");
  return (
    <Card role="alert">
      <CardHeader>
        <span aria-hidden="true" className="mb-1 grid size-12 place-items-center rounded-2xl bg-warn/12 text-warn">
          <RotateCcw className="size-6" />
        </span>
        <CardTitle className="text-lg font-bold">{t("failedTitle")}</CardTitle>
        <CardDescription className="text-[13px]">{t("failedBody")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button size="lg" className="w-full" onClick={onBack}>{t("failedRetry")}</Button>
      </CardContent>
    </Card>
  );
}
