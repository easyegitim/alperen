"use client";

import { Check, LoaderCircle, Plus, ScanFace, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DeviceAnalysisProgress } from "@/components/analysis/AnalysisProgress";
import { GeometryOverlay, type OverlaySource } from "@/components/analysis/GeometryOverlay";
import { SelfieCamera, type CaptureResult } from "@/components/camera/SelfieCamera";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { track } from "@/lib/analytics";
import { submitDeviceAnalysis } from "@/lib/api/analysisClient";
import { ApiClientError } from "@/lib/api/client";
import { VisionClient } from "@/lib/face/client";
import { DEVICE_STEP_MIN_MS, finishDeviceProgress, markDeviceStep, startDeviceProgress, type DeviceProgress } from "@/lib/face/deviceProgress";
import { findHairline, propagateHairline } from "@/lib/face/hairline";
import { sourceHashesFor } from "@/lib/face/hash";
import { computeStableGeometry, toPixels, type GeometryFrame } from "@/lib/face/metrics";
import { qualitySummary } from "@/lib/face/quality";
import { bindSessionSelfie, setSessionSelfie, setSessionViews, type SessionView } from "@/lib/face/sessionStore";
import type { GeometryResult } from "@/lib/face/types";
import { OPTIONAL_VIEWS, PROFILE_VIEWS, VIEWS, VIEW_BY_KEY, type ViewKey } from "@/lib/face/views";
import { addProgressPhoto } from "@/lib/local/progressStore";
import { cn } from "@/lib/utils";

/** Çekim sonrası cihazda geometri (F06): segmenter → saç çizgisi → 5 kare medyanı → GeometryResult (yalnız ön). */
async function computeGeometry(result: CaptureResult): Promise<GeometryResult> {
  const seg = await VisionClient.get().segment(await createImageBitmap(result.image.bitmap));
  const finalPx = result.final.landmarks ? toPixels(result.final.landmarks, result.final.width, result.final.height) : null;
  const hairline = seg && finalPx ? findHairline(finalPx, result.final, seg).point : null;
  // Canlı karelerde segmenter çalıştırılmaz (maliyet); son karede bulunan saç çizgisi göreli konumuyla canlı karelere
  // taşınır (computeStableGeometry çoğunluk ister; aksi halde üst üçte bir hep null kalırdı). Mobil ile aynı kural (M8).
  const frames: GeometryFrame[] = [
    ...result.recentFrames.map((f) => ({ frame: f, hairline: hairline && finalPx && f.landmarks ? propagateHairline(finalPx, hairline, toPixels(f.landmarks, f.width, f.height)) : null })),
    { frame: result.final, hairline },
  ];
  return computeStableGeometry(frames);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** "Analizin tamamlandı" gösterim süresi. */
const DONE_HOLD_MS = 900;

/** Akış adımı: ön (zorunlu) → yan profil (zorunlu, iki profilden biri) → isteğe bağlı açılar → özet. */
type Step = { kind: "capture"; view: ViewKey; required: boolean } | { kind: "summary" };

type Captures = Partial<Record<ViewKey, CaptureResult>>;

/** Zorunlu yan profil: iki profilden hangisi çekildiyse (KB P#4: "zorunlu yan profil iki profilden biri sayılır"). */
const hasProfile = (c: Captures) => PROFILE_VIEWS.some((v) => c[v] !== undefined);

/**
 * /tara ekranı (F05, v2). Ön + yan profil zorunlu; 45°×2, ikinci profil ve saç çizgisi isteğe bağlı. Cihaz analizi (geometri,
 * oranlar, yüz şekli ön değerlendirmesi) yalnız ön fotoğraftan. "Analizi başlat": POST /api/analyses mode device_only —
 * görsel GÖNDERİLMEZ, LLM çağrılmaz; fotoğraflar ödeme sonrası tek POST için bellekte kalır. 478 nokta cihazdan çıkmaz.
 */
export function CaptureScreen({ aiProviderName }: { aiProviderName: string }) {
  const t = useTranslations("camera.captured");
  const tv = useTranslations("camera.views");
  const ta = useTranslations("analysis");
  const tg = useTranslations("geometry");
  const router = useRouter();
  const [captures, setCaptures] = useState<Captures>({});
  const [step, setStep] = useState<Step>({ kind: "capture", view: "front", required: true });
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [geometry, setGeometry] = useState<GeometryResult | null>(null);
  const [phase, setPhase] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [progress, setProgress] = useState<DeviceProgress | null>(null);
  const [error, setError] = useState<{ code: string; retryAt?: string } | null>(null);
  const [saveProgress, setSaveProgress] = useState(false);
  const capturedAtRef = useRef<number | null>(null);
  const requestIdRef = useRef<string>(crypto.randomUUID());

  const front = captures.front ?? null;

  // Ölçü çizgisi kaynağı yalnız bellekteki ön çekimden (piksel koordinatı); hiçbir yere gönderilmez.
  const source = useMemo<OverlaySource | null>(
    () =>
      front?.final.landmarks
        ? {
            bitmap: front.image.bitmap,
            width: front.image.width,
            height: front.image.height,
            landmarks: front.final.landmarks.map((p) => ({ x: p.x * front.image.width, y: p.y * front.image.height })),
          }
        : null,
    [front],
  );

  // Ön çekim değişince geometri yeniden hesaplanır; ayrılırken bitmap'ler bırakılır.
  useEffect(() => {
    if (!front) return;
    let cancelled = false;
    computeGeometry(front)
      .then((g) => {
        if (!cancelled) setGeometry(g);
      })
      .catch(() => {
        if (!cancelled) setGeometry(null);
      });
    return () => {
      cancelled = true;
    };
  }, [front]);

  useEffect(() => {
    const all = captures;
    return () => {
      // Bileşen ayrılınca (sonuç ekranına geçişte oturum deposu kopyaları tutar) çekim bitmap'leri kapanır.
      for (const c of Object.values(all)) c?.image.bitmap.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız ayrılışta
  }, []);

  /** Açıya yerleştirir; aynı açı yeniden çekildiyse eskisi kapanır. Ön çekimde selfie oturum deposuna kopyalanır. */
  async function place(items: CaptureResult[]) {
    const next: Captures = { ...captures };
    for (const r of items) {
      next[r.view]?.image.bitmap.close();
      next[r.view] = r;
    }
    setCaptures(next);
    const fr = items.find((r) => r.view === "front");
    if (fr?.final.landmarks) {
      setGeometry(null);
      requestIdRef.current = crypto.randomUUID();
      setPhase("idle");
      setError(null);
      const capturedAt = Date.now();
      capturedAtRef.current = capturedAt;
      // SPEC 10.3 adım 3: selfie + landmark'lar oturum boyunca bellekte (IndexedDB'ye yazılmaz).
      setSessionSelfie({
        bitmap: await createImageBitmap(fr.image.bitmap),
        width: fr.image.width,
        height: fr.image.height,
        landmarks: fr.final.landmarks.map((p) => ({ x: p.x * fr.image.width, y: p.y * fr.image.height })),
        capturedAt,
      });
    }
    // Sıradaki adım: ön yoksa ön; profil yoksa profil; aksi halde özet.
    if (!next.front) setStep({ kind: "capture", view: "front", required: true });
    else if (!hasProfile(next)) setStep({ kind: "capture", view: "profile_left", required: true });
    else setStep({ kind: "summary" });
  }

  function remove(view: ViewKey) {
    const c = captures[view];
    if (!c) return;
    c.image.bitmap.close();
    const next = { ...captures };
    delete next[view];
    setCaptures(next);
    if (view === "front") {
      setSessionSelfie(null);
      setGeometry(null);
      setStep({ kind: "capture", view: "front", required: true });
    } else if (!hasProfile(next)) setStep({ kind: "capture", view: "profile_left", required: true });
  }

  async function runDeviceAnalysis(g: GeometryResult) {
    if (!front) return;
    setPhase("submitting");
    setError(null);
    // Yükleme ekranı sayfanın başında: "Analizi başlat" en alttaydı.
    window.scrollTo({ top: 0, behavior: "smooth" });
    let s = startDeviceProgress(Date.now());
    setProgress(s);
    const tick = async (st: Parameters<typeof markDeviceStep>[1]) => {
      await sleep(DEVICE_STEP_MIN_MS);
      s = markDeviceStep(s, st);
      setProgress(s);
    };
    try {
      await tick("landmarks"); // 478 nokta: çekimde çıkarıldı
      await tick("ratios"); // oranlar: computeGeometry bitti (g)
      await tick("faceShape"); // ön değerlendirme: g.faceShape
      // Yan açılar oturum deposuna (ödeme sonrası tek POST için); hash'ler yalnız galeri dosyalarından.
      const sideViews: SessionView[] = [];
      for (const key of VIEWS.map((v) => v.key)) {
        const c = captures[key];
        if (!c || key === "front") continue;
        sideViews.push({ view: key, bitmap: await createImageBitmap(c.image.bitmap), width: c.image.width, height: c.image.height, sourceHash: c.sourceHash });
      }
      setSessionViews(sideViews, front.sourceHash);
      await tick("views");
      const orderedHashes = [front.sourceHash, ...sideViews.map((v) => v.sourceHash)];
      const sourceHashes = sourceHashesFor(orderedHashes);
      // relaxed yalnız saklanan üst veridir; hiçbir skoru değiştirmez (C7).
      const geometry: GeometryResult = front.relaxed ? { ...g, quality: { ...g.quality, relaxed: true } } : g;
      const viewKeys = ["front", ...sideViews.map((v) => v.view)];
      track("device_analysis_submitted", { views: viewKeys.join(","), count: viewKeys.length, hashed: sourceHashes !== null });
      const analysis = await submitDeviceAnalysis({ clientRequestId: requestIdRef.current, geometry, sourceHashes });
      if (saveProgress) {
        // SPEC 11.2: yalnız cihazda (IndexedDB); sunucuya gitmez.
        try {
          const canvas = new OffscreenCanvas(front.image.width, front.image.height);
          canvas.getContext("2d")?.drawImage(front.image.bitmap, 0, 0);
          await addProgressPhoto({ blob: await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 }), analysisId: analysis.id });
        } catch {
          // depolama kapalıysa sessizce geç
        }
      }
      await tick("save");
      s = finishDeviceProgress(s);
      setProgress(s);
      setPhase("done");
      track("device_analysis_completed");
      await sleep(DONE_HOLD_MS);
      // Portre ve ölçü çizgileri sonuç ekranında yalnız bu analize bağlı selfie üzerinde çizilir (UI spec S1).
      if (capturedAtRef.current !== null) bindSessionSelfie(analysis.id, capturedAtRef.current);
      router.push(`/analiz/${analysis.id}`);
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : "NETWORK";
      track("analysis_failed", { reason: code });
      setError({ code, retryAt: e instanceof ApiClientError ? e.retryAt : undefined });
      setProgress(null);
      setPhase("error");
    }
  }

  if ((phase === "submitting" || phase === "done") && progress) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-6">
        <DeviceAnalysisProgress state={progress} source={source} viewsCount={Object.keys(captures).length} />
      </div>
    );
  }

  if (step.kind === "capture") {
    const spec = VIEW_BY_KEY[step.view];
    const requiredCount = 2;
    const requiredProfile = step.required && (PROFILE_VIEWS as readonly ViewKey[]).includes(step.view);
    const index = step.view === "front" ? 1 : requiredProfile ? 2 : null;
    const name = requiredProfile ? tv("profileAny.name") : tv(`${step.view}.name`);
    const label = index ? tv("stepLabel", { current: index, total: requiredCount, name }) : tv("optionalStep", { name });
    const optionalNote = step.required ? undefined : tv.has(`${step.view}.optionalNote`) ? tv(`${step.view}.optionalNote`) : tv("optionalLabel");
    return (
      <div className="mx-auto w-full max-w-lg space-y-3 px-4 py-6">
        <SelfieCamera
          key={step.view}
          view={spec}
          stepLabel={label}
          optionalNote={optionalNote}
          aiProviderName={step.view === "front" ? aiProviderName : undefined}
          takenViews={Object.keys(captures) as ViewKey[]}
          onCapture={(r) => void place([r])}
          onGalleryBatch={step.view === "front" ? (items) => void place(items) : undefined}
          onBack={captures.front ? () => setStep({ kind: "summary" }) : undefined}
          labels={requiredProfile ? { name: tv("profileAny.name"), instruction: tv("profileAny.instruction") } : undefined}
        />
        {step.view === "front" ? <p className="text-center text-[11px] text-muted-foreground">{tv("profileRequiredNote")}</p> : null}
      </div>
    );
  }

  // Özet: çekilen açılar, isteğe bağlı ekleme, yüz şekli ön değerlendirmesi, "Analizi başlat".
  const quality = front ? qualitySummary(front.quality.measures) : null;
  const startDisabled = !front || !geometry || !hasProfile(captures) || error?.code === "QUOTA_EXCEEDED";
  const takenList = VIEWS.filter((v) => captures[v.key]);
  const addable = [...PROFILE_VIEWS, ...OPTIONAL_VIEWS].filter((v) => !captures[v]);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <Card className="bg-hero-glow">
        <CardHeader>
          <p className="eyebrow">{t("eyebrowV2")}</p>
          <CardTitle className="text-2xl font-bold">{tv("done")}</CardTitle>
          <CardDescription className="text-[13px]">{t("leadV2")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <GeometryOverlay source={source} variant="full" showLines={geometry !== null} />
          <ul className="grid grid-cols-3 gap-2" aria-label={tv("takenAria")}>
            {takenList.map((v) => {
              const c = captures[v.key]!;
              return (
                <li key={v.key} className="relative">
                  <Thumb result={c} />
                  <span className="mt-1 block truncate text-center text-[11px] font-medium">{tv(`${v.key}.name`)}</span>
                  <button
                    type="button"
                    onClick={() => remove(v.key)}
                    aria-label={tv("removeAria", { name: tv(`${v.key}.name`) })}
                    className="absolute -top-1.5 -right-1.5 grid size-7 place-items-center rounded-full border bg-background text-muted-foreground shadow-card hover:text-foreground"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
            {addable.length > 0 ? (
              <li>
                <button
                  type="button"
                  onClick={() => setOptionalOpen((o) => !o)}
                  aria-expanded={optionalOpen}
                  className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed bg-muted/40 text-xs font-semibold text-brand hover:bg-accent"
                >
                  <Plus className="size-5" aria-hidden="true" />
                  {tv("addOptional")}
                </button>
                <span className="mt-1 block text-center text-[10px] text-muted-foreground">{tv("optionalLabel")}</span>
              </li>
            ) : null}
          </ul>
          {optionalOpen && addable.length > 0 ? (
            <ul className="space-y-1.5 rounded-xl border bg-muted/40 p-2">
              {addable.map((v) => (
                <li key={v}>
                  <button
                    type="button"
                    onClick={() => {
                      setOptionalOpen(false);
                      setStep({ kind: "capture", view: v, required: false });
                    }}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm hover:bg-accent"
                  >
                    <span className="font-semibold">{tv(`${v}.name`)}</span>
                    <span className="text-[11px] text-muted-foreground">{tv.has(`${v}.optionalNote`) ? tv(`${v}.optionalNote`) : tv("optionalLabel")}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {quality ? (
            <ul className="flex flex-wrap gap-1.5" aria-label={t("qualityAria")}>
              {(["light", "sharpness", "framing"] as const).map((k) => (
                <li key={k} className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[11px] font-medium">
                  <span aria-hidden="true" className={cn("size-1.5 rounded-full", quality[k] === "good" ? "bg-success" : "bg-warn")} />
                  {t(`quality.${k}.${quality[k]}`)}
                </li>
              ))}
              {front?.source === "gallery" ? (
                <li className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[11px] font-medium">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-info" />
                  {t("fromGallery")}
                </li>
              ) : null}
            </ul>
          ) : null}
          {geometry ? (
            <div className="flex items-center gap-3 rounded-xl border bg-muted/40 px-3.5 py-3">
              <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl bg-brand-soft text-brand">
                <ScanFace className="size-5" />
              </span>
              <p className="min-w-0 flex-1">
                <span className="eyebrow block">{tg("faceShapePrelim")}</span>
                <strong className="text-lg font-bold tracking-tight">{tg(`shapes.${geometry.faceShape.primary}`)}</strong>
                {geometry.faceShape.secondary ? (
                  <span className="block text-xs text-muted-foreground">{tg("nearTo", { other: tg(`shapes.${geometry.faceShape.secondary}`) })}</span>
                ) : null}
              </p>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
              {tg("computing")}
            </p>
          )}
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border bg-muted/40 p-3 text-[13px]">
            <Checkbox checked={saveProgress} onCheckedChange={(v) => setSaveProgress(v === true)} className="mt-0.5 size-5" />
            <span>
              <span className="font-semibold">{t("saveProgress")}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{t("saveProgressHint")}</span>
            </span>
          </label>
          {error ? (
            <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-dashed p-3 text-sm">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warn" />
              <span>
                {ta.has(`errors.${error.code}`) ? ta(`errors.${error.code}`) : ta("errors.GENERIC")}
                {error.retryAt ? ` ${ta("retryAt", { date: new Date(error.retryAt).toLocaleString("tr-TR") })}` : ""}
              </span>
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="outline" size="lg" className="flex-1" onClick={() => setStep({ kind: "capture", view: "front", required: true })}>
              {t("retake")}
            </Button>
            <Button size="lg" className="flex-[1.4]" disabled={startDisabled} onClick={() => geometry && void runDeviceAnalysis(geometry)}>
              {ta("start")}
            </Button>
          </div>
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="mt-px size-3.5 shrink-0 text-brand" />
            <span>{t("sendNoteV2")}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** Çekilen açının küçük önizlemesi: bellekteki bitmap tuvale çizilir; toDataURL/indirme yok. */
function Thumb({ result }: { result: CaptureResult }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { bitmap, width, height } = result.image;
    const side = Math.min(width, height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = 120 * dpr;
    canvas.height = 120 * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx || bitmap.width === 0) return;
    ctx.drawImage(bitmap, (width - side) / 2, (height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    return () => {
      canvas.width = 0;
    };
  }, [result]);
  return (
    <span className="relative block aspect-square w-full overflow-hidden rounded-xl border bg-muted">
      <canvas ref={ref} className="block size-full" aria-hidden="true" />
      <span className="absolute right-1 bottom-1 grid size-5 place-items-center rounded-full bg-success text-white" aria-hidden="true">
        <Check className="size-3" strokeWidth={3} />
      </span>
    </span>
  );
}
