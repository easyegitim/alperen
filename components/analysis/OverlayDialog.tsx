"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { GeometryOverlay, type OverlayLayerKey, type OverlaySource } from "@/components/analysis/GeometryOverlay";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { OVERLAY_LAYER_KEYS } from "@/lib/face/overlay";

/**
 * Büyük ölçü görünümü (UI spec §2.5). Ücretsiz ve premium aynı çizgileri ve adları görür; yapısal katmanlar için
 * tek durum "bu çekimde ölçülmedi"dir (yalnız ilgili alt skorun açıklaması açıksa). Başka bir yargı yok.
 */
export function OverlayDialog({
  open,
  onOpenChange,
  source,
  notMeasured,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: OverlaySource | null;
  notMeasured: OverlayLayerKey[];
}) {
  const t = useTranslations("analysis.overlay");
  const te = useTranslations("analysis.explain");
  const [showLines, setShowLines] = useState(true);
  const switchId = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{source ? t("localNote") : t("fallbackNote")}</DialogDescription>
        </DialogHeader>
        <GeometryOverlay source={source} variant="full" showLines={showLines} notMeasured={notMeasured} srLegend={false} className="[&>p]:hidden" />
        <div className="flex min-h-11 items-center gap-3">
          <Switch id={switchId} checked={showLines} onCheckedChange={setShowLines} />
          <label htmlFor={switchId} className="text-sm">
            {t("toggle")}
          </label>
        </div>
        <ul className="space-y-2 text-sm">
          {OVERLAY_LAYER_KEYS.map((k) => (
            <li key={k}>
              <span className="font-medium">{t(`layers.${k}`)}</span>
              {notMeasured.includes(k) ? <span className="text-muted-foreground"> · {te("status.not_measured")}</span> : null}
              <span className="block text-muted-foreground">{t(`meaning.${k}`)}</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
