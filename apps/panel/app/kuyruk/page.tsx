'use client';
// Onay kuyruğu (BLUEPRINT §7 kuyruk/page.tsx; v_review_queue): soru ve şekil, yanılgı, havuz açıklaması, ders raporu,
// işaretli cevap, öncelik planı, araştırma. Seçili kalemin tek birincil eylemi bu sayfada tek primary düğmeyle çizilir.
import * as React from 'react';
import { Badge, Button, Notice } from '../../lib/ds';
import { dateTime } from '../../lib/format';
import { useAction, useAsync } from '../../lib/hooks';
import { ActionResult, Loadable, StaffPage, type StaffContext } from '../../lib/shell';
import { QuestionReview } from '../../components/queue/QuestionReview';
import { FigureReview, FlaggedReview, LessonLink, MisconceptionReview, PlanReview, PoolReview, ResearchReview } from '../../components/queue/OtherReviews';
import { AddQuestion } from '../../components/queue/AddQuestion';
import type { PrimaryAction } from '../../components/queue/types';
import type { QueueDetail, QueueKind, QueueRow } from '../../lib/data';

const KIND_TEXT: Record<QueueKind, string> = {
  question: 'Soru',
  figure: 'Şekil',
  misconception: 'Yanılgı',
  pool: 'Havuz açıklaması',
  lesson_analysis: 'Ders raporu',
  flagged_response: 'İşaretli cevap',
  priority_plan: 'Öncelik planı',
  research: 'Araştırma',
};

const keyOf = (r: QueueRow) => `${r.kind}:${r.ref_id}`;

function Detail({ ctx, row, setPrimary, onDone }: { ctx: StaffContext; row: QueueRow; setPrimary: (a: PrimaryAction | null) => void; onDone: (m: string) => void }) {
  const detail = useAsync(() => ctx.ds.queueDetail(row), [ctx.ds, row.kind, row.ref_id]);
  return (
    <Loadable state={detail}>
      {(d: QueueDetail | null) => {
        if (!d) return <Notice tone="info">Bu kalem artık görünmüyor.</Notice>;
        const props = { ctx, setPrimary, onDone };
        switch (d.kind) {
          case 'question':
            return <QuestionReview key={row.ref_id} {...props} detail={d} />;
          case 'figure':
            return <FigureReview key={row.ref_id} {...props} detail={d} />;
          case 'misconception':
            return <MisconceptionReview key={row.ref_id} {...props} detail={d} />;
          case 'pool':
            return <PoolReview key={row.ref_id} {...props} detail={d} />;
          case 'lesson_analysis':
            return <LessonLink key={row.ref_id} {...props} detail={d} />;
          case 'flagged_response':
            return <FlaggedReview key={row.ref_id} {...props} detail={d} />;
          case 'priority_plan':
            return <PlanReview key={row.ref_id} {...props} detail={d} />;
          case 'research':
            return <ResearchReview key={row.ref_id} {...props} detail={d} />;
        }
      }}
    </Loadable>
  );
}

function Queue(ctx: StaffContext) {
  const queue = useAsync(() => ctx.ds.queue(), [ctx.ds]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [primary, setPrimary] = React.useState<PrimaryAction | null>(null);
  const done = useAction();
  const rows = queue.data ?? [];
  const current = rows.find((r) => keyOf(r) === selected) ?? rows[0] ?? null;
  const select = (r: QueueRow) => {
    setPrimary(null);
    done.setMessage(null);
    setSelected(keyOf(r));
  };
  const onDone = React.useCallback(
    (message: string) => {
      setPrimary(null);
      setSelected(null);
      done.setMessage(message);
      queue.reload();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue.reload, done.setMessage],
  );
  const runPrimary = async () => {
    if (!primary || primary.disabled) return;
    const label = primary.label;
    if (await primary.run()) onDone(label === 'Yayınla' ? 'Araştırma yayınlandı.' : 'Onaylandı.');
  };
  return (
    <>
      <ActionResult error={null} message={done.message} />
      <Loadable state={queue}>
        {() =>
          rows.length === 0 ? (
            <Notice tone="info">Kuyruk boş.</Notice>
          ) : (
            <div className="split">
              <ul className="stack" aria-label="Kuyruk" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {rows.map((r) => (
                  <li key={keyOf(r)}>
                    <button type="button" className="list-btn" aria-pressed={current !== null && keyOf(current) === keyOf(r)} onClick={() => select(r)} data-queue-key={keyOf(r)}>
                      <span className="row">
                        <Badge tone="warning">Onay bekliyor</Badge>
                        <span className="t-caption">{KIND_TEXT[r.kind]}</span>
                      </span>
                      <span className="t-small">{r.reason}</span>
                      <span className="t-caption muted">{dateTime(r.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {current && (
                <section className="card" aria-label="Seçili kalem">
                  <span className="t-title-3">{KIND_TEXT[current.kind]}</span>
                  <Detail key={keyOf(current)} ctx={ctx} row={current} setPrimary={setPrimary} onDone={onDone} />
                  {primary && (
                    <div className="row">
                      <Button variant="primary" disabled={primary.disabled} title={primary.hint} onClick={() => void runPrimary()}>
                        {primary.label}
                      </Button>
                      {primary.hint && <span className="hint">{primary.hint}</span>}
                    </div>
                  )}
                </section>
              )}
            </div>
          )
        }
      </Loadable>
      <AddQuestion ctx={ctx} onAdded={queue.reload} />
    </>
  );
}

export default function Page() {
  return <StaffPage title="Onay kuyruğu">{(ctx) => <Queue {...ctx} />}</StaffPage>;
}
