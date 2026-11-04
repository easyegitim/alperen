import { renderHtml, type RenderableDocument, type RenderHtmlOptions } from './html.js';
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
  const pdf = await renderPdf(html, { headerTitle: doc.title, ...pdfOptions });
  return { html, pdf };
}
