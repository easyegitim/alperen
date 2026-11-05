import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, View, useWindowDimensions } from "react-native";
import { MediapipeCamera } from "react-native-mediapipe";
import { Camera, useCameraPermission } from "react-native-vision-camera";
import { track } from "@/lib/analytics";
import type { GhostOutline } from "@/lib/face/ghostGuide";
import { findHairline, propagateHairline } from "@/lib/face/hairline";
import { computeStableGeometry, toPixels, type GeometryFrame } from "@/lib/face/metrics";
import { checkQuality, manualOfferReady, type HardIssue } from "@/lib/face/quality";
import type { FrameAnalysis, GeometryResult } from "@/lib/face/types";
import { VIEW_BY_KEY, type ViewKey, type ViewSpec } from "@/lib/face/views";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { toFrameAnalysis, type NativeBundle } from "@/mobile/src/features/capture/frame";
import { initialLive, shouldProcess, stepLive, type LiveState } from "@/mobile/src/features/capture/machine";
import { decideFront, decideSide, sideLiveIssue } from "@/mobile/src/features/capture/quality";
import type { CaptureResult } from "@/mobile/src/features/capture/result";
import { hairAboveFace } from "@/mobile/src/features/capture/segmentation";
import { fileSha256Hex } from "@/mobile/src/features/capture/viewImages";
import { classifyFrame, galleryTarget, relabelProfile } from "@/mobile/src/features/capture/views";
import { scoped } from "@/mobile/src/lib/i18n";
import { detectFaceOnImage, useLiveFaceLandmarker } from "@/mobile/src/native/faceLandmarker";
import { deleteQuietly, pixelStatsFor, resizeToAnalysis, type LocalImage } from "@/mobile/src/native/images";
import { segmentForHairline } from "@/mobile/src/native/segmenter";
import { radius, spacing, useTheme } from "@/mobile/src/theme";
import { GhostGuideOverlay } from "./GhostGuideOverlay";
import { OvalOverlay } from "./OvalOverlay";
import { QualityPrompt } from "./QualityPrompt";

const t = scoped("camera");
const tgh = scoped("ghost");

type Stage = "guide" | "live" | "countdown" | "processing" | "review" | "denied" | "model_error";
type Review = { image: LocalImage; failed: HardIssue | null; result: CaptureResult | null; promptOpen: boolean };
type Src = { uri: string; width: number; height: number };

type Props = {
  /** Çekilecek açı. Ön: otomatik çekim + geometri; diğerleri: elle deklanşör, yalnız tek yüz kuralı. */
  view: ViewSpec;
  /** "1 / 2 · Ön" gibi adım etiketi. */
  stepLabel?: string | null;
  /** Zorunlu yan profil adımında genel "Yan profil" adı ve yönergesi (hangi yanak olduğu yaw'dan anlaşılır). */
  labels?: { name: string; instruction: string };
  optionalNote?: string;
  /** Açı dolu olduğu için galeri toplu seçimde atlanacak görünümler. */
  takenViews?: readonly ViewKey[];
  onCapture: (r: CaptureResult) => void;
  /** Galeriden çoklu seçim (yalnız ön adımda): her dosya açısına göre yerleştirilir (KB R1-E5). */
  onGalleryBatch?: (items: CaptureResult[]) => void;
  onBack?: () => void;
  /** Yeniden analizde önceki yüz çizgisi (S3.3.4); yalnız ön adımda çizilir. */
  ghost?: GhostOutline | null;
};

/**
 * Tek açı için kamera (web SelfieCamera karşılığı; SPEC 7, SPEC-MOBILE M4): rehber → kamera (aynalı, oval) → 600 ms
 * kararlı → 3-2-1 → çekim (ön); yan açılarda elle deklanşör. Galeriden yükleme (ön adımda çoklu). Kötü ışık/bulanıklıkta
 * ret yok, evet/hayır pop-up'ı (KB R1-E12). Fotoğraf ve 478 nokta yalnız geçici dosyada/bellekte.
 */
export function ViewCamera({ view, stepLabel, labels, optionalNote, takenViews = [], onCapture, onGalleryBatch, onBack, ghost = null }: Props) {
  const { colors } = useTheme();
  const { width: winW } = useWindowDimensions();
  const isFront = view.geometry;
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<Camera>(null);
  const stageRef = useRef<Stage>("guide");
  const liveRef = useRef<LiveState>(initialLive);
  const lastRunRef = useRef(0);
  const recentRef = useRef<FrameAnalysis[]>([]);
  const attemptsRef = useRef(0);
  const capturingRef = useRef(false);
  const liveStartedAtRef = useRef<number | null>(null);
  const manualOfferedRef = useRef(false);
  const ghostShownRef = useRef(false);
  const reviewRef = useRef<Review | null>(null);

  const [stage, setStageState] = useState<Stage>("guide");
  const [issue, setIssue] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [review, setReviewState] = useState<Review | null>(null);
  const [manualOffered, setManualOffered] = useState(false);
  const [batchNote, setBatchNote] = useState<string | null>(null);
  const [showGhost, setShowGhost] = useState(true);

  const setStage = useCallback((s: Stage) => {
    stageRef.current = s;
    setStageState(s);
  }, []);
  const setReview = useCallback((r: Review | null) => {
    reviewRef.current = r;
    setReviewState(r);
  }, []);

  const resetLive = useCallback(() => {
    recentRef.current = [];
    liveRef.current = initialLive;
    liveStartedAtRef.current = null;
    manualOfferedRef.current = false;
    setManualOffered(false);
    setIssue(null);
    setWarning(null);
    setCountdown(0);
  }, []);

  /** Tek görüntüyü (kamera karesi ya da galeri dosyası) açıya göre denetler; sonuç gösterimi çağıranın işi. */
  const analyze = useCallback(
    async (src: Src, source: "camera" | "gallery", target: ViewKey, opts: { manual?: boolean; originalUri?: string } = {}): Promise<{ image: LocalImage; failed: HardIssue | null; result: CaptureResult | null }> => {
      const image = await resizeToAnalysis(src.uri, src.width, src.height);
      const bundle = await detectFaceOnImage(image.uri);
      const oneFace = bundle.results[0]?.faceLandmarks.length === 1;
      const stats = oneFace ? await pixelStatsFor(image.uri, bundle.results[0].faceLandmarks[0]) : null;
      const base = toFrameAnalysis(bundle, Date.now(), stats);
      const sourceHash = opts.originalUri ? await fileSha256Hex(opts.originalUri) : null;
      const spec = VIEW_BY_KEY[target];
      if (!spec.geometry) {
        const cls = classifyFrame(base);
        const relabeled = relabelProfile(target, cls);
        const d = decideSide(base, relabeled);
        const report = checkQuality(base);
        return { image, failed: d.hard, result: d.ok ? { view: relabeled, image, final: base, recent: [], report, source, warnings: [], relaxed: false, sourceHash, geometry: null } : null };
      }
      // Ön: segmenter maskesi (yalnız çekilen karede) → saç görünürlüğü + saç çizgisi (M8); modül yoksa null.
      const seg = oneFace ? await segmentForHairline(image.uri) : null;
      const final: FrameAnalysis = seg && base.landmarks ? { ...base, hairVisible: hairAboveFace(seg, base.landmarks) } : base;
      const d = decideFront(final, { manual: opts.manual });
      if (opts.manual) track("capture_manual_used", { issue: d.report.issues[0] ?? "none" });
      if (!d.ok) return { image, failed: d.hard, result: null };
      let geometry: GeometryResult | null = null;
      if (final.landmarks) {
        const finalPx = toPixels(final.landmarks, final.width, final.height);
        const hairline = seg ? findHairline(finalPx, final, seg).point : null;
        const recent = source === "camera" ? recentRef.current.slice(-4) : [];
        const frames: GeometryFrame[] = [
          ...recent.map((f) => ({ frame: f, hairline: hairline && f.landmarks ? propagateHairline(finalPx, hairline, toPixels(f.landmarks, f.width, f.height)) : null })),
          { frame: final, hairline },
        ];
        try {
          geometry = computeStableGeometry(frames);
        } catch {
          geometry = null;
        }
      }
      return { image, failed: null, result: { view: target, image, final, recent: source === "camera" ? recentRef.current.slice(-5) : [], report: d.report, source, warnings: d.warnings, relaxed: d.relaxed, sourceHash, geometry } };
    },
    [],
  );

  const finalize = useCallback(
    async (src: Src, source: "camera" | "gallery", opts: { manual?: boolean; originalUri?: string } = {}) => {
      setStage("processing");
      let image: LocalImage | null = null;
      try {
        const a = await analyze(src, source, view.key, opts);
        image = a.image;
        attemptsRef.current++;
        if (a.result) {
          track("capture_succeeded", { attempts: attemptsRef.current });
          setReview({ image, failed: null, result: a.result, promptOpen: a.result.warnings.length > 0 });
        } else {
          track("capture_quality_failed", { reason: a.failed ?? "unknown" });
          setReview({ image, failed: a.failed, result: null, promptOpen: false });
        }
        setStage("review");
      } catch {
        await deleteQuietly(image?.uri);
        resetLive();
        setIssue(t("errors.processing"));
        setStage("guide");
      } finally {
        // Kaynak dosya işini bitirdi (analiz kopyası + hash alındı): kamera karesi ve expo-image-picker'ın önbellek
        // kopyası (tam çözünürlük, galeri orijinali) silinir — sanal alanda yalnız analiz kopyası kalır.
        if (source === "camera") await deleteQuietly(src.uri);
        if (opts.originalUri) await deleteQuietly(opts.originalUri);
      }
    },
    [analyze, resetLive, setReview, setStage, view.key],
  );

  const takePhoto = useCallback(
    async (manual: boolean) => {
      if (capturingRef.current) return;
      capturingRef.current = true;
      try {
        const photo = await cameraRef.current?.takePhoto({ flash: "off" });
        if (!photo) throw new Error("no_photo");
        await finalize({ uri: `file://${photo.path}`, width: photo.width, height: photo.height }, "camera", { manual });
      } catch {
        setIssue(t("errors.processing"));
        setStage("live");
      } finally {
        capturingRef.current = false;
      }
    },
    [finalize, setStage],
  );

  const onResults = useCallback(
    (bundle: NativeBundle, now: number) => {
      const s = stageRef.current;
      if (s !== "live" && s !== "countdown") return;
      if (!shouldProcess(lastRunRef.current, now)) return;
      lastRunRef.current = now;
      const frame = toFrameAnalysis(bundle, now);
      if (!isFront) {
        // Yan görünüm: otomatik çekim yok (90°'de yüz ağı güvenilmez); yalnız "birden çok yüz" uyarısı.
        const li = sideLiveIssue(frame);
        setIssue(li ? t(`issues.${li}`) : null);
        return;
      }
      const report = checkQuality(frame);
      setIssue(report.issues[0] ? t(`issues.${report.issues[0]}`) : null);
      setWarning(report.warnings[0] ? t(`warnings.${report.warnings[0]}`) : null);
      if (!manualOfferedRef.current && liveStartedAtRef.current !== null && manualOfferReady(frame, now - liveStartedAtRef.current)) {
        manualOfferedRef.current = true;
        setManualOffered(true);
        track("capture_manual_offered");
      }
      if (report.passed) recentRef.current = [...recentRef.current.slice(-4), frame];
      else recentRef.current = [];
      const step = stepLive(liveRef.current, report.passed, now);
      liveRef.current = step.state;
      setCountdown(step.countdown);
      if (step.state.stage !== stageRef.current && !step.capture) setStage(step.state.stage);
      if (step.capture) {
        setStage("processing");
        void takePhoto(false);
      }
    },
    [isFront, setStage, takePhoto],
  );
  const onError = useCallback(() => setStage("model_error"), [setStage]);
  const solution = useLiveFaceLandmarker(onResults, onError);

  async function startCamera() {
    track("capture_started", { source: "camera" });
    const ok = hasPermission || (await requestPermission());
    if (!ok) {
      setStage("denied");
      return;
    }
    resetLive();
    liveStartedAtRef.current = Date.now();
    setStage("live");
    if (isFront && ghost && showGhost && !ghostShownRef.current) {
      ghostShownRef.current = true;
      track("ghost_guide_shown");
    }
  }

  async function captureNow() {
    if (stageRef.current !== "live" && stageRef.current !== "countdown") return;
    setStage("processing");
    await takePhoto(isFront);
  }

  async function pickFromGallery() {
    resetLive();
    setBatchNote(null);
    const multiple = isFront && Boolean(onGalleryBatch);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, exif: false, allowsMultipleSelection: multiple, selectionLimit: multiple ? 6 : 1 });
    if (res.canceled || res.assets.length === 0) return;
    track("capture_started", { source: "gallery" });
    const assets = res.assets.filter((a) => Math.min(a.width, a.height) >= 640);
    if (assets.length === 0) {
      setIssue(t("errors.too_small"));
      return;
    }
    if (assets.length === 1 || !onGalleryBatch) {
      const a = assets[0];
      await finalize({ uri: a.uri, width: a.width, height: a.height }, "gallery", { originalUri: a.uri });
      return;
    }
    // Çoklu seçim (KB R1-E5): her dosya yaw'a göre sınıflanır; sınıflanamayan bu adımın açısına gider (boşsa).
    setStage("processing");
    const taken = new Set<ViewKey>(takenViews);
    const items: CaptureResult[] = [];
    let assigned = 0;
    for (const a of assets) {
      let probeImage: LocalImage | null = null;
      try {
        probeImage = await resizeToAnalysis(a.uri, a.width, a.height);
        const probe = toFrameAnalysis(await detectFaceOnImage(probeImage.uri), Date.now());
        const target = galleryTarget(classifyFrame(probe), taken, view.key);
        if (target === null) continue;
        const r = await analyze({ uri: probeImage.uri, width: probeImage.width, height: probeImage.height }, "gallery", target, { originalUri: a.uri });
        if (r.result) {
          taken.add(r.result.view);
          items.push(r.result);
          assigned++;
        } else {
          await deleteQuietly(r.image.uri);
        }
      } catch {
        // bu dosya atlanır
      } finally {
        await deleteQuietly(probeImage?.uri);
        await deleteQuietly(a.uri); // seçici kopyası (tam çözünürlük) kalmaz
      }
    }
    track("capture_gallery_batch", { selected: assets.length, assigned });
    if (items.length === 0) {
      setIssue(t("gallery.noneAssigned"));
      setStage("guide");
      return;
    }
    if (assigned < assets.length) setBatchNote(t("gallery.someSkipped", { assigned, selected: assets.length }));
    setStage("guide");
    onGalleryBatch(items);
  }

  async function retake() {
    const r = reviewRef.current;
    setReview(null);
    await deleteQuietly(r?.image.uri);
    resetLive();
    setStage("guide");
  }

  function useResult() {
    const r = reviewRef.current?.result;
    if (!r) return;
    setReview(null);
    track("capture_view_captured", { view: r.view, source: r.source });
    onCapture(r);
  }

  useEffect(() => {
    return () => {
      // Ayrılırken kullanılmamış inceleme dosyası silinir; kabul edilen sonuç çağıranın sorumluluğundadır.
      const r = reviewRef.current;
      if (r) void deleteQuietly(r.image.uri);
    };
  }, []);

  const viewName = labels?.name ?? t(`views.${view.key}.name`);
  const instruction = labels?.instruction ?? t(`views.${view.key}.instruction`);
  const camW = Math.min(winW - spacing.md * 2, 420);
  const camH = Math.round((camW * 4) / 3);

  if (stage === "review" && review) {
    const ok = Boolean(review.result);
    const warn = review.result?.warnings[0];
    return (
      <Screen>
        <Card title={ok ? t("review.okTitle") : t("review.failTitle")} description={ok ? t("review.okBody") : t(`issues.${review.failed ?? "no_face"}`)}>
          {stepLabel ? <Text variant="small">{stepLabel}</Text> : null}
          <Image source={{ uri: review.image.uri }} accessibilityLabel={t("captured.previewAlt")} style={{ width: "100%", aspectRatio: review.image.width / review.image.height, maxHeight: 420, borderRadius: radius.lg }} resizeMode="contain" />
          {warn ? (
            <View style={{ flexDirection: "row", gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.md }}>
              <Ionicons name="sunny-outline" size={16} color={colors.warn} />
              <Text variant="small" style={{ flex: 1 }}>
                {t(`issues.${warn}`)} · {t("review.relaxedNote")}
              </Text>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Button title={t("review.retake")} variant={ok ? "outline" : "primary"} size="lg" style={{ flex: 1 }} onPress={() => void retake()} />
            {ok ? <Button title={t("review.use")} size="lg" style={{ flex: 1 }} onPress={useResult} /> : null}
          </View>
        </Card>
        <QualityPrompt open={review.promptOpen} onYes={() => setReview(reviewRef.current ? { ...reviewRef.current, promptOpen: false } : null)} onNo={() => void retake()} />
      </Screen>
    );
  }

  if (stage === "guide" || stage === "denied" || stage === "model_error") {
    const title = stage === "denied" ? t("denied.title") : stage === "model_error" ? t("modelError.title") : isFront ? t("guide.title") : viewName;
    const body = stage === "denied" ? t("denied.body") : stage === "model_error" ? t("modelError.body") : isFront ? t("guide.body") : instruction;
    const multiple = isFront && Boolean(onGalleryBatch);
    return (
      <Screen>
        <Card title={title} description={body}>
          {stepLabel ? <Text variant="small" style={{ textTransform: "uppercase", letterSpacing: 1 }}>{stepLabel}</Text> : null}
          {optionalNote && stage === "guide" ? (
            <View style={{ alignSelf: "flex-start", paddingHorizontal: 10, height: 24, borderRadius: radius.full, backgroundColor: colors.muted, justifyContent: "center" }}>
              <Text variant="small" style={{ fontWeight: "600" }}>{optionalNote}</Text>
            </View>
          ) : null}
          {stage === "guide" && isFront ? (
            <View style={{ gap: spacing.xs }}>
              {(["light", "neutral", "frame", "alone", "distance"] as const).map((k) => (
                <Text key={k} variant="muted">• {t(`guide.tips.${k}`)}</Text>
              ))}
            </View>
          ) : null}
          {stage === "guide" && isFront && ghost ? (
            <View style={{ gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.muted }}>
              <Text style={{ fontWeight: "600" }}>{tgh("title")}</Text>
              <Text variant="small">{tgh("body")}</Text>
              <Pressable accessibilityRole="switch" accessibilityState={{ checked: showGhost }} onPress={() => setShowGhost((v) => !v)} style={{ minHeight: 44, justifyContent: "center" }}>
                <Text style={{ color: colors.brand, fontWeight: "600" }}>{showGhost ? tgh("hide") : tgh("show")}</Text>
              </Pressable>
              <Text variant="small">{tgh("deviceNote")}</Text>
            </View>
          ) : null}
          {issue ? <Text accessibilityLiveRegion="polite">{issue}</Text> : null}
          {batchNote ? <Text variant="small" accessibilityLiveRegion="polite">{batchNote}</Text> : null}
          {stage !== "denied" ? <Button title={t("guide.open")} size="lg" onPress={() => void startCamera()} disabled={stage === "model_error"} /> : null}
          <Button title={multiple ? t("views.pickFromGallery") : t("guide.upload")} size="lg" variant={stage === "denied" ? "primary" : "outline"} onPress={() => void pickFromGallery()} />
          {stage === "model_error" ? <Button title={t("modelError.retry")} variant="ghost" onPress={() => setStage("guide")} /> : null}
          {onBack ? <Button title={t("views.back")} variant="ghost" onPress={onBack} /> : null}
          {isFront ? <Text variant="small">{t("guide.privacy")}</Text> : <Text variant="small">{t("live.sideHint")}</Text>}
        </Card>
      </Screen>
    );
  }

  return (
    <Screen scroll={false} style={{ alignItems: "center" }}>
      {stepLabel ? <Text variant="small" style={{ textTransform: "uppercase", letterSpacing: 1 }}>{stepLabel}</Text> : null}
      <View style={{ width: camW, height: camH, borderRadius: 24, overflow: "hidden", backgroundColor: "#000" }}>
        <MediapipeCamera ref={cameraRef} style={{ width: camW, height: camH }} solution={solution} activeCamera="front" resizeMode="cover" />
        <OvalOverlay dashed={Boolean(issue) || !isFront} width={camW} height={camH} />
        {isFront && ghost && showGhost ? <GhostGuideOverlay outline={ghost} width={camW} height={camH} mirror /> : null}
        {stage === "countdown" ? (
          <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }} accessibilityLiveRegion="assertive">
            <Text style={{ fontSize: 72, color: "#fff", fontWeight: "600" }}>{countdown || 1}</Text>
          </View>
        ) : null}
        {stage === "processing" ? (
          <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.6)" }}>
            <Text style={{ color: "#fff" }}>{t("live.processing")}</Text>
          </View>
        ) : null}
      </View>
      <Text accessibilityLiveRegion="polite" variant={issue ? "body" : "muted"} style={{ textAlign: "center", minHeight: 24 }}>
        {issue ?? warning ?? (stage === "countdown" ? t("live.holdStill") : isFront ? t("live.ready") : instruction)}
      </Text>
      {(manualOffered || !isFront) && (stage === "live" || stage === "countdown") ? (
        <View style={{ gap: spacing.xs, alignItems: "center", alignSelf: "stretch" }}>
          <Button title={isFront ? t("live.manual") : t("live.shutter")} size="lg" style={{ alignSelf: "stretch" }} onPress={() => void captureNow()} disabled={Boolean(issue) && !isFront} />
          <Text variant="small" style={{ textAlign: "center" }}>{isFront ? t("live.manualHint") : t("live.sideHint")}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button
          title={t("live.cancel")}
          variant="ghost"
          onPress={() => {
            resetLive();
            setStage("guide");
          }}
        />
        <Button title={t("guide.upload")} variant="ghost" onPress={() => void pickFromGallery()} />
      </View>
    </Screen>
  );
}
