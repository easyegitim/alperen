'use client';

import { useRouter } from 'next/navigation';
import { ProgressBar } from '@/ds';
import { DRAFT_STATUS_LABELS, type DraftStatus } from '@/lib/curriculum-tree';
import { useLive, type LiveTiming } from '@/lib/live';

export interface DraftProgressProps {
  curriculumId: string;
  status: DraftStatus;
  progress: number;
}

/** Taslak (araştırma + Opus taslağı) dakikalar sürebilir: yoklama bütçesi 15 dk; aralık ortak (2 sn → 5 sn). */
export const DRAFT_LIVE_TIMING: Partial<LiveTiming> = { maxElapsedMs: 15 * 60_000 };

/**
 * Taslak işi sürerken ilerleme: curricula satırındaki draft_status/draft_progress değişince sayfa tazelenir
 * (`useLive`: Supabase Realtime varsa olayla, yoksa 2 sn → 5 sn yoklamayla; sekme gizliyken durur).
 */
export function DraftProgress({ curriculumId, status, progress }: DraftProgressProps) {
  const router = useRouter();
  useLive({
    key: `curriculum-${curriculumId}`,
    tables: [{ table: 'curricula', event: 'UPDATE', filter: `id=eq.${curriculumId}` }],
    timing: DRAFT_LIVE_TIMING,
    check: () => router.refresh(),
  });
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-4" aria-live="polite">
      <p className="text-label m-0 text-ink">{DRAFT_STATUS_LABELS[status]}</p>
      <ProgressBar value={progress} label="Taslak ilerlemesi" valueText={DRAFT_STATUS_LABELS[status]} showValue={false} />
      <p className="text-small m-0 text-ink-muted">Öğrenmen resmi programı ve sınav kılavuzunu okuyup kazanım ağacını kuruyor. Bitince ağaç burada açılır.</p>
    </div>
  );
}
