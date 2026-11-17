import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { examKindLabel } from '@/lib/exam-admin';
import { requireRole } from '@/server/auth';
import { loadExamList } from '@/server/exam-admin';

export const metadata: Metadata = { title: 'Sınavlar' };

const DATE_FMT = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Istanbul' });
const dateLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : DATE_FMT.format(d);
};

// Sınavlar: kullanıcının JWT'siyle instructor_exam_list (0048). Eğitmen yayımlanmış, bağlı öğrencilerinin çözdüğü ya da
// yüklediği ve düzenleyebildiği sınavları, admin hepsini görür. Anahtar değerleri satır sayfasında (/egitmen/sinavlar/[id]).
export default async function Sayfa() {
  await requireRole('instructor', 'admin');
  const res = await loadExamList();
  const rows = res.ok ? res.rows : [];
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="Sınavlar" description="Cevap anahtarlarını kontrol et; doğrulanmamış anahtarları düzelt." />
      {!res.ok ? (
        <p role="alert" className="text-small text-danger">
          Sınav listesi şu an yüklenemedi. Biraz sonra yeniden dene.
        </p>
      ) : rows.length === 0 ? (
        <EmptyState title="Henüz sınav yok">
          {'Yüklenen ve üretilen sınavlar burada listelenir. Cevap anahtarını kontrol eder, doğrulanmamış anahtarları düzeltirsin.'}
        </EmptyState>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-small border-b border-line text-ink-muted">
              <th scope="col" className="px-3 py-2 font-medium">Sınav</th>
              <th scope="col" className="px-3 py-2 font-medium">Tür</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Soru sayısı</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Oturum</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Anahtar</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="text-small border-b border-line last:border-b-0">
                <td className="px-3 py-2">
                  <Link href={`/egitmen/sinavlar/${r.id}`} className="text-primary">
                    {r.title}
                  </Link>
                  {r.createdAt ? <span className="block text-ink-muted">{dateLabel(r.createdAt)}</span> : null}
                </td>
                <td className="px-3 py-2">{examKindLabel(r.kind)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.questionCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.sessionCount}</td>
                <td className="px-3 py-2 text-right">
                  {r.unverifiedKeys > 0 ? (
                    <span className="font-medium text-warning">{r.unverifiedKeys} anahtar doğrulanmadı</span>
                  ) : r.missingKeys > 0 ? (
                    <span className="text-ink-muted">{r.missingKeys} soru anahtarsız</span>
                  ) : r.questionCount > 0 ? (
                    <span className="text-ink-muted">tamam</span>
                  ) : (
                    <span className="text-ink-muted">soru yok</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
