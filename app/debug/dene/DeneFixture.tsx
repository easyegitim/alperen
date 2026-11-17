"use client";

import { useEffect, useState } from "react";
import { ComboPicker } from "@/components/tryon/ComboPicker";
import { GlowUpPanel } from "@/components/tryon/GlowUpPanel";
import { QcFailedCard } from "@/components/tryon/QcFailedCard";
import { TryonResult, type TryonResultView } from "@/components/tryon/TryonResult";
import { QuotaBar, TryonGenerating } from "@/components/tryon/TryonScreen";
import { drawTryonShare } from "@/lib/share/card";
import type { GlowUpLayer, TryonPresets } from "@/lib/tryon/types";

export type DeneFixtureState = "combo" | "glowup" | "qc_failed" | "result" | "share" | "generating";

const PLAN_STEPS = [
  { id: "textured_crop", title: "Dokulu kısa kesim", area: "hair" },
  { id: "stubble_light", title: "Hafif kirli sakal", area: "beard" },
  { id: "st_spf", title: "Güneş koruyucu", area: "skin" },
  { id: "st_moisturizer_light", title: "Hafif nemlendirici", area: "skin" },
  { id: "hb_sleep", title: "Uyku", area: "habit" },
];

/** Sentetik "yüz" (gradyan + geometrik şekiller; gerçek fotoğraf değil). before/after yalnız ton farkıyla ayrılır. */
function synthetic(w: number, shade: number, label: string): ImageBitmap | null {
  if (typeof OffscreenCanvas === "undefined") return null;
  const c = new OffscreenCanvas(w, w);
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createLinearGradient(0, 0, 0, w);
  g.addColorStop(0, `hsl(222 30% ${18 + shade}%)`);
  g.addColorStop(1, `hsl(262 30% ${10 + shade}%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);
  ctx.fillStyle = `hsl(28 45% ${62 + shade}%)`;
  ctx.beginPath();
  ctx.ellipse(w / 2, w * 0.52, w * 0.24, w * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `hsl(20 20% ${18 + shade}%)`;
  ctx.beginPath();
  ctx.ellipse(w / 2, w * 0.26, w * 0.26, w * 0.14, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a1a1a";
  for (const dx of [-0.09, 0.09]) {
    ctx.beginPath();
    ctx.ellipse(w / 2 + w * dx, w * 0.45, w * 0.03, w * 0.018, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `600 ${Math.round(w * 0.04)}px system-ui, sans-serif`;
  ctx.fillText(label, w * 0.06, w * 0.94);
  return c.transferToImageBitmap();
}

export function DeneFixture({ state }: { state: DeneFixtureState }) {
  const [picked, setPicked] = useState<TryonPresets>({ hair: "textured_crop", beard: "van_dyke" });
  const [layers, setLayers] = useState<GlowUpLayer[]>(["hair", "skin"]);
  const [slider, setSlider] = useState(50);
  const [flagged, setFlagged] = useState(false);
  const [urls, setUrls] = useState<{ before: string; after: string; share: string } | null>(null);

  useEffect(() => {
    if (state !== "result" && state !== "share") return;
    const before = synthetic(640, 0, "sentetik önce"), after = synthetic(640, 6, "sentetik sonra");
    if (!before || !after) return;
    const toUrl = async (bmp: ImageBitmap) => {
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext("2d")?.drawImage(bmp, 0, 0);
      return URL.createObjectURL(await c.convertToBlob({ type: "image/jpeg", quality: 0.9 }));
    };
    const shareUrl = async () => {
      const w = after.width, h = Math.round(w / 0.88);
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext("2d");
      if (!ctx) return "";
      drawTryonShare(ctx, { after, label: "Aura ile oluşturuldu · YZ simülasyonu", title: "Dokulu kısa kesim + Van Dyke", appName: "Aura" }, w, h);
      return URL.createObjectURL(await c.convertToBlob({ type: "image/jpeg", quality: 0.9 }));
    };
    void Promise.all([toUrl(before), toUrl(after), shareUrl()]).then(([b, a, s]) => setUrls({ before: b, after: a, share: s }));
  }, [state]);

  if (state === "combo") {
    return (
      <div className="space-y-4">
        <QuotaBar remaining={7} limit={10} nextAt={null} />
        <ComboPicker mode="combo" value={picked} onChange={setPicked} onRun={() => undefined} recommended={["textured_crop", "stubble_light"]} presentation="male" />
      </div>
    );
  }
  if (state === "glowup") return <GlowUpPanel layers={layers} onChange={setLayers} onRun={() => undefined} planSteps={PLAN_STEPS} analysisId="11111111-1111-4111-8111-111111111111" />;
  if (state === "qc_failed") return <QcFailedCard onBack={() => undefined} />;
  if (state === "generating") return <TryonGenerating title="Kombin deneniyor…" elapsed={14} />;
  if (!urls) return <p className="text-sm text-muted-foreground">Sentetik görseller hazırlanıyor…</p>;
  if (state === "share") {
    return (
      <figure className="space-y-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- yerel blob */}
        <img src={urls.share} alt="Paylaşım görseli önizlemesi (sentetik)" className="w-full rounded-2xl border" />
        <figcaption className="text-[11px] text-muted-foreground">Paylaşım çıktısı: etiket görsele gömülü.</figcaption>
      </figure>
    );
  }
  const result: TryonResultView = {
    eventId: "00000000-0000-0000-0000-000000000000",
    mode: "glow_up",
    title: "İyileşmiş halin",
    beforeUrl: urls.before,
    afterUrl: urls.after,
    eyeLineY: 0.45,
    appliedSteps: PLAN_STEPS.filter((s) => s.area !== "beard").map(({ id, title }) => ({ id, title })),
    qc: { pass: true, reasons: [], identityKept: true, styleApplied: true, strayHairCleared: true, artifacts: "minor" },
    regenCount: 1,
  };
  return <TryonResult result={result} slider={slider} onSlider={setSlider} onShare={() => undefined} onFlag={() => setFlagged(true)} flagged={flagged} onBack={() => undefined} />;
}
