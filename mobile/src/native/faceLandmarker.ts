// react-native-mediapipe sarmalayıcı (SPEC-MOBILE M4). Model dosyası native pakete gömülüdür (plugins/withMediapipeModels.js);
// iOS Bundle.main, Android assets içinden dosya adıyla bulunur. Görüntü ve noktalar hiçbir yere gönderilmez/loglanmaz.
import { Delegate, faceLandmarkDetectionOnImage, RunningMode, useFaceLandmarkDetection } from "react-native-mediapipe";
import type { NativeBundle } from "@/mobile/src/features/capture/frame";

export const FACE_MODEL = "face_landmarker.task";

/** Web ile aynı seçenekler: 2 yüze kadar ara (ikinci yüz → ret), eşik 0,6. */
export const FACE_OPTIONS = { numFaces: 2, minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5 } as const;

/** Canlı önizleme çözümü (LIVE_STREAM). GPU delegesi; başarısızlıkta kütüphane hata olayı verir (onError). */
export function useLiveFaceLandmarker(onResults: (b: NativeBundle, timestamp: number) => void, onError: (message: string) => void, delegate: Delegate = Delegate.GPU) {
  return useFaceLandmarkDetection(
    (result) => onResults(result as NativeBundle, Date.now()),
    (e) => onError(e.message),
    RunningMode.LIVE_STREAM,
    FACE_MODEL,
    { ...FACE_OPTIONS, delegate, mirrorMode: "mirror-front-only" },
  );
}

/** Durağan görüntü (dosya yolu) için tespit; GPU başarısızsa CPU ile tekrar denenir. */
export async function detectFaceOnImage(path: string): Promise<NativeBundle> {
  try {
    return (await faceLandmarkDetectionOnImage(path, FACE_MODEL, { ...FACE_OPTIONS, delegate: Delegate.GPU })) as NativeBundle;
  } catch {
    return (await faceLandmarkDetectionOnImage(path, FACE_MODEL, { ...FACE_OPTIONS, delegate: Delegate.CPU })) as NativeBundle;
  }
}

export { Delegate };
