'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LinkButton } from '@/components/LinkButton';
import { elapsedSince, pollDelay, SLOW_AFTER_MS } from '@/server/practice/wait';

/**
 * Soru hazırlanırken bekleme notu ve yoklama: sunucu bileşeni aralıklarla yeniden çizilir (sorular gelince oynatıcı
 * açılır, üretim düşerse sonuç). Süre setin açılışından sayılır (yeniden yüklemede sıfırlanmaz); sekme gizliyken
 * yoklama beklemede kalır. 60 sn'yi geçince not tek cümleye döner ve Koç bağlantısı çıkar.
 */
export function Yenile({ startedAt, slow: slowAtRender = false }: { startedAt: string | null | undefined; slow?: boolean }) {
  const router = useRouter();
  const [slow, setSlow] = useState(slowAtRender);
  useEffect(() => {
    const t0 = Date.now() - elapsedSince(startedAt, Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = () => {
      const elapsed = Date.now() - t0;
      if (elapsed >= SLOW_AFTER_MS) setSlow(true);
      const delay = pollDelay(elapsed);
      if (delay === null || stopped) return;
      timer = setTimeout(() => {
        if (document.visibilityState !== 'hidden') router.refresh();
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [router, startedAt]);
  return (
    <>
      <p className="text-body m-0 max-w-prose text-ink-muted" data-testid="hazirlaniyor-not">
        {slow ? 'Biraz uzun sürdü, Koç’a sorabilirsin.' : 'Birkaç saniye sürer; hazır olunca bu ekran kendiliğinden açılır.'}
      </p>
      {slow ? (
        <LinkButton href="/ogrenci/koc" variant="secondary" size="lg">
          Koç’a sor
        </LinkButton>
      ) : null}
    </>
  );
}
