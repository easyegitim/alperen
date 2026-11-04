import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocumentScreen } from '@/components/pdf';
import { loadViewableDocument } from '@/server/documents/read';
import { requireRole } from '@/server/auth';
import { isUuid } from '@/server/practice/rpc';

export const metadata: Metadata = { title: 'Rapor' };

// Veli: çocuğun son raporu, öğrencideki belge görüntüleyiciyle aynı ekran (iskelet; P6'da haftalık özet bağlanır).
export default async function VeliRaporSayfasi({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('parent', 'admin');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const doc = await loadViewableDocument(id);
  if (!doc) notFound();
  return <DocumentScreen doc={doc} closeHref="/veli" backLabel="Özet’e dön" />;
}
