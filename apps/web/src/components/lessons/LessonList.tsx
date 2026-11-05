'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { Badge, ProgressBar } from '@/ds';
import { useLive } from '@/lib/live';
import { formatDuration, formatHeld, isWorking, lessonName, stageLine, stageProgress, type LessonRow } from '@/server/lessons/shared';

interface StatusRow {
  id: string;
  status: string;
  stage: string | null;
  error: string | null;
  transcript_ready: boolean;
  working: boolean;
}

function rowState(l: LessonRow, live: Map<string, StatusRow>) {
  const s = live.get(l.id);
  const status = s?.status ?? l.status;
  const stage = s?.stage ?? l.stage;
  return { status, stage, error: s?.error ?? l.error ?? null, working: isWorking(status, stage) };
}

/**
 * Ders listesi (S14): her satır ders, öğrenci, tarih, süre ve durum (işlenirken aşama kelimeyle + ince çubuk; hazırsa
 * "n onay bekliyor" ya da "Hazır"). İşlenen ders varken `useLive` listeyi tazeler (Realtime `lessons` ya da yoklama).
 */
export function LessonList({ rows }: { rows: LessonRow[] }) {
  const router = useRouter();
  const [live, setLive] = useState<Map<string, StatusRow>>(new Map());
  const anyWorking = rows.some((l) => isWorking(l.status, l.stage));
  useLive({
    key: 'dersler',
    enabled: anyWorking,
    tables: [{ table: 'lessons', event: 'UPDATE' }],
    timing: { maxElapsedMs: 60 * 60_000 },
    check: async () => {
      const res = await fetch('/egitmen/dersler/durum', { cache: 'no-store' });
      if (!res.ok) return false;
      const body = (await res.json()) as { rows: StatusRow[]; done: boolean };
      setLive(new Map(body.rows.map((r) => [r.id, r])));
      const changed = body.rows.some((r) => {
        const old = rows.find((x) => x.id === r.id);
        return old && (old.status !== r.status || old.stage !== r.stage || old.transcript_ready !== r.transcript_ready);
      });
      if (body.done || changed) router.refresh();
      return body.done;
    },
  });
  return (
    <ul aria-label="Dersler" data-testid="ders-listesi" className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((l) => {
        const st = rowState(l, live);
        const pending = l.claims?.pending ?? 0;
        const meta = [l.student?.name, l.course_title, formatHeld(l.held_at, false), formatDuration(l.duration_sec)].filter(Boolean).join(' · ');
        return (
          <li key={l.id}>
            <Link href={`/egitmen/dersler/${l.id}`} className="flex min-h-16 items-center gap-3 rounded-lg border border-line bg-surface-raised p-4 no-underline hover:border-line-strong" data-testid="ders-satiri">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-label truncate text-ink">{lessonName(l)}</span>
                <span className="text-small truncate text-ink-muted">{meta}</span>
                {st.working ? <ProgressBar value={stageProgress(st.stage)} label={stageLine(st.stage)} showValue={false} className="mt-1 max-w-80" /> : null}
              </div>
              {st.working ? null : st.status === 'failed' || st.stage === 'failed' ? (
                <Badge tone="danger">İşlenemedi</Badge>
              ) : pending > 0 ? (
                <Badge tone="warning">{pending} onay bekliyor</Badge>
              ) : (
                <Badge tone="success">{l.student_visible ? 'Öğrenciye açık' : 'Hazır'}</Badge>
              )}
              <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-ink-muted" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
