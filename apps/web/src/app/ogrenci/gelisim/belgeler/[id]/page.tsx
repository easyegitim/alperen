import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { X } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';
import { PdfViewer } from '@/ds';
import { requireRole } from '@/server/auth';
import { isUuid } from '@/server/practice/rpc';
import { documentLine } from '@/server/progress/present';
import { progressClient } from '@/server/progress/read';

export const metadata: Metadata = { title: 'Belge' };

const SIGNED_URL_SECONDS = 600;

// Belge (mockup S09): PDF görüntüleyici (pdf.js, sayfa sayfa) ve tek "İndir / Paylaş". PDF 'documents' kovasından
// kullanıcının JWT'siyle imzalı adresle gelir (Storage politikası generated_documents RLS'ini izler).
export default async function BelgeSayfasi({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('student', 'admin');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = await progressClient();
  const { data: doc } = await db.from('generated_documents').select('id, title, kind, pdf_path, status').eq('id', id).maybeSingle();
  if (!doc) notFound();
  const title = documentLine(doc.title, doc.kind);
  const signed = doc.pdf_path ? await db.storage.from('documents').createSignedUrl(doc.pdf_path, SIGNED_URL_SECONDS) : null;
  const src = signed?.data?.signedUrl ?? null;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex h-15 items-center">
        <Link href="/ogrenci/gelisim" aria-label="Kapat" className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-sunken hover:text-ink">
          <X aria-hidden="true" size={24} strokeWidth={1.75} />
        </Link>
      </div>
      {src ? (
        <PdfViewer src={src} title={title} headingLevel={1} />
      ) : (
        <>
          <h1 className="sr-only">{title}</h1>
          <EmptyState title="Bu belge henüz hazır değil" action={<LinkButton href="/ogrenci/gelisim">Gelişim’e dön</LinkButton>}>
          {'PDF hazır olunca burada sayfa sayfa açılır.'}
          </EmptyState>
        </>
      )}
    </div>
  );
}
