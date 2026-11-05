'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import mascot from '@ogrenmen/design-system/assets/Maskot/ogrenmen-maskot.webp';
import { LinkButton } from '@/components/LinkButton';
import { useLive } from '@/lib/live';

/** Bu süreden sonra "Biraz uzun sürüyor" (sonuç Bugün kartında da gelir). */
const SLOW_AFTER_MS = 60_000;

/**
 * Bekleme (sade): maskot + "İnceliyorum…". Teşhis yazılınca ya da yükleme düşünce (Realtime: solution_analyses,
 * uploads; yoksa `useLive` yoklaması 2 sn → 5 sn, 120 sn, sekme gizliyken durur) sunucu bileşeni yenilenir ve S05
 * benzeri tek cümle çizilir.
 */
export function Bekleme({ uploadId, school }: { uploadId: string; school: boolean }) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);
  useLive({
    key: `upload-${uploadId}`,
    tables: [
      { table: 'solution_analyses', event: 'INSERT' },
      { table: 'uploads', event: 'UPDATE', filter: `id=eq.${uploadId}` },
    ],
    timing: { initialDelayMs: 1_500 },
    check: async () => {
      const res = await fetch(`/ogrenci/sonuc/durum?yukleme=${encodeURIComponent(uploadId)}`, { cache: 'no-store' });
      const body = (await res.json()) as { state?: string };
      if (!body.state || body.state === 'waiting') return false;
      router.refresh();
      return true;
    },
    onGiveUp: () => setSlow(true),
  });
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [uploadId]);

  return (
    <section aria-live="polite" aria-busy={!slow} className="mx-auto flex w-full max-w-md flex-col items-center gap-6 py-12 text-center">
      <Image src={mascot} alt="" width={102} height={128} sizes="102px" className="h-32 w-auto motion-safe:animate-pulse" priority />
      <h1 className="text-title-1 m-0 text-ink">{school ? 'Sayfalarını alıyorum…' : 'İnceliyorum…'}</h1>
      <p className="text-body m-0 max-w-prose text-ink-muted">
        {slow ? 'Biraz uzun sürüyor. Sonuç hazır olunca Bugün’de görürsün.' : 'Birkaç saniye sürer. İstersen kapat; sonucu Bugün’de görürsün.'}
      </p>
      <LinkButton href="/ogrenci" variant="quiet">
        Bugün’e dön
      </LinkButton>
    </section>
  );
}
