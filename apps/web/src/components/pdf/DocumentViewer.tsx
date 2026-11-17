'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PdfViewer, cn } from '@/ds';
import { downloadName } from '@/server/documents/present';

export interface DocumentViewerProps {
  /** İmzalı Storage adresi. */
  src: string;
  title: string;
}

/** Tek "İndir / Paylaş": Web Share ile dosya (varsa), yoksa adres; hiçbiri yoksa dosyayı indirir. */
export async function shareOrDownload(src: string, title: string, nav: Pick<Navigator, 'share' | 'canShare'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const name = downloadName(title);
  try {
    if (nav?.share) {
      const res = await fetch(src);
      if (res.ok) {
        const file = new File([await res.blob()], name, { type: 'application/pdf' });
        if (nav.canShare?.({ files: [file] })) {
          await nav.share({ files: [file], title });
          return 'shared';
        }
      }
      await nav.share({ title, url: src });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return 'cancelled';
  }
  const a = document.createElement('a');
  a.href = src;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return 'downloaded';
}

/**
 * Belge görüntüleyici (mockup S09): PdfViewer (pdf.js, sayfa sayfa tuval) + tek "İndir / Paylaş" + alt çubukta
 * sayfa ‹ ›. Sayfa sayısı ve geçerli sayfa çizilen tuvallerden okunur.
 */
export function DocumentViewer({ src, title }: DocumentViewerProps) {
  const holder = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(0);
  const [current, setCurrent] = useState(1);
  const [announce, setAnnounce] = useState('');

  const canvases = useCallback((): HTMLCanvasElement[] => Array.from(holder.current?.querySelectorAll<HTMLCanvasElement>('canvas') ?? []), []);

  useEffect(() => {
    const root = holder.current;
    if (!root) return;
    const sync = () => setPages(canvases().length);
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [canvases, src]);

  useEffect(() => {
    if (pages === 0 || typeof IntersectionObserver === 'undefined') return;
    const list = canvases();
    const ratios = new Map<Element, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(e.target, e.isIntersecting ? e.intersectionRatio : 0);
        let best = -1;
        let bestRatio = 0;
        list.forEach((c, i) => {
          const r = ratios.get(c) ?? 0;
          if (r > bestRatio) {
            bestRatio = r;
            best = i;
          }
        });
        if (best >= 0) setCurrent(best + 1);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    list.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [pages, canvases]);

  function go(delta: number) {
    const target = Math.min(pages, Math.max(1, current + delta));
    const el = canvases()[target - 1];
    if (!el) return;
    setCurrent(target);
    setAnnounce(`Sayfa ${target} / ${pages}`);
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const btn = 'inline-flex size-11 items-center justify-center rounded-full text-ink hover:bg-surface-sunken disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
  return (
    <div className="flex flex-col gap-4 pb-20" ref={holder} data-testid="belge-goruntuleyici">
      <PdfViewer src={src} title={title} headingLevel={1} onShare={() => void shareOrDownload(src, title)} />
      {pages > 1 ? (
        <nav aria-label="Sayfa" className={cn('fixed inset-x-0 bottom-0 z-10 flex items-center justify-center gap-2 border-t border-line bg-surface-raised px-4 py-2')}>
          <button type="button" onClick={() => go(-1)} disabled={current <= 1} aria-label="Önceki sayfa" className={btn}>
            <ChevronLeft aria-hidden="true" size={22} />
          </button>
          <span className="text-label min-w-24 text-center text-ink tabular-nums" data-testid="sayfa-no">
            Sayfa {current} / {pages}
          </span>
          <button type="button" onClick={() => go(1)} disabled={current >= pages} aria-label="Sonraki sayfa" className={btn}>
            <ChevronRight aria-hidden="true" size={22} />
          </button>
          <span role="status" className="sr-only">
            {announce}
          </span>
        </nav>
      ) : null}
    </div>
  );
}
