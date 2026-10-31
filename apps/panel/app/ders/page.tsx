'use client';
// Ders raporu (BLUEPRINT §7 ders/page.tsx): claim başına MasteryMeter / MisconceptionItem + EvidenceQuote(kind=lesson),
// ödev ve sözler; üstte "Konuşma oranı · Soru sayısı · Moral" satırı (talk claim'i; onaylanınca memory_facts(kind='morale')).
// Her claim "Onayla / Düzelt / Reddet"; altta tek "Onayla" (primary) → approve_lesson_analysis. Ders maliyeti ayrı bütçededir.
import * as React from 'react';
import { Badge, Button, EvidenceQuote, MasteryMeter, MisconceptionItem, Notice } from '../../lib/ds';
import { band, clock, confidenceBand, dateTime, dayMonth, moraleText, percent } from '../../lib/format';
import { useAction, useAsync, useQueryParam } from '../../lib/hooks';
import { ActionResult, Loadable, StaffPage, type StaffContext } from '../../lib/shell';
import type { ClaimDecision, LessonClaim, LessonDetail } from '../../lib/data';

type Decision = { status: ClaimDecision['status']; edited_value?: Record<string, unknown> | null };

const GROUPS: { title: string; kinds: LessonClaim['kind'][] }[] = [
  { title: 'Kazanımlar', kinds: ['skill_mastery'] },
  { title: 'Kavram yanılgıları', kinds: ['misconception', 'followup'] },
  { title: 'Sorular ve duraksamalar', kinds: ['question', 'hesitation'] },
  { title: 'Ödev, söz ve sonraki adım', kinds: ['homework', 'promise', 'deadline', 'next_step'] },
];

const DECISION_TEXT: Record<ClaimDecision['status'], { tone: 'success' | 'warning' | 'danger'; text: string }> = {
  approved: { tone: 'success', text: '✓ Onaylanacak' },
  edited: { tone: 'warning', text: 'Düzeltildi' },
  rejected: { tone: 'danger', text: '✕ Reddedilecek' },
};

function source(detail: LessonDetail, c: LessonClaim): string {
  return `Ders ${dayMonth(detail.lesson.held_at)} · ${clock(c.t_start_sec)}`;
}

function valueOf(c: LessonClaim, d: Decision | undefined): Record<string, unknown> {
  return (d?.status === 'edited' && d.edited_value) || c.edited_value || c.value;
}

function ClaimEditor({ claim, initial, onSave, onCancel }: { claim: LessonClaim; initial: Record<string, unknown>; onSave: (v: Record<string, unknown>) => void; onCancel: () => void }) {
  const [mastery, setMastery] = React.useState(String(initial.mastery ?? ''));
  const [text, setText] = React.useState(String(initial.text ?? ''));
  const [morale, setMorale] = React.useState(String(initial.morale ?? 'unknown'));
  const id = `edit-${claim.id}`;
  const save = () => {
    if (claim.kind === 'skill_mastery') {
      const m = Number(mastery.replace(',', '.'));
      if (!(m >= 0 && m <= 1)) return;
      onSave({ ...initial, mastery: m });
    } else if (claim.kind === 'talk') onSave({ ...initial, morale });
    else onSave({ ...initial, text: text.trim() });
  };
  return (
    <div className="form">
      {claim.kind === 'skill_mastery' && (
        <div className="field">
          <label htmlFor={id}>Ustalık değeri (0–1)</label>
          <input id={id} type="number" min={0} max={1} step={0.05} value={mastery} onChange={(e) => setMastery(e.target.value)} />
        </div>
      )}
      {claim.kind === 'talk' && (
        <div className="field">
          <label htmlFor={id}>Moral</label>
          <select id={id} value={morale} onChange={(e) => setMorale(e.target.value)}>
            <option value="low">düşük</option>
            <option value="medium">orta</option>
            <option value="high">yüksek</option>
            <option value="unknown">belirsiz</option>
          </select>
        </div>
      )}
      {claim.kind !== 'skill_mastery' && claim.kind !== 'talk' && (
        <div className="field">
          <label htmlFor={id}>Düzeltilmiş metin</label>
          <textarea id={id} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      )}
      <div className="row">
        <Button variant="secondary" size="sm" onClick={save}>
          Düzeltmeyi kaydet
        </Button>
        <Button variant="quiet" size="sm" onClick={onCancel}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}

function ClaimActions({
  claim,
  decision,
  editable,
  onDecide,
  onEdit,
}: {
  claim: LessonClaim;
  decision: Decision | undefined;
  editable: boolean;
  onDecide: (d: Decision) => void;
  onEdit: () => void;
}) {
  const shown = decision?.status ?? (claim.status === 'pending' ? undefined : (claim.status as ClaimDecision['status']));
  return (
    <div className="claim-actions">
      {shown && <Badge tone={DECISION_TEXT[shown].tone}>{DECISION_TEXT[shown].text}</Badge>}
      <Button variant="secondary" size="sm" disabled={!editable} onClick={() => onDecide({ status: 'approved' })}>
        Onayla
      </Button>
      <Button variant="secondary" size="sm" disabled={!editable} onClick={onEdit}>
        Düzelt
      </Button>
      <Button variant="quiet" size="sm" disabled={!editable} onClick={() => onDecide({ status: 'rejected' })}>
        Reddet
      </Button>
    </div>
  );
}

function ClaimBody({ detail, claim, value }: { detail: LessonDetail; claim: LessonClaim; value: Record<string, unknown> }) {
  const skill = claim.skill_id ? (detail.skill_names[claim.skill_id] ?? claim.skill_id) : undefined;
  const ev = { quote: claim.quote, kind: 'lesson' as const, source: source(detail, claim) };
  switch (claim.kind) {
    case 'skill_mastery': {
      const cur = detail.current_mastery.find((m) => m.skill_id === claim.skill_id);
      const m = Number(value.mastery ?? 0);
      const conf = Number(value.confidence ?? 0);
      return (
        <>
          <MasteryMeter skill={skill ?? ''} p={cur?.p ?? 0} evidence={cur?.evidence_count ?? 0} minEvidence={detail.min_evidence} period="Güncel profil" />
          <span className="t-small">
            Bu dersteki değerlendirme: {band(m)} · güven {confidenceBand(conf)}
          </span>
          <EvidenceQuote kind="lesson" source={ev.source}>
            {claim.quote}
          </EvidenceQuote>
        </>
      );
    }
    case 'misconception':
      return <MisconceptionItem text={String(value.text ?? '')} skill={skill} evidence={[ev]} />;
    case 'followup':
      return (
        <>
          <span>Önceki yanılgı takibi: {String(value.status ?? '')}</span>
          <EvidenceQuote kind="lesson" source={ev.source}>
            {claim.quote}
          </EvidenceQuote>
        </>
      );
    default: {
      const label =
        claim.kind === 'question' ? 'Soru' : claim.kind === 'hesitation' ? 'Duraksama' : claim.kind === 'homework' ? 'Ödev' : claim.kind === 'promise' ? 'Söz' : claim.kind === 'deadline' ? 'Teslim' : 'Sonraki adım';
      return (
        <>
          <span className="t-label">
            {label}: {String(value.text ?? claim.quote)}
            {typeof value.due === 'string' ? ` · son gün ${dayMonth(`${value.due}T12:00:00Z`)}` : ''}
          </span>
          {claim.kind === 'next_step' && typeof value.for_instructor === 'string' && <span className="muted">Eğitmen için: {value.for_instructor}</span>}
          <EvidenceQuote kind="lesson" source={ev.source}>
            {claim.quote}
          </EvidenceQuote>
        </>
      );
    }
  }
}

function LessonReport({ ds, canEdit, id }: StaffContext & { id: string }) {
  const detail = useAsync(() => ds.lessonDetail(id), [ds, id]);
  const [decisions, setDecisions] = React.useState<Record<string, Decision>>({});
  const [editing, setEditing] = React.useState<string | null>(null);
  const action = useAction();

  return (
    <Loadable state={detail}>
      {(d) => {
        if (!d) return <Notice tone="info">Rapor bulunamadı ya da bu öğrenci sana atanmamış.</Notice>;
        const draft = d.analysis.status === 'draft';
        const editable = canEdit && draft;
        const talk = d.claims.find((c) => c.kind === 'talk');
        const decide = (claimId: string, dec: Decision) => {
          setDecisions((s) => ({ ...s, [claimId]: dec }));
          setEditing(null);
        };
        // §7: her madde için açık karar (Onayla / Düzelt / Reddet). Karar verilmemiş madde sessizce onaylanmaz: tek "Onayla"
        // hepsi karar alana kadar kapalıdır; kalanları bilerek onaylamak için ayrı "Kalanların hepsini onayla" eylemi vardır.
        const undecided = d.claims.filter((c) => !decisions[c.id] && c.status === 'pending');
        const approveRest = () => {
          setDecisions((s) => {
            const next = { ...s };
            for (const c of undecided) next[c.id] = { status: 'approved' };
            return next;
          });
          setEditing(null);
        };
        const submit = async () => {
          if (undecided.length > 0) return;
          const list: ClaimDecision[] = d.claims.map((c) => {
            const dec = decisions[c.id] ?? { status: c.status as ClaimDecision['status'], edited_value: c.edited_value };
            return { claim_id: c.id, status: dec.status, edited_value: dec.status === 'edited' ? (dec.edited_value ?? null) : null };
          });
          const r = await action.run(() => ds.approveLesson(d.analysis.id, list));
          if (r.ok) {
            action.setMessage(`Rapor onaylandı; ${r.value ?? 0} madde öğrenci profiline işlendi.`);
            detail.reload();
          }
        };
        const renderClaim = (c: LessonClaim) => (
          <article key={c.id} className="card claim">
            <ClaimBody detail={d} claim={c} value={valueOf(c, decisions[c.id])} />
            {editing === c.id ? (
              <ClaimEditor claim={c} initial={valueOf(c, decisions[c.id])} onSave={(v) => decide(c.id, { status: 'edited', edited_value: v })} onCancel={() => setEditing(null)} />
            ) : (
              <ClaimActions claim={c} decision={decisions[c.id]} editable={editable} onDecide={(dec) => decide(c.id, dec)} onEdit={() => setEditing(c.id)} />
            )}
          </article>
        );
        return (
          <>
            <section className="card" aria-label="Ders bilgisi">
              <div className="card-head">
                <div className="stack">
                  <span className="t-title-3">
                    {d.student_label} · {dateTime(d.lesson.held_at)}
                  </span>
                  <span className="muted">
                    {d.staff_name ?? 'Eğitmen bilinmiyor'} · {d.lesson.duration_min ?? '—'} dk · {d.lesson.frames_count ?? 0} kare
                  </span>
                </div>
                <Badge tone="ai">AI ile üretildi · {d.analysis.model}</Badge>
              </div>
              <span className="t-small">{d.cost_line}</span>
            </section>
            {draft ? (
              <Notice tone="warning" title="Onay bekliyor">
                Bu rapor sen onaylayana kadar öğrenci profiline işlenmez; öğrenciye "raporun hazırlanıyor" denir.
              </Notice>
            ) : (
              <Notice tone="info" title="Karar verildi">
                Rapor {d.analysis.status === 'corrected' ? 'düzeltilerek onaylandı' : d.analysis.status === 'approved' ? 'onaylandı' : 'reddedildi'}
                {d.analysis.approved_at ? ` (${dateTime(d.analysis.approved_at)})` : ''}.
              </Notice>
            )}
            {talk && (
              <section className="section" aria-labelledby="talk-h">
                <h2 id="talk-h" className="t-title-2">
                  Konuşma
                </h2>
                <div className="talk-row">
                  <span>Konuşma oranı {percent(Number(valueOf(talk, decisions[talk.id]).student_ratio ?? 0))}</span>
                  <span>·</span>
                  <span>Soru sayısı {String(valueOf(talk, decisions[talk.id]).student_questions ?? 0)}</span>
                  <span>·</span>
                  <span>Moral {moraleText(String(valueOf(talk, decisions[talk.id]).morale ?? ''))}</span>
                </div>
                <Notice tone="info">Onaylanınca moral göstergesi öğrencinin hafızasına moral olgusu olarak yazılır ve takip uyarılarına katılır.</Notice>
                {renderClaim(talk)}
              </section>
            )}
            {GROUPS.map((g) => {
              const claims = d.claims.filter((c) => g.kinds.includes(c.kind));
              if (claims.length === 0) return null;
              return (
                <section key={g.title} className="section" aria-label={g.title}>
                  <h2 className="t-title-2">{g.title}</h2>
                  {claims.map(renderClaim)}
                </section>
              );
            })}
            <ActionResult error={action.error} message={action.message} />
            <div className="row">
              <Button variant="primary" disabled={!editable || action.busy || undecided.length > 0} onClick={() => void submit()}>
                Onayla
              </Button>
              {editable && undecided.length > 0 && (
                <Button variant="secondary" disabled={action.busy} onClick={approveRest}>
                  Kalanların hepsini onayla
                </Button>
              )}
              <span className="hint" aria-live="polite">
                {editable && undecided.length > 0
                  ? `${undecided.length} madde karar bekliyor. Her maddeyi onayla, düzelt ya da reddet; reddedilenler profile işlenmez.`
                  : 'Reddedilen maddeler profile işlenmez.'}
              </span>
            </div>
          </>
        );
      }}
    </Loadable>
  );
}

function LessonPage(ctx: StaffContext) {
  const id = useQueryParam('id');
  if (!id) return <Notice tone="info">Rapor seçilmedi. Ders raporları listesinden bir rapor aç.</Notice>;
  return <LessonReport {...ctx} id={id} />;
}

export default function Page() {
  return <StaffPage title="Ders raporu">{(ctx) => <LessonPage {...ctx} />}</StaffPage>;
}
