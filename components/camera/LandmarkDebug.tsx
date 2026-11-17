"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { VisionClient } from "@/lib/face/client";
import { FACE_OVAL, IDX } from "@/lib/face/indices";
import { eulerFromMatrix } from "@/lib/face/pose";
import { checkQuality, type QualityReport } from "@/lib/face/quality";
import { SEG_CLASS, type FrameAnalysis, type SegmentationResult } from "@/lib/face/types";

const NAMED = Object.entries(IDX) as [keyof typeof IDX, number][];
const SEG_COLORS: Record<number, [number, number, number]> = {
  [SEG_CLASS.hair]: [255, 80, 80],
  [SEG_CLASS.faceSkin]: [80, 200, 120],
  [SEG_CLASS.bodySkin]: [80, 140, 255],
  [SEG_CLASS.clothes]: [220, 200, 60],
  [SEG_CLASS.other]: [200, 80, 220],
};

/** Geliştirici sayfası: 478 nokta numaralı, adlandırılmış noktalar renkli, yüz ovali, segmenter maskesi, canlı poz/kalite, JSON indirme. */
export function LandmarkDebug() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const busyRef = useRef(false);
  const lastFrameRef = useRef<FrameAnalysis | null>(null);
  const segRef = useRef<SegmentationResult | null>(null);
  const counterRef = useRef(0);
  const [status, setStatus] = useState("model yükleniyor…");
  const [report, setReport] = useState<QualityReport | null>(null);
  const [frame, setFrame] = useState<FrameAnalysis | null>(null);
  const [showNumbers, setShowNumbers] = useState(true);
  const [showMask, setShowMask] = useState(true);

  const draw = useCallback(
    (fa: FrameAnalysis) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const W = canvas.width, H = canvas.height;

      const seg = segRef.current;
      if (showMask && seg) {
        const img = ctx.createImageData(seg.width, seg.height);
        for (let i = 0; i < seg.mask.length; i++) {
          const c = SEG_COLORS[seg.mask[i]];
          if (!c) continue;
          img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 90;
        }
        const off = new OffscreenCanvas(seg.width, seg.height);
        off.getContext("2d")?.putImageData(img, 0, 0);
        ctx.drawImage(off, 0, 0, W, H);
      }

      if (!fa.landmarks) return;
      const L = fa.landmarks;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      FACE_OVAL.forEach((i, k) => (k === 0 ? ctx.moveTo(L[i].x * W, L[i].y * H) : ctx.lineTo(L[i].x * W, L[i].y * H)));
      ctx.closePath();
      ctx.stroke();

      ctx.fillStyle = "rgba(0,255,255,0.8)";
      ctx.font = "8px monospace";
      L.forEach((p, i) => {
        ctx.fillRect(p.x * W - 1, p.y * H - 1, 2, 2);
        if (showNumbers) ctx.fillText(String(i), p.x * W + 2, p.y * H - 2);
      });

      ctx.font = "bold 11px sans-serif";
      for (const [name, i] of NAMED) {
        const p = L[i];
        if (!p) continue;
        ctx.fillStyle = "#ff3b30";
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(`${name}:${i}`, p.x * W + 6, p.y * H + 4);
      }
    },
    [showMask, showNumbers],
  );

  const loopRef = useRef<() => Promise<void>>(async () => {});
  const loop = useCallback(async () => {
    const video = videoRef.current;
    if (video && video.readyState >= 2 && !busyRef.current) {
      busyRef.current = true;
      try {
        const client = VisionClient.get();
        const now = performance.now();
        const fa = await client.detectVideo(await createImageBitmap(video), now);
        counterRef.current++;
        if (counterRef.current % 10 === 0) {
          const seg = await client.segment(await createImageBitmap(video));
          if (seg) segRef.current = seg;
        }
        lastFrameRef.current = fa;
        setFrame(fa);
        setReport(checkQuality(fa));
        draw(fa);
      } catch (e) {
        setStatus(`hata: ${e instanceof Error ? e.message : "?"}`);
      } finally {
        busyRef.current = false;
      }
    }
    rafRef.current = requestAnimationFrame(() => void loopRef.current());
  }, [draw]);
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false; // StrictMode çift bağlanmasında ilk çalıştırma iptal edilir
    (async () => {
      try {
        const init = await VisionClient.get().init();
        if (cancelled) return;
        setStatus(`model hazır (${init.delegate})`);
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 } }, audio: false });
        const video = videoRef.current;
        if (cancelled || !video) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        rafRef.current = requestAnimationFrame(() => void loopRef.current());
      } catch (e) {
        if (!cancelled) setStatus(`başlatılamadı: ${e instanceof Error ? e.message : "?"}`);
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [loop]);

  function download() {
    const fa = lastFrameRef.current;
    if (!fa) return;
    const blob = new Blob([JSON.stringify(fa, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `landmarks-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const pose = frame?.matrix ? eulerFromMatrix(frame.matrix) : null;
  const f = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "–" : v.toFixed(d));

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{status}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={showNumbers ? "default" : "outline"} onClick={() => setShowNumbers((v) => !v)}>
          numaralar
        </Button>
        <Button size="sm" variant={showMask ? "default" : "outline"} onClick={() => setShowMask((v) => !v)}>
          maske
        </Button>
        <Button size="sm" variant="outline" onClick={download} disabled={!frame?.landmarks}>
          Landmark JSON indir
        </Button>
      </div>
      <video ref={videoRef} playsInline muted className="hidden" />
      <canvas ref={canvasRef} className="w-full rounded-lg bg-black" />
      <pre className="overflow-x-auto rounded-md border p-3 text-xs">
        {`yüz: ${frame?.faces ?? "–"}  boyut: ${frame?.width ?? "–"}×${frame?.height ?? "–"}
yaw: ${f(pose?.yaw)}  pitch: ${f(pose?.pitch)}  roll: ${f(pose?.roll)}
parlaklık: ${f(frame?.brightness, 0)}  denge: ${f(frame?.brightnessBalance, 0)}  netlik: ${f(frame?.sharpness, 0)}
göz: ${f(frame?.blendshapes?.eyeBlinkLeft, 2)}/${f(frame?.blendshapes?.eyeBlinkRight, 2)}  gülümseme: ${f(frame?.blendshapes?.mouthSmileLeft, 2)}/${f(frame?.blendshapes?.mouthSmileRight, 2)}  çene: ${f(frame?.blendshapes?.jawOpen, 2)}
saç görünür: ${frame?.hairVisible ?? "–"}  yüz genişliği: ${f(report?.measures.faceWidthRatio, 2)}  merkez sapması: ${f(report?.measures.centerOffset, 3)}
kalite: ${report ? (report.passed ? "GEÇTİ" : report.issues.join(", ")) : "–"}  uyarı: ${report?.warnings.join(", ") || "–"}`}
      </pre>
    </div>
  );
}
