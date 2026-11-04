"use client";

import { Camera, Crop, RotateCcw, ScanFace, ServerOff, ShieldCheck, Smartphone, Sparkles, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { getPreset } from "@/content/presets";
import { SelfieCamera, type CaptureResult } from "@/components/camera/SelfieCamera";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { track } from "@/lib/analytics";
import { APP_NAME } from "@/lib/config/app";
import { ApiClientError, postJson } from "@/lib/api/client";
import { blobToBase64 } from "@/lib/api/analysisClient";
import { VisionClient } from "@/lib/face/client";
import { cropForServer, landmarksToCrop } from "@/lib/face/crop";
import { IDX } from "@/lib/face/indices";
import { getSessionSelfie, setSessionSelfie } from "@/lib/face/sessionStore";
import { renderTryonShareImage, shareOrDownload } from "@/lib/share/card";
import { base64ToBlob } from "@/lib/tryon/base64";
import { presetNames, resolvePresets } from "@/lib/tryon/combo";
import { driftPolicyForPresets } from "@/lib/tryon/composite";
import { GLOW_UP_LAYERS, TRYON_MODES, maskRegionFor, type GlowUpLayer, type TryonMode, type TryonPresets, type TryonResultV2 } from "@/lib/tryon/types";
import { ComboPicker } from "./ComboPicker";
import { GlowUpPanel } from "./GlowUpPanel";
import { QcFailedCard } from "./QcFailedCard";
import { TryonResult, type TryonResultView } from "./TryonResult";
import { stepTitle, type PlanStepLite } from "./stepTitles";

type Props = {
  consentVersion: string;
  hasConsent: boolean;
  recommended: string[];
  quota: { used: number; limit: number; nextAt: string | null };
  initialPreset?: string;
  /** Derin bağlantı (`/dene?mode=glow_up`): bayrakla kapalı mod istenirse tek stile düşer. */
  initialMode?: TryonMode;
  presentation: "male" | "female" | "unspecified";
  /** Glow-up bağı: en son analiz (yoksa glow-up kapalı görünür). */
  analysisId: string | null;
  /** Plandan gelen adımlar (W4 plan_v2); boşsa sunucu katalogdan seçer. */
  planSteps: PlanStepLite[];
  flags: { combo: boolean; glowUp: boolean };
};

type Stage = "gallery" | "camera" | "generating" | "result" | "qc_failed";
type RunRequest = { mode: TryonMode; presets: TryonPresets; layers: GlowUpLayer[]; title: string };

const CROP_SIZE = 1024;
const nowMs = () => performance.now();
const epochNow = () => Date.now();

/**
 * /dene v2 (F11; KB §7; PLAN 5a–5e): mod (tek stil · kombin · iyileşmiş halin) → (rıza) → selfie bellekte → POST /api/tryon
 * (Claude kalite kontrolü sunucuda; geçmeyen görsel hiç gelmez, hak düşmez) → worker kompoziti (yüz orijinal piksellerle,
 * glow-up'ta doku kapısı) → gözlere hizalı önce/sonra → paylaş (etiket gömülü) / "Bozuk görünüyor".
 */
export function TryonScreen({ consentVersion, hasConsent, recommended, quota, initialPreset, initialMode, presentation, analysisId, planSteps, flags }: Props) {
  const t = useTranslations("tryon");
  const tc = useTranslations("common");
  const modes = TRYON_MODES.filter((m) => (m === "combo" ? flags.combo : m === "glow_up" ? flags.glowUp : true));
  const [consent, setConsent] = useState(hasConsent);
  const [mode, setMode] = useState<TryonMode>(() => (initialMode && modes.includes(initialMode) ? initialMode : "style"));
  const [stage, setStage] = useState<Stage>("gallery");
  const [picked, setPicked] = useState<TryonPresets>(() => {
    const p = initialPreset ? getPreset(initialPreset) : undefined;
    return p ? { [p.kind]: p.id } : {};
  });
  const [layers, setLayers] = useState<GlowUpLayer[]>([...GLOW_UP_LAYERS]);
  const [pending, setPending] = useState<RunRequest | null>(null);
  const [used, setUsed] = useState(quota.used);
  const [result, setResult] = useState<(TryonResultView & { afterBitmap: ImageBitmap }) | null>(null);
  const [slider, setSlider] = useState(50);
  const [flagged, setFlagged] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);

  async function giveConsent() {
    try {
      await postJson("/api/consents", { type: "tryon_generation", granted: true, textVersion: consentVersion });
      track("consent_updated", { type: "tryon_generation", granted: true });
      setConsent(true);
    } catch {
      toast.error(t("consentError"));
    }
  }

  function start(req: RunRequest) {
    setPending(req);
    setError(null);
    if (!getSessionSelfie()) {
      setStage("camera");
      return;
    }
    void run(req);
  }

  function startStyleOrCombo() {
    const resolved = resolvePresets(picked);
    start({ mode, presets: picked, layers: [], title: presetNames(resolved) });
  }

  function startGlowUp() {
    track("glowup_viewed");
    start({ mode: "glow_up", presets: {}, layers, title: t("v2.glowUp.title") });
  }

  async function onCaptured(r: CaptureResult) {
    if (!r.final.landmarks) return;
    setSessionSelfie({
      bitmap: await createImageBitmap(r.image.bitmap),
      width: r.image.width,
      height: r.image.height,
      landmarks: r.final.landmarks.map((p) => ({ x: p.x * r.image.width, y: p.y * r.image.height })),
      capturedAt: epochNow(),
    });
    r.image.bitmap.close();
    if (pending) void run(pending);
    else setStage("gallery");
  }

  async function run(req: RunRequest) {
    const selfie = getSessionSelfie();
    if (!selfie) return;
    setStage("generating");
    setElapsed(0);
    const start = nowMs();
    timerRef.current = window.setInterval(() => setElapsed(Math.round((nowMs() - start) / 1000)), 1000);
    if (req.mode === "combo") track("tryon_combo_started");
    else if (req.mode === "style") {
      const kind = (["hair", "beard", "color"] as const).find((k) => req.presets[k]);
      if (kind) track("tryon_started", { presetKind: kind });
    }
    let eventId: string | null = null;
    try {
      // 1024 px kare kırpım C + kırpım uzayında landmark'lar (SPEC 10.3 adım 4); görsel yalnız /api/tryon'a gider.
      const { blob, box } = await cropForServer(selfie.bitmap, selfie.landmarks, CROP_SIZE);
      const landmarksC = landmarksToCrop(selfie.landmarks, box, CROP_SIZE);
      const c = await createImageBitmap(blob);
      const body = {
        clientRequestId: crypto.randomUUID(),
        mode: req.mode,
        ...(req.mode === "glow_up" ? { analysisId, layers: req.layers } : { presets: req.presets }),
        image: await blobToBase64(blob),
      };
      const res = await postJson<TryonResultV2>("/api/tryon", body);
      if (!res) throw new Error("empty");
      eventId = res.eventId;
      const gBlob = base64ToBlob(res.image, res.mimeType); // fetch("data:") CSP tarafından engellenir
      const g = await createImageBitmap(gBlob);
      const protect = maskRegionFor(res.mode, res.presets);
      const out = await VisionClient.get().tryon(c, g, landmarksC, protect, driftPolicyForPresets(res.presets), res.mode === "glow_up");
      if (!out.ok) {
        console.warn("[tryon] kontrol başarısız:", out.reason); // yalnız neden kodu; görsel/nokta yok
        await postJson(`/api/tryon/${eventId}/drift`, {}).catch(() => undefined);
        track("tryon_result", { status: "identity_drift", durationMs: Math.round(nowMs() - start) });
        setError(t("driftMessage"));
        setStage("gallery");
        return;
      }
      const beforeUrl = URL.createObjectURL(blob);
      const afterBlob = await bitmapToBlob(out.image);
      const eyeY = (landmarksC[IDX.irisR].y + landmarksC[IDX.irisL].y) / 2 / CROP_SIZE;
      const title = res.mode === "glow_up" ? req.title : presetNames(resolvePresets(res.presets)) || req.title;
      setResult({
        eventId,
        mode: res.mode,
        title,
        beforeUrl,
        afterUrl: URL.createObjectURL(afterBlob),
        afterBitmap: out.image,
        eyeLineY: res.mode === "glow_up" ? eyeY : null,
        appliedSteps: res.appliedStepIds.map((id) => ({ id, title: stepTitle(id, planSteps) })),
        qc: res.qc,
        regenCount: res.regenCount,
      });
      setFlagged(false);
      setSlider(50);
      setUsed((u) => u + 1);
      track("tryon_result", { status: "success", durationMs: Math.round(nowMs() - start) });
      setStage("result");
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : "NETWORK";
      track("tryon_result", { status: code, durationMs: Math.round(nowMs() - start) });
      if (code === "TRYON_QC_FAILED") {
        track("tryon_qc_failed");
        setStage("qc_failed");
        return;
      }
      setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t.has(`v2.errors.${code}`) ? t(`v2.errors.${code}`) : t("errors.GENERIC"));
      setStage("gallery");
    } finally {
      window.clearInterval(timerRef.current);
    }
  }

  async function share() {
    if (!result) return;
    setSharing(true);
    try {
      const blob = await renderTryonShareImage({ after: result.afterBitmap, label: tc("aiGenerated"), title: result.title, appName: APP_NAME });
      const how = await shareOrDownload(blob, `aura-deneme-${result.eventId.slice(0, 8)}.jpg`, result.title);
      toast.success(how === "shared" ? t("v2.result.shared") : t("v2.result.downloaded"));
    } catch {
      toast.error(t("v2.result.shareError"));
    } finally {
      setSharing(false);
    }
  }

  async function flagBroken() {
    if (!result || flagged) return;
    try {
      await postJson(`/api/tryon/${result.eventId}/flag`, {});
      setFlagged(true);
      track("tryon_flagged_broken");
      toast.success(t("v2.flagBrokenThanks"));
    } catch {
      toast.error(t("errors.GENERIC"));
    }
  }

  function back() {
    if (result) {
      URL.revokeObjectURL(result.beforeUrl);
      URL.revokeObjectURL(result.afterUrl);
      result.afterBitmap.close();
    }
    setResult(null);
    setStage("gallery");
  }

  if (!consent) {
    return (
      <Card className="bg-hero-glow">
        <CardHeader>
          <span aria-hidden="true" className="mb-1 grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
            <ShieldCheck className="size-6" />
          </span>
          <p className="eyebrow">{t("consent.eyebrow")}</p>
          <CardTitle className="text-xl font-bold">{t("consent.title")}</CardTitle>
          <CardDescription className="text-[13px]">{t("consent.body")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2.5">
            {CONSENT_POINTS.map(({ k, icon: Icon }) => (
              <li key={k} className="flex items-start gap-3 text-[13px] leading-relaxed">
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Icon className="size-4" />
                </span>
                <span className="pt-1">{t(`consent.${k}`)}</span>
              </li>
            ))}
          </ul>
          <Button className="w-full" size="lg" onClick={giveConsent}>{t("consent.accept")}</Button>
        </CardContent>
      </Card>
    );
  }

  if (stage === "camera") {
    return (
      <div className="space-y-3">
        <p className="flex gap-3 rounded-2xl border border-dashed p-4 text-[13px] leading-relaxed text-muted-foreground">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <Camera className="size-4" />
          </span>
          <span>{t("needSelfie")}</span>
        </p>
        <SelfieCamera onCapture={(r) => void onCaptured(r)} />
        <Button variant="ghost" className="w-full" onClick={() => setStage("gallery")}>{t("back")}</Button>
      </div>
    );
  }

  if (stage === "generating") {
    const title = pending?.mode === "combo" ? t("v2.generatingCombo") : pending?.mode === "glow_up" ? t("v2.generatingGlowUp") : t("generating.title", { name: pending?.title ?? "" });
    return <TryonGenerating title={title} elapsed={elapsed} />;
  }

  if (stage === "qc_failed") return <QcFailedCard onBack={back} />;

  if (stage === "result" && result) {
    return <TryonResult result={result} slider={slider} onSlider={setSlider} onShare={share} onFlag={flagBroken} flagged={flagged} onBack={back} sharing={sharing} />;
  }

  const remaining = Math.max(0, quota.limit - used);
  return (
    <div className="space-y-4">
      <QuotaBar remaining={remaining} limit={quota.limit} nextAt={quota.nextAt} />
      {error ? (
        <div role="alert" className="flex gap-3 rounded-2xl border border-dashed p-4">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-xl bg-warn/12 text-warn">
            <RotateCcw className="size-4" />
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-medium">{error}</p>
            {pending && remaining > 0 ? (
              <Button size="sm" variant="outline" className="h-11 rounded-xl" onClick={() => start(pending)}>
                {t("retry")} · {pending.title}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <Tabs value={mode} onValueChange={(v) => { setMode(v as TryonMode); setPicked({}); }}>
        <TabsList className="w-full rounded-xl p-1 group-data-[orientation=horizontal]/tabs:h-11">
          {modes.map((m) => (
            <TabsTrigger key={m} value={m} className="flex-1 rounded-lg text-[13px]">{t(`v2.modes.${m}`)}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <p className="text-[12px] text-muted-foreground">{t(`v2.modeHint.${mode}`)}</p>
      {mode === "glow_up" ? (
        <GlowUpPanel layers={layers} onChange={setLayers} onRun={startGlowUp} planSteps={planSteps} hasAnalysis={Boolean(analysisId)} disabled={remaining === 0} />
      ) : (
        <ComboPicker mode={mode} value={picked} onChange={setPicked} onRun={startStyleOrCombo} recommended={recommended} presentation={presentation} disabled={remaining === 0} />
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">{mode === "glow_up" ? t("v2.glowUp.skinNote") : t("galleryNote")} {t("v2.aiLabelNote")}</p>
    </div>
  );
}

const CONSENT_POINTS: { k: "b1" | "b2" | "b3" | "b4"; icon: LucideIcon }[] = [
  { k: "b1", icon: Crop },
  { k: "b2", icon: ServerOff },
  { k: "b3", icon: ScanFace },
  { k: "b4", icon: Smartphone },
];

/** Kalan hak çubuğu (sunum). */
export function QuotaBar({ remaining, limit, nextAt }: { remaining: number; limit: number; nextAt: string | null }) {
  const t = useTranslations("tryon");
  return (
    <div className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-card">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="eyebrow">{t("remainingLabel")}</p>
        <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-track">
          <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${limit ? (remaining / limit) * 100 : 0}%` }} />
        </div>
        {remaining === 0 && nextAt ? <p className="text-[11px] text-muted-foreground">{t("nextAt", { date: new Date(nextAt).toLocaleDateString("tr-TR") })}</p> : null}
      </div>
      <p className="num shrink-0 text-right" aria-label={t("remaining", { n: remaining, limit })}>
        <span aria-hidden="true" className="text-3xl font-bold text-brand-gradient">{remaining}</span>
        <span aria-hidden="true" className="text-sm text-muted-foreground"> / {limit}</span>
      </p>
    </div>
  );
}

/** Üretim bekleme kartı (sunum; süre üst bileşenden gelir). */
export function TryonGenerating({ title, elapsed }: { title: string; elapsed: number }) {
  const t = useTranslations("tryon");
  return (
    <Card className="bg-hero-glow">
      <CardContent className="flex flex-col items-center gap-4 py-4 text-center">
        <div aria-hidden="true" className="relative grid size-28 place-items-center">
          <svg viewBox="0 0 100 100" className="absolute inset-0 size-full motion-safe:animate-spin [animation-duration:1.6s]">
            <defs>
              <linearGradient id="tryon-arc" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--brand-from)" />
                <stop offset="100%" stopColor="var(--brand-to)" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="44" fill="none" stroke="var(--track)" strokeWidth="6" />
            <circle cx="50" cy="50" r="44" fill="none" stroke="url(#tryon-arc)" strokeWidth="6" strokeLinecap="round" strokeDasharray="90 190" />
          </svg>
          <Sparkles className="size-9 text-brand" />
        </div>
        <div role="status" aria-live="polite" className="space-y-1.5">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-[13px] text-muted-foreground">{elapsed > 45 ? t("generating.slow") : elapsed > 12 ? t("v2.qc.checking") : t("generating.body")}</p>
        </div>
        <p className="num inline-flex h-7 items-center rounded-full bg-muted px-3 text-xs font-semibold text-muted-foreground">
          {t("generating.elapsed", { s: elapsed })}
        </p>
      </CardContent>
    </Card>
  );
}

async function bitmapToBlob(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
}
