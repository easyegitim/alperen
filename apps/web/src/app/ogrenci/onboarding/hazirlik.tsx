'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ProgressBar } from '@/ds';
import { useLive } from '@/lib/live';

const SHOW_SKIP_MS = 20_000;

/**
 * Taslak izleyici: curricula satırı değişince (Realtime) ya da yoklamayla (`useLive`: 2 sn → 5 sn, sekme gizliyken
 * durur; taslak dakikalar sürebildiği için bütçe 10 dk) durum ucu (/ogrenci/onboarding/durum) sorulur; bitince Bugün'e
 * geçilir. 20 sn sonra (ya da yoklama bütçesi dolunca) "Bugün’e geç" bağlantısı çıkar.
 */
export function Hazirlik({ curriculumId, initialProgress }: { curriculumId: string; initialProgress: number }) {
  const router = useRouter();
  const [progress, setProgress] = useState(initialProgress);
  const [skip, setSkip] = useState(false);

  useLive({
    key: `onboarding-${curriculumId}`,
    tables: [{ table: 'curricula', event: 'UPDATE', filter: `id=eq.${curriculumId}` }],
    timing: { maxElapsedMs: 10 * 60_000 },
    check: async () => {
      const r = await fetch(`/ogrenci/onboarding/durum?mufredat=${curriculumId}`, { cache: 'no-store' });
      if (!r.ok) return false;
      const s = (await r.json()) as { done: boolean; progress: number };
      setProgress(s.progress);
      if (!s.done) return false;
      router.replace('/ogrenci');
      return true;
    },
    onGiveUp: () => setSkip(true),
  });
  useEffect(() => {
    const skipTimer = setTimeout(() => setSkip(true), SHOW_SKIP_MS);
    return () => clearTimeout(skipTimer);
  }, [curriculumId]);

  return (
    <div className="flex w-full flex-col items-center gap-4" aria-live="polite">
      <ProgressBar value={Math.max(5, progress)} label="Plan hazırlığı" valueText={progress >= 100 ? 'Hazır' : 'Hazırlanıyor'} showValue={false} className="w-full" />
      {skip ? (
        <Link href="/ogrenci" className="text-small inline-flex min-h-11 items-center rounded-md px-3 text-ink-muted">
          Bugün’e geç
        </Link>
      ) : null}
    </div>
  );
}
