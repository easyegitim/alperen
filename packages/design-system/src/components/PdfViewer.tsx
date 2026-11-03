'use client';

import { useEffect, useRef, useState } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { Download } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button, buttonClasses } from './Button';

export interface PdfViewerProps extends Omit<ComponentPropsWithRef<'article'>, 'title'> {
  /** PDF adresi (imzalı depolama adresi ya da aynı kökenden yol). */
  src: string;
  title: string;
  headingLevel?: 1 | 2 | 3;
  /**
   * "İndir / Paylaş" tek düğmesi. Verilirse düğme bunu çağırır (ör. Web Share API);
   * verilmezse düğme `src` adresini indiren bir bağlantıdır.
   */
  onShare?: () => void;
  /** pdf.js işçi dosyasının adresi; verilmezse paketin kendi işçisi kullanılır. */
  workerSrc?: string;
  /** Sayfa çizim ölçeği çarpanı (varsayılan 1,5; yüksek yoğunluklu ekranlar için keskin kalır). */
  scale?: number;
}

type Status = 'loading' | 'ready' | 'error';

interface PdfPageProxy {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<unknown>; cancel?: () => void };
}
interface PdfDocProxy {
  numPages: number;
  getPage(n: number): Promise<PdfPageProxy>;
  destroy?: () => Promise<void> | void;
}

/**
 * PDF görüntüleyici (pdf.js): belgeyi sayfa sayfa tuvale çizer; şekiller, şemalar ve formüller her cihazda aynı görünür.
 * Tek eylem vardır: "İndir / Paylaş". pdf.js ilk açılışta tembel yüklenir (sunucu tarafında çalışmaz).
 */
export function PdfViewer({ src, title, headingLevel = 1, onShare, workerSrc, scale = 1.5, className, ...rest }: PdfViewerProps) {
  const Heading = `h${headingLevel}` as const;
  const [status, setStatus] = useState<Status>('loading');
  const [pages, setPages] = useState(0);
  const holder = useRef<HTMLDivElement>(null);
  const canvases = useRef<Array<HTMLCanvasElement | null>>([]);

  // Belgeyi yükle.
  const docRef = useRef<PdfDocProxy | null>(null);
  const [docVersion, setDocVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setPages(0);
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc ?? new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        const task = pdfjs.getDocument({ url: src });
        const doc = (await task.promise) as unknown as PdfDocProxy;
        if (cancelled) {
          void doc.destroy?.();
          return;
        }
        docRef.current = doc;
        setPages(doc.numPages);
        setStatus('ready');
        setDocVersion((v) => v + 1);
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      const d = docRef.current;
      docRef.current = null;
      void d?.destroy?.();
    };
  }, [src, workerSrc]);

  // Sayfaları sırayla çiz.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || status !== 'ready') return;
    let cancelled = false;
    const width = holder.current?.clientWidth || 640;
    (async () => {
      for (let n = 1; n <= doc.numPages; n++) {
        if (cancelled) return;
        const canvas = canvases.current[n - 1];
        if (!canvas) continue;
        try {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const fit = Math.max(0.1, (width / base.width) * (scale / 1.5));
          const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
          const viewport = page.getViewport({ scale: fit * dpr });
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.aspectRatio = `${base.width} / ${base.height}`;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
        } catch {
          if (!cancelled) setStatus('error');
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docVersion, status, scale]);

  return (
    <article lang="tr" {...rest} className={cn('mx-auto flex w-full max-w-160 flex-col gap-4', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <Heading className="text-title-2 m-0 min-w-0 text-ink">{title}</Heading>
        {onShare ? (
          <Button variant="secondary" icon={<Download size={18} />} onClick={onShare}>
            İndir / Paylaş
          </Button>
        ) : (
          <a href={src} download className={buttonClasses({ variant: 'secondary' })}>
            <Download aria-hidden="true" size={18} />
            İndir / Paylaş
          </a>
        )}
      </header>
      {status === 'loading' ? (
        <p role="status" className="text-body m-0 text-ink-muted">
          Belge açılıyor
        </p>
      ) : null}
      {status === 'error' ? (
        <p role="alert" className="text-body m-0 text-danger">
          ✕ Belge açılamadı. Yine de indirebilirsin.
        </p>
      ) : null}
      <div ref={holder} className="flex flex-col gap-4">
        {Array.from({ length: pages }, (_, i) => (
          <canvas
            key={i}
            ref={(el) => {
              canvases.current[i] = el;
            }}
            role="img"
            aria-label={`${title}, sayfa ${i + 1} / ${pages}`}
            className="block w-full rounded-md border border-line bg-paper"
          />
        ))}
      </div>
    </article>
  );
}
