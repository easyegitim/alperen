import { useEffect, useRef } from 'react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import renderMathInElement from 'katex/contrib/auto-render';
import { Download, Sparkles } from 'lucide-react';
import { cn } from '../lib/cn';
import { Badge } from './Badge';
import { buttonClasses } from './Button';

export interface DocumentViewerProps extends Omit<ComponentPropsWithRef<'article'>, 'title'> {
  title: string;
  /**
   * Güvenilir kaynaktan (packages/doc-render) üretilmiş HTML. Kullanıcı girdisi olduğu gibi verilmez;
   * bileşen temizleme yapmaz. `children` ile birlikte verilmez.
   */
  html?: string;
  /** React içeriği (MathText vb.). */
  children?: ReactNode;
  /** html içindeki `$…$`/`$$…$$` ifadelerini KaTeX ile çizer (varsayılan açık). */
  autoRenderMath?: boolean;
  /** Öğrenmen sana göre hazırladı notu ve ai rozeti. */
  personalized?: boolean;
  /** PDF indirme bağlantısı. */
  pdfHref?: string;
  /** Üst çubuğa eylemler ("Çöz", "Soru sor"). */
  actions?: ReactNode;
}

/** Ders notu/belge kabı: en fazla 640px okuma sütunu, KaTeX matematiği, PDF ve eylem çubuğu. */
export function DocumentViewer({
  title,
  html,
  children,
  autoRenderMath = true,
  personalized,
  pdfHref,
  actions,
  className,
  ...rest
}: DocumentViewerProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !html || !autoRenderMath) return;
    renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '$', right: '$', display: false },
      ],
      output: 'htmlAndMathml',
      throwOnError: false,
      strict: 'ignore',
      trust: false,
    });
  }, [html, autoRenderMath]);

  return (
    <article lang="tr" {...rest} className={cn('mx-auto flex w-full max-w-160 flex-col gap-4', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-title-2 m-0 text-ink">{title}</h1>
          {personalized ? (
            <span className="text-small inline-flex items-center gap-2 text-ink-muted">
              <Badge tone="ai">
                <Sparkles aria-hidden="true" size={12} />
                ai
              </Badge>
              Öğrenmen sana göre hazırladı
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {actions}
          {pdfHref ? (
            <a href={pdfHref} className={buttonClasses({ variant: 'secondary' })} download>
              <Download aria-hidden="true" size={18} />
              PDF indir
            </a>
          ) : null}
        </div>
      </header>
      {html ? (
        <div ref={bodyRef} className="og-doc" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="og-doc">{children}</div>
      )}
    </article>
  );
}
