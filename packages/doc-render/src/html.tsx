/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Belge AST -> tam (kendi kendine yeten) HTML. Şablon `kind`'dan seçilir: notes -> not, mock_exam/question_set -> deneme,
 * report -> rapor. KaTeX sunucu tarafında çalışır; fontlar ve stil gömülüdür.
 */
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DocumentAst } from '@ogrenmen/contracts';
import { BlockView, type BlockContext, type KeyRow, QuestionBlock } from './blocks.js';
import { RichText } from './blocks.js';
import type { ChartDataMap } from './charts.js';
import { printCss } from './css.js';
import { brandFontCss, katexCss } from './fonts.js';
import { trDate } from './format.js';
import type { MathOutput } from './math.js';
import { tokenCss } from './tokens.js';

export type TemplateName = 'not' | 'deneme' | 'rapor';

/** Render için gereken AST parçası: saklanan belge (keys boş) de, model çıktısı da uyar. */
export type RenderableDocument = Pick<DocumentAst, 'kind' | 'title' | 'meta' | 'sections' | 'blocks'>;

export interface RenderHtmlOptions {
  /** Yalnız basılı tema vardır (koyu tema yok). */
  theme: 'print';
  /** 'embed' (varsayılan): Lexend/JetBrains Mono/KaTeX base64 gömülür. 'none': sistem fontu (testler, hızlı önizleme). */
  fonts?: 'embed' | 'none';
  /** `chart` bloklarının `data_ref` adına bağlı veri. */
  chartData?: ChartDataMap;
  /**
   * Cevap anahtarı: YALNIZ burada verilirse ve belgede `answer_key_page` bloğu varsa çizilir. `ast.keys` hiçbir zaman
   * okunmaz (öğrenci belgesine anahtar sızmasın).
   */
  answerKeys?: readonly KeyRow[];
  /** `figure.source=upload` için imzalı adres çözücü; yoksa yedek kutu çizilir. */
  resolveUploadUrl?: (uploadId: string) => string | undefined;
  /** 'htmlAndMathml' (varsayılan, erişilebilir) | 'html'. */
  mathOutput?: MathOutput;
}

export function templateFor(kind: RenderableDocument['kind']): TemplateName {
  return kind === 'notes' ? 'not' : kind === 'report' ? 'rapor' : 'deneme';
}

function questionCount(doc: RenderableDocument): number {
  return doc.blocks.filter((b) => b.type === 'question').length;
}

function Cover({ doc, template }: { doc: RenderableDocument; template: 'not' | 'deneme' }): ReactElement {
  const n = questionCount(doc);
  const hasSheet = doc.blocks.some((b) => b.type === 'answer_sheet');
  return (
    <header className="cover">
      <div className="cover-band" />
      <div className="cover-brand">{template === 'not' ? 'Öğrenmen sana göre hazırladı' : doc.kind === 'question_set' ? 'Soru seti' : 'Deneme sınavı'}</div>
      <h1>{doc.title}</h1>
      {doc.meta.subtitle ? <p className="cover-sub">{doc.meta.subtitle}</p> : null}
      <dl className="cover-meta">
        <dt>Ders</dt>
        <dd>{doc.meta.course_title}</dd>
        {template === 'deneme' && n > 0 ? (
          <>
            <dt>Soru sayısı</dt>
            <dd>{n}</dd>
          </>
        ) : null}
        {doc.meta.duration_min ? (
          <>
            <dt>Süre</dt>
            <dd>{doc.meta.duration_min} dakika</dd>
          </>
        ) : null}
        <dt>Tarih</dt>
        <dd>{trDate(doc.meta.generated_on)}</dd>
      </dl>
      {template === 'deneme' ? (
        <>
          <div className="cover-fields">
            <div className="cover-field">Adı soyadı</div>
            <div className="cover-field">Numara</div>
          </div>
          <div className="cover-rules">
            <strong>Başlamadan önce</strong>
            <ol>
              <li>Her sorunun yalnız bir doğru cevabı vardır.</li>
              {hasSheet ? <li>Cevaplarını kitapçığın sonundaki optik forma işaretle.</li> : null}
              <li>Kitapçığın boş yerlerini karalama için kullanabilirsin.</li>
            </ol>
          </div>
        </>
      ) : null}
    </header>
  );
}

function ReportHead({ doc }: { doc: RenderableDocument }): ReactElement {
  return (
    <header className="report-head">
      <div className="brand">Öğrenmen · {doc.meta.course_title}</div>
      <h1>{doc.title}</h1>
      <div className="sub">
        {doc.meta.subtitle ? `${doc.meta.subtitle} · ` : ''}
        {trDate(doc.meta.generated_on)}
      </div>
    </header>
  );
}

function Body({ doc, template, ctx }: { doc: RenderableDocument; template: TemplateName; ctx: BlockContext }): ReactElement {
  const out: ReactNode[] = [];
  const sectionTitle = new Map(doc.sections.map((s) => [s.no, s.title]));
  const bandedKind = doc.kind === 'mock_exam' || doc.kind === 'question_set';
  let lastSection: number | undefined;
  let leadDone = false;
  let group: ReactElement[] = [];
  const flush = (key: string) => {
    if (group.length > 0) out.push(<div className="questions" key={key}>{group}</div>);
    group = [];
  };
  doc.blocks.forEach((b, i) => {
    if (bandedKind && b.section_no !== lastSection) {
      flush(`g-${i}`);
      const t = sectionTitle.get(b.section_no);
      if (t) out.push(<div className="section-band" key={`band-${i}`}>{t}</div>);
      lastSection = b.section_no;
    }
    if (b.type === 'question') {
      group.push(<QuestionBlock key={b.id} b={b} ctx={ctx} />);
      return;
    }
    flush(`g-${i}`);
    if (template === 'rapor' && b.type === 'paragraph' && !leadDone) {
      leadDone = true;
      out.push(
        <p className="lead" key={b.id} data-block-id={b.id}>
          <RichText text={b.text} math={ctx.math} />
        </p>,
      );
      return;
    }
    out.push(<BlockView key={b.id} b={b} ctx={ctx} />);
  });
  flush('g-end');

  const checks = doc.blocks.filter((b) => b.type === 'check_yourself');
  if (checks.length > 0) {
    out.push(
      <section className="page-start" key="check-answers" aria-label="Kendini sına cevapları">
        <h2>Kendini sına: cevaplar</h2>
        <ol className="answers-list">
          {checks.map((c) => (
            <li key={c.id}>
              <strong>Kendini sına {ctx.checkNo(c.id)}.</strong> <RichText text={c.answer_hidden} math={ctx.math} />
            </li>
          ))}
        </ol>
      </section>,
    );
  }
  return <>{out}</>;
}

/** Tam HTML belgesi (doctype dahil). Aynı girdi -> aynı çıktı. */
export function renderHtml(doc: RenderableDocument, options: RenderHtmlOptions): string {
  if (options.theme !== 'print') throw new Error("doc-render: yalnız theme:'print' desteklenir");
  const template = templateFor(doc.kind);
  const math = options.mathOutput ?? 'htmlAndMathml';
  const checkIds = doc.blocks.filter((b) => b.type === 'check_yourself').map((b) => b.id);
  const ctx: BlockContext = {
    math,
    chartData: options.chartData ?? {},
    answerKeys: options.answerKeys,
    resolveUploadUrl: options.resolveUploadUrl,
    generatedOn: doc.meta.generated_on,
    checkNo: (id) => checkIds.indexOf(id) + 1,
  };
  // Yüklenen görsellerin kökenleri CSP img-src'e eklenir (yalnız çözücünün döndürdüğü adresler).
  const imgOrigins = new Set<string>();
  if (options.resolveUploadUrl) {
    const resolve = options.resolveUploadUrl;
    ctx.resolveUploadUrl = (id) => {
      const url = resolve(id);
      if (url) {
        try {
          const u = new URL(url);
          if (u.protocol === 'https:' || u.protocol === 'http:') imgOrigins.add(u.origin);
        } catch {
          /* göreli/bozuk adres: köken eklenmez */
        }
      }
      return url;
    };
  }
  const body = renderToStaticMarkup(
    <main className={`doc doc-${template}`} lang="tr">
      {template === 'rapor' ? <ReportHead doc={doc} /> : <Cover doc={doc} template={template} />}
      <Body doc={doc} template={template} ctx={ctx} />
    </main>,
  );
  const embed = (options.fonts ?? 'embed') === 'embed';
  const hasMath = body.includes('class="katex');
  const kcss = hasMath ? (embed ? katexCss() : katexCss().replace(/@font-face\{[^}]*\}/g, '')) : '';
  const css = [embed ? brandFontCss() : '', kcss, tokenCss(), printCss(), ':root{--og-font-sans:Lexend,"Segoe UI",system-ui,sans-serif;--og-font-mono:"JetBrains Mono",ui-monospace,Menlo,monospace;}'].join('\n');
  const title = doc.title.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c);
  const csp = ["default-src 'none'", "style-src 'unsafe-inline'", `img-src data: ${[...imgOrigins].sort().join(' ')}`.trim(), 'font-src data:'].join('; ');
  return `<!doctype html>\n<html lang="tr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}</style></head><body>${body}</body></html>`;
}
