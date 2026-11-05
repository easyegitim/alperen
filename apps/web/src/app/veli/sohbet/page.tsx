import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { ParentChat } from '@/components/parent/ParentChat';
import { PARENT_COPY } from '@/lib/parent';
import { requireRole } from '@/server/auth';
import { parentChildren, pickChild } from '@/server/parent/children';
import { loadParentBootstrap } from '@/server/parent/bootstrap';

export const metadata: Metadata = { title: 'Sohbet' };
export const dynamic = 'force-dynamic';

// Veli Sohbet (mockup S10b): klasik sohbet, akışlı yanıt, mod seçici yok; altta "Rapor iste" hızlı çipleri.
// Veli ajanı yalnız velinin görebildiği veriye bakar (parent_* RPC'leri); asla cevap anahtarı ya da koç sohbeti.
export default async function VeliSohbet({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireRole('parent', 'admin');
  const children = await parentChildren(user.id);
  const child = pickChild(children, (await searchParams).cocuk);
  if (!child) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <h1 className="text-title-3 m-0 text-ink">Sohbet</h1>
        <EmptyState title={PARENT_COPY.noChild}>{PARENT_COPY.noChildBody}</EmptyState>
      </div>
    );
  }
  const initial = await loadParentBootstrap(child.id);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <header className="mb-2 flex items-baseline gap-2">
        <h1 className="text-title-3 m-0 text-ink">Sohbet</h1>
        <span className="text-caption font-medium tracking-wide text-ink-muted">AI öğretmen</span>
      </header>
      {children.length > 1 ? (
        <nav aria-label="Çocuklar" className="mb-2 flex flex-wrap gap-2">
          {children.map((c) => (
            <Link
              key={c.id}
              href={`/veli/sohbet?cocuk=${c.id}`}
              aria-current={c.id === child.id ? 'page' : undefined}
              className="text-small min-h-10 rounded-full border border-line px-4 py-2 text-ink no-underline aria-[current=page]:border-primary aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary"
            >
              {c.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <ParentChat key={child.id} studentId={child.id} initial={initial} />
    </div>
  );
}
