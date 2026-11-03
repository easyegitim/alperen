'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ProgressBar } from '@/ds';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

const POLL_MS = 2000;
const SHOW_SKIP_MS = 20_000;

/**
 * Taslak izleyici: curricula satırı değişince (Supabase Realtime, postgres_changes) ya da her 2 sn'de durum ucu
 * (/ogrenci/onboarding/durum) sorulur; bitince Bugün'e geçilir. 20 sn sonra "Bugün’e geç" bağlantısı çıkar.
 */
export function Hazirlik({ curriculumId, initialProgress }: { curriculumId: string; initialProgress: number }) {
  const router = useRouter();
  const [progress, setProgress] = useState(initialProgress);
  const [skip, setSkip] = useState(false);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const r = await fetch(`/ogrenci/onboarding/durum?mufredat=${curriculumId}`, { cache: 'no-store' });
        if (!r.ok) return;
        const s = (await r.json()) as { done: boolean; progress: number };
        if (stopped) return;
        setProgress(s.progress);
        if (s.done) {
          stopped = true;
          router.replace('/ogrenci');
        }
      } catch {
        /* ağ yoksa bir sonraki yoklamada */
      }
    };
    let channel: { unsubscribe: () => unknown } | null = null;
    try {
      channel = createSupabaseBrowserClient()
        .channel(`onboarding-${curriculumId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'curricula', filter: `id=eq.${curriculumId}` }, () => void check())
        .subscribe();
    } catch {
      channel = null;
    }
    const timer = setInterval(() => void check(), POLL_MS);
    const skipTimer = setTimeout(() => setSkip(true), SHOW_SKIP_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(skipTimer);
      void channel?.unsubscribe();
    };
  }, [curriculumId, router]);

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
