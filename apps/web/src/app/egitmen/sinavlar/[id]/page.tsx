import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button, Notice } from '@/ds';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { examKindLabel, KEY_SOURCE_LABELS, optionChoices, SAVE_MESSAGES, type ExamKeyQuestion } from '@/lib/exam-admin';
import { requireRole } from '@/server/auth';
import { loadExamKeys } from '@/server/exam-admin';
import { isUuid } from '@/server/practice/rpc';
import { saveExamKeys } from '../actions';

export const metadata: Metadata = { title: 'Sınav anahtarı' };

const FIELD = 'box-border h-9 rounded-sm border border-line bg-surface-raised px-2 text-body text-ink disabled:opacity-60';

function sourceLine(q: ExamKeyQuestion): string {
  if (!q.source) return q.kind === 'open' ? '' : 'anahtar yok';
  const label = KEY_SOURCE_LABELS[q.source] ?? q.source;
  return q.source === 'inferred' && q.confidence !== null ? `${label} · güven %${Math.round(q.confidence * 100)}` : label;
}

function KeyField({ q, disabled }: { q: ExamKeyQuestion; disabled: boolean }) {
  if (q.kind === 'open') return <span className="text-ink-muted">açık uçlu</span>;
  if (q.kind === 'numeric') {
    return (
      <input
        name={`key-${q.no}`}
        type="text"
        inputMode="decimal"
        defaultValue={q.numericValue ?? ''}
        aria-label={`Soru ${q.no} sayısal cevabı`}
        disabled={disabled}
        className={`${FIELD} w-24`}
      />
    );
  }
  return (
    <select name={`key-${q.no}`} defaultValue={q.correctOption ?? ''} aria-label={`Soru ${q.no} anahtarı`} disabled={disabled} className={FIELD}>
      <option value="">—</option>
      {optionChoices(q).map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

// Sınav anahtarı: instructor_exam_keys (0048; yalnız kapsamdaki sınav, soru metni dönmez) ve tek "Kaydet" →
// saveExamKeys → set_exam_keys (app.can_edit_exam; notlanmış oturumu olan sınavda kilitli).
export default async function Sayfa({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ durum?: string | string[]; n?: string | string[] }>;
}) {
  await requireRole('instructor', 'admin');
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const res = await loadExamKeys(id);
  if (!res.ok && res.code === 'OGR-EXAM-001') notFound();
  if (!res.ok) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader title="Sınav anahtarı" />
        <EmptyState title={res.code === 'OGR-AUTH-002' ? 'Bu sınavı göremezsin' : 'Sınav açılamadı'}>
          {res.code === 'OGR-AUTH-002' ? 'Bu sınav sana bağlı öğrencilerle ilgili değil.' : 'Biraz sonra yeniden dene.'}
        </EmptyState>
        <Link href="/egitmen/sinavlar" className="text-small text-primary">
          Sınavlara dön
        </Link>
      </div>
    );
  }
  const { exam, questions } = res.data;
  const editable = exam.canEdit && !exam.locked;
  const unverified = questions.filter((q) => q.unverified).length;
  const status = typeof sp.durum === 'string' ? sp.durum : null;
  const saved = typeof sp.n === 'string' && /^\d+$/.test(sp.n) ? Number(sp.n) : null;
  const message = status && SAVE_MESSAGES[status] ? (status === 'kaydedildi' && saved ? `${saved} anahtar kaydedildi.` : SAVE_MESSAGES[status]) : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title={exam.title}
        description={`${examKindLabel(exam.kind)} · ${questions.length} soru${unverified > 0 ? ` · ${unverified} anahtar doğrulanmadı` : ''}`}
      />
      <Link href="/egitmen/sinavlar" className="text-small text-primary">
        Sınavlara dön
      </Link>
      {message ? <Notice tone={status === 'kaydedildi' || status === 'degisiklik_yok' ? 'info' : 'warning'}>{message}</Notice> : null}
      {exam.locked ? (
        <Notice tone="warning">Bu sınavın notlanmış oturumu var; anahtar artık değiştirilemez.</Notice>
      ) : !exam.canEdit ? (
        <Notice tone="info">Bu sınavın anahtarını görebilirsin; değiştirmeyi yalnız sınavın eğitmeni ya da admin yapar.</Notice>
      ) : null}
      {exam.isCopyrighted ? <p className="text-small m-0 text-ink-muted">Telifli sınav: soru metinleri burada gösterilmez.</p> : null}
      {questions.length === 0 ? (
        <EmptyState title="Bu sınavda henüz soru yok">{'Sorular kaydedildiğinde anahtarları burada kontrol edersin.'}</EmptyState>
      ) : (
        <form action={saveExamKeys} className="flex flex-col gap-4">
          <input type="hidden" name="exam" value={exam.id} />
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-small border-b border-line text-ink-muted">
                <th scope="col" className="px-3 py-2 text-right font-medium">No</th>
                <th scope="col" className="px-3 py-2 font-medium">Bölüm</th>
                <th scope="col" className="px-3 py-2 font-medium">Kazanım</th>
                <th scope="col" className="px-3 py-2 font-medium">Anahtar</th>
                <th scope="col" className="px-3 py-2 font-medium">Kaynak</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q) => (
                <tr key={q.no} className="text-small border-b border-line last:border-b-0" data-unverified={q.unverified || undefined}>
                  <td className="px-3 py-2 text-right tabular-nums">{q.no}</td>
                  <td className="px-3 py-2">{q.section ?? '—'}</td>
                  <td className="px-3 py-2 font-mono">{q.skillIds.length > 0 ? q.skillIds.join(', ') : '—'}</td>
                  <td className="px-3 py-2">
                    <KeyField q={q} disabled={!editable} />
                  </td>
                  <td className="px-3 py-2">
                    {q.unverified ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-warning">anahtar doğrulanmadı</span>
                        <span className="text-ink-muted">({sourceLine(q)})</span>
                        {editable ? (
                          <label className="flex items-center gap-1">
                            <input type="checkbox" name={`ok-${q.no}`} />
                            Doğru
                          </label>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-ink-muted">{sourceLine(q)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {editable ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary">
                Kaydet
              </Button>
              <span className="text-small text-ink-muted">Değiştirdiğin ve “Doğru” diye işaretlediğin anahtarlar eğitmen anahtarı olarak kaydedilir.</span>
            </div>
          ) : null}
        </form>
      )}
    </div>
  );
}
