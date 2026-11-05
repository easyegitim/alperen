'use client';

import { FileText } from 'lucide-react';

export interface AttachmentView {
  id: string;
  kind: 'photo' | 'pdf';
  /** Yerel önizleme (gönderilmeden önce); yoksa sunucudan küçük resim. */
  previewUrl?: string | null;
  name?: string;
}

/** Sohbetteki ek: fotoğraf küçük resmi ya da PDF kutucuğu. */
export function Attachment({ a, size = 'lg' }: { a: AttachmentView; size?: 'sm' | 'lg' }) {
  const box = size === 'lg' ? 'h-36 w-48' : 'h-16 w-16';
  if (a.kind === 'pdf') {
    return (
      <span className={`${box} flex flex-col items-center justify-center gap-1 rounded-lg bg-surface-raised p-2 text-ink-muted shadow-sm ring-1 ring-line`}>
        <FileText aria-hidden="true" size={size === 'lg' ? 28 : 20} />
        <span className="text-caption max-w-full truncate">{a.name ?? 'PDF'}</span>
      </span>
    );
  }
  const src = a.previewUrl ?? `/api/chat/upload/${a.id}`;
  return (
    // Kullanıcının kendi yüklemesi; next/image eniyilemesi kişisel veriyi önbelleğe almasın diye düz img.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={a.name ? `Ek: ${a.name}` : 'Eklediğin fotoğraf'} className={`${box} rounded-lg bg-paper object-cover shadow-sm`} loading="lazy" />
  );
}
