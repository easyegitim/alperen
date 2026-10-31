'use client';
// Kalem (b) öncelik planları (BLUEPRINT §7 oncelik/page.tsx): ?course= — kursun exam_priority_plans listesi,
// seçili planın ExamPriorityRow satırları (başlık "Sıklık analizine göre öncelikler"; kanıt → v_exam_items_full),
// "Onayla" (primary) / "Geri çek" → approve_priority_plan; "Arşiv yükle" formu: PDF → Storage exams/<uuid>.pdf + exam_sources.
import * as React from 'react';
import { Badge, Button, ExamPriorityRow, Notice, TextField } from '../../lib/ds';
import { dateTime } from '../../lib/format';
import { useAction, useAsync, useQueryParam } from '../../lib/hooks';
import { ActionResult, Loadable, StaffPage, type StaffContext } from '../../lib/shell';
import { ALIAS_RE, examFileProblem, examMetaProblem } from '../../lib/validation';
import { LEGAL_BASES, type CourseRow, type ExamItemRow, type ExamSourceRow, type ExamTerm, type LegalBasis, type PriorityPlanRow } from '../../lib/data';

const PLAN_STATUS: Record<PriorityPlanRow['status'], { tone: 'warning' | 'success' | 'neutral'; text: string }> = {
  pending_review: { tone: 'warning', text: 'Onay bekliyor' },
  approved: { tone: 'success', text: '✓ Onaylı' },
  retired: { tone: 'neutral', text: 'Geri çekildi' },
};
const SOURCE_STATUS: Record<ExamSourceRow['status'], { tone: 'neutral' | 'primary' | 'success' | 'danger'; text: string }> = {
  uploaded: { tone: 'neutral', text: 'Yüklendi' },
  ocr_done: { tone: 'primary', text: 'OCR tamam' },
  clustered: { tone: 'success', text: '✓ Kümelendi' },
  failed: { tone: 'danger', text: '✕ Hata' },
};
const TERMS: { v: ExamTerm; text: string }[] = [
  { v: 'vize', text: 'Vize' },
  { v: 'final', text: 'Final' },
  { v: 'but', text: 'Bütünleme' },
  { v: 'deneme', text: 'Deneme' },
  { v: 'osym', text: 'ÖSYM' },
  { v: 'diger', text: 'Diğer' },
];
const ALIASES = Array.from({ length: 26 }, (_, i) => `hoca-${String.fromCharCode(65 + i)}`);

function EvidenceItems({ ctx, ids }: { ctx: StaffContext; ids: string[] }) {
  const items = useAsync(() => ctx.ds.examItems(ids), [ctx.ds, ids.join(',')]);
  return (
    <Loadable state={items}>
      {(rows: ExamItemRow[]) => (
        <table className="table" aria-label="Kanıt maddeleri">
          <thead>
            <tr>
              <th>Madde</th>
              <th>Konu</th>
              <th className="num">Puan</th>
              <th>Arşiv metni</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.item_no}</td>
                <td>{r.topic ?? '—'}</td>
                <td className="num">{r.points ?? '—'}</td>
                <td>{r.ocr_text === undefined ? <span className="muted">Gözlemci arşiv metnini göremez</span> : (r.ocr_text ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Loadable>
  );
}

function PlanView({ ctx, plan, onChanged }: { ctx: StaffContext; plan: PriorityPlanRow; onChanged: () => void }) {
  const [open, setOpen] = React.useState<number | null>(null);
  const action = useAction();
  const decide = async (decision: 'approved' | 'retired') => {
    const r = await action.run(() => ctx.ds.approvePriorityPlan(plan.id, decision), decision === 'approved' ? 'Plan onaylandı; öğrencilere /oncelik bildirimi sıraya alındı.' : 'Plan geri çekildi.');
    if (r.ok) onChanged();
  };
  return (
    <section className="card" aria-labelledby="plan-h">
      <div className="card-head">
        <h2 id="plan-h" className="t-title-2">
          Sıklık analizine göre öncelikler
        </h2>
        <Badge tone={PLAN_STATUS[plan.status].tone}>{PLAN_STATUS[plan.status].text}</Badge>
      </div>
      <span className="hint">
        {plan.course_code} · {plan.period} · {plan.plan.years_total} yıllık arşiv · {plan.evidence_count} kanıt · üretim {dateTime(plan.created_at)}
      </span>
      {plan.plan.rows.map((r) => (
        <div key={r.rank} className="stack">
          <ExamPriorityRow
            rank={r.rank}
            topic={r.topic}
            kind={r.kind}
            hits={r.hits}
            years={plan.plan.years_total}
            points={r.points_text}
            evidence={`${r.evidence_count} kanıt`}
            href={`#kanit-${r.rank}`}
          />
          <Button variant="quiet" size="sm" onClick={() => setOpen(open === r.rank ? null : r.rank)} aria-expanded={open === r.rank}>
            {open === r.rank ? 'Kanıtı gizle' : 'Kanıtı göster'}
          </Button>
          {open === r.rank && (
            <div id={`kanit-${r.rank}`}>
              <EvidenceItems ctx={ctx} ids={r.evidence_item_ids} />
            </div>
          )}
        </div>
      ))}
      {plan.plan.others.length > 0 && <span className="hint">Diğer konular: {plan.plan.others.join(', ')}</span>}
      {(plan.plan.uncovered_topics ?? []).length > 0 && <span className="hint">İzlencede olup arşivde görülmeyen: {(plan.plan.uncovered_topics ?? []).join(', ')}</span>}
      <div className="row">
        <Button variant="primary" disabled={!ctx.canEdit || action.busy || plan.status === 'approved'} onClick={() => void decide('approved')}>
          Onayla
        </Button>
        <Button variant="secondary" disabled={!ctx.canEdit || action.busy || plan.status === 'retired'} onClick={() => void decide('retired')}>
          Geri çek
        </Button>
      </div>
      <ActionResult error={action.error} message={action.message} />
    </section>
  );
}

function UploadForm({ ctx, course, onDone }: { ctx: StaffContext; course: CourseRow; onDone: () => void }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [year, setYear] = React.useState('');
  const [term, setTerm] = React.useState<ExamTerm | ''>('');
  const [basis, setBasis] = React.useState<LegalBasis | ''>('');
  const [alias, setAlias] = React.useState('');
  const [done, setDone] = React.useState(false);
  const action = useAction();
  const aliasError = alias && !ALIAS_RE.test(alias) ? 'Takma ad hoca-A … hoca-Z biçiminde olmalı; gerçek ad girilmez.' : undefined;
  // live ve mock ile aynı denetim (lib/validation.ts): PDF (MIME ya da uzantı), boyut, yıl, dönem, dayanak, takma ad
  const fileError = file ? (examFileProblem(file) ?? undefined) : undefined;
  const meta = term && basis ? { course_id: course.id, year: Number(year), term, legal_basis: basis, instructor_alias: alias } : null;
  const ready = ctx.canEdit && !!file && /^\d{4}$/.test(year) && !!meta && !fileError && examMetaProblem(meta) === null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !meta || !ready) return;
    const r = await action.run(() => ctx.ds.uploadExamSource(file, meta));
    if (r.ok) {
      setDone(true);
      onDone();
    }
  };
  return (
    <form className="form" noValidate onSubmit={(e) => void submit(e)} aria-labelledby="upload-h">
      <h2 id="upload-h" className="t-title-2">
        Arşiv yükle
      </h2>
      <p className="hint">Öğrenci adı ve numarası görünen kâğıtları yüklemeden önce karart. Sınav soruları öğrenciye gösterilmez; yalnız sıklık istatistiği çıkarılır.</p>
      <div className="field">
        <label htmlFor="exam-file">Sınav PDF'i</label>
        <input id="exam-file" type="file" accept="application/pdf,.pdf" disabled={!ctx.canEdit} onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
        {fileError && (
          <span className="hint" role="alert">
            Dosya yüklenemez: {fileError}.
          </span>
        )}
      </div>
      <div className="form-row">
        <TextField label="Yıl" inputMode="numeric" pattern="\d{4}" value={year} onChange={(e) => setYear(e.target.value)} disabled={!ctx.canEdit} required />
        <div className="field">
          <label htmlFor="exam-term">Sınav türü</label>
          <select id="exam-term" value={term} onChange={(e) => setTerm(e.target.value as ExamTerm)} disabled={!ctx.canEdit} required>
            <option value="">Seç</option>
            {TERMS.map((t) => (
              <option key={t.v} value={t.v}>
                {t.text}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="exam-basis">Hukuki dayanak (zorunlu)</label>
        <select id="exam-basis" value={basis} onChange={(e) => setBasis(e.target.value as LegalBasis)} disabled={!ctx.canEdit} required>
          <option value="">Seç</option>
          {LEGAL_BASES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
      <TextField
        label="Eğitmen takma adı"
        hint="hoca-A … hoca-Z; gerçek ad girilmez."
        error={aliasError}
        pattern="^hoca-[A-Z]$"
        list="alias-list"
        value={alias}
        onChange={(e) => setAlias(e.target.value)}
        disabled={!ctx.canEdit}
        required
      />
      <datalist id="alias-list">
        {ALIASES.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
      <div className="row">
        <Button variant="secondary" type="submit" disabled={!ready || action.busy}>
          Arşivi yükle
        </Button>
      </div>
      <ActionResult error={action.error} message={null} />
      {done && (
        <Notice tone="info" title="Yüklendi">
          OCR gece işinde (kalem ingest --queue) yapılır; kümeleme ve izlence hizalaması otomatik izler. Plan üretimi koordinatör tarafından kalem plan --course {course.code} --period
          &lt;dönem&gt; ile çalıştırılır, sonuç kuyrukta onaya düşer.
        </Notice>
      )}
    </form>
  );
}

function Sources({ ctx, course, tick }: { ctx: StaffContext; course: CourseRow; tick: number }) {
  const sources = useAsync(() => ctx.ds.examSources(course.id), [ctx.ds, course.id, tick]);
  return (
    <section className="section" aria-labelledby="sources-h">
      <h2 id="sources-h" className="t-title-2">
        Sınav arşivi
      </h2>
      <Loadable state={sources}>
        {(rows) => (
          <table className="table">
            <thead>
              <tr>
                <th className="num">Yıl</th>
                <th>Tür</th>
                <th>Eğitmen</th>
                <th>Dayanak</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="num">{s.year}</td>
                  <td>{TERMS.find((t) => t.v === s.term)?.text ?? s.term}</td>
                  <td>{s.instructor_alias ?? '—'}</td>
                  <td>{s.legal_basis}</td>
                  <td>
                    <Badge tone={SOURCE_STATUS[s.status].tone}>{SOURCE_STATUS[s.status].text}</Badge>
                    {s.error ? <span className="hint"> {s.error}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Loadable>
    </section>
  );
}

function Priorities(ctx: StaffContext) {
  const courseParam = useQueryParam('course');
  const courses = useAsync(() => ctx.ds.courses(), [ctx.ds]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  const course = (courses.data ?? []).find((c) => c.code === courseParam) ?? courses.data?.[0];
  const plans = useAsync(() => (course ? ctx.ds.priorityPlans(course.code) : Promise.resolve([])), [ctx.ds, course?.code, tick]);
  const list = plans.data ?? [];
  const current = list.find((p) => p.id === selected) ?? list.find((p) => p.status === 'pending_review') ?? list[0];
  return (
    <Loadable state={courses}>
      {() =>
        !course ? (
          <Notice tone="info">Henüz kurs yok.</Notice>
        ) : (
          <>
            <span className="t-title-3">
              {course.title} ({course.code})
            </span>
            <div className="split">
              <ul className="stack" aria-label="Planlar" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {list.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="list-btn" aria-pressed={current?.id === p.id} onClick={() => setSelected(p.id)}>
                      <Badge tone={PLAN_STATUS[p.status].tone}>{PLAN_STATUS[p.status].text}</Badge>
                      <span className="t-small">
                        {p.period} · {dateTime(p.created_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {current ? <PlanView ctx={ctx} plan={current} onChanged={() => setTick((t) => t + 1)} /> : <Notice tone="info">Bu kurs için plan yok.</Notice>}
            </div>
            <Sources ctx={ctx} course={course} tick={tick} />
            <UploadForm ctx={ctx} course={course} onDone={() => setTick((t) => t + 1)} />
          </>
        )
      }
    </Loadable>
  );
}

export default function Page() {
  return <StaffPage title="Öncelikler">{(ctx) => <Priorities {...ctx} />}</StaffPage>;
}
