'use client';
// Bot cevapları denetimi (BLUEPRINT §7 cevaplar/page.tsx): TutorMessage review={model, cost "0,002 $", memory, flagged, onFlag};
// filtre: hafta, yalnız işaretli, öğrenci; temizlenmiş prompt_text açılır panelde. Maliyet yalnız bu denetim satırında görünür.
import * as React from 'react';
import { dayMonth } from '../../lib/format';
import { useAction, useAsync } from '../../lib/hooks';
import { ActionResult, Loadable, StaffPage, type StaffContext } from '../../lib/shell';
import { ResponseReview } from '../../components/ResponseReview';

function Responses(ctx: StaffContext) {
  const { ds } = ctx;
  const [week, setWeek] = React.useState('');
  const [flaggedOnly, setFlaggedOnly] = React.useState(false);
  const [studentRef, setStudentRef] = React.useState('');
  const all = useAsync(() => ds.botResponses({}), [ds]);
  const list = useAsync(() => ds.botResponses({ week: week || null, flaggedOnly, studentRef: studentRef || null }), [ds, week, flaggedOnly, studentRef]);
  const weeks = [...new Set((all.data ?? []).map((r) => r.review_week).filter((w): w is string => !!w))].sort().reverse();
  const students = [...new Map((all.data ?? []).filter((r) => r.student_ref).map((r) => [r.student_ref as string, r.student_label ?? r.student_ref])).entries()];
  const action = useAction();
  return (
    <>
      <form className="row" aria-label="Filtre" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="f-week">Hafta</label>
          <select id="f-week" value={week} onChange={(e) => setWeek(e.target.value)}>
            <option value="">Tümü</option>
            {weeks.map((w) => (
              <option key={w} value={w}>
                {dayMonth(`${w}T12:00:00Z`)} haftası
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-student">Öğrenci</label>
          <select id="f-student" value={studentRef} onChange={(e) => setStudentRef(e.target.value)}>
            <option value="">Tümü</option>
            {students.map(([ref, label]) => (
              <option key={ref} value={ref}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
          <span>Yalnız işaretli</span>
        </label>
      </form>
      <ActionResult error={action.error} message={action.message} />
      <Loadable state={list}>
        {(rows) => (
          <section className="stack" aria-label="Cevaplar">
            <span className="hint">{rows.length} cevap</span>
            {rows.map((r) => (
              <ResponseReview
                key={r.id}
                row={r}
                ctx={ctx}
                onChanged={() => {
                  list.reload();
                  all.reload();
                }}
              />
            ))}
          </section>
        )}
      </Loadable>
    </>
  );
}

export default function Page() {
  return <StaffPage title="Bot cevapları">{(ctx) => <Responses {...ctx} />}</StaffPage>;
}
