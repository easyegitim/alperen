'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** En çok bu kadar yenileme (5 sn'den 30 sn'ye uzayan aralıkla yaklaşık 2 dakika). */
export const MAX_REFRESHES = 12;

/** n. yenilemeden önceki bekleme: everyMs'den başlar, her adımda yarım kat artar, 30 sn'yi geçmez. */
export function refreshDelay(everyMs: number, n: number): number {
  return Math.min(30_000, Math.round(everyMs * 1.5 ** n));
}

/**
 * Sunucu bileşenini aralıklarla yeniden çizer (soru üretimi bitince oynatıcı açılır). Bekleme notunu da çizer.
 * Aralık uzar, sekme gizliyken durur, üst sınırda bırakır; sınır dolunca not tek cümleye döner.
 */
export function Yenile({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    let n = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (n >= MAX_REFRESHES) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(() => {
        if (document.visibilityState === 'hidden') {
          schedule(); // gizliyken saymadan bekle
          return;
        }
        n += 1;
        router.refresh();
        schedule();
      }, refreshDelay(everyMs, n));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [router, everyMs]);
  return (
    <p className="text-body m-0 text-ink-muted" data-testid="hazirlaniyor-not">
      {gaveUp ? 'Sorular hazır olunca Bugün’de kart olarak göreceksin.' : 'Hazır olunca bu ekran kendiliğinden açılır.'}
    </p>
  );
}
