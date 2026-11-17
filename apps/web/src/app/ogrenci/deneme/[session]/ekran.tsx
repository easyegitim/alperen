import Image from 'next/image';
import mascot from '@ogrenmen/design-system/assets/Maskot/ogrenmen-maskot.webp';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';
import { ExamResultDetail, OneLineResult } from '@/components/result';
import { documentHref } from '@/server/documents/present';
import { documentDb } from '@/server/documents/read';
import { countsLine, heatRows, itemLines, keyNote, netText, reportPending, reportReady, resultSentence, screenOf, sectionBars } from '@/server/exam-result/present';
import { examSessionView } from '@/server/exam-result/rpc';
import type { ExamSessionView } from '@/server/exam-result/types';
import { isUuid } from '@/server/practice/rpc';
import { DenemeBekleme, SonucYenile } from './bekleme';

function Missing() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <EmptyState title="Bu sonucu bulamadım" action={<LinkButton href="/ogrenci">Bugün’e dön</LinkButton>}>
        {'Bağlantı eski olabilir. Son sonuçların Bugün’de.'}
      </EmptyState>
    </div>
  );
}

function Failed() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-8 py-8 text-center">
        <Image src={mascot} alt="" width={102} height={128} sizes="102px" className="h-32 w-auto" />
        <div className="flex flex-col gap-2">
          <h1 data-testid="tek-cumle" className="text-title-2 m-0 text-ink">
            Denemeni okuyamadım.
          </h1>
          <p className="text-body m-0 text-ink-muted">Düz, aydınlık ve sayfanın tamamı görünen fotoğraflarla yeniden dener misin?</p>
        </div>
      </div>
      <div className="flex flex-col items-stretch gap-2 pb-4">
        <LinkButton href="/ogrenci/yukle" variant="primary" size="lg" block>
          Yeniden yükle
        </LinkButton>
        <LinkButton href="/ogrenci" variant="quiet" size="lg" block>
          Bugün’e dön
        </LinkButton>
      </div>
    </div>
  );
}

function Result({ view, detailOpen }: { view: ExamSessionView; detailOpen: boolean }) {
  const net = view.summary?.net ?? 0;
  return (
    <OneLineResult
      big={{ text: netText(net), label: `Toplam ${netText(net)}` }}
      sentence={resultSentence(view)}
      primary={{ href: '/ogrenci', label: 'Devam et' }}
      defaultDetailOpen={detailOpen}
      detail={
        <ExamResultDetail
          sessionId={view.session_id}
          counts={countsLine(view)}
          keyNote={keyNote(view)}
          sections={sectionBars(view.sections)}
          heat={heatRows(view.heatmap)}
          items={itemLines(view.items)}
          itemsHidden={view.items_hidden}
        />
      }
      extra={
        <>
          {reportReady(view) && view.report ? (
            <LinkButton href={documentHref(view.report.id)} variant="quiet" size="lg" block>
              Raporu aç (PDF)
            </LinkButton>
          ) : null}
          <SonucYenile sessionId={view.session_id} reportPending={reportPending(view)} pendingItems={view.items.filter((i) => i.state === 'pending').length} />
        </>
      }
    />
  );
}

/**
 * Deneme sonucu (S05 düzeni): notlanana dek sade bekleme, gelince büyük net + tek cümle + Devam et; Detay katlı; rapor PDF'i.
 * /ogrenci/deneme/[session] ve (uygulama içi sınavın bitiş adresi) /ogrenci/sonuc?deneme= aynı ekranı çizer.
 */
export async function DenemeSonucu({ sessionId, detailOpen = false }: { sessionId: string; detailOpen?: boolean }) {
  if (!isUuid(sessionId)) return <Missing />;
  const res = await examSessionView(await documentDb(), sessionId);
  if (!res.ok) return <Missing />;
  const view = res.data;
  switch (screenOf(view)) {
    case 'failed':
      return <Failed />;
    case 'waiting':
      return <DenemeBekleme sessionId={sessionId} initial={view.progress ?? null} />;
    default:
      return <Result view={view} detailOpen={detailOpen} />;
  }
}
