"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { track } from "@/lib/analytics";

/**
 * KB §3.1/6 (R1-E12, R1-E14): kötü ya da karanlık fotoğrafta net bir evet/hayır pop-up'ı. Engellemez; sonuç yalnız
 * kullanıcı "Evet" derse çıkar. Metin KB'deki öneri (onay bekliyor): camera.qualityPrompt.
 */
export function QualityPrompt({ open, onYes, onNo }: { open: boolean; onYes: () => void; onNo: () => void }) {
  const t = useTranslations("camera.qualityPrompt");
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          track("capture_quality_prompt", { answer: "no" });
          onNo();
        }
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader className="items-center text-center">
          <span aria-hidden="true" className="grid size-12 place-items-center rounded-2xl bg-warn/12 text-warn">
            <TriangleAlert className="size-6" />
          </span>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("body")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              track("capture_quality_prompt", { answer: "no" });
              onNo();
            }}
          >
            {t("no")}
          </Button>
          <Button
            size="lg"
            onClick={() => {
              track("capture_quality_prompt", { answer: "yes" });
              onYes();
            }}
          >
            {t("yes")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
