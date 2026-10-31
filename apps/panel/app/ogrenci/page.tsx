'use client';
// Öğrenci profili (BLUEPRINT §7 ogrenci/page.tsx): ?ref= — MasteryMeter listesi (minEvidence settings'ten, dönem "YKS 2027"),
// açık MisconceptionItem'lar kanıtlarıyla, haftalık özet, kota, son denemeler, eğitmen notu (add_instructor_note).
// Öğrenciyle ilgili hiçbir yüzeyde maliyet yoktur.
import * as React from 'react';
import { Badge, Button, MasteryMeter, MisconceptionItem, Notice, ProgressBar } from '../../lib/ds';
import { dateTime, dayMonth } from '../../lib/format';
import { useAction, useAsync, useQueryParam } from '../../lib/hooks';
import { ActionResult, Loadable, StaffPage, type StaffContext } from '../../lib/shell';
import type { StudentDetail } from '../../lib/data';
import { studentStatusBadge } from '../../lib/status';

const QUOTA_TEXT: Record<string, string> = { message: 'Mesaj', test: 'Test', research: 'Araştırma', voice_minutes: 'Ses (dk)', figure: 'Şekilli soru' };
const CONTEXT_TEXT: Record<string, string> = { diagnostic: 'Teşhis', practice: 'Pratik', exam_variant: 'Sınav varyantı' };

function NoteForm({ ctx, student, onDone }: { ctx: StaffContext; student: StudentDetail; onDone: () => void }) {
  const [skill, setSkill] = React.useState('');
  const [body, setBody] = React.useState('');
  const [estimate, setEstimate] = React.useState('');
  const [fact, setFact] = React.useState(false);
  const action = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const est = estimate.trim() === '' ? null : Number(estimate.replace(',', '.'));
    const r = await action.run(
      () => ctx.ds.addNote({ enrollment_id: student.enrollment_id, skill_id: skill || null, body: body.trim(), mastery_estimate: est, approved_fact: fact }),
      est === null ? 'Not eklendi.' : 'Not eklendi; ustalık değeri eğitmen gözlemi olarak işlendi.',
    );
    if (r.ok) {
      setBody('');
      setEstimate('');
      setFact(false);
      onDone();
    }
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)} aria-labelledby="note-h">
      <h2 id="note-h" className="t-title-2">
        Eğitmen notu ekle
      </h2>
      <div className="field">
        <label htmlFor="note-skill">Kazanım (isteğe bağlı)</label>
        <select id="note-skill" value={skill} onChange={(e) => setSkill(e.target.value)} disabled={!ctx.canEdit}>
          <option value="">Genel not</option>
          {student.skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="note-body">Not</label>
        <textarea id="note-body" value={body} onChange={(e) => setBody(e.target.value)} disabled={!ctx.canEdit} required />
      </div>
      <div className="field">
        <label htmlFor="note-est">Ustalık değeri (0–1, isteğe bağlı)</label>
        <input id="note-est" type="number" min={0} max={1} step={0.05} value={estimate} onChange={(e) => setEstimate(e.target.value)} disabled={!ctx.canEdit || !skill} />
      </div>
      <label className="check">
        <input type="checkbox" checked={fact} onChange={(e) => setFact(e.target.checked)} disabled={!ctx.canEdit} />
        <span>Bot bu notu öğrenciyle konuşurken hafıza olarak kullanabilir</span>
      </label>
      <div className="row">
        <Button variant="primary" type="submit" disabled={!ctx.canEdit || action.busy || !body.trim()}>
          Notu ekle
        </Button>
      </div>
      <ActionResult error={action.error} message={action.message} />
    </form>
  );
}

function Profile({ ctx, refId }: { ctx: StaffContext; refId: string }) {
  const student = useAsync(() => ctx.ds.student(refId), [ctx.ds, refId]);
  return (
    <Loadable state={student}>
      {(s) =>
        !s ? (
          <Notice tone="info">Öğrenci bulunamadı ya da sana atanmamış.</Notice>
        ) : (
          <>
            <div className="row">
              <span className="t-title-2">{s.label}</span>
              <Badge tone={studentStatusBadge(s.status).tone}>{studentStatusBadge(s.status).text}</Badge>
              <span className="muted">
                {s.period} · {s.is_minor ? '18 yaş altı' : '18 yaş ve üstü'}
              </span>
            </div>
            <section className="section" aria-labelledby="mastery-h">
              <h2 id="mastery-h" className="t-title-2">
                Kazanımlar
              </h2>
              {s.mastery.length === 0 && <Notice tone="info">Henüz gözlem yok. Teşhis testi ya da onaylı ders raporuyla dolar.</Notice>}
              {s.mastery.map((m) => (
                <MasteryMeter key={m.skill_id} skill={m.skill_name} p={m.p} evidence={m.evidence_count} minEvidence={s.min_evidence} period={s.period} />
              ))}
            </section>
            <section className="section" aria-labelledby="miscon-h">
              <h2 id="miscon-h" className="t-title-2">
                Açık kavram yanılgıları
              </h2>
              {s.open_misconceptions.length === 0 && <Notice tone="info">Açık yanılgı yok.</Notice>}
              {s.open_misconceptions.map((m) => (
                <MisconceptionItem
                  key={m.id}
                  text={m.text_instructor}
                  skill={s.skills.find((k) => k.id === m.skill_id)?.name ?? m.skill_id}
                  firstSeen={dateTime(m.first_seen)}
                  evidence={m.evidence.map((e) => ({
                    quote: e.quote ?? 'Yanlış şık seçimi',
                    kind: e.kind === 'lesson' ? 'lesson' : e.kind === 'chat' ? 'chat' : e.kind === 'instructor' ? 'instructor' : 'quiz',
                    source: e.source_locator ?? undefined,
                  }))}
                />
              ))}
            </section>
            <section className="section" aria-labelledby="weekly-h">
              <h2 id="weekly-h" className="t-title-2">
                Haftalık özet
              </h2>
              {s.weekly_summary ? (
                <article className="card">
                  <div className="row">
                    <Badge tone="ai">AI ile üretildi</Badge>
                    <span className="hint">{dayMonth(`${s.weekly_summary.week_start}T12:00:00Z`)} haftası</span>
                  </div>
                  <p>{s.weekly_summary.body}</p>
                </article>
              ) : (
                <Notice tone="info">Bu öğrenci için henüz haftalık özet yok.</Notice>
              )}
            </section>
            <section className="section" aria-labelledby="quota-h">
              <h2 id="quota-h" className="t-title-2">
                Kota
              </h2>
              {s.quota.map((q) => (
                <ProgressBar key={q.kind} value={q.used} max={q.daily_limit ?? 1} label={`${QUOTA_TEXT[q.kind] ?? q.kind} · ${dayMonth(`${q.day}T12:00:00Z`)}`} valueText={`${q.used}/${q.daily_limit ?? '—'}`} />
              ))}
            </section>
            <section className="section" aria-labelledby="attempts-h">
              <h2 id="attempts-h" className="t-title-2">
                Son denemeler
              </h2>
              {s.recent_attempts.length === 0 ? (
                <Notice tone="info">Henüz cevaplanmış soru yok.</Notice>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Zaman</th>
                      <th>Bağlam</th>
                      <th>Soru</th>
                      <th>Sonuç</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.recent_attempts.map((a) => (
                      <tr key={a.id}>
                        <td>{a.graded_at ? dateTime(a.graded_at) : '—'}</td>
                        <td>{CONTEXT_TEXT[a.context] ?? a.context}</td>
                        <td>{a.stem ?? '—'}</td>
                        <td>{a.is_correct === null ? '—' : a.is_correct ? '✓ Doğru' : `✕ Yanlış${a.misconception_tag ? ` · ${a.misconception_tag}` : ''}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            {s.notes.length > 0 && (
              <section className="section" aria-labelledby="notes-h">
                <h2 id="notes-h" className="t-title-2">
                  Eğitmen notları
                </h2>
                {s.notes.map((n) => (
                  <article key={n.id} className="card">
                    <span className="hint">
                      {n.author ?? 'Eğitmen'} · {dateTime(n.created_at)}
                    </span>
                    <p>{n.body}</p>
                  </article>
                ))}
              </section>
            )}
            <NoteForm ctx={ctx} student={s} onDone={student.reload} />
          </>
        )
      }
    </Loadable>
  );
}

function StudentPage(ctx: StaffContext) {
  const ref = useQueryParam('ref');
  if (!ref) return <Notice tone="info">Öğrenci seçilmedi. Öğrenciler listesinden birini aç.</Notice>;
  return <Profile ctx={ctx} refId={ref} />;
}

export default function Page() {
  return <StaffPage title="Öğrenci">{(ctx) => <StudentPage {...ctx} />}</StaffPage>;
}
