// Segmenter sarmalayıcı (SPEC-MOBILE M8): yerel modül → kategori maskesi. Başarısızlıkta null; akış saç çizgisiz sürer.
// Görüntü dosyası yalnız native tarafta okunur; maske dışında veri dönmez, loglanmaz.
import type { SegmentationResult } from "@/lib/face/types";
import { isSegmenterAvailable, segmentImage } from "@/mobile/modules/aura-segmenter";
import { decodeMask, SEGMENTER_MODEL } from "@/mobile/src/features/capture/segmentation";

export { isSegmenterAvailable };

export async function segmentForHairline(uri: string): Promise<SegmentationResult | null> {
  if (!isSegmenterAvailable) return null;
  try {
    const r = await segmentImage(uri, SEGMENTER_MODEL);
    return decodeMask(r.width, r.height, r.maskBase64);
  } catch {
    return null;
  }
}
