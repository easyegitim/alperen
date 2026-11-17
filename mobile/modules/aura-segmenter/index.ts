// Yerel Expo modülü JS yüzü (SPEC-MOBILE M8). Native modül yoksa (Expo Go, Jest, web) null → segmenter devre dışı,
// saç çizgisi bulunamaz (hairlineFound=false; SPEC 7.6 üst üçte bir null). Hata fırlatmaz.
import { requireOptionalNativeModule } from "expo";

export type NativeSegmentation = { width: number; height: number; maskBase64: string };

type AuraSegmenterNative = {
  segmentImage(path: string, modelName: string): Promise<NativeSegmentation>;
  release(): Promise<void>;
};

const native = requireOptionalNativeModule<AuraSegmenterNative>("AuraSegmenter");

export const isSegmenterAvailable = native !== null;

/** Dosya yolundaki görüntünün kategori maskesi. Native modül yoksa reddeder; çağıran yakalar. */
export function segmentImage(path: string, modelName: string): Promise<NativeSegmentation> {
  if (!native) return Promise.reject(new Error("segmenter_unavailable"));
  return native.segmentImage(path, modelName);
}

export async function releaseSegmenter(): Promise<void> {
  await native?.release();
}
