import { File, Paths } from "expo-file-system";
import { Redirect, Stack, router, useLocalSearchParams, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { track } from "@/lib/analytics";
import { DEVICE_STEP_MIN_MS, finishDeviceProgress, markDeviceStep, startDeviceProgress, type DeviceProgress } from "@/lib/face/deviceProgress";
import { ghostOutlineFromLandmarks, type GhostOutline } from "@/lib/face/ghostGuide";
import type { GeometryResult } from "@/lib/face/types";
import { VIEW_BY_KEY, type ViewKey } from "@/lib/face/views";
import { CaptureSummary } from "@/mobile/src/components/capture/CaptureSummary";
import { DeviceProgressScreen } from "@/mobile/src/components/capture/DeviceProgressScreen";
import { ViewCamera } from "@/mobile/src/components/capture/ViewCamera";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { bindPendingSet, clearPendingSet, getLastGhost, setLastGhost, setPendingSet, type PendingView } from "@/mobile/src/features/capture/captureSession";
import { buildDeviceOnlyBody, viewsLabel } from "@/mobile/src/features/capture/payload";
import { landmarksPx, type CaptureResult } from "@/mobile/src/features/capture/result";
import { bindSessionSelfie, setSessionSelfie } from "@/mobile/src/features/capture/sessionSelfie";
import { uploadPendingSet } from "@/mobile/src/features/capture/upload";
import { canStartDevice, isProfileView, nextStep, orderedViews, placeViews, removeView, stepIndex, type CaptureSet, type FlowStep } from "@/mobile/src/features/capture/views";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { useGate } from "@/mobile/src/features/session/useGate";
import { ApiClientError } from "@/mobile/src/lib/api";
import { scoped } from "@/mobile/src/lib/i18n";
import { addProgressPhoto, getLatestGhost } from "@/mobile/src/lib/progressStore";
import { deleteQuietly } from "@/mobile/src/native/images";
import { useTheme } from "@/mobile/src/theme";

const tv = scoped("camera.views");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** "Analizin tamamlandı" gösterim süresi. */
const DONE_HOLD_MS = 900;

function newRequestId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Deneme (W7b /dene) için ön selfie'yi önbelleğe kopyalar; analiz gönderilmez. */
async function cacheSessionSelfie(front: CaptureResult, analysisId?: string): Promise<{ capturedAt: number; uri: string } | null> {
  const px = landmarksPx(front);
  if (!px) return null;
  try {
    const dest = new File(Paths.cache, "aura-session-selfie.jpg");
    if (dest.exists) dest.delete();
    await new File(front.image.uri).copy(dest);
    const capturedAt = Date.now();
    setSessionSelfie({ uri: dest.uri, width: front.image.width, height: front.image.height, landmarksPx: px, capturedAt, analysisId });
    return { capturedAt, uri: dest.uri };
  } catch {
    return null;
  }
}

/**
 * /tara (SPEC 7; KB §3.1/5–7; CONTRACTS_V2 §2.3; web components/camera/CaptureScreen.tsx karşılığı). Ön + yan profil
 * zorunlu; 45°×2, ikinci profil ve saç çizgisi isteğe bağlı; galeriden çoklu seçim. Cihaz analizi yalnız ön fotoğraftan.
 * "Analizi başlat": POST /api/analyses mode device_only — GÖRSEL GÖNDERİLMEZ, LLM çağrılmaz; set ödeme sonrası
 * POST /api/analyses/[id]/run için bellekte/önbellek dosyasında kalır. Hak zaten varsa set hemen gider.
 * `?analysis=<id>`: ödeme sonrası çekime dönüş (cihaz analizi yeniden yapılmaz). `?purpose=tryon`: W7b deneme selfie'si.
 */
export default function CaptureScreen() {
  const { aura } = useSession();
  const { colors } = useTheme();
  // Web (app)/(gated) layout karşılığı (PLAN 1a: "Giriş olmadan /tara açılmaz"): oturum / 18+ / onboarding kapısı.
  const gate = useGate();
  const { purpose, analysis: resumeParam } = useLocalSearchParams<{ purpose?: string; analysis?: string }>();
  const forTryon = purpose === "tryon";
  const resumeAnalysisId = typeof resumeParam === "string" && resumeParam.length > 0 ? resumeParam : null;
  const [captures, setCaptures] = useState<CaptureSet<CaptureResult>>({});
  const [step, setStep] = useState<FlowStep>(nextStep({}));
  const [phase, setPhase] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [progress, setProgress] = useState<DeviceProgress | null>(null);
  const [error, setError] = useState<{ code: string; retryAt?: string } | null>(null);
  const [saveProgress, setSaveProgress] = useState(false);
  const capturesRef = useRef<CaptureSet<CaptureResult>>({});
  const requestIdRef = useRef(newRequestId());
  /** Gönderim sırasında gösterilen ön kare: oturum selfie kopyası (kararlı yol; set dosyaları gönderim sonrası silinir). */
  const [heroUri, setHeroUri] = useState<string | null>(null);
  // Hayalet kılavuz (S3.3.4): bu oturumdaki son ön çekim; yoksa ilerleme dizinindeki en yeni kayıt (yalnız cihazda).
  const [ghost, setGhost] = useState<GhostOutline | null>(() => getLastGhost());
  useEffect(() => {
    if (ghost || forTryon) return;
    let active = true;
    void getLatestGhost()
      .then((g) => {
        if (!active || !g) return;
        setLastGhost(g);
        setGhost(g);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız ilk açılışta okunur
  }, []);

  const update = useCallback((next: CaptureSet<CaptureResult>) => {
    capturesRef.current = next;
    setCaptures(next);
  }, []);

  // Ayrılırken (sonuç ekranına geçiş hariç: set captureSession'a taşınmıştır) kullanılmayan geçici dosyalar silinir.
  useEffect(() => {
    return () => {
      for (const c of Object.values(capturesRef.current)) if (c) void deleteQuietly(c.image.uri);
    };
  }, []);

  /** Açıya yerleştirir; aynı açı yeniden çekildiyse eskisi silinir. Ön çekimde selfie önbelleğe ve hayalet çizgi belleğe. */
  async function place(items: CaptureResult[]) {
    const { set, replaced } = placeViews(capturesRef.current, items);
    for (const r of replaced) await deleteQuietly(r.image.uri);
    update(set);
    const fr = items.find((r) => r.view === "front");
    if (fr) {
      requestIdRef.current = newRequestId();
      setPhase("idle");
      setError(null);
      if (forTryon) {
        await cacheSessionSelfie(fr);
        router.back();
        return;
      }
    }
    setStep(nextStep(set));
  }

  async function remove(view: ViewKey) {
    const c = capturesRef.current[view];
    if (!c) return;
    await deleteQuietly(c.image.uri);
    const next = removeView(capturesRef.current, view);
    update(next);
    if (view === "front") setSessionSelfie(null);
    const n = nextStep(next);
    if (n.kind === "capture") setStep(n);
  }

  async function runDeviceAnalysis(front: CaptureResult, geometry: GeometryResult) {
    setPhase("submitting");
    setError(null);
    let s = startDeviceProgress(Date.now());
    setProgress(s);
    const tick = async (st: Parameters<typeof markDeviceStep>[1]) => {
      await sleep(DEVICE_STEP_MIN_MS);
      s = markDeviceStep(s, st);
      setProgress(s);
    };
    const set = capturesRef.current;
    try {
      await tick("landmarks"); // 478 nokta: çekimde çıkarıldı
      await tick("ratios"); // oranlar: computeStableGeometry bitti (geometry)
      await tick("faceShape"); // ön değerlendirme: geometry.faceShape
      // Set (ön + yan açılar) ödeme sonrası tek POST için bellekte/önbellekte; hash'ler yalnız galeri dosyalarından.
      const views: PendingView[] = orderedViews(set).map((k) => {
        const c = set[k]!;
        return { view: k, uri: c.image.uri, width: c.image.width, height: c.image.height, landmarksPx: k === "front" ? landmarksPx(c) : null, sourceHash: c.sourceHash };
      });
      await clearPendingSet();
      setPendingSet({ analysisId: resumeAnalysisId, views, capturedAt: Date.now() });
      capturesRef.current = {}; // dosyalar artık captureSession'a ait; ayrılışta silinmez
      await tick("views");
      const viewKeys = views.map((v) => v.view);
      const frontPx = landmarksPx(front);
      const outline = frontPx ? ghostOutlineFromLandmarks(frontPx, front.image.width, front.image.height, { mirrored: false, takenAt: Date.now() }) : null;
      if (outline) setLastGhost(outline);
      const cached = await cacheSessionSelfie(front);
      const capturedAt = cached?.capturedAt ?? null;
      // Gönderim başarılı olunca set dosyaları (front.image.uri dahil) silinir: ilerleme kopyası ve bekleme ekranı
      // kararlı oturum selfie kopyasını kullanır (web bellekteki bitmap'ten kaydeder; CaptureScreen.tsx karşılığı).
      const frontStableUri = cached?.uri ?? front.image.uri;
      setHeroUri(frontStableUri);
      /** SPEC 11.2: yalnız cihazda (uygulama sanal alanı); sunucuya gitmez. Hayalet çizgi yalnız bu kayıtla saklanır (web ile aynı kural). */
      const saveProgressPhoto = async (analysisId: string) => {
        if (!saveProgress) return;
        await addProgressPhoto(frontStableUri, { analysisId, ghost: outline }).catch(() => undefined);
      };
      /** Gönderim/istek başarısız: set dosyaları yeniden bu ekranın olur (ayrılışta silinir); bekleyen set düşürülür (çift sahiplik yok). */
      const failBack = () => {
        setPendingSet(null);
        capturesRef.current = set;
        setProgress(null);
        setPhase("error");
        setStep({ kind: "summary" });
      };

      if (resumeAnalysisId) {
        // Ödeme sonrası çekime dönüş: satır zaten var; görseller bu analize gider, sonuç ekranı kart kart açar.
        // İlerleme kopyası gönderimden ÖNCE alınır (başarıda set dosyaları silinir).
        await saveProgressPhoto(resumeAnalysisId);
        const up = await uploadPendingSet(aura, resumeAnalysisId, { resume: true });
        if (!up.ok) {
          setError({ code: up.reason === "api" ? (up.code ?? "GENERIC") : "IMAGE_TOO_LARGE", retryAt: up.reason === "api" ? up.retryAt : undefined });
          failBack();
          return;
        }
        await tick("save");
        s = finishDeviceProgress(s);
        setProgress(s);
        setPhase("done");
        await sleep(DONE_HOLD_MS);
        if (capturedAt !== null) bindSessionSelfie(resumeAnalysisId, capturedAt);
        router.replace(`/analiz/${resumeAnalysisId}`);
        return;
      }

      const body = buildDeviceOnlyBody({ clientRequestId: requestIdRef.current, geometry, relaxed: front.relaxed, hashes: views.map((v) => v.sourceHash) });
      track("device_analysis_submitted", { ...viewsLabel(viewKeys), hashed: body.sourceHashes !== undefined });
      const analysis = await aura.analyses.deviceOnly(body);
      if (!analysis) throw new Error("empty_response");
      bindPendingSet(analysis.id);
      if (capturedAt !== null) bindSessionSelfie(analysis.id, capturedAt);
      // İlerleme kopyası + hayalet çizgi, set gönderilmeden ÖNCE (hak varsa gönderim set dosyalarını siler).
      await saveProgressPhoto(analysis.id);
      // Hak zaten varsa (abonelik / bağlanmamış ödenmiş rapor / davet kilidi) set bellekteyken hemen gider; hata sonucu engellemez.
      if (analysis.stage === "device_only") {
        const st = await aura.billing.status(analysis.id).catch(() => null);
        if (st?.analysisEntitled === true) await uploadPendingSet(aura, analysis.id);
      }
      await tick("save");
      s = finishDeviceProgress(s);
      setProgress(s);
      setPhase("done");
      track("device_analysis_completed");
      await sleep(DONE_HOLD_MS);
      requestIdRef.current = newRequestId();
      router.replace(`/analiz/${analysis.id}`);
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : "NETWORK";
      track("analysis_failed", { reason: code });
      setError({ code, retryAt: e instanceof ApiClientError ? e.retryAt : undefined });
      // Set dosyaları yeniden bu ekranın olur (özet yeniden gönderebilsin); bekleyen set düşürülür (çift sahiplik yok:
      // ayrılışta silinen dosyalara captureSession referans tutmaz).
      setPendingSet(null);
      capturesRef.current = set;
      setProgress(null);
      setPhase("error");
      setStep({ kind: "summary" });
    }
  }

  if (!gate.ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.foreground} />
      </View>
    );
  }
  if (gate.redirect) return <Redirect href={gate.redirect as Href} />;

  const front = captures.front ?? null;
  const geometry = front?.geometry ?? null;

  if ((phase === "submitting" || phase === "done") && progress) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Screen>
          <DeviceProgressScreen state={progress} photoUri={heroUri ?? front?.image.uri ?? null} viewsCount={Object.keys(captures).length} />
        </Screen>
      </>
    );
  }

  if (step.kind === "capture") {
    const spec = VIEW_BY_KEY[step.view];
    const idx = stepIndex(step);
    const requiredProfile = step.required && isProfileView(step.view);
    const name = requiredProfile ? tv("profileAny.name") : tv(`${step.view}.name`);
    const label = idx ? tv("stepLabel", { current: idx.current, total: idx.total, name }) : tv("optionalStep", { name });
    const optionalNote = step.required ? undefined : tv(`${step.view}.optionalNote`) === `camera.views.${step.view}.optionalNote` ? tv("optionalLabel") : tv(`${step.view}.optionalNote`);
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: forTryon ? tv("front.name") : name, headerBackTitle: "Geri" }} />
        <ViewCamera
          key={step.view}
          view={spec}
          stepLabel={forTryon ? null : label}
          optionalNote={optionalNote}
          takenViews={Object.keys(captures) as ViewKey[]}
          onCapture={(r) => void place([r])}
          onGalleryBatch={step.view === "front" && !forTryon ? (items) => void place(items) : undefined}
          onBack={captures.front && !forTryon ? () => setStep({ kind: "summary" }) : undefined}
          labels={requiredProfile ? { name: tv("profileAny.name"), instruction: tv("profileAny.instruction") } : undefined}
          ghost={step.view === "front" && !forTryon ? ghost : null}
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: tv("done"), headerBackTitle: "Geri" }} />
      <Screen>
        <CaptureSummary
          captures={captures}
          geometry={geometry}
          resume={resumeAnalysisId !== null}
          error={error}
          saveProgress={saveProgress}
          onSaveProgress={setSaveProgress}
          onRemove={(v) => void remove(v)}
          onAdd={(view, required) => setStep({ kind: "capture", view, required })}
          onRetake={() => setStep({ kind: "capture", view: "front", required: true })}
          onStart={() => front && geometry && void runDeviceAnalysis(front, geometry)}
          startDisabled={!canStartDevice(captures, geometry !== null, error?.code)}
        />
      </Screen>
    </>
  );
}
