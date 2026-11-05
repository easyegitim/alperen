import { notFound, redirect } from 'next/navigation';
import { requireRole } from '@/server/auth';
import { documentHref } from '@/server/documents/present';
import { isUuid } from '@/server/practice/rpc';

// Eski adres: belge görüntüleyici /ogrenci/belge/[id]'e taşındı (P2-D); yer imleri ve eski bağlantılar buraya düşer.
export default async function EskiBelgeAdresi({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('student', 'admin');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  redirect(documentHref(id));
}
