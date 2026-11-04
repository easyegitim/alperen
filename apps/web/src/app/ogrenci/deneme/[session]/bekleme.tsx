'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import mascot from '@ogrenmen/design-system/assets/Maskot/ogrenmen-maskot.webp';
import { LinkButton } from '@/components/LinkButton';
import { ProgressBar } from '@/ds';
import { useLive } from '@/lib/live';
import { examStatusHref, stageFraction, waitingLine } from '@/server/exam-result/present';
import type { ExamProgress } from '@/server/exam-result/types';

/** Analiz birkaç dakika sürebilir (40 sayfa): yoklama bütçesi 20 dakika. */
const BUDGET_MS = 20 * 60_000;
/** Bu süreden sonra "Biraz uzun sürüyor" (sonuç Bugün kartında da gelir). */
const SLOW_AFTER_MS = 5 * 60_000;

interface Status {
  screen?: string;
  progress?: ExamProgress | null;
  report?: string;
  pendingItems?: number;
}

async function poll(sessionId: string): Promise<Status | null> {
  try {
    const res = await fetch(examStatusHref(sessionId), { cache: 'no-store' });
    return (await res.json()) as Status;
  } catch {
    return null;
  }
}

/**
 * Bekleme (sade): maskot + "Denemeni inceliyorum…" + aşamaya göre tek alt satır ("sayfa 3/12"). Oturum notlanınca ya da
 * düşünce (Realtime: exam_sessions; yoksa `useLive` yoklaması) sunucu bileşeni yenilenir ve sonuç/hata ekranı çizilir.
 */
export function DenemeBekleme({ sessionId, initial }: { sessionId: string; initial: ExamProgress | null }) {
  const router = useRouter();
  const [progress, setProgress] = useState<ExamProgress | null>(initial);
  const [slow, setSlow] = useState(false);
  useLive({
    key: `exam-${sessionId}`,
    tables: [{ table: 'exam_sessions', event: 'UPDATE', filter: `id=eq.${sessionId}` }],
    timing: { initialDelayMs: 1_500, maxElapsedMs: BUDGET_MS },
    check: async () => {
      const s = await poll(sessionId);
      if (!s) return false;
      if (s.progress) setProgress(s.progress);
      if (s.screen && s.screen !== 'waiting') {
        router.refresh();
        return true;
      }
      return false;
    },
    onGiveUp: () => setSlow(true),
  });
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [sessionId]);

  return (
    <section role="status" className="mx-auto flex w-full max-w-md flex-col items-center gap-6 py-12 text-center">
      <Image src={mascot} alt="" width={102} height={128} sizes="102px" className="h-32 w-auto motion-safe:animate-pulse" priority />
      <h1 className="text-title-1 m-0 text-ink">Denemeni inceliyorum…</h1>
      <p data-testid="bekleme-satiri" className="text-body m-0 text-ink-muted">
        {waitingLine(progress)}
      </p>
      <ProgressBar className="w-full max-w-xs" label="Analiz ilerlemesi" showValue={false} value={Math.round(stageFraction(progress) * 100)} />
      <p className="text-small m-0 max-w-prose text-ink-muted">
        {slow ? 'Biraz uzun sürüyor. Sonuç hazır olunca Bugün’de görürsün.' : 'Birkaç dakika sürebilir. İstersen kapat; sonucu Bugün’de görürsün.'}
      </p>
      <LinkButton href="/ogrenci" variant="quiet">
        Bugün’e dön
      </LinkButton>
    </section>
  );
}

/**
 * Sonuç çizildi ama bir şey sürüyor: rapor PDF'i hazırlanıyor ("Raporun hazırlanıyor…" tek satır) ve/veya "Nereye kadar
 * geldim?" teşhisleri bekliyor. İkisinden biri bitince ekran yenilenir ("Raporu aç", "Teşhisi gör"); sürmüyorsa hiçbir şey çizmez.
 */
export function SonucYenile({ sessionId, reportPending, pendingItems }: { sessionId: string; reportPending: boolean; pendingItems: number }) {
  const router = useRouter();
  useLive({
    key: `exam-live-${sessionId}-${reportPending ? 'r' : '-'}-${pendingItems}`,
    enabled: reportPending || pendingItems > 0,
    tables: [
      { table: 'exam_sessions', event: 'UPDATE', filter: `id=eq.${sessionId}` },
      { table: 'solution_analyses', event: 'INSERT' },
    ],
    timing: { initialDelayMs: 2_000, maxElapsedMs: BUDGET_MS },
    check: async () => {
      const s = await poll(sessionId);
      if (!s) return false;
      const reportDone = reportPending && s.report !== undefined && s.report !== 'pending';
      const itemsDone = pendingItems > 0 && typeof s.pendingItems === 'number' && s.pendingItems < pendingItems;
      if (reportDone || itemsDone) {
        router.refresh();
        return true;
      }
      return false;
    },
  });
  return reportPending ? (
    <p role="status" data-testid="rapor-bekliyor" className="text-small m-0 min-h-11 text-center text-ink-muted">
      Raporun hazırlanıyor…
    </p>
  ) : null;
}
