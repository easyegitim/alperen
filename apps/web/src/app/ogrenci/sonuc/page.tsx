import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Image from 'next/image';
import mascot from '@ogrenmen/design-system/assets/Maskot/ogrenmen-maskot.webp';
import { LinkButton } from '@/components/LinkButton';
import { EmptyState } from '@/components/EmptyState';
import { OneLineResult } from '@/components/result';
import { coachHref } from '@/server/diagnosis/present';
import { getDiagnosis, type DiagnosisView } from '@/server/diagnosis/read';
import { requireRole } from '@/server/auth';
import { uploadClient } from '@/server/uploads/client';
import { isUuid } from '@/server/uploads/shared';
import { getUploadState } from '@/server/uploads/status';
import { Bekleme } from './bekleme';

export const metadata: Metadata = { title: 'Sonuç' };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Ortalanmış tek cümle ekranı (S05): başlık, isteğe bağlı açıklama/kart, altta düğmeler (tek birincil). */
function Center({ children, footer, mascotOn = false }: { children: ReactNode; footer: ReactNode; mascotOn?: boolean }) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-8 py-8 text-center">
        {mascotOn ? <Image src={mascot} alt="" width={102} height={128} sizes="102px" className="h-32 w-auto" /> : null}
        {children}
      </div>
      <div className="flex flex-col items-stretch gap-2 pb-4">{footer}</div>
    </div>
  );
}

/** Teşhis sonucu: testin sonuç ekranıyla aynı bileşen (src/components/result): tek cümle, "Neyi öğrendik", Devam et · Detay · Koça sor. */
function DiagnosisResult({ d }: { d: DiagnosisView }) {
  if (d.verdict === 'unreadable') return <Unreadable />;
  return (
    <OneLineResult
      sentence={d.sentence}
      learned={d.learned}
      primary={{ href: '/ogrenci', label: 'Devam et' }}
      detailHref={`/ogrenci/teshis/${d.id}`}
      coachHref={coachHref(d.id)}
    />
  );
}

function Unreadable() {
  return (
    <Center
      mascotOn
      footer={
        <>
          <LinkButton href="/ogrenci/yukle" variant="primary" size="lg" block>
            Yeniden yükle
          </LinkButton>
          <LinkButton href="/ogrenci" variant="quiet" size="lg" block>
            Bugün’e dön
          </LinkButton>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <h1 data-testid="tek-cumle" className="text-title-2 m-0 text-ink">
          Fotoğrafı okuyamadım.
        </h1>
        <p className="text-body m-0 text-ink-muted">Düz, aydınlık ve yakın bir fotoğrafla yeniden dener misin?</p>
      </div>
    </Center>
  );
}

/** İşleyemedim (worker son denemede de düştü; fotoğrafın suçu değil): tek cümle + yeniden gönder. */
function NotProcessed() {
  return (
    <Center
      mascotOn
      footer={
        <>
          <LinkButton href="/ogrenci/yukle" variant="primary" size="lg" block>
            Yeniden gönder
          </LinkButton>
          <LinkButton href="/ogrenci" variant="quiet" size="lg" block>
            Bugün’e dön
          </LinkButton>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <h1 data-testid="tek-cumle" className="text-title-2 m-0 text-ink">
          Yüklemeni şu an işleyemedim.
        </h1>
        <p className="text-body m-0 text-ink-muted">Sorun sende değil; sayfaları biraz sonra yeniden gönderebilir misin?</p>
      </div>
    </Center>
  );
}

function SchoolReceived() {
  return (
    <Center
      mascotOn
      footer={
        <LinkButton href="/ogrenci" variant="primary" size="lg" block>
          Devam et
        </LinkButton>
      }
    >
      <div className="flex flex-col gap-2">
        <h1 data-testid="tek-cumle" className="text-title-2 m-0 text-ink">
          Sayfaları aldım.
        </h1>
        <p className="text-body m-0 text-ink-muted">Deneme analizi yakında açılıyor; hazır olunca sonucu Bugün’de görürsün.</p>
      </div>
    </Center>
  );
}

// Sonuç (mockup S05): yüklemenin teşhisi gelene dek sade bekleme, gelince tek cümle + "Neyi öğrendik" + Devam et.
export default async function SonucSayfasi({ searchParams }: { searchParams: Search }) {
  await requireRole('student', 'admin');
  const sp = await searchParams;
  const supabase = await uploadClient();
  const analysisParam = one(sp.analiz);
  if (isUuid(analysisParam)) {
    const d = await getDiagnosis(supabase, analysisParam);
    if (d) return <DiagnosisResult d={d} />;
  }
  const uploadId = one(sp.yukleme);
  const state = await getUploadState(supabase, uploadId);
  if (state.state === 'ready') {
    const d = await getDiagnosis(supabase, state.analysisId);
    if (d) return <DiagnosisResult d={d} />;
  }
  if (state.state === 'waiting') return <Bekleme uploadId={uploadId} school={one(sp.tur) === 'deneme'} />;
  if (state.state === 'received') return <SchoolReceived />;
  if (state.state === 'failed') return state.reason === 'processing' ? <NotProcessed /> : <Unreadable />;
  return (
    <div className="mx-auto w-full max-w-3xl">
      <EmptyState title="Bu sonucu bulamadım" action={<LinkButton href="/ogrenci">Bugün’e dön</LinkButton>}>
        {'Bağlantı eski olabilir. Son sonuçların Bugün’de.'}
      </EmptyState>
    </div>
  );
}
