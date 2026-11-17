import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { CAP_STATE_LABELS, capState, EMPTY_COST_OVERVIEW, formatUsd, parseCostOverview, type CostOverview } from '@/lib/cost';
import { requireRole } from '@/server/auth';
import { studentDb } from '@/server/practice/client';
import { callRpc, isMissingFunction } from '@/server/practice/rpc';

export const metadata: Metadata = { title: 'Maliyet' };

// Kullanıcının JWT'siyle instructor_cost_overview (0047; yalnız eğitmen/admin, öğrenci kırılımı bağlı öğrencilerle sınırlı).
// RPC yoksa (göç uygulanmamış, E2E sahte Supabase) boş durum; diğer hatalar loglanır ve kullanıcıya söylenir.
async function loadOverview(): Promise<{ data: CostOverview; failed: boolean }> {
  const res = await callRpc(await studentDb(), 'instructor_cost_overview', {}, parseCostOverview);
  if (res.ok) return { data: res.data, failed: false };
  if (isMissingFunction(res.error)) return { data: EMPTY_COST_OVERVIEW, failed: false };
  console.error('[maliyet] instructor_cost_overview', res.code, res.error.message);
  return { data: EMPTY_COST_OVERVIEW, failed: true };
}

const STATE_TONE = { normal: 'text-ink-muted', near: 'text-warning', over: 'text-danger' } as const;

function BigNumber({ label, total, cap }: { label: string; total: number; cap: number }) {
  const state = capState(total, cap);
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface-raised p-4">
      <span className="text-small text-ink-muted">{label}</span>
      <span className="text-title tabular-nums text-ink">{formatUsd(total)}</span>
      <span className="text-small text-ink-muted">
        {cap > 0 ? `tavan: ${formatUsd(cap)}` : 'tavan yok'} · <span className={STATE_TONE[state]}>{CAP_STATE_LABELS[state]}</span>
      </span>
    </div>
  );
}

const DAY_FMT = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' });
const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : DAY_FMT.format(d);
};

export default async function Sayfa() {
  await requireRole('instructor', 'admin');
  const { data, failed } = await loadOverview();
  const maxDay = Math.max(0, ...data.last7Days.map((d) => d.costUsd));
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="Maliyet" description="Yapay zekâ harcaması ve tavanlar." />
      {failed ? (
        <p role="alert" className="text-small text-danger">
          Maliyet özeti şu an yüklenemedi. Biraz sonra yeniden dene.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BigNumber label="Bugün" total={data.todayUsd} cap={data.dailyCapUsd} />
        <BigNumber label="Bu ay" total={data.monthUsd} cap={data.monthlyCapUsd} />
      </div>
      {data.monthUsd <= 0 ? (
        <EmptyState title="Bu ay harcama kaydı yok">
          {'Model çağrılarının maliyeti rota ve öğrenci başına burada görünür. Günlük ve aylık tavanları buradan izlersin.'}
        </EmptyState>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-label text-ink">Rota başına (bu ay)</h2>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="text-small border-b border-line text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-medium">Rota</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Çağrı</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Maliyet</th>
                </tr>
              </thead>
              <tbody>
                {data.byRoute.map((r) => (
                  <tr key={r.route} className="text-small border-b border-line last:border-b-0">
                    <td className="px-3 py-2 font-mono">{r.route}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.calls}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUsd(r.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-label text-ink">Öğrenci başına (bu ay)</h2>
            {data.byStudent.length === 0 ? (
              <p className="text-small text-ink-muted">Bu ay sana bağlı öğrencilerin harcaması yok.</p>
            ) : (
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="text-small border-b border-line text-ink-muted">
                    <th scope="col" className="px-3 py-2 font-medium">Öğrenci</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Maliyet</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Tavan{data.studentMonthlyCapUsd > 0 ? ` (${formatUsd(data.studentMonthlyCapUsd)})` : ''}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.byStudent.map((s) => (
                    <tr key={s.studentRef} className="text-small border-b border-line last:border-b-0">
                      <td className="px-3 py-2">
                        <Link href="/egitmen" className="text-primary">
                          {s.name ?? 'Adsız öğrenci'}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatUsd(s.costUsd)}</td>
                      <td className={`px-3 py-2 text-right ${s.overCap ? 'text-danger' : 'text-ink-muted'}`}>
                        {s.overCap ? 'tavan aşıldı' : 'normal'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
      {data.last7Days.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-label text-ink">Son 7 gün</h2>
          <ul aria-label="Son 7 gün" className="m-0 flex list-none flex-col gap-1 p-0">
            {data.last7Days.map((d) => (
              <li key={d.day} className="text-small grid grid-cols-[7rem_1fr_5.5rem] items-center gap-3">
                <span className="text-ink-muted">{dayLabel(d.day)}</span>
                <span className="h-2 rounded-full bg-line" aria-hidden="true">
                  <span className="block h-2 rounded-full bg-primary" style={{ width: `${maxDay > 0 ? Math.round((d.costUsd / maxDay) * 100) : 0}%` }} />
                </span>
                <span className="text-right tabular-nums">{formatUsd(d.costUsd)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
