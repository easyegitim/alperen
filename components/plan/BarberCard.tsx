"use client";

import { MessageSquareQuote } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BarberSpec } from "@/lib/coach/planTypes";

/** "Berbere göster" (KB §8): stil adı, yanlar kaç numara, üst kaç cm, sakal hattı. Yapılandırılmış alan; büyük punto. */
export function BarberCard({ spec }: { spec: BarberSpec }) {
  const t = useTranslations("plan.v2.barber");
  const [open, setOpen] = useState(false);
  const rows: string[] = [];
  if (spec.sidesGuard) rows.push(t("sides", { guard: spec.sidesGuard }));
  if (spec.topLengthCm !== undefined) rows.push(t("top", { cm: spec.topLengthCm.toLocaleString("tr-TR") }));
  if (spec.beardLine) rows.push(t("beardLine", { line: spec.beardLine }));
  return (
    <>
      <Button variant="ghost" size="sm" className="h-11 text-[13px]" onClick={() => setOpen(true)}>
        <MessageSquareQuote aria-hidden="true" />
        {t("share")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{spec.styleName}</DialogTitle>
            <DialogDescription>{t("title")}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 rounded-xl bg-muted p-4 text-lg leading-relaxed">
            {rows.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {spec.notes ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">{t("notes")}:</span> {spec.notes}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
