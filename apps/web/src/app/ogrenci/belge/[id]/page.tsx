import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocumentScreen } from '@/components/pdf';
import { loadViewableDocument } from '@/server/documents/read';
import { requireRole } from '@/server/auth';
import { isUuid } from '@/server/practice/rpc';

export const metadata: Metadata = { title: 'Belge' };

// Belge (mockup S09): PDF görüntüleyici (pdf.js, sayfa sayfa) ve tek "İndir / Paylaş". PDF 'documents' kovasından
// kullanıcının JWT'siyle imzalı adresle gelir (Storage politikası generated_documents RLS'ini izler).
export default async function BelgeSayfasi({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('student', 'admin');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const doc = await loadViewableDocument(id);
  if (!doc) notFound();
  return <DocumentScreen doc={doc} closeHref="/ogrenci/gelisim" backLabel="Gelişim’e dön" />;
}
