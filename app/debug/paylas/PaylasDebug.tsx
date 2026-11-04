"use client";

import { useEffect, useState } from "react";
import { GhostGuide } from "@/components/camera/GhostGuide";
import { ReferralBlock } from "@/components/paywall/ReferralBlock";
import { ReferralClaimForm } from "@/components/paywall/ReferralClaimForm";
import { ShareCardButton } from "@/components/share/ShareCardButton";
import { FACE_OVAL } from "@/lib/face/indices";
import type { GhostOutline } from "@/lib/face/ghostGuide";
import { renderShareCard } from "@/lib/share/card";
import type { ShareCardSpec } from "@/lib/share/spec";

const COMMON = { format: "square" as const, audience: "personal" as const, appName: "Aura", url: "aura.app", disclaimer: "Yapay zekâ tahmini; kişisel değerini ölçmez." };

/** Sentetik "fotoğraf": renkli daire (yüz değil); daire kırpımını göstermek için. */
async function syntheticPhoto(): Promise<ImageBitmap> {
  const c = new OffscreenCanvas(400, 400);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#c9b8a8";
  ctx.fillRect(0, 0, 400, 400);
  ctx.fillStyle = "#7c9cff";
  ctx.beginPath();
  ctx.arc(200, 200, 150, 0, Math.PI * 2);
  ctx.fill();
  return createImageBitmap(c);
}

const SPECS: { name: string; spec: ShareCardSpec; photo: boolean }[] = [
  { name: "skor-foto", photo: true, spec: { ...COMMON, kind: "score", withPhoto: true, overall: 6.4, potential: 7.1, subs: [{ key: "skin", label: "Cilt", value: 7.2 }, { key: "eyes", label: "Göz çevresi", value: 6.9 }, { key: "hair", label: "Saç", value: 6.1 }] } },
  { name: "skor-story", photo: false, spec: { ...COMMON, format: "story", kind: "score", withPhoto: false, overall: 6.4, potential: 7.1, subs: [{ key: "skin", label: "Cilt", value: 7.2 }, { key: "eyes", label: "Göz çevresi", value: 6.9 }, { key: "hair", label: "Saç", value: 6.1 }] } },
  { name: "en-guclu", photo: false, spec: { ...COMMON, kind: "strongest", withPhoto: false, sub: "eyes", title: "En güçlü yanın: Göz çevresi", line: "Göz altı tonu dengeli ve çevresi dinlenmiş görünüyor." } },
  { name: "berber", photo: false, spec: { ...COMMON, kind: "barber", withPhoto: false, barber: { styleName: "Kısa kenar, dokulu üst", sidesGuard: "2", topLengthCm: 5, beardLine: "Çene hattının bir parmak altı", notes: "Doğal dokuyu koru; keskin kontur yok." }, presetIds: { hair: "textured_crop" }, lines: ["Yanlar: 2 numara", "Üst: 5 cm", "Sakal hattı: Çene hattının bir parmak altı"] } },
];

export function KartDebug() {
  const [urls, setUrls] = useState<{ name: string; url: string }[]>([]);
  useEffect(() => {
    let out: string[] = [];
    (async () => {
      const photo = await syntheticPhoto();
      const list: { name: string; url: string }[] = [];
      for (const s of SPECS) {
        const blob = await renderShareCard(s.spec, s.photo ? photo : null);
        list.push({ name: s.name, url: URL.createObjectURL(blob) });
      }
      out = list.map((l) => l.url);
      setUrls(list);
    })();
    return () => out.forEach((u) => URL.revokeObjectURL(u));
  }, []);
  return (
    <div className="space-y-4">
      <ShareCardButton overall={6.4} potential={7.1} subs={[{ key: "skin", label: "Cilt", value: 7.2 }, { key: "eyes", label: "Göz çevresi", value: 6.9 }, { key: "hair", label: "Saç", value: 6.1 }]} strongest={{ sub: "eyes", label: "Göz çevresi", line: "Göz altı tonu dengeli görünüyor." }} />
      <ul className="grid grid-cols-2 gap-3">
        {urls.map((u) => (
          <li key={u.name} className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- yerel blob */}
            <img src={u.url} alt={u.name} className="w-full rounded-xl border" data-share-card={u.name} />
            <p className="text-center text-[11px] text-muted-foreground">{u.name}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DavetDebug({ unlocked }: { unlocked: boolean }) {
  return (
    <div className="space-y-4">
      <ReferralBlock initial={{ code: "DV-K7PM-3XQA", progress: unlocked ? { done: 5, total: 5, pending: 0 } : { done: 2, total: 5, pending: 1 }, unlocked }} />
      <ReferralClaimForm enabled collapsible={false} />
    </div>
  );
}

/** Sentetik yüz çizgisi (elips; gerçek landmark yok). */
function syntheticOutline(): GhostOutline {
  const oval = Array.from({ length: FACE_OVAL.length }, (_, i) => {
    const a = (i / FACE_OVAL.length) * Math.PI * 2;
    return [Math.round((0.5 + 0.27 * Math.sin(a)) * 1e4) / 1e4, Math.round((0.47 - 0.33 * Math.cos(a)) * 1e4) / 1e4] as [number, number];
  });
  return { version: 1, aspect: 0.75, mirrored: false, oval, eyes: [[0.33, 0.4], [0.43, 0.41], [0.57, 0.41], [0.67, 0.4]], nose: [0.5, 0.55], mouth: [[0.41, 0.68], [0.59, 0.68]], takenAt: 1_700_000_000_000 };
}

export function HayaletDebug() {
  return (
    <div className="relative mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-3xl border bg-black shadow-card">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,#3a3a3a,#111)]" aria-hidden="true" />
      <GhostGuide outline={syntheticOutline()} mirror />
      <p className="absolute inset-x-4 bottom-4 flex min-h-11 items-center justify-center rounded-full bg-black/60 px-4 text-center text-sm font-semibold text-white">Hizalan ve bekle</p>
    </div>
  );
}
