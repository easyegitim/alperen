'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import mascot from '@ogrenmen/design-system/assets/Maskot/ogrenmen-maskot.webp';
import { LinkButton } from '@/components/LinkButton';

/** Yoklama aralığı: ilk yarım dakika sık, sonra seyrek; 4 dakikadan sonra durur (sonuç Bugün kartında da gelir). */
export function pollDelay(elapsedMs: number): number | null {
  if (elapsedMs > 240_000) return null;
  return elapsedMs < 30_000 ? 2_000 : 5_000;
}

/**
 * Bekleme (sade): maskot + "İnceliyorum…". Durum değişince sunucu bileşeni yenilenir ve S05 benzeri tek cümle çizilir.
 */
export function Bekleme({ uploadId, school }: { uploadId: string; school: boolean }) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      try {
        const res = await fetch(`/ogrenci/sonuc/durum?yukleme=${encodeURIComponent(uploadId)}`, { cache: 'no-store' });
        const body = (await res.json()) as { state?: string };
        if (body.state && body.state !== 'waiting') {
          router.refresh();
          return;
        }
      } catch {
        // ağ kesintisi: bir sonraki turda yeniden denenir
      }
      const delay = pollDelay(Date.now() - started);
      if (delay === null || stopped) {
        setSlow(true);
        return;
      }
      if (Date.now() - started > 60_000) setSlow(true);
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 1_500);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [uploadId, router]);

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
