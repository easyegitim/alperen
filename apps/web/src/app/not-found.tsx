import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';

export default function NotFound() {
  return (
    <main id="icerik" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <EmptyState title="Bu sayfa bulunamadı" action={<LinkButton href="/" variant="primary">Ana sayfaya dön</LinkButton>}>
        {'Adres yanlış yazılmış olabilir ya da sayfa taşınmış olabilir.'}
      </EmptyState>
    </main>
  );
}
