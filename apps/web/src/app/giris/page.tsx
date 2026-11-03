import type { Metadata } from 'next';
import { Notice } from '@/ds';
import { AppBrand } from '@/components/AppBrand';
import { safeNextPath } from '@/lib/routing';
import { GirisFormu } from './giris-formu';

export const metadata: Metadata = { title: 'Giriş yap' };

const ERRORS: Record<string, string> = {
  baglanti: 'Giriş bağlantısı geçersiz ya da süresi dolmuş. Yeni bir kod isteyebilirsin.',
  google: 'Google ile giriş başlatılamadı. E-posta koduyla devam edebilirsin.',
};

export default async function GirisPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const nextRaw = Array.isArray(params.next) ? params.next[0] : params.next;
  const errorKey = Array.isArray(params.hata) ? params.hata[0] : params.hata;
  const next = safeNextPath(nextRaw);
  const errorText = errorKey ? ERRORS[errorKey] : undefined;

  return (
    <main id="icerik" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 py-10">
      <div className="flex flex-col gap-4">
        <AppBrand size="lg" />
        <div>
          <h1 className="text-title-1 m-0 text-ink">Giriş yap</h1>
          <p className="text-body mt-1 mb-0 text-ink-muted">Öğrenci, veli ve eğitmen hesapları aynı yerden açılır. Şifre yok: e-postana kod gönderiyoruz.</p>
        </div>
      </div>
      {errorText ? <Notice tone="warning">{errorText}</Notice> : null}
      <GirisFormu next={next} />
      <p className="text-small m-0 text-ink-muted">
        Öğrenmen, easy eğitim şirketinin yapay zekâ destekli öğrenme modelidir. Öğretmenin bir yapay zekâdır ve bunu her zaman söyler.
      </p>
    </main>
  );
}
