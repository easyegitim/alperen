import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { X } from 'lucide-react';
import { LinkButton } from '@/components/LinkButton';
import { requireRole } from '@/server/auth';
import { documentDb } from '@/server/documents/read';
import { examDetailHref, itemLine } from '@/server/exam-result/present';
import { examSessionView } from '@/server/exam-result/rpc';
import { isUuid } from '@/server/practice/rpc';
import { NeredenKadarGeldim } from './nereye-kadar';

export const metadata: Metadata = { title: 'Nereye kadar geldim?' };

// "Nereye kadar geldim?" (sade sayfa): fotoğraf çek / yaz / "Hiç başlayamadım" / "Süre yetmedi". Teşhis edilmiş ya da
// bekleyen soruda form yerine tek cümle durum.
export default async function NereyeKadarSayfasi({ params }: { params: Promise<{ session: string; response: string }> }) {
  const { user } = await requireRole('student', 'admin');
  const { session, response } = await params;
  if (!isUuid(session) || !isUuid(response)) notFound();
  const res = await examSessionView(await documentDb(), session);
  if (!res.ok) notFound();
  const item = res.data.items.find((i) => i.response_id === response);
  if (!item) notFound();
  const back = examDetailHref(session);
  const line = itemLine(item);
  const done = item.state !== 'needs_input';
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div className="flex justify-end">
        <Link href={back} aria-label="Kapat" className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-sunken hover:text-ink">
          <X aria-hidden="true" size={22} strokeWidth={1.75} />
        </Link>
      </div>
      <header className="flex flex-col gap-1">
        <h1 className="text-title-1 m-0 text-ink">Soru {item.no}</h1>
        <p className="text-body m-0 text-ink-muted">{done ? line.title : 'Nereye kadar geldin?'}</p>
      </header>
      {item.state === 'needs_input' ? (
        <NeredenKadarGeldim sessionId={session} responseId={response} ownerId={user.id} blankable={item.outcome !== 'wrong'} />
      ) : (
        <div className="flex flex-col gap-4">
          <p data-testid="nereye-durum" className="text-body-lg m-0 text-ink">
            {item.state === 'diagnosed'
              ? (item.diagnosis?.one_line ?? 'Çözümünü inceledim.')
              : item.state === 'pending'
                ? 'Bakıyorum. Hazır olunca burada görürsün.'
                : item.blank_reason === 'time'
                  ? 'Süre yetmedi diye not aldım.'
                  : 'Hiç başlayamadığını not aldım.'}
          </p>
          <div className="flex flex-col gap-2">
            {item.state === 'diagnosed' && item.solution_analysis_id ? (
              <LinkButton href={`/ogrenci/teshis/${item.solution_analysis_id}?don=${session}`} variant="primary" size="lg" block>
                Teşhisi gör
              </LinkButton>
            ) : null}
            <LinkButton href={back} variant={item.state === 'diagnosed' && item.solution_analysis_id ? 'quiet' : 'primary'} size="lg" block>
              Sonuca dön
            </LinkButton>
          </div>
        </div>
      )}
    </div>
  );
}
