'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ProgressBar } from '@/ds';
import { DRAFT_STATUS_LABELS, type DraftStatus } from '@/lib/curriculum-tree';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export interface DraftProgressProps {
  curriculumId: string;
  status: DraftStatus;
  progress: number;
}

/** Realtime bu sürede bağlanmazsa yoklamaya geçilir. */
export const REALTIME_GRACE_MS = 10_000;
/** Yoklama aralığı (yalnız Realtime yokken ya da koptuğunda). */
export const POLL_MS = 5_000;

/**
 * Taslak işi sürerken ilerleme: curricula satırındaki draft_status/draft_progress değişince (Supabase Realtime) sayfa
 * tazelenir. Yalnız Realtime bağlanamazsa (hata, zaman aşımı, kopma ya da REALTIME_GRACE_MS içinde SUBSCRIBED gelmezse)
 * POLL_MS'de bir yoklanır; Realtime bağlanınca yoklama durur.
 */
export function DraftProgress({ curriculumId, status, progress }: DraftProgressProps) {
  const router = useRouter();
  useEffect(() => {
    let disposed = false;
    let subscribed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (!disposed && !timer) timer = setInterval(() => router.refresh(), POLL_MS);
    };
    const stopPolling = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    let channel: { unsubscribe: () => unknown } | null = null;
    try {
      const supabase = createSupabaseBrowserClient();
      channel = supabase
        .channel(`curriculum-${curriculumId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'curricula', filter: `id=eq.${curriculumId}` }, () => router.refresh())
        .subscribe((state) => {
          if (disposed) return;
          if (state === 'SUBSCRIBED') {
            subscribed = true;
            stopPolling();
          } else {
            subscribed = false;
            startPolling();
          }
        });
    } catch {
      channel = null;
      startPolling();
    }
    const grace = setTimeout(() => {
      if (!subscribed) startPolling();
    }, REALTIME_GRACE_MS);
    return () => {
      disposed = true;
      clearTimeout(grace);
      stopPolling();
      void channel?.unsubscribe();
    };
  }, [curriculumId, router]);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-4" aria-live="polite">
      <p className="text-label m-0 text-ink">{DRAFT_STATUS_LABELS[status]}</p>
      <ProgressBar value={progress} label="Taslak ilerlemesi" valueText={DRAFT_STATUS_LABELS[status]} showValue={false} />
      <p className="text-small m-0 text-ink-muted">Öğrenmen resmi programı ve sınav kılavuzunu okuyup kazanım ağacını kuruyor. Bitince ağaç burada açılır.</p>
    </div>
  );
}
