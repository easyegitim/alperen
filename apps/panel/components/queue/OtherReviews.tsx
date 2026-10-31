'use client';
// Kuyruğun diğer kalemleri: şekil, yanılgı, havuz açıklaması, ders raporu bağlantısı, işaretli cevap, öncelik planı, araştırma.
import * as React from 'react';
import { Badge, Button, CitationCard, EvidenceQuote, ExamPriorityRow, FigureFrame, MisconceptionItem, Notice, TextField } from '../../lib/ds';
import { dateTime } from '../../lib/format';
import { useAction } from '../../lib/hooks';
import { ActionResult } from '../../lib/shell';
import { ResponseReview } from '../ResponseReview';
import { FigureSteps, figureStatus } from './QuestionReview';
import type { BotResponseRow, EvidenceItem, FigureRow, MisconceptionRow, PoolRow, PriorityPlanRow, QuestionRow, ResearchDetail } from '../../lib/data';
import type { DetailProps } from './types';

export function FigureReview({ ctx, detail, setPrimary, onDone }: DetailProps<{ figure: FigureRow; figure_url: string | null; used_by: QuestionRow[] }>) {
  const action = useAction();
  const { busy, run: act } = action;
  const { figure } = detail;
  React.useEffect(() => {
    setPrimary({
      label: 'Onayla',
      disabled: !ctx.canEdit || busy,
      run: async () => (await act(() => ctx.ds.decideFigure(figure.id, 'verified'))).ok,
    });
  }, [ctx.canEdit, ctx.ds, figure.id, busy, act, setPrimary]);
  return (
    <div className="stack">
      {detail.figure_url && <FigureFrame src={detail.figure_url} alt={figure.alt_text} status={figureStatus(figure)} source={`Koddan üretildi · ${figure.tool}`} caption={figure.alt_text} width="100%" />}
      <FigureSteps figure={figure} />
      {detail.used_by.length > 0 && (
        <div className="stack">
          <span className="t-label">Bu şekli kullanan sorular</span>
          {detail.used_by.map((q) => (
            <span key={q.id} className="t-small">
              {q.stem}
            </span>
          ))}
        </div>
      )}
      <div className="row">
        <Button
          variant="quiet"
          disabled={!ctx.canEdit || action.busy}
          onClick={() =>
            void action.run(() => ctx.ds.decideFigure(figure.id, 'rejected')).then((r) => {
              if (r.ok) onDone('Şekil reddedildi; öğrenciye gösterilmez.');
            })
          }
        >
          Reddet
        </Button>
      </div>
      <ActionResult error={action.error} message={action.message} />
    </div>
  );
}

export function MisconceptionReview({ ctx, detail, setPrimary, onDone }: DetailProps<{ misconception: MisconceptionRow; evidence: EvidenceItem[]; student_label: string | null }>) {
  const action = useAction();
  const { busy, run: act } = action;
  const [note, setNote] = React.useState('');
  const m = detail.misconception;
  const latest = [...detail.evidence].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const pending = m.status === 'pending_review';
  React.useEffect(() => {
    // §10.3: şüpheli yanılgı (pending_review) "3 kanıt ya da eğitmen onayı → open". Onay yanılgıyı açık profile alır.
    if (!pending) {
      setPrimary(null);
      return;
    }
    setPrimary({
      label: 'Onayla',
      disabled: !ctx.canEdit || busy,
      hint: 'Onay yanılgıyı açık yanılgı yapar; öğrenci profilinde ve alıştırma seçiminde görünür.',
      run: async () => (await act(() => ctx.ds.confirmMisconception(m.id))).ok,
    });
  }, [ctx.canEdit, ctx.ds, m.id, pending, busy, act, setPrimary]);
  return (
    <div className="stack">
      <span className="t-label">{detail.student_label ?? 'Öğrenci'}</span>
      <MisconceptionItem
        text={m.text_instructor}
        skill={m.skill_id}
        firstSeen={dateTime(m.first_seen)}
        evidence={detail.evidence.map((e) => ({ quote: e.quote ?? '(alıntı yok)', kind: e.kind === 'lesson' ? 'lesson' : e.kind === 'chat' ? 'chat' : 'quiz', source: e.source_locator ?? undefined }))}
      />
      <TextField label="Ret notu" value={note} onChange={(e) => setNote(e.target.value)} disabled={!ctx.canEdit} />
      <div className="row">
        {m.status === 'open' && (
          // ders takibinde 'improved' gelip yeniden incelemeye düşen açık yanılgı: en yeni kanıt çözüm gözlemi olur
          <Button
            variant="secondary"
            disabled={!ctx.canEdit || action.busy || !latest}
            onClick={() =>
              void action.run(() => ctx.ds.resolveMisconception(m.id, latest!.observation_id)).then((r) => {
                if (r.ok) onDone('Yanılgı çözüldü olarak kapatıldı.');
              })
            }
          >
            Çözüldü olarak kapat
          </Button>
        )}
        <Button
          variant="quiet"
          disabled={!ctx.canEdit || action.busy || !note.trim()}
          onClick={() =>
            void action.run(() => ctx.ds.rejectMisconception(m.id, note.trim())).then((r) => {
              if (r.ok) onDone('Yanılgı reddedildi.');
            })
          }
        >
          Reddet
        </Button>
      </div>
      <ActionResult error={action.error} message={action.message} />
    </div>
  );
}

export function PoolReview({ ctx, detail, setPrimary, onDone }: DetailProps<{ pool: PoolRow }>) {
  const action = useAction();
  const { busy, run: act } = action;
  const p = detail.pool;
  React.useEffect(() => {
    setPrimary({
      label: 'Onayla',
      disabled: !ctx.canEdit || busy,
      run: async () => (await act(() => ctx.ds.decidePool(p.id, 'approved'))).ok,
    });
  }, [ctx.canEdit, ctx.ds, p.id, busy, act, setPrimary]);
  return (
    <div className="stack">
      <div className="row">
        <Badge tone="ai">AI ile üretildi</Badge>
        <Badge tone="neutral">{p.kind === 'hint' ? 'İpucu' : 'Açıklama'}</Badge>
        <span className="hint">
          {p.skill_id}
          {p.misconception_tag ? ` · ${p.misconception_tag}` : ''}
        </span>
      </div>
      <EvidenceQuote kind="chat" source="Havuz açıklaması">
        {p.body}
      </EvidenceQuote>
      <span className="hint">Onaylanan açıklama aynı kazanım, yanılgı ve mod için yeniden üretilmeden servis edilir.</span>
      <div className="row">
        <Button
          variant="quiet"
          disabled={!ctx.canEdit || action.busy}
          onClick={() =>
            void action.run(() => ctx.ds.decidePool(p.id, 'rejected')).then((r) => {
              if (r.ok) onDone('Havuz açıklaması reddedildi.');
            })
          }
        >
          Reddet
        </Button>
      </div>
      <ActionResult error={action.error} message={action.message} />
    </div>
  );
}

export function LessonLink({ detail, setPrimary }: DetailProps<{ analysis_id: string; student_label: string | null }>) {
  React.useEffect(() => setPrimary(null), [setPrimary]);
  return (
    <Notice tone="warning" title="Onay bekliyor" action={<a href={`/ders?id=${detail.analysis_id}`}>Raporu aç</a>}>
      {detail.student_label ?? 'Öğrenci'} için ders raporu madde madde onay bekliyor.
    </Notice>
  );
}

export function FlaggedReview({ ctx, detail, setPrimary, onDone }: DetailProps<{ response: BotResponseRow }>) {
  React.useEffect(() => setPrimary(null), [setPrimary]);
  return <ResponseReview row={detail.response} ctx={ctx} onChanged={() => onDone('Cevap işaretlendi.')} />;
}

export function PlanReview({ ctx, detail, setPrimary, onDone: _onDone }: DetailProps<{ plan: PriorityPlanRow }>) {
  const action = useAction();
  const { busy, run: act } = action;
  const p = detail.plan;
  React.useEffect(() => {
    setPrimary({
      label: 'Onayla',
      disabled: !ctx.canEdit || busy || p.status !== 'pending_review',
      run: async () => (await act(() => ctx.ds.approvePriorityPlan(p.id, 'approved'))).ok,
    });
  }, [ctx.canEdit, ctx.ds, p.id, p.status, busy, act, setPrimary]);
  return (
    <div className="stack">
      <h3 className="t-title-3">{p.plan.title}</h3>
      <span className="hint">
        {p.course_code} · {p.period} · {p.evidence_count} kanıt · <a href={`/oncelik?course=${encodeURIComponent(p.course_code)}`}>Öncelikler sayfasında aç</a>
      </span>
      {p.plan.rows.map((r) => (
        <ExamPriorityRow key={r.rank} rank={r.rank} topic={r.topic} kind={r.kind} hits={r.hits} years={p.plan.years_total} points={r.points_text} evidence={`${r.evidence_count} kanıt`} />
      ))}
      <ActionResult error={action.error} message={action.message} />
    </div>
  );
}

const RELEVANCE = [
  { v: 0, text: '0 İlgisiz' },
  { v: 1, text: '1 Kısmen' },
  { v: 2, text: '2 Destekliyor' },
] as const;

export function ResearchReview({ ctx, detail, setPrimary }: DetailProps<{ research: ResearchDetail }>) {
  const action = useAction();
  const { busy, run: act } = action;
  const r = detail.research;
  const [relevance, setRelevance] = React.useState<Record<string, number | null>>(() => Object.fromEntries(r.citations.map((c) => [c.id, c.relevance])));
  React.useEffect(() => {
    setPrimary({
      label: 'Yayınla',
      disabled: !ctx.canEdit || busy || r.status !== 'pending_review',
      hint: 'Yayınlanınca öğrenciye "araştırman hazır" bildirimi gider; doğrulanmamış atıflar gösterilmez.',
      run: async () => (await act(() => ctx.ds.publishResearch(r.id))).ok,
    });
  }, [ctx.canEdit, ctx.ds, r.id, r.status, busy, act, setPrimary]);
  const rate = async (citationId: string, value: 0 | 1 | 2) => {
    const res = await action.run(() => ctx.ds.setCitationRelevance(citationId, value));
    if (res.ok) setRelevance((s) => ({ ...s, [citationId]: value }));
  };
  const output = r.output as unknown as { query?: string; synthesis?: { text: string; cites: number[] }[] };
  return (
    <div className="stack">
      <span className="t-label">Sorgu: {output.query ?? '—'}</span>
      {(output.synthesis ?? []).map((s, i) => (
        <p key={i} className="t-small">
          {s.text} <span className="muted">[{s.cites.join(', ')}]</span>
        </p>
      ))}
      {r.citations.map((c) => (
        <CitationCard
          key={c.id}
          title={`${c.ordinal}. ${c.title}`}
          authors={c.authors ?? undefined}
          venue={c.venue ?? undefined}
          year={c.year ?? undefined}
          doi={c.doi ?? undefined}
          verified={c.crossref_status === 'verified'}
          tldr={c.tldr ?? undefined}
          pdfUrl={c.oa_pdf_url ?? undefined}
          actions={
            <div className="field">
              <label htmlFor={`rel-${c.id}`}>İlgi</label>
              <select
                id={`rel-${c.id}`}
                aria-label={`Atıf ${c.ordinal} ilgisi`}
                value={relevance[c.id] === null || relevance[c.id] === undefined ? '' : String(relevance[c.id])}
                disabled={!ctx.canEdit || action.busy}
                onChange={(e) => void rate(c.id, Number(e.target.value) as 0 | 1 | 2)}
              >
                <option value="" disabled>
                  İncelenmedi
                </option>
                {RELEVANCE.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.text}
                  </option>
                ))}
              </select>
            </div>
          }
        />
      ))}
      <ActionResult error={action.error} message={action.message} />
    </div>
  );
}
