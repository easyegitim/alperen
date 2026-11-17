'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, ExamPriorityList, ExamPriorityRow, Notice } from '@/ds';
import { PLAN_STATUS_WORD, priorityLines, scoreText, type LibraryPlan, type LibraryStyle } from '@/server/styles/shared';

type Result = Promise<{ ok: boolean; message: string }>;

/**
 * "Sıklık analizine göre öncelikler" (S13 üst bölüm): çıkmış sınavlarda ne kadar sık sorulduğuna göre sıralı tarzlar.
 * Tahmin değildir; skor = 0,5 · sıklık + 0,3 · güncellik + 0,2 · müfredat uyumu. Onay planı "Onaylandı" yapar; öğrencinin ekranında ayrıca bir yer açmaz.
 */
export function PriorityBlock({
  courseId,
  plan,
  styles,
  canManage,
  yearsTotal,
  compute,
  decide,
}: {
  courseId: string;
  plan: LibraryPlan | null;
  styles: LibraryStyle[];
  canManage: boolean;
  yearsTotal: number;
  compute: (courseId: string) => Result;
  decide: (planId: string, decision: 'approved' | 'retired') => Result;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const lines = plan && plan.status !== 'retired' ? priorityLines(plan, styles) : [];
  const enough = yearsTotal >= 2;

  function run(fn: () => Result) {
    start(async () => {
      const r = await fn();
      setNote({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  return (
    <ExamPriorityList data-testid="oncelikler">
      <p className="text-small m-0 text-ink-muted">Skor = 0,5 · sıklık + 0,3 · güncellik + 0,2 · müfredat uyumu. Yalnız geçmiş sınavların sayımıdır.</p>
      {plan && plan.status !== 'retired' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={plan.status === 'approved' ? 'success' : 'warning'}>{PLAN_STATUS_WORD[plan.status]}</Badge>
          {plan.period ? <span className="text-small text-ink-muted">{plan.period}</span> : null}
        </div>
      ) : null}
      {lines.length > 0 ? (
        <div className="flex flex-col gap-2">
          {lines.map((l) => (
            <div key={l.rank} className="flex flex-wrap items-center gap-3">
              <ExamPriorityRow rank={l.rank} topic={l.topic} kind={l.kind} hits={l.hits} years={l.years} points={l.points} evidence={l.evidence} className="min-w-0 flex-1" />
              {l.score != null ? <span className="text-small text-ink-muted tabular-nums">Skor {scoreText(l.score)}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-body m-0 text-ink-muted" data-testid="oncelik-bos">
          {enough ? 'Henüz öncelik listesi yok.' : 'Öncelik listesi için en az iki yılın çıkmış sınavını yükle.'}
        </p>
      )}
      {plan?.plan.uncovered_topics && plan.plan.uncovered_topics.length > 0 && lines.length > 0 ? (
        <p className="text-small m-0 text-ink-muted">İzlencede olup çıkmış sınavlarda sorulmayan konular: {plan.plan.uncovered_topics.slice(0, 6).join(', ')}.</p>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          {plan?.status === 'pending_review' ? (
            <>
              <Button variant="primary" disabled={pending} onClick={() => run(() => decide(plan.id, 'approved'))}>
                Onayla
              </Button>
              <Button variant="quiet" disabled={pending} onClick={() => run(() => decide(plan.id, 'retired'))}>
                Kaldır
              </Button>
            </>
          ) : null}
          <Button variant={plan?.status === 'pending_review' ? 'secondary' : 'primary'} disabled={pending || !enough} onClick={() => run(() => compute(courseId))}>
            {plan && plan.status !== 'retired' ? 'Yeniden hesapla' : 'Önceliği hesapla'}
          </Button>
          {plan?.status === 'pending_review' ? <span className="text-small self-center text-ink-muted">Yeniden hesaplamak bekleyen listeyi yenisiyle değiştirir.</span> : null}
        </div>
      ) : null}
      {note ? (
        <Notice tone={note.ok ? 'info' : 'warning'} live>
          {note.text}
        </Notice>
      ) : null}
    </ExamPriorityList>
  );
}
