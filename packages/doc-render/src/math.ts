/** Sunucu tarafı KaTeX: metin içindeki `$…$` parçalarını HTML dizgisine çevirir (hata fırlatmaz). */
import katex from 'katex';
import { splitMath } from '@ogrenmen/design-system/math';

export type MathOutput = 'htmlAndMathml' | 'html';

export function texToHtml(tex: string, display: boolean, output: MathOutput): string {
  return katex.renderToString(tex, { displayMode: display, output, throwOnError: false, strict: 'ignore', trust: false });
}

export { splitMath };
