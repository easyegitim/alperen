import { token } from './tokens.js';

/** Basılı belge stili (A4). Renkler `--og-*` değişkenlerinden; koyu tema yoktur. */
export const PAGE = { widthMm: 210, heightMm: 297, marginTopMm: 20, marginBottomMm: 22, marginXMm: 16 } as const;

export function printCss(): string {
  // @page içinde var() çalışmaz: kâğıt rengi değişkenden okunup düz değer olarak yazılır.
  return `
@page { size: A4; margin: ${PAGE.marginTopMm}mm ${PAGE.marginXMm}mm ${PAGE.marginBottomMm}mm; background: ${token('--og-paper')}; }
*, *::before, *::after { box-sizing: border-box; }
html { background: var(--og-paper); color-scheme: light; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: var(--og-paper); color: var(--og-ink); font-family: var(--og-font-sans); font-size: 10pt; line-height: 1.5; font-weight: 400; font-variant-numeric: lining-nums; }
.doc { max-width: ${PAGE.widthMm - 2 * PAGE.marginXMm}mm; margin: 0 auto; }
h1, h2, h3, h4 { margin: 0; font-weight: 600; letter-spacing: -0.01em; break-after: avoid; page-break-after: avoid; }
h2 { font-size: 15pt; line-height: 1.3; margin: 7mm 0 2.5mm; padding-bottom: 1.2mm; border-bottom: 0.4mm solid var(--og-navy); }
h3 { font-size: 12pt; line-height: 1.35; margin: 5mm 0 2mm; }
h4 { font-size: 10.5pt; line-height: 1.4; margin: 4mm 0 1.5mm; }
p { margin: 0 0 2.6mm; orphans: 3; widows: 3; white-space: pre-line; }
code, .mono { font-family: var(--og-font-mono); font-size: 9pt; }
.katex { font-size: 1.05em; }
.math-display { margin: 2.5mm 0; text-align: center; overflow: hidden; break-inside: avoid; }
.math-display .katex-display { margin: 0; }

/* kapak */
.cover { break-after: page; page-break-after: always; padding: 14mm 0 0; }
.cover-band { height: 3mm; background: var(--og-primary); margin-bottom: 10mm; width: 40mm; }
.cover-brand { font-size: 9pt; font-weight: 500; letter-spacing: 0.04em; color: var(--og-ink-muted); text-transform: uppercase; margin-bottom: 6mm; }
.cover h1 { font-size: 30pt; line-height: 1.12; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4mm; }
.cover-sub { font-size: 14pt; line-height: 1.35; color: var(--og-ink-muted); margin: 0 0 12mm; }
.cover-meta { border-top: 0.4mm solid var(--og-navy); margin-top: 10mm; padding-top: 4mm; display: grid; grid-template-columns: max-content 1fr; column-gap: 8mm; row-gap: 1.5mm; font-size: 10.5pt; }
.cover-meta dt { color: var(--og-ink-muted); }
.cover-meta dd { margin: 0; font-weight: 500; }
.cover-fields { margin-top: 16mm; display: grid; grid-template-columns: 1fr 1fr; gap: 8mm 10mm; }
.cover-field { border-bottom: 0.3mm solid var(--og-navy); padding-bottom: 1mm; font-size: 9pt; color: var(--og-ink-muted); min-height: 9mm; }
.cover-rules { margin: 14mm 0 0; padding: 4mm 5mm; border: 0.3mm solid var(--og-line-strong); border-radius: 1.5mm; font-size: 9.5pt; }
.cover-rules ol { margin: 1.5mm 0 0; padding-left: 5mm; }
.cover-rules li { margin-bottom: 1mm; }

/* rapor başlığı */
.report-head { margin-bottom: 6mm; }
.report-head .brand { font-size: 8.5pt; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--og-ink-muted); }
.report-head h1 { font-size: 21pt; line-height: 1.2; font-weight: 700; letter-spacing: -0.02em; margin: 1.5mm 0 1mm; }
.report-head .sub { color: var(--og-ink-muted); font-size: 10.5pt; }
.lead { font-size: 13pt; line-height: 1.45; font-weight: 500; padding: 4mm 5mm; margin: 0 0 6mm; background: var(--og-primary-soft); border-left: 1.2mm solid var(--og-primary); border-radius: 0 1.5mm 1.5mm 0; break-inside: avoid; }

/* bölüm bandı */
.section-band { break-after: avoid; margin: 6mm 0 3mm; padding: 1.8mm 3mm; background: var(--og-navy); color: var(--og-on-navy); font-weight: 600; font-size: 10.5pt; border-radius: 1mm; }

/* kutular */
.box { break-inside: avoid; page-break-inside: avoid; margin: 3.5mm 0; padding: 3.5mm 4.5mm; border-radius: 1.5mm; }
.box > :last-child { margin-bottom: 0; }
.box-title { font-weight: 600; font-size: 10pt; margin: 0 0 1.5mm; }
.definition { background: var(--og-surface-raised); border: 0.3mm solid var(--og-line-strong); border-left: 1.2mm solid var(--og-primary); }
.definition .term { font-weight: 700; color: var(--og-primary-strong); }
.summary { background: var(--og-primary-soft); border: 0.3mm solid var(--og-line); }
.summary ul { margin: 0; padding-left: 5mm; }
.summary li { margin-bottom: 1mm; }
.next-step { background: var(--og-surface-raised); border: 0.3mm solid var(--og-gold-deep); border-left: 1.6mm solid var(--og-gold-deep); }
.next-step .box-title { color: var(--og-gold-ink); }
.worked { background: var(--og-surface-raised); border: 0.3mm solid var(--og-line); }
.worked .label { font-size: 8pt; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--og-ink-muted); margin: 0 0 1mm; }
.worked ol { margin: 1.5mm 0 2mm; padding-left: 6mm; }
.worked li { margin-bottom: 1mm; }
.worked .answer { font-weight: 600; margin-top: 2mm; padding-top: 2mm; border-top: 0.3mm dashed var(--og-line-strong); }
.mistake { background: var(--og-warning-soft); border: 0.3mm solid var(--og-warning); border-left: 1.6mm solid var(--og-warning); }
.mistake .box-title { color: var(--og-warning); }
.mistake .date { font-weight: 400; color: var(--og-ink-muted); }
.check { background: var(--og-surface-raised); border: 0.3mm dashed var(--og-line-strong); }
.check .num { font-weight: 700; color: var(--og-primary); margin-right: 1.5mm; }
.check .hint { font-size: 8.5pt; color: var(--og-ink-muted); margin-top: 1.5mm; }

/* şekil ve tablo */
figure { margin: 3mm 0; }
figure.fig { break-inside: avoid; text-align: center; }
figure.fig svg, figure.fig img { max-width: 100%; height: auto; max-height: 90mm; }
.fig-missing { display: inline-block; padding: 6mm; border: 0.3mm dashed var(--og-line-strong); color: var(--og-ink-muted); font-size: 9pt; }
table.data { width: 100%; border-collapse: collapse; margin: 3mm 0; font-size: 9.5pt; break-inside: auto; }
table.data caption { caption-side: top; text-align: left; font-weight: 600; padding-bottom: 1.5mm; break-after: avoid; }
table.data th, table.data td { border: 0.25mm solid var(--og-line-strong); padding: 1.6mm 2.4mm; text-align: left; vertical-align: top; }
table.data thead th { background: var(--og-primary-soft); font-weight: 600; }
table.data thead { display: table-header-group; }
table.data tr { break-inside: avoid; page-break-inside: avoid; }

/* sorular (ÖSYM benzeri iki sütun) */
.questions { column-count: 2; column-gap: 9mm; column-rule: 0.3mm solid var(--og-line-strong); margin-bottom: 4mm; }
.question { break-inside: avoid; page-break-inside: avoid; margin: 0 0 6mm; display: grid; grid-template-columns: 7mm 1fr; column-gap: 1mm; }
.q-no { font-weight: 700; font-size: 10.5pt; color: var(--og-navy); }
.q-stem { white-space: pre-line; margin: 0 0 2mm; font-size: 9.5pt; line-height: 1.5; }
.q-body { min-width: 0; }
.q-body figure.fig svg, .q-body figure.fig img { max-height: 55mm; }
.q-options { list-style: none; margin: 1.5mm 0 0; padding: 0; font-size: 9.5pt; }
.q-options li { display: grid; grid-template-columns: 5.5mm 1fr; align-items: center; margin-bottom: 1.4mm; min-height: 5.2mm; }
.q-options .k { font-weight: 600; }

/* optik form */
.optik { break-inside: avoid; page-break-inside: avoid; border: 0.5mm solid var(--og-navy); border-radius: 2mm; padding: 6mm; margin: 4mm 0; }
.optik h3 { margin-top: 0; }
.optik-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 8mm; margin: 3mm 0 5mm; }
.optik-grid { display: grid; grid-auto-flow: column; column-gap: 8mm; row-gap: 1.6mm; justify-content: start; }
.optik-row { display: flex; align-items: center; gap: 1.8mm; break-inside: avoid; }
.optik-no { width: 7mm; text-align: right; font-weight: 600; font-size: 9pt; }
.bubble { width: 5.2mm; height: 5.2mm; border: 0.35mm solid var(--og-navy); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 6.5pt; color: var(--og-ink-muted); background: var(--og-surface-raised); }
.optik-note { margin-top: 4mm; font-size: 8.5pt; color: var(--og-ink-muted); }

/* anahtar ve cevap sayfaları */
.page-start { break-before: page; page-break-before: always; }
.key-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1.5mm 6mm; margin-top: 3mm; }
.key-cell { display: flex; justify-content: space-between; border-bottom: 0.2mm solid var(--og-line); padding: 0.6mm 0; font-size: 9.5pt; }
.key-cell b { font-weight: 700; }
.answers-list { margin: 3mm 0 0; padding-left: 0; list-style: none; }
.answers-list li { margin-bottom: 3mm; break-inside: avoid; }

/* grafikler */
.chart { margin: 4mm 0; break-inside: avoid; }
.chart-title { font-weight: 600; font-size: 10.5pt; margin-bottom: 1.5mm; break-after: avoid; }
.chart-svg { display: block; max-width: 100%; height: auto; }
.chart-caption { font-size: 8.5pt; color: var(--og-ink-muted); margin: 1.5mm 0 0; }
.chart-empty { color: var(--og-ink-muted); font-size: 9pt; font-style: italic; }
table.heat { width: 100%; border-collapse: separate; border-spacing: 0 1mm; font-size: 9pt; }
table.heat th { text-align: right; font-weight: 400; padding-right: 3mm; width: 52%; }
table.heat td.heat-cell { border-radius: 1mm; padding: 1.4mm 3mm; display: table-cell; }
.heat-band { display: inline-block; min-width: 14mm; font-weight: 600; }
.heat-in { display: flex; justify-content: space-between; align-items: baseline; }
.heat-num { font-family: var(--og-font-mono); font-size: 8.5pt; }
.heat-legend { display: flex; align-items: center; gap: 2mm; margin-top: 1.5mm; font-size: 8pt; color: var(--og-ink-muted); }
.heat-legend i { display: inline-block; width: 40mm; height: 2.5mm; border-radius: 1mm; }
`;
}
