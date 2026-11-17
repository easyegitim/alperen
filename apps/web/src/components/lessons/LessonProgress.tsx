'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import { Button, Notice, ProgressBar } from '@/ds';
import { useLive } from '@/lib/live';
import { isWorking, stageLine, stageProgress } from '@/server/lessons/shared';

type RetryAction = (lessonId: string) => Promise<{ ok: boolean; message: string }>;

/**
 * Ders işlenirken ayrıntı sayfasının üstündeki tek satır: aşama kelimeyle + ince çubuk. `useLive` aşama ya da durum
 * değişince sayfayı tazeler (transkript ve iddialar geldikçe belirir); düşerse tek cümle not ve (dersi yöneten
 * eğitmene) "Yeniden dene": aynı yüklemeyle yeniden işler (retry_lesson), dosya yeniden yüklenmez. Takılan ders
 * (`stalled`: 2 saattir ilerleme yok) de aynı notu ve düğmeyi alır.
 */
export function LessonProgress({
  lessonId,
  status,
  stage,
  error,
  transcriptReady,
  stalled = false,
  retry,
}: {
  lessonId: string;
  status: string;
  stage: string | null;
  error: string | null;
  transcriptReady: boolean;
  stalled?: boolean;
  retry?: RetryAction | undefined;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const working = isWorking(status, stage) && !stalled;
  useLive({
    key: `ders-${lessonId}`,
    enabled: working,
    tables: [{ table: 'lessons', filter: `id=eq.${lessonId}`, event: 'UPDATE' }],
    timing: { maxElapsedMs: 60 * 60_000 },
    check: async () => {
      const res = await fetch('/egitmen/dersler/durum', { cache: 'no-store' });
      if (!res.ok) return false;
      const body = (await res.json()) as { rows: { id: string; status: string; stage: string | null; transcript_ready: boolean; working: boolean }[] };
      const me = body.rows.find((r) => r.id === lessonId);
      if (!me) return false;
      if (me.status !== status || me.stage !== stage || me.transcript_ready !== transcriptReady) router.refresh();
      return !me.working;
    },
  });
  if (stage === 'failed' || status === 'failed' || stalled) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="warning" data-testid="ders-hata">
          {stalled ? 'Bu dersin işlenmesi yarıda kaldı.' : <>Bu dersi işleyemedim{error ? `: ${error}` : '.'}</>}
          {retry ? ' Aynı kayıtla yeniden deneyebilirsin.' : ''}
        </Notice>
        {retry ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              disabled={pending}
              icon={<RotateCcw size={16} />}
              data-testid="ders-yeniden-dene"
              onClick={() =>
                start(async () => {
                  const r = await retry(lessonId);
                  setNote(r.ok ? null : r.message);
                  if (r.ok) router.refresh();
                })
              }
            >
              Yeniden dene
            </Button>
            {note ? (
              <p role="status" className="text-small m-0 text-ink-muted">
                {note}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
  if (!working) return null;
  return (
    <div data-testid="ders-ilerleme" className="rounded-lg border border-line bg-surface-raised p-4">
      <ProgressBar value={stageProgress(stage)} label={stageLine(stage)} showValue={false} />
    </div>
  );
}
