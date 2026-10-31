'use client';
// Soru incelemesi: FigureFrame (denetim adımlarıyla), salt okunur QuizOption'lar, "Cevap anahtarını göster" (peek_answer_key — audit'e yazılır).
// Anahtarı sympy_status='not_applicable' (sözel, LLM kaynaklı) olan soruda "Onayla" bu oturumda anahtar görülene kadar disabled (§7; sunucu OGR-Q-003).
// Kural anahtarın sympy_status'una bağlıdır ama anahtar (secure.answer_keys) görülmeden okunamaz; bu yüzden UI kapalı tarafta
// kalır: verification.sympy 'verified' DEĞİLSE (pending, not_applicable, eksik) anahtar görülene kadar "Onayla" kapalıdır.
import * as React from 'react';
import { Badge, Button, FigureFrame, Notice, QuizOption, TextField } from '../../lib/ds';
import { useAction } from '../../lib/hooks';
import { ActionResult } from '../../lib/shell';
import type { AnswerKeyPeek, FigureRow, QuestionRow } from '../../lib/data';
import type { DetailProps } from './types';

export function needsPeek(q: QuestionRow): boolean {
  return q.verification?.sympy !== 'verified';
}

/** FigureFrame durumu: inceleme reddi (review_status 'rejected', §3.4) ya da çizim hatası → 'failed'. */
export function figureStatus(f: FigureRow): 'verified' | 'pending' | 'failed' {
  if (f.review_status === 'verified') return 'verified';
  return f.review_status === 'rejected' || f.render_status === 'failed' ? 'failed' : 'pending';
}

export function FigureSteps({ figure }: { figure: FigureRow }) {
  return (
    <ul className="hint">
      <li>Çizim: {figure.render_status}</li>
      <li>Görsel denetim: {figure.vision_status}</li>
      <li>İnceleme: {figure.review_status}</li>
      {figure.render_log && <li>Günlük: {figure.render_log}</li>}
    </ul>
  );
}

const SOURCE_TEXT: Record<string, string> = { template: 'Şablon', llm: 'AI ile üretildi', instructor: 'Eğitmen' };

export function QuestionReview({ ctx, detail, setPrimary, onDone }: DetailProps<{ question: QuestionRow; figure: FigureRow | null; figure_url: string | null }>) {
  const { question: q, figure, figure_url } = detail;
  const [key, setKey] = React.useState<AnswerKeyPeek | null>(null);
  const [note, setNote] = React.useState('');
  const action = useAction();
  const { busy, run: act } = action;
  const locked = needsPeek(q) && key === null;

  React.useEffect(() => {
    setPrimary({
      label: 'Onayla',
      disabled: !ctx.canEdit || locked || busy,
      hint: locked ? 'Önce cevap anahtarını gör' : undefined,
      run: async () => (await act(() => ctx.ds.approveQuestion(q.id, 'approved', null))).ok,
    });
  }, [ctx.canEdit, ctx.ds, q.id, locked, busy, act, setPrimary]);

  const peek = async () => {
    const r = await action.run(() => ctx.ds.peekAnswerKey(q.id));
    if (r.ok && r.value) setKey(r.value);
  };
  const decide = async (decision: 'rejected' | 'regenerate') => {
    const r = await action.run(() => ctx.ds.approveQuestion(q.id, decision, note.trim() || null));
    if (r.ok) onDone(decision === 'rejected' ? 'Soru reddedildi.' : 'Soru geri çekildi; gece yeniden üretilecek.');
  };

  return (
    <div className="stack">
      <div className="row">
        <Badge tone={q.source === 'llm' ? 'ai' : 'neutral'}>{SOURCE_TEXT[q.source] ?? q.source}</Badge>
        <Badge tone="warning">Onay bekliyor</Badge>
        <span className="hint">
          Doğrulama: SymPy {q.verification?.sympy ?? '—'} · çizim {q.verification?.render ?? '—'} · görsel {q.verification?.vision ?? '—'}
        </span>
      </div>
      {figure && figure_url && (
        <>
          <FigureFrame src={figure_url} alt={figure.alt_text} status={figureStatus(figure)} source={`Koddan üretildi · ${figure.tool}`} width="100%" />
          <FigureSteps figure={figure} />
        </>
      )}
      <p className="t-title-3">{q.stem}</p>
      <div className="stack" aria-label="Şıklar (salt okunur)">
        {q.options.map((o) => (
          <QuizOption
            key={o.key}
            letter={o.key}
            disabled
            state={key?.correct_option === o.key ? 'correct' : 'idle'}
            feedback={o.misconception_tag ? `Yanılgı: ${o.misconception_tag}` : undefined}
          >
            {o.text}
          </QuizOption>
        ))}
      </div>
      <div className="row">
        <Button variant="secondary" disabled={!ctx.canEdit || action.busy || key !== null} onClick={() => void peek()}>
          Cevap anahtarını göster
        </Button>
        <span className="hint">Anahtarı görmek denetim kaydına yazılır.</span>
      </div>
      {key && (
        <Notice tone="info" title={`Doğru şık: ${key.correct_option ?? '—'}`}>
          {key.solution ?? 'Çözüm metni yok.'} {key.sympy_status === 'not_applicable' ? 'Bu anahtar SymPy ile doğrulanamaz (sözel madde); onay senin denetimine dayanır.' : ''}
        </Notice>
      )}
      <TextField label="İnceleme notu (ret ve yeniden üretim için)" value={note} onChange={(e) => setNote(e.target.value)} disabled={!ctx.canEdit} />
      <div className="row">
        <Button variant="secondary" disabled={!ctx.canEdit || action.busy} onClick={() => void decide('regenerate')}>
          Yeniden üret
        </Button>
        <Button variant="quiet" disabled={!ctx.canEdit || action.busy} onClick={() => void decide('rejected')}>
          Reddet
        </Button>
      </div>
      <ActionResult error={action.error} message={action.message} />
    </div>
  );
}
