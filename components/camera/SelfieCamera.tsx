"use client";

import { ArrowUpRight, Camera, CameraOff, ChevronDown, CircleCheck, ImageUp, Images, LoaderCircle, RotateCcw, Scale, ScanFace, Send, ShieldCheck, Smartphone, Smile, Sun, TriangleAlert, User } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { QualityPrompt } from "@/components/camera/QualityPrompt";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { track } from "@/lib/analytics";
import { VisionClient } from "@/lib/face/client";
import { sha256Hex } from "@/lib/face/hash";
import { eulerFromMatrix } from "@/lib/face/pose";
import { PreprocessError, loadImageFile, resizeToAnalysis, type LoadedImage } from "@/lib/face/preprocess";
import { GALLERY_QUALITY_CONFIG, MANUAL_QUALITY_CONFIG, QUALITY_CONFIG, checkQuality, lenientReview, manualOfferReady, sideViewReview, type HardIssue, type QualityIssue, type QualityReport } from "@/lib/face/quality";
import type { FrameAnalysis } from "@/lib/face/types";
import { PROFILE_VIEWS, VIEW_BY_KEY, classifyView, type ViewKey, type ViewSpec } from "@/lib/face/views";
import { cn } from "@/lib/utils";

export type CaptureResult = {
  /** Hangi açı (KB P#4). Galeri çoklu seçimde yaw'dan sınıflanır. */
  view: ViewKey;
  /** Analiz kopyası (uzun kenar ≤ 1280). Kullanıcı sonucu bırakınca close() çağrılır. */
  image: LoadedImage;
  /** Son karenin analizi (ham noktalar dahil; yalnız bellekte). Yan görünümde yüz bulunmamış olabilir. */
  final: FrameAnalysis;
  /** Çekimden önceki en fazla 5 geçerli canlı kare (SPEC 7.5 medyan için; yalnız ön). */
  recentFrames: FrameAnalysis[];
  quality: QualityReport;
  source: "camera" | "gallery";
  /** Uyarı listesi (KB: ret yerine uyarı); kullanıcı pop-up'ta "Evet" dediyse boş olmayan listeyle devam edilir. */
  warnings: QualityIssue[];
  /** Elle çekim ("Şimdi çek") veya uyarıyla devam. Yalnız saklanan üst veri; skoru değiştirmez (C7). */
  relaxed: boolean;
  /** Galeriden gelen orijinal dosyanın SHA-256'sı (set önbelleği, KB Ç11); kamerada null. */
  sourceHash: string | null;
};

type Stage = "guide" | "loading" | "live" | "countdown" | "processing" | "review" | "denied" | "model_error";

type Props = {
  /** Çekilecek açı (varsayılan ön). Ön: otomatik çekim + geometri; diğerleri: elle deklanşör, yalnız tek yüz kuralı. */
  view?: ViewSpec;
  /** "1 / 2 · Ön" gibi adım etiketi (çoklu açı akışı); yoksa gösterilmez. */
  stepLabel?: string;
  optionalNote?: string;
  onCapture: (r: CaptureResult) => void;
  /** Galeriden çoklu seçim (yalnız ön adımda): her dosya açısına göre yerleştirilir (KB R1-E5). */
  onGalleryBatch?: (items: CaptureResult[]) => void;
  /** Açı dolu olduğu için galeri toplu seçimde atlanacak görünümler. */
  takenViews?: readonly ViewKey[];
  /** Analiz akışında güven bloğundaki sağlayıcı adı; hukuki onaya kadar nötr "yapay zekâ" (UI spec §5.3).
   *  Verilmezse (ör. deneme ekranı) güven bloğu yerine eski kısa gizlilik notu gösterilir. */
  aiProviderName?: string;
  /** Adım geri/iptal (çoklu açı akışında). */
  onBack?: () => void;
  /** Zorunlu yan profil adımında genel "Yan profil" adı ve yönergesi (hangi yanak olduğu yaw'dan anlaşılır). */
  labels?: { name: string; instruction: string };
};

const TIP_ICONS = { light: Sun, neutral: Smile, frame: ScanFace, alone: User } as const;

async function fileHash(file: File): Promise<string | null> {
  try {
    return await sha256Hex(await file.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * SPEC 7 / KB §3.1: rehber → kamera (aynalı, oval kılavuz, tek satır uyarı) → 600 ms kararlı → 3-2-1 → çekim (ön);
 * yan görünümlerde elle deklanşör. Galeriden yükleme (ön adımda çoklu). Kötü ışık/bulanıklıkta ret yok, evet/hayır pop-up'ı.
 */
export function SelfieCamera({ view = VIEW_BY_KEY.front, stepLabel, optionalNote, onCapture, onGalleryBatch, takenViews = [], aiProviderName, onBack, labels }: Props) {
  const t = useTranslations("camera");
  const isFront = view.geometry;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number>(0);
  const busyRef = useRef(false);
  const lastRunRef = useRef(0);
  const stableSinceRef = useRef<number | null>(null);
  const recentRef = useRef<FrameAnalysis[]>([]);
  const stageRef = useRef<Stage>("guide");
  const attemptsRef = useRef(0);
  const countdownEndRef = useRef<number | null>(null);
  const liveStartedAtRef = useRef<number | null>(null);
  const manualOfferedRef = useRef(false);

  const [stage, setStageState] = useState<Stage>("guide");
  const [issue, setIssue] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [review, setReview] = useState<{ url: string; failed: HardIssue | null; result: CaptureResult | null; promptOpen: boolean } | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [manualOffered, setManualOffered] = useState(false);
  const [batchNote, setBatchNote] = useState<string | null>(null);

  const setStage = useCallback((s: Stage) => {
    stageRef.current = s;
    setStageState(s);
  }, []);

  // Model arka planda yüklenir (onboarding sırasında prefetch edilmiş olabilir).
  useEffect(() => {
    let cancelled = false;
    VisionClient.get()
      .init()
      .then(() => {
        if (!cancelled) setModelReady(true);
      })
      .catch(() => {
        if (!cancelled) setStage("model_error");
      });
    return () => {
      cancelled = true;
    };
  }, [setStage]);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  /** Canlı akışın kalıntılarını temizler: eski kareler galeri sonucuna veya yeni çekime karışmaz. */
  const resetLiveState = useCallback(() => {
    recentRef.current = [];
    stableSinceRef.current = null;
    countdownEndRef.current = null;
    liveStartedAtRef.current = null;
    manualOfferedRef.current = false;
    setManualOffered(false);
    setIssue(null);
    setWarning(null);
  }, []);

  /** Tek bir görüntüyü (kamera karesi ya da dosya) açıya göre denetler; sonucu döner (gösterim çağıranın işi). */
  const analyze = useCallback(
    async (bitmap: ImageBitmap, source: "camera" | "gallery", target: ViewKey, opts: { manual?: boolean; file?: File } = {}) => {
      const client = VisionClient.get();
      const image = await resizeToAnalysis(bitmap);
      const forWorker = await createImageBitmap(image.bitmap);
      const final = await client.detectImage(forWorker);
      const spec = VIEW_BY_KEY[target];
      const sourceHash = opts.file ? await fileHash(opts.file) : null;
      if (!spec.geometry) {
        // Profil adımında yüz ağı okunabildiyse hangi yanak olduğu yaw'dan alınır (sol/sağ etiketi); doğrulama değildir.
        if ((PROFILE_VIEWS as readonly ViewKey[]).includes(target) && final.faces === 1 && final.matrix) {
          const cls = classifyView(eulerFromMatrix(final.matrix).yaw);
          if (cls.view === "profile_left" || cls.view === "profile_right") target = cls.view;
        }
        const sv = sideViewReview(final, { allowNoFace: (PROFILE_VIEWS as readonly ViewKey[]).includes(target) });
        const report = checkQuality(final);
        return { image, final, failed: sv.hard, result: sv.hard ? null : ({ view: target, image, final, recentFrames: [], quality: report, source, warnings: [], relaxed: false, sourceHash } satisfies CaptureResult) };
      }
      // Ön: galeri/stüdyo yapılandırması; yalnız yüz yok / çok yüz engeller, kalan sorunlar uyarı (KB R1-E12/E14).
      const strict = checkQuality(final);
      const lr = lenientReview(final, GALLERY_QUALITY_CONFIG);
      if (opts.manual) track("capture_manual_used", { issue: strict.issues[0] ?? "none" });
      const manualOk = opts.manual ? checkQuality(final, MANUAL_QUALITY_CONFIG).passed : false;
      const warnings = manualOk ? [] : lr.warnings;
      return {
        image,
        final,
        failed: lr.hard,
        result: lr.hard
          ? null
          : ({ view: target, image, final, recentFrames: source === "gallery" ? [] : recentRef.current.slice(-5), quality: lr.report, source, warnings, relaxed: warnings.length > 0 || (opts.manual === true && !strict.passed), sourceHash } satisfies CaptureResult),
      };
    },
    [],
  );

  const finalizeCapture = useCallback(
    async (bitmap: ImageBitmap, source: "camera" | "gallery", opts: { manual?: boolean; file?: File } = {}) => {
      setStage("processing");
      let image: LoadedImage | null = null;
      try {
        const a = await analyze(bitmap, source, view.key, opts);
        image = a.image;
        const url = URL.createObjectURL(await bitmapToBlob(image.bitmap));
        attemptsRef.current++;
        if (a.result) {
          track("capture_succeeded", { attempts: attemptsRef.current });
          setReview({ url, failed: null, result: a.result, promptOpen: a.result.warnings.length > 0 });
        } else {
          track("capture_quality_failed", { reason: a.failed ?? "unknown" });
          image.bitmap.close();
          setReview({ url, failed: a.failed, result: null, promptOpen: false });
        }
        setStage("review");
      } catch {
        image?.bitmap.close();
        // Kamera bu noktada durdurulmuştur: canlı görünüme dönmek ölü bir önizleme bırakırdı.
        resetLiveState();
        setIssue(t("errors.processing"));
        setStage("guide");
      } finally {
        bitmap.close();
      }
    },
    [analyze, resetLiveState, setStage, t, view.key],
  );

  const loopRef = useRef<() => Promise<void>>(async () => {});
  const loop = useCallback(async () => {
    const video = videoRef.current;
    const stage = stageRef.current;
    if (!video || (stage !== "live" && stage !== "countdown")) return;
    const now = performance.now();
    const interval = 1000 / QUALITY_CONFIG.maxFps;
    if (!busyRef.current && now - lastRunRef.current >= interval && video.readyState >= 2) {
      busyRef.current = true;
      lastRunRef.current = now;
      try {
        const bitmap = await createImageBitmap(video);
        const frame = await VisionClient.get().detectVideo(bitmap, now);
        if (stageRef.current !== "live" && stageRef.current !== "countdown") return;
        if (!isFront) {
          // Yan görünüm: otomatik çekim yok (90°'de yüz ağı güvenilmez); yalnız "birden çok yüz" uyarısı.
          setIssue(frame.faces > 1 ? t("issues.multiple_faces") : null);
          return;
        }
        const report = checkQuality(frame);
        setIssue(report.issues[0] ? t(`issues.${report.issues[0]}`) : null);
        // 8 sn sonra yalnız yumuşak sorunlar kaldıysa "Şimdi çek" (canlı akış bitene kadar kalır).
        if (!manualOfferedRef.current && liveStartedAtRef.current !== null && manualOfferReady(frame, now - liveStartedAtRef.current)) {
          manualOfferedRef.current = true;
          setManualOffered(true);
          track("capture_manual_offered");
        }
        setWarning(report.warnings[0] ? t(`warnings.${report.warnings[0]}`) : null);
        if (report.passed) {
          recentRef.current = [...recentRef.current.slice(-4), frame];
          stableSinceRef.current ??= now;
          if (stageRef.current === "live" && now - stableSinceRef.current >= QUALITY_CONFIG.stableMs) {
            countdownEndRef.current = now + QUALITY_CONFIG.countdownSeconds * 1000;
            setStage("countdown");
          }
          if (stageRef.current === "countdown" && countdownEndRef.current !== null) {
            const remaining = Math.ceil((countdownEndRef.current - now) / 1000);
            setCountdown(Math.max(remaining, 0));
            if (now >= countdownEndRef.current) {
              countdownEndRef.current = null;
              stableSinceRef.current = null;
              const full = await createImageBitmap(video);
              stopCamera();
              await finalizeCapture(full, "camera");
              return;
            }
          }
        } else {
          stableSinceRef.current = null;
          recentRef.current = [];
          if (stageRef.current === "countdown") {
            countdownEndRef.current = null;
            setStage("live");
          }
        }
      } catch {
        // kare atlandı
      } finally {
        busyRef.current = false;
      }
    }
    rafRef.current = requestAnimationFrame(() => void loopRef.current());
  }, [finalizeCapture, isFront, setStage, stopCamera, t]);
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  async function startCamera() {
    track("capture_started", { source: "camera" });
    setStage("loading");
    try {
      await VisionClient.get().init();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      resetLiveState();
      liveStartedAtRef.current = performance.now();
      setStage("live");
      rafRef.current = requestAnimationFrame(() => void loopRef.current());
    } catch (err) {
      stopCamera();
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError") {
        setStage("denied");
      } else {
        setStage("model_error");
      }
    }
  }

  async function onFiles(list: FileList | null) {
    resetLiveState();
    setBatchNote(null);
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    track("capture_started", { source: "gallery" });
    setStage("loading");
    try {
      await VisionClient.get().init();
      if (files.length === 1 || !onGalleryBatch) {
        const loaded = await loadImageFile(files[0]);
        await finalizeCapture(loaded.bitmap, "gallery", { file: files[0] });
        return;
      }
      // Çoklu seçim (KB R1-E5): her dosya yaw'a göre sınıflanır; sınıflanamayan bu adımın açısına gider (boşsa).
      setStage("processing");
      const taken = new Set<ViewKey>(takenViews);
      const items: CaptureResult[] = [];
      let assigned = 0;
      for (const file of files) {
        let loaded: LoadedImage | null = null;
        try {
          loaded = await loadImageFile(file);
          const probe = await VisionClient.get().detectImage(await createImageBitmap(loaded.bitmap));
          const cls = probe.landmarks && probe.faces === 1 && probe.matrix ? classifyView(eulerFromMatrix(probe.matrix).yaw) : { view: null as null, reason: "invalid" as const };
          let target: ViewKey | null = cls.view;
          if (target === null || taken.has(target)) target = taken.has(view.key) ? null : view.key;
          if (target === null) continue;
          const a = await analyze(loaded.bitmap, "gallery", target, { file });
          if (a.result) {
            taken.add(target);
            items.push(a.result);
            assigned++;
          } else {
            a.image.bitmap.close();
          }
        } catch {
          // bu dosya atlanır
        } finally {
          loaded?.bitmap.close();
        }
      }
      track("capture_gallery_batch", { selected: files.length, assigned });
      if (items.length === 0) {
        setIssue(t("gallery.noneAssigned"));
        setStage("guide");
        return;
      }
      if (assigned < files.length) setBatchNote(t("gallery.someSkipped", { assigned, selected: files.length }));
      setStage("guide");
      onGalleryBatch(items);
    } catch (err) {
      if (err instanceof PreprocessError) setIssue(t(`errors.${err.code}`));
      else setIssue(t("errors.processing"));
      setStage("guide");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function retake() {
    if (review) URL.revokeObjectURL(review.url);
    review?.result?.image.bitmap.close();
    setReview(null);
    resetLiveState();
    setStage("guide");
  }

  /** Elle çekim: ön adımda "Şimdi çek" (gevşek eşikler), yan adımlarda deklanşör. */
  async function captureNow() {
    const video = videoRef.current;
    if (!video || (stageRef.current !== "live" && stageRef.current !== "countdown")) return;
    setStage("processing");
    let full: ImageBitmap;
    try {
      full = await createImageBitmap(video);
    } catch {
      stopCamera();
      resetLiveState();
      setIssue(t("errors.processing"));
      setStage("guide");
      return;
    }
    stopCamera();
    await finalizeCapture(full, "camera", { manual: isFront });
  }

  function useResult() {
    if (!review?.result) return;
    const r = review.result;
    URL.revokeObjectURL(review.url);
    setReview(null);
    track("capture_view_captured", { view: r.view, source: r.source });
    onCapture(r);
  }

  const multiple = isFront && Boolean(onGalleryBatch);
  const fileInput = (
    <input ref={fileRef} type="file" accept="image/*" multiple={multiple} className="hidden" onChange={(e) => void onFiles(e.target.files)} />
  );

  const viewName = labels?.name ?? t(`views.${view.key}.name`);
  const instruction = labels?.instruction ?? t(`views.${view.key}.instruction`);

  if (stage === "review" && review) {
    const ok = Boolean(review.result);
    const warn = review.result?.warnings[0];
    return (
      <Card className="bg-hero-glow">
        <CardHeader className="text-center">
          {stepLabel ? <p className="eyebrow">{stepLabel}</p> : null}
          <span
            aria-hidden="true"
            className={cn("mx-auto mb-1 grid size-12 place-items-center rounded-2xl", ok ? "bg-brand-soft text-brand" : "bg-warn/12 text-warn")}
          >
            {ok ? <CircleCheck className="size-6" /> : <TriangleAlert className="size-6" />}
          </span>
          <CardTitle className="text-xl font-bold">{ok ? t("review.okTitle") : t("review.failTitle")}</CardTitle>
          <CardDescription>{ok ? t("review.okBody") : t(`issues.${review.failed ?? "no_face"}`)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- yerel blob, next/image uygun değil */}
          <img src={review.url} alt="" className="mx-auto max-h-[50dvh] rounded-2xl border shadow-card" />
          {warn ? (
            <p className="flex gap-2.5 rounded-xl border border-dashed p-3 text-[13px] text-muted-foreground">
              <Sun aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warn" />
              <span>
                {t(`issues.${warn}`)} · {t("review.relaxedNote")}
              </span>
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button variant={ok ? "outline" : "default"} size="lg" className="flex-1" onClick={retake}>
              <RotateCcw aria-hidden="true" /> {t("review.retake")}
            </Button>
            {ok ? (
              <Button size="lg" className="flex-1" onClick={useResult}>
                {t("review.use")}
              </Button>
            ) : null}
          </div>
        </CardContent>
        <QualityPrompt open={review.promptOpen} onYes={() => setReview((r) => (r ? { ...r, promptOpen: false } : r))} onNo={retake} />
      </Card>
    );
  }

  // Güven bloğu (UI spec §5.1): ekstra dokunma yok; "Kamerayı aç" kartın ilk düğmesi kalır.
  const trust =
    aiProviderName === undefined ? (
      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="mt-px size-3.5 shrink-0 text-brand" />
        <span>{t("guide.privacy")}</span>
      </p>
    ) : (
      <section aria-labelledby="camera-trust-title" className="space-y-2.5 rounded-xl border bg-muted/40 p-3.5">
        <h3 id="camera-trust-title" className="flex items-center gap-2 text-[13px] font-semibold">
          <ShieldCheck aria-hidden="true" className="size-4 text-brand" />
          {t("trust.title")}
        </h3>
        <ul className="space-y-2 text-[13px] leading-snug text-muted-foreground">
          {(
            [
              [Smartphone, t("trust.deviceShort")],
              [Send, t("trust.sentShort", { provider: aiProviderName })],
              [Scale, t("trust.limitsShort")],
            ] as const
          ).map(([Icon, text]) => (
            <li key={text} className="flex items-start gap-2.5">
              <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                <Icon className="size-3.5" />
              </span>
              <span className="pt-0.5">{text}</span>
            </li>
          ))}
        </ul>
      </section>
    );

  if (stage === "guide" || stage === "denied" || stage === "model_error") {
    const title = stage === "denied" ? t("denied.title") : stage === "model_error" ? t("modelError.title") : isFront ? t("guide.title") : viewName;
    const body = stage === "denied" ? t("denied.body") : stage === "model_error" ? t("modelError.body") : instruction;
    return (
      <Card className="bg-hero-glow">
        <CardHeader className="items-center text-center">
          {stage === "guide" ? <FaceGuideArt side={!isFront} /> : (
            <span aria-hidden="true" className="mx-auto mb-1 grid size-14 place-items-center rounded-2xl bg-warn/12 text-warn">
              {stage === "denied" ? <CameraOff className="size-7" /> : <TriangleAlert className="size-7" />}
            </span>
          )}
          {stage === "guide" && stepLabel ? <p className="eyebrow">{stepLabel}</p> : null}
          <CardTitle className="text-2xl font-bold">{title}</CardTitle>
          <CardDescription className="text-[13px]">{body}</CardDescription>
          {stage === "guide" && optionalNote ? (
            <p className="mx-auto inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-[11px] font-semibold text-muted-foreground">{optionalNote}</p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {stage === "guide" && isFront ? (
            <ul className="grid grid-cols-2 gap-2">
              {(["light", "neutral", "frame", "alone"] as const).map((k, i) => {
                const Icon = TIP_ICONS[k];
                return (
                  <li
                    key={k}
                    className="flex min-h-14 items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 motion-safe:animate-fade-up"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                      <Icon className="size-4" />
                    </span>
                    <span className="text-[13px] leading-tight font-semibold">{t(`guide.tipsShort.${k}`)}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {stage === "guide" && isFront ? trust : null}
          {issue ? (
            <p role="status" className="flex items-start gap-2.5 rounded-xl border border-dashed p-3 text-sm">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warn" />
              <span>{issue}</span>
            </p>
          ) : null}
          {batchNote ? (
            <p role="status" className="rounded-xl border border-dashed p-3 text-[13px] text-muted-foreground">
              {batchNote}
            </p>
          ) : null}
          <div className="grid gap-2">
            {stage !== "denied" ? (
              <Button size="lg" onClick={startCamera} disabled={stage === "model_error"}>
                <Camera aria-hidden="true" /> {t("guide.open")}
              </Button>
            ) : null}
            <Button size="lg" variant={stage === "denied" ? "default" : "outline"} onClick={() => fileRef.current?.click()}>
              {multiple ? <Images aria-hidden="true" /> : <ImageUp aria-hidden="true" />} {multiple ? t("views.pickFromGallery") : t("guide.upload")}
            </Button>
            {stage === "model_error" ? (
              <Button variant="ghost" onClick={() => location.reload()}>
                {t("modelError.retry")}
              </Button>
            ) : null}
            {onBack ? (
              <Button variant="ghost" onClick={onBack}>
                {t("views.back")}
              </Button>
            ) : null}
          </div>
          {stage !== "guide" && isFront ? trust : null}
          {stage === "guide" && isFront ? (
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground">
                {t("guide.tipsMore")}
                <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
              </summary>
              <ul className="space-y-1.5 pb-1 text-[13px] leading-relaxed text-muted-foreground">
                <li>{t("guide.body")}</li>
                {(["light", "neutral", "frame", "alone"] as const).map((k) => (
                  <li key={k}>{t(`guide.tips.${k}`)}</li>
                ))}
                <li>{t("guide.tips.distance")}</li>
              </ul>
            </details>
          ) : null}
          {aiProviderName !== undefined && isFront ? (
            <Link
              href="/yontem?from=guide"
              className="-mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-brand underline-offset-4 hover:underline"
            >
              {t("trust.methodLink")}
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
            </Link>
          ) : null}
          {fileInput}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {stepLabel ? <p className="eyebrow text-center">{stepLabel}</p> : null}
      <div className="relative mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-3xl border bg-black shadow-card">
        <video ref={videoRef} playsInline muted autoPlay className="size-full -scale-x-100 object-cover" />
        <svg viewBox="0 0 300 400" className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
          <defs>
            <linearGradient id="oval-ok" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--brand-from)" />
              <stop offset="100%" stopColor="var(--brand-to)" />
            </linearGradient>
            <mask id="oval-cut">
              <rect width="300" height="400" fill="white" />
              <ellipse cx="150" cy="190" rx={isFront ? 105 : 115} ry="145" fill="black" />
            </mask>
          </defs>
          <rect width="300" height="400" fill="rgba(0,0,0,0.35)" mask="url(#oval-cut)" />
          <ellipse
            cx="150"
            cy="190"
            rx={isFront ? 105 : 115}
            ry="145"
            fill="none"
            stroke={issue || !isFront ? "rgba(255,255,255,0.7)" : "url(#oval-ok)"}
            strokeWidth={issue || !isFront ? 2.5 : 4}
            strokeDasharray={issue || !isFront ? "6 6" : undefined}
          />
        </svg>
        {stage === "countdown" ? (
          <div className="absolute inset-0 flex items-center justify-center" aria-live="assertive">
            <span className="num text-display font-bold text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.5)]">{countdown || 1}</span>
          </div>
        ) : null}
        {stage === "loading" || stage === "processing" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-sm font-medium text-white">
            <LoaderCircle aria-hidden="true" className="size-8 motion-safe:animate-spin" />
            {stage === "loading" ? (modelReady ? t("live.startingCamera") : t("live.loadingModel")) : t("live.processing")}
          </div>
        ) : null}
        <p
          role="status"
          aria-live="polite"
          className="absolute inset-x-4 bottom-4 flex min-h-11 items-center justify-center gap-2 rounded-full bg-black/60 px-4 text-center text-sm font-semibold text-white backdrop-blur-md"
        >
          <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", issue ? "bg-warn" : "bg-success")} />
          {issue ?? warning ?? (stage === "countdown" ? t("live.holdStill") : isFront ? t("live.ready") : instruction)}
        </p>
      </div>
      {(manualOffered || !isFront) && (stage === "live" || stage === "countdown") ? (
        <div className="space-y-1.5 text-center">
          <Button size="lg" className="w-full max-w-sm" onClick={() => void captureNow()} disabled={Boolean(issue) && !isFront}>
            <Camera aria-hidden="true" /> {isFront ? t("live.manual") : t("live.shutter")}
          </Button>
          <p className="mx-auto max-w-sm text-[11px] leading-relaxed text-muted-foreground">{isFront ? t("live.manualHint") : t("live.sideHint")}</p>
        </div>
      ) : null}
      <div className="flex justify-center gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            stopCamera();
            resetLiveState();
            setStage("guide");
          }}
        >
          {t("live.cancel")}
        </Button>
        <Button variant="ghost" onClick={() => fileRef.current?.click()}>
          <ImageUp aria-hidden="true" /> {t("guide.upload")}
        </Button>
      </div>
      {fileInput}
    </div>
  );
}

/** Rehber ekranının görseli: marka gradyanlı oval kılavuz (dekoratif); yan görünümde profil ipucu. */
function FaceGuideArt({ side = false }: { side?: boolean }) {
  return (
    <div aria-hidden="true" className="relative mx-auto mb-2 grid size-28 place-items-center">
      <div className="absolute inset-2 rounded-full bg-brand-soft blur-xl" />
      <svg viewBox="0 0 100 120" className="relative h-28 w-24">
        <defs>
          <linearGradient id="guide-oval" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--brand-from)" />
            <stop offset="100%" stopColor="var(--brand-to)" />
          </linearGradient>
        </defs>
        {side ? (
          <path d="M62 10c-18 0-30 12-30 30 0 9 3 15 3 22l-8 8c-1 2 0 4 2 5l7 2v10c0 8 6 14 14 14h8c6 0 12-5 12-11V60c6-6 10-14 10-22 0-16-8-28-18-28z" fill="none" stroke="url(#guide-oval)" strokeWidth="3" strokeDasharray="10 7" strokeLinecap="round" />
        ) : (
          <ellipse cx="50" cy="60" rx="40" ry="54" fill="none" stroke="url(#guide-oval)" strokeWidth="3" strokeDasharray="10 7" strokeLinecap="round" />
        )}
      </svg>
      {side ? null : <ScanFace className="absolute size-10 text-brand" />}
    </div>
  );
}

async function bitmapToBlob(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
}
