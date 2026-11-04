"use client";

import { Check, CircleHelp, ScanFace } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { FaceShape } from "@/lib/face/types";
import type { FaceShapeV2 } from "@/lib/score/contract";
import { cn } from "@/lib/utils";

const SHAPES: FaceShape[] = ["oval", "round", "square", "long", "heart", "diamond"];

async function patchFaceShape(faceShape: FaceShape | null): Promise<boolean> {
  const res = await fetch("/api/me/face-shape", { method: "PATCH", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ faceShape }) });
  return res.ok;
}

/**
 * Yüz şekli (KB §4.10, Ç8): ön değerlendirme (cihaz) ve detaylı sonuç (çoklu açı) birlikte; ayrışırsa "emin değiliz"
 * ve neden. "Bence değil" → kullanıcının seçimi geçerli olur (profiles.face_shape_override); hiçbir sonuç silinmez.
 */
export function FaceShapeCard({ faceShape, detailedReady }: { faceShape: FaceShapeV2 | null; detailedReady: boolean }) {
  const tg = useTranslations("geometry");
  const tf = useTranslations("analysis.faceShapeV2");
  const tr = useTranslations("analysis.result.faceShape");
  const [override, setOverride] = useState<FaceShape | null>(faceShape?.override ?? null);
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState<FaceShape>(override ?? faceShape?.prelim.primary ?? "oval");
  const [busy, setBusy] = useState(false);

  if (!faceShape) return null;
  const label = (s: FaceShape, secondary?: FaceShape) => (secondary ? `${tg(`shapes.${s}`)}, ${tg("between", { other: tg(`shapes.${secondary}`) })}` : tg(`shapes.${s}`));

  async function save(next: FaceShape | null) {
    setBusy(true);
    try {
      if (!(await patchFaceShape(next))) throw new Error("patch_failed");
      setOverride(next);
      setPicking(false);
      toast.success(tr("saved"));
    } catch {
      toast.error(tr("error"));
    } finally {
      setBusy(false);
    }
  }

  const detailed = detailedReady ? faceShape.detailed : undefined;
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex shrink-0 items-center gap-2 text-lg font-semibold tracking-tight">
          <ScanFace aria-hidden="true" className="size-4 text-brand" />
          {tr("title")}
        </h2>
        {detailed ? (
          faceShape.agree ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2.5 py-1 text-[11px] font-semibold text-success">
              <Check aria-hidden="true" className="size-3" />
              {tf("agree")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              <CircleHelp aria-hidden="true" className="size-3" />
              {tf("unsure")}
            </span>
          )
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-muted/60 p-3">
            <dt className="text-[11px] leading-tight text-muted-foreground">{tr("prelimLabel")}</dt>
            <dd className="mt-1 text-base leading-tight font-semibold">{label(faceShape.prelim.primary, faceShape.prelim.secondary)}</dd>
          </div>
          <div className="rounded-xl bg-muted/60 p-3">
            <dt className="text-[11px] leading-tight text-muted-foreground">{tr("detailedLabel")}</dt>
            <dd className="mt-1 text-base leading-tight font-semibold">{detailed ? label(detailed.shape, detailed.secondary) : <span className="text-sm text-muted-foreground">{detailedReady ? "–" : "…"}</span>}</dd>
          </div>
        </dl>
        {detailed && !faceShape.agree ? (
          <p className="text-[13px] leading-relaxed">
            <span className="font-semibold">{tr("reasonLabel")}: </span>
            {detailed.reason}
          </p>
        ) : null}
        {override ? (
          <p className="flex items-center justify-between gap-2 rounded-xl border-brand-gradient px-3 py-2 text-[13px]">
            <span>
              <span className="font-semibold">{tr("overrideLabel")}: </span>
              {tg(`shapes.${override}`)}
            </span>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void save(null)}>
              {tr("remove")}
            </Button>
          </p>
        ) : null}
        {picking ? (
          <div className="space-y-3 rounded-xl border p-3">
            <p className="text-sm font-semibold">{tr("pickTitle")}</p>
            <p className="text-xs text-muted-foreground">{tr("pickBody")}</p>
            <RadioGroup value={choice} onValueChange={(v) => setChoice(v as FaceShape)} className="grid grid-cols-3 gap-2">
              {SHAPES.map((s) => (
                <label key={s} className={cn("flex min-h-11 cursor-pointer items-center justify-center rounded-xl border text-sm font-medium", choice === s ? "border-brand-gradient" : "bg-card")}>
                  <RadioGroupItem value={s} aria-label={tr("shapeAria", { shape: tg(`shapes.${s}`) })} className="sr-only" />
                  {tg(`shapes.${s}`)}
                </label>
              ))}
            </RadioGroup>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setPicking(false)}>
                {tr("cancel")}
              </Button>
              <Button type="button" disabled={busy} onClick={() => void save(choice)}>
                {tr("save")}
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="outline" className="w-full" onClick={() => setPicking(true)}>
            {tf("notMe")}
          </Button>
        )}
        <p className="text-[11px] text-muted-foreground">{tf("overrideNote")}</p>
      </CardContent>
    </Card>
  );
}
