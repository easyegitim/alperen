'use client';
// Ders raporları listesi (BLUEPRINT §7): onay bekleyen raporlar Notice warning "Onay bekliyor" taşır ve öğrenci profiline işlenmez.
// "Ders kaydet" formu register_lesson RPC'sini çağırır (video yolu kurucu makinesindedir, Storage'a girmez).
import * as React from 'react';
import { Badge, Button, Notice, TextField } from '../../lib/ds';
import { dateTime } from '../../lib/format';
import { useAction, useAsync } from '../../lib/hooks';
import { ActionResult, Loadable, StaffPage, type StaffContext } from '../../lib/shell';
import type { AnalysisStatus } from '../../lib/data';

const STATUS: Record<AnalysisStatus, { tone: 'warning' | 'success' | 'danger'; text: string }> = {
  draft: { tone: 'warning', text: 'Onay bekliyor' },
  approved: { tone: 'success', text: '✓ Onaylandı' },
  corrected: { tone: 'success', text: '✓ Düzeltilerek onaylandı' },
  rejected: { tone: 'danger', text: '✕ Reddedildi' },
};

function RegisterLesson({ ds, canEdit, onDone }: StaffContext & { onDone: () => void }) {
  const students = useAsync(() => ds.students(), [ds]);
  const staff = useAsync(() => ds.staff(), [ds]);
  const [studentRef, setStudentRef] = React.useState('');
  const [staffId, setStaffId] = React.useState('');
  const [heldAt, setHeldAt] = React.useState('');
  const [duration, setDuration] = React.useState('60');
  const [videoRef, setVideoRef] = React.useState('');
  const action = useAction();
  const instructors = (staff.data ?? []).filter((s) => s.role !== 'observer');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await action.run(
      () => ds.registerLesson({ student_ref: studentRef, staff_id: staffId, held_at: new Date(heldAt).toISOString(), duration_min: Number(duration), video_ref: videoRef.trim() }),
      'Ders kaydedildi. Analiz ders iş akışında (ders.yml) çalışır; rapor onaya düşer.',
    );
    if (r.ok) onDone();
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)} aria-labelledby="register-h">
      <h2 id="register-h" className="t-title-3">
        Ders kaydet
      </h2>
      <p className="hint">Ders kaydı analizi için öğrencinin (18 yaş altında velinin) ders kaydı onayı önceden alınmış olmalı.</p>
      <div className="form-row">
        <div className="field">
          <label htmlFor="lesson-student">Öğrenci</label>
          <select id="lesson-student" value={studentRef} onChange={(e) => setStudentRef(e.target.value)} required disabled={!canEdit}>
            <option value="">Seç</option>
            {(students.data ?? []).map((s) => (
              <option key={s.public_ref} value={s.public_ref}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="lesson-staff">Eğitmen</label>
          <select id="lesson-staff" value={staffId} onChange={(e) => setStaffId(e.target.value)} required disabled={!canEdit}>
            <option value="">Seç</option>
            {instructors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor="lesson-when">Ders zamanı</label>
          <input id="lesson-when" type="datetime-local" value={heldAt} onChange={(e) => setHeldAt(e.target.value)} required disabled={!canEdit} />
        </div>
        <div className="field">
          <label htmlFor="lesson-duration">Süre (dk)</label>
          <input id="lesson-duration" type="number" min={1} max={300} value={duration} onChange={(e) => setDuration(e.target.value)} required disabled={!canEdit} />
        </div>
      </div>
      <TextField label="Video yolu (kurucu makinesi)" hint="Video Storage'a yüklenmez; yalnız yol kaydedilir." value={videoRef} onChange={(e) => setVideoRef(e.target.value)} required disabled={!canEdit} />
      <div className="row">
        <Button variant="secondary" type="submit" disabled={!canEdit || action.busy || !studentRef || !staffId || !heldAt || !videoRef.trim()}>
          Dersi kaydet
        </Button>
      </div>
      <ActionResult error={action.error} message={action.message} />
    </form>
  );
}

function Lessons(ctx: StaffContext) {
  const { ds } = ctx;
  const list = useAsync(() => ds.lessonAnalyses(), [ds]);
  return (
    <>
      <Loadable state={list}>
        {(rows) => (
          <section className="stack" aria-label="Ders raporları">
            {rows.length === 0 && <Notice tone="info">Henüz ders raporu yok.</Notice>}
            {rows.map((r) => (
              <article key={r.analysis_id} className="card">
                <div className="card-head">
                  <div className="stack">
                    <a className="t-title-3" href={`/ders?id=${r.analysis_id}`}>
                      {r.student_label} · {dateTime(r.held_at)}
                    </a>
                    <span className="muted">{r.staff_name ?? 'Eğitmen bilinmiyor'}</span>
                  </div>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Badge>
                </div>
                {r.status === 'draft' && (
                  <Notice tone="warning" title="Onay bekliyor">
                    Bu rapor eğitmen onaylayana kadar öğrenci profiline işlenmez; öğrenciye taslak gösterilmez.
                  </Notice>
                )}
              </article>
            ))}
          </section>
        )}
      </Loadable>
      <RegisterLesson {...ctx} onDone={list.reload} />
    </>
  );
}

export default function Page() {
  return <StaffPage title="Ders raporları">{(ctx) => <Lessons {...ctx} />}</StaffPage>;
}
