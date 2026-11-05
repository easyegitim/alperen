import { renderHtml, type RenderableDocument, type RenderHtmlOptions } from './html.js';
import { trDate } from './format.js';
import { renderPdf, type RenderPdfOptions } from './pdf.js';

export { renderHtml, templateFor, type RenderableDocument, type RenderHtmlOptions, type TemplateName } from './html.js';
export { closeBrowser, getBrowser, isRequestAllowed, normalizeOrigins, renderPdf, renderPreviewPng, type RenderPdfOptions } from './pdf.js';
export type { KeyRow } from './blocks.js';
export type { ChartData, ChartDataMap, ChartKind } from './charts.js';
export { sanitizeSvg } from './svg.js';
export { trDate, trDuration, trNumber, wordBand, type Band } from './format.js';
export { token, tokenCss } from './tokens.js';

/** Kolaylık: AST -> HTML -> PDF; üst bilgi belge başlığıdır. */
export async function renderDocumentPdf(
  doc: RenderableDocument,
  options: Omit<RenderHtmlOptions, 'theme'> & { pdf?: RenderPdfOptions } = {},
): Promise<{ html: string; pdf: Uint8Array }> {
  const { pdf: pdfOptions, ...htmlOptions } = options;
  const html = renderHtml(doc, { theme: 'print', ...htmlOptions });
  // Not belgesinin alt bilgisinde kişisel hazırlama rozeti (mockup S09b); diğer belgeler sade kalır.
  const footerBadge = doc.kind === 'notes' ? `Öğrenmen sana göre hazırladı · ${trDate(doc.meta.generated_on)}` : undefined;
  const pdf = await renderPdf(html, { headerTitle: doc.title, ...(footerBadge ? { footerBadge } : {}), ...pdfOptions });
  return { html, pdf };
}
