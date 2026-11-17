'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { buttonClasses } from '@/ds';
import type { DocRef } from '@/lib/chat';
import { useLive } from '@/lib/live';
import { chatCardLine, type Phase } from '@/server/documents/status';

/** Bu süreden sonra sorgu bırakılır (kart Bugün'de zaten gelir). */
const MAX_WATCH_MS = 10 * 60_000;

interface Watch {
  phase: Phase;
  documentId: string | null;
}

/**
 * Sohbetteki ince belge durum kartı (S03): tek satır — "Hazırlıyorum… Bugün’de görürsün" → hazır olunca "Notun hazır"
 * ve tek "Aç"; hata olursa tek satır. Durum `useLive` ile izlenir (Realtime document_requests ya da yoklama).
 */
export function RequestCard({ doc, fetchImpl }: { doc: DocRef; fetchImpl?: typeof fetch }) {
  const [watch, setWatch] = useState<Watch>({ phase: 'working', documentId: null });
  // Yoklama süresi dolduysa son bilinen evre yerine Bugün'e yönlendiren satır gösterilir (durum orada da izlenir).
  const [gaveUp, setGaveUp] = useState(false);
  useLive({
    key: `docreq-${doc.requestId}`,
    tables: [{ table: 'document_requests', event: 'UPDATE', filter: `id=eq.${doc.requestId}` }],
    timing: { maxElapsedMs: MAX_WATCH_MS, initialDelayMs: 1_500 },
    onGiveUp: () => setGaveUp(true),
    check: async () => {
      const f = fetchImpl ?? fetch;
      const res = await f(`/ogrenci/koc/belge-durum?istek=${encodeURIComponent(doc.requestId)}`, { cache: 'no-store' });
      if (!res.ok) return res.status === 400 || res.status === 403;
      const b = (await res.json()) as { phase?: string; documentId?: string | null };
      const phase: Phase = b.phase === 'review' || b.phase === 'ready' || b.phase === 'failed' ? b.phase : 'working';
      setWatch({ phase, documentId: b.documentId ?? null });
      return phase === 'ready' || phase === 'failed';
    },
  });
  const status = watch.phase === 'working' ? 'generating' : watch.phase;
  const line = gaveUp && watch.phase !== 'ready' && watch.phase !== 'failed' ? 'Bugün’de görürsün' : chatCardLine(doc.kind, status);
  return (
    <div role="status" data-testid="belge-istek" data-phase={watch.phase} className="ml-14 flex max-w-[330px] items-center gap-3 rounded-lg border border-line bg-surface-raised px-3 py-2 sm:max-w-xl">
      <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
        <FileText size={18} strokeWidth={1.75} />
      </span>
      <span className="text-small min-w-0 flex-1 text-ink">{line}</span>
      {watch.phase === 'ready' && watch.documentId ? (
        <Link
          href={`/ogrenci/belge/${watch.documentId}`}
          aria-label={`${doc.title ?? 'Belge'} aç`}
          className={buttonClasses({ variant: 'secondary', size: 'sm' })}
        >
          Aç
        </Link>
      ) : null}
    </div>
  );
}
