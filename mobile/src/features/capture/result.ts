// Bir açının çekim sonucu (web components/camera/SelfieCamera.tsx CaptureResult karşılığı). Görsel yalnız geçici dosyada,
// 478 nokta yalnız bellekte; hiçbiri ağa/analitiğe/loga çıkmaz.
import type { QualityIssue, QualityReport } from "@/lib/face/quality";
import type { FrameAnalysis, GeometryResult, Point } from "@/lib/face/types";
import type { ViewKey } from "@/lib/face/views";
import type { LocalImage } from "@/mobile/src/native/images";

export type CaptureResult = {
  view: ViewKey;
  /** Analiz kopyası (uzun kenar ≤ 1280), uygulama önbelleğinde geçici dosya. */
  image: LocalImage;
  /** Son karenin analizi (ham noktalar dahil; yalnız bellekte). Yan görünümde yüz bulunmamış olabilir. */
  final: FrameAnalysis;
  /** Çekimden önceki en fazla 5 geçerli canlı kare (SPEC 7.5 medyan; yalnız ön, kamera). */
  recent: FrameAnalysis[];
  report: QualityReport;
  source: "camera" | "gallery";
  /** Uyarı listesi (KB: ret yerine uyarı); kullanıcı pop-up'ta "Evet" dediyse boş olmayan listeyle devam edilir. */
  warnings: QualityIssue[];
  /** Elle çekim ya da uyarıyla devam; yalnız saklanan üst veri, skoru değiştirmez (C7). */
  relaxed: boolean;
  /** Galeriden gelen orijinal dosyanın SHA-256'sı (set önbelleği, KB Ç11); kamerada null. */
  sourceHash: string | null;
  /** Yalnız ön: cihaz geometrisi (5 kare medyanı); hesaplanamadıysa null. */
  geometry: GeometryResult | null;
};

/** Ön çekimin piksel koordinatlı noktaları (portre, kırpım, hayalet kılavuz için); hiçbir yere gönderilmez. */
export function landmarksPx(r: Pick<CaptureResult, "final" | "image">): Point[] | null {
  if (!r.final.landmarks) return null;
  return r.final.landmarks.map((p) => ({ x: p.x * r.image.width, y: p.y * r.image.height }));
}
