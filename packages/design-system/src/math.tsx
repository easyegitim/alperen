import katex from 'katex';
import type { ComponentPropsWithRef } from 'react';
import { cn } from './lib/cn';

// KaTeX yardımcıları. Çıktı "htmlAndMathml": görsel HTML + ekran okuyucu için MathML.
// Stil için uygulama bir kez "@ogrenmen/design-system/styles/katex.css" içe aktarır.

export interface RenderMathOptions {
  /** true: ayrı satırda (display) kip. */
  display?: boolean;
  /** Yalnızca MathML çıktısı (ör. e-posta, düz metin alternatifi). */
  mathmlOnly?: boolean;
}

/** TeX'i güvenli HTML dizgisine çevirir. trust kapalı, hata fırlatmaz (hatalı TeX kırmızı ham metin olarak görünür). */
export function renderMath(tex: string, { display = false, mathmlOnly = false }: RenderMathOptions = {}): string {
  return katex.renderToString(tex, {
    displayMode: display,
    output: mathmlOnly ? 'mathml' : 'htmlAndMathml',
    throwOnError: false,
    strict: 'ignore',
    trust: false,
  });
}

/** Yalnızca MathML dizgisi. */
export function renderMathML(tex: string, display = false): string {
  return renderMath(tex, { display, mathmlOnly: true });
}

export interface TexProps extends Omit<ComponentPropsWithRef<'span'>, 'children' | 'dangerouslySetInnerHTML'> {
  tex: string;
  display?: boolean;
}

/** Tek bir formül (TeX). display ise ayrı satırda ve yatay kaydırılabilir. */
export function Tex({ tex, display = false, className, ...rest }: TexProps) {
  return (
    <span
      {...rest}
      className={cn(display ? 'og-math-display my-2 block' : 'inline', className)}
      dangerouslySetInnerHTML={{ __html: renderMath(tex, { display }) }}
    />
  );
}

export type MathSegment = { type: 'text'; value: string } | { type: 'math'; value: string; display: boolean };

/** `$…$`, `$$…$$`, `\(…\)` ve `\[…\]` sınırlayıcılarını ayırır. Kaçışlı `\$` düz dolar işaretidir. */
export function splitMath(input: string): MathSegment[] {
  const out: MathSegment[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)(?<!\\)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: input.slice(last, m.index).replace(/\\\$/g, '$') });
    const display = m[1] !== undefined || m[2] !== undefined;
    const tex = m[1] ?? m[2] ?? m[3] ?? m[4] ?? '';
    out.push({ type: 'math', value: tex.trim(), display });
    last = m.index + m[0].length;
  }
  if (last < input.length) out.push({ type: 'text', value: input.slice(last).replace(/\\\$/g, '$') });
  return out;
}

export interface MathTextProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  children: string;
}

/** Düz metin içindeki formülleri çizer: "Önce $\\frac{3}{4}$ kesrini yaz". */
export function MathText({ children, ...rest }: MathTextProps) {
  const segments = splitMath(children);
  return (
    <span {...rest}>
      {segments.map((s, i) =>
        s.type === 'text' ? (
          <span key={i}>{s.value}</span>
        ) : (
          <Tex key={i} tex={s.value} display={s.display} />
        ),
      )}
    </span>
  );
}
