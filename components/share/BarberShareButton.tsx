"use client";

import { Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { APP_NAME } from "@/lib/config/app";
import type { BarberSpec } from "@/lib/coach/planTypes";
import { renderShareCard, shareOrDownload } from "@/lib/share/card";
import { shareFileName, shareSpecIssues, type BarberShareSpec } from "@/lib/share/spec";
import { APP_HOST } from "./ShareCardButton";

/**
 * Berber kartını paylaş / indir (KB §8 ONAYLI ÖNERİ R2-Ö2; S3.3.1): stil adı + ölçü satırları; fotoğraf YOK
 * (önden/yandan stil görseli varlığı yok, S2.14 #27). Cihazda üretilir; sunucuya gitmez.
 */
export function BarberShareButton({ spec, lines, presetIds = {} }: { spec: BarberSpec; lines: string[]; presetIds?: { hair?: string; beard?: string } }) {
  const t = useTranslations("share");
  const tv = useTranslations("share.v2");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const card: BarberShareSpec = { kind: "barber", format: "square", audience: "personal", appName: APP_NAME, url: APP_HOST, disclaimer: tv("disclaimer"), withPhoto: false, barber: spec, presetIds, lines };
      if (shareSpecIssues(card).length) {
        toast.error(tv("invalid"));
        return;
      }
      const blob = await renderShareCard(card);
      track("share_card_created", { withPhoto: false, kind: "barber" });
      const r = await shareOrDownload(blob, shareFileName("barber"), spec.styleName);
      toast.success(r === "shared" ? tv("shared") : tv("downloaded"));
    } catch {
      toast.error(tv("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Button variant="outline" className="w-full" onClick={() => void create()} disabled={busy}>
        <Share2 aria-hidden="true" /> {tv("barberButton")}
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">
        {tv("barberNoPhoto")} {t("v2.deviceNote")}
      </p>
    </div>
  );
}
