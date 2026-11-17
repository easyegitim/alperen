import { cropLayout } from '@/server/exam/present';
import type { ExamCrop } from '@/server/exam/types';

/**
 * Telifli sınavın sorusu: soru metni yoktur, kitapçık sayfasından {x,y,w,h} (0..1 oranlı) kutusu gösterilir.
 * Görsel kapsayıcıya sığacak kadar büyütülüp kaydırılır; kırpım dışı kısım taşmayla gizlenir.
 */
export function CropView({ crop, label }: { crop: ExamCrop; label: string }) {
  const l = cropLayout(crop);
  return (
    <div role="img" aria-label={label} className="relative w-full overflow-hidden rounded-md border border-line bg-paper" style={{ aspectRatio: String(l.aspectRatio) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={crop.src} alt="" draggable={false} className="absolute max-w-none select-none" style={{ width: `${l.widthPct}%`, left: `${l.leftPct}%`, top: `${l.topPct}%` }} />
    </div>
  );
}
