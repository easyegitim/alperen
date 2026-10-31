'use client';
// Öğrenciler (BLUEPRINT §7 ogrenciler/page.tsx): liste "Elif K." (person_labels); koordinatör eğitmen/gözlemci atar (staff_students).
import * as React from 'react';
import { Badge, Button, Notice } from '../../lib/ds';
import { useAction, useAsync } from '../../lib/hooks';
import { ActionResult, Loadable, ROLE_TEXT, StaffPage, type StaffContext } from '../../lib/shell';
import type { StudentListItem } from '../../lib/data';
import { studentStatusBadge } from '../../lib/status';


function Assign({ ctx, students, onDone }: { ctx: StaffContext; students: StudentListItem[]; onDone: () => void }) {
  const staff = useAsync(() => ctx.ds.staff(), [ctx.ds]);
  const [staffId, setStaffId] = React.useState('');
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const action = useAction();
  const pick = (id: string) => {
    setStaffId(id);
    setChosen(new Set(students.filter((s) => s.assigned_staff.includes(id)).map((s) => s.student_id)));
  };
  const assignable = (staff.data ?? []).filter((s) => s.role !== 'coordinator' && s.active);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await action.run(() => ctx.ds.assignStudents(staffId, [...chosen]), 'Atama kaydedildi.');
    if (r.ok) onDone();
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)} aria-labelledby="assign-h">
      <h2 id="assign-h" className="t-title-2">
        Eğitmen ve gözlemci ataması
      </h2>
      <div className="field">
        <label htmlFor="assign-staff">Personel</label>
        <select id="assign-staff" value={staffId} onChange={(e) => pick(e.target.value)}>
          <option value="">Seç</option>
          {assignable.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name} · {ROLE_TEXT[s.role]}
            </option>
          ))}
        </select>
      </div>
      {staffId && (
        <fieldset className="stack">
          <legend className="t-label">Atanan öğrenciler</legend>
          {students.map((s) => (
            <label key={s.student_id} className="check">
              <input
                type="checkbox"
                checked={chosen.has(s.student_id)}
                onChange={(e) =>
                  setChosen((c) => {
                    const n = new Set(c);
                    if (e.target.checked) n.add(s.student_id);
                    else n.delete(s.student_id);
                    return n;
                  })
                }
              />
              <span>{s.label}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="row">
        <Button variant="primary" type="submit" disabled={!staffId || action.busy}>
          Atamayı kaydet
        </Button>
      </div>
      <ActionResult error={action.error} message={action.message} />
    </form>
  );
}

function Students(ctx: StaffContext) {
  const students = useAsync(() => ctx.ds.students(), [ctx.ds]);
  return (
    <Loadable state={students}>
      {(rows) => (
        <>
          {rows.length === 0 && <Notice tone="info">Sana atanmış öğrenci yok.</Notice>}
          <table className="table" aria-label="Öğrenci listesi">
            <thead>
              <tr>
                <th>Öğrenci</th>
                <th>Durum</th>
                <th>Onay</th>
                <th>Yaş grubu</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.student_id}>
                  <td>
                    <a href={`/ogrenci?ref=${s.public_ref}`} data-student-label>
                      {s.label}
                    </a>
                  </td>
                  <td>
                    <Badge tone={studentStatusBadge(s.status).tone}>{studentStatusBadge(s.status).text}</Badge>
                  </td>
                  <td>{s.consent_ok ? <Badge tone="success">✓ Tamam</Badge> : <Badge tone="warning">Eksik</Badge>}</td>
                  <td>{s.is_minor ? '18 yaş altı' : '18 yaş ve üstü'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ctx.viewer.role === 'coordinator' && <Assign ctx={ctx} students={rows} onDone={students.reload} />}
        </>
      )}
    </Loadable>
  );
}

export default function Page() {
  return <StaffPage title="Öğrenciler">{(ctx) => <Students {...ctx} />}</StaffPage>;
}
