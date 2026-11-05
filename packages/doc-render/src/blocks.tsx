/** @jsxRuntime automatic */
/** @jsxImportSource react */
/** Belge bloklarının React (sunucu) bileşenleri. Cevap anahtarı yalnız `answer_key_page` ve `answerKeys` ile görünür. */
import type { ReactElement, ReactNode } from 'react';
import type { DocumentBlock } from '@ogrenmen/contracts';
import { ChartBlock, type ChartDataMap } from './charts.js';
import { trDate, trNumber } from './format.js';
import { type MathOutput, splitMath, texToHtml } from './math.js';
import { sanitizeSvg } from './svg.js';

export interface KeyRow {
  question_no: number;
  correct_option: string | null;
  numeric_value: number | null;
}

export interface BlockContext {
  math: MathOutput;
  chartData: ChartDataMap;
  answerKeys: readonly KeyRow[] | undefined;
  resolveUploadUrl: ((uploadId: string) => string | undefined) | undefined;
  generatedOn: string;
  /** Kazanım kodu -> görünen ad (anahtar sayfasındaki kazanım haritası); yoksa koddan türetilir. */
  skillLabels: Readonly<Record<string, string>>;
  /** Soru numarası -> kazanım kodları (belge sorularından; anahtar sayfası için). */
  questionSkills: ReadonlyMap<number, readonly string[]>;
  /** `image_url` doğrulayıcı: yalnız data: png/jpeg/webp geçer. */
  resolveImageUrl: (url: string) => string | undefined;
  /** check_yourself numarası (belge boyunca sıralı). */
  checkNo: (blockId: string) => number;
}

const PATTERN_SOURCE_LABEL = { 'patterns.md': 'örüntüler.md', misconception: 'yanılgı etiketi', analysis: 'analiz' } as const;

type Of<T extends DocumentBlock['type']> = Extract<DocumentBlock, { type: T }>;

/** Satır içi `$…$` içeren metin. Ayrı satır formülleri (`$$…$$`) blok olarak çıkar. */
export function RichText({ text, math }: { text: string; math: MathOutput }): ReactElement {
  const parts = splitMath(text);
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === 'text') return <span key={i}>{p.value}</span>;
        const html = texToHtml(p.value, p.display, math);
        return p.display ? (
          <span key={i} className="math-display" style={{ display: 'block' }} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span key={i} className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />
        );
      })}
    </>
  );
}

type FigureLike = { source: 'svg' | 'upload'; svg?: string | undefined; upload_id?: string | undefined; alt: string; image_url?: string | undefined };

/**
 * Şekil çerçevesi (kâğıt zemin). Öncelik: satır içi SVG, `image_url`, yüklenen görsel. `figure_code` burada okunmaz:
 * kodu worker çalıştırır, SVG'yi belgeye yazar; kodu olup SVG'si gelmemiş şekil yedek kutu olarak çıkar.
 */
export function Figure({ f, ctx }: { f: FigureLike; ctx: BlockContext }): ReactElement {
  let inner: ReactNode = null;
  if (f.source === 'svg' && f.svg) {
    const clean = sanitizeSvg(f.svg);
    if (clean) inner = <span role="img" aria-label={f.alt} dangerouslySetInnerHTML={{ __html: clean }} />;
  }
  if (!inner && f.image_url) {
    const url = ctx.resolveImageUrl(f.image_url);
    if (url) inner = <img src={url} alt={f.alt} />;
  }
  if (!inner && f.source === 'upload' && f.upload_id) {
    const url = ctx.resolveUploadUrl?.(f.upload_id);
    if (url) inner = <img src={url} alt={f.alt} />;
  }
  return <figure className="fig">{inner ?? <span className="fig-missing">Şekil yüklenemedi: {f.alt}</span>}</figure>;
}

function keyText(k: KeyRow): string {
  return k.correct_option ?? (k.numeric_value !== null ? trNumber(k.numeric_value, 4) : '-');
}

export function QuestionBlock({ b, ctx }: { b: Of<'question'>; ctx: BlockContext }): ReactElement {
  return (
    <div className="question" data-block-id={b.id} data-question-no={b.no}>
      <div className="q-no">{b.no}.</div>
      <div className="q-body">
        <p className="q-stem">
          <RichText text={b.stem} math={ctx.math} />
        </p>
        {b.figure ? <Figure f={b.figure} ctx={ctx} /> : null}
        {b.options.length > 0 ? (
          <ol className="q-options">
            {b.options.map((o) => (
              <li key={o.key}>
                <span className="k">{o.key})</span>
                <span>
                  <RichText text={o.text} math={ctx.math} />
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

function AnswerSheet({ b }: { b: Of<'answer_sheet'> }): ReactElement {
  const letters = ['A', 'B', 'C', 'D', 'E'].slice(0, b.options_per_question);
  const perColumn = Math.min(b.question_count, 25);
  return (
    <section className="optik" data-block-id={b.id} aria-label="Optik form">
      <h3>{b.title}</h3>
      <div className="optik-fields">
        <div className="cover-field">Adı soyadı</div>
        <div className="cover-field">Numara</div>
      </div>
      <div className="optik-grid" style={{ gridTemplateRows: `repeat(${perColumn}, auto)` }}>
        {Array.from({ length: b.question_count }, (_, i) => (
          <div className="optik-row" key={i}>
            <span className="optik-no">{i + 1}</span>
            {letters.map((l) => (
              <span className="bubble" key={l}>
                {l}
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="optik-note">Her soru için tek daireyi tamamen doldur. Silinen ya da çift işaretli sorular boş sayılır.</p>
    </section>
  );
}

/** "tyt.mat.temel.rasyonel-sayilar" -> "Rasyonel sayilar" (ad sözlüğü verilmediyse son parça). */
function skillName(code: string, labels: Readonly<Record<string, string>>): string {
  const given = labels[code];
  if (given) return given;
  const last = code.split('.').pop() ?? code;
  const words = last.replace(/-/g, ' ');
  return words.charAt(0).toLocaleUpperCase('tr') + words.slice(1);
}

function AnswerKeyPage({ b, ctx }: { b: Of<'answer_key_page'>; ctx: BlockContext }): ReactElement | null {
  // Anahtar yalnız çağıran açıkça verdiyse çizilir; yoksa blok hiç çıktı üretmez.
  if (!ctx.answerKeys || ctx.answerKeys.length === 0) return null;
  const rows = [...ctx.answerKeys].sort((x, y) => x.question_no - y.question_no);
  // Kazanım haritası: kazanım -> sorular (belge sırasıyla), yanında anahtardaki cevaplar.
  const bySkill = new Map<string, number[]>();
  for (const k of rows) {
    for (const sk of ctx.questionSkills.get(k.question_no) ?? []) bySkill.set(sk, [...(bySkill.get(sk) ?? []), k.question_no]);
  }
  return (
    <section className="page-start" data-block-id={b.id}>
      <h2>{b.title}</h2>
      <div className="key-grid">
        {rows.map((k) => (
          <div className="key-cell" key={k.question_no}>
            <span>{k.question_no}</span>
            <b>{keyText(k)}</b>
          </div>
        ))}
      </div>
      {bySkill.size > 0 ? (
        <>
          <h3>Kazanım haritası</h3>
          <table className="data skill-map">
            <thead>
              <tr>
                <th scope="col">Kazanım</th>
                <th scope="col">Sorular</th>
                <th scope="col">Soru sayısı</th>
              </tr>
            </thead>
            <tbody>
              {[...bySkill.entries()].map(([code, nos]) => (
                <tr key={code}>
                  <td>{skillName(code, ctx.skillLabels)}</td>
                  <td>{nos.join(', ')}</td>
                  <td>{nos.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

/** Soru olmayan bloklar. `question` ve gruplama `html.tsx` içinde. */
export function BlockView({ b, ctx }: { b: DocumentBlock; ctx: BlockContext }): ReactElement | null {
  const rt = (t: string) => <RichText text={t} math={ctx.math} />;
  switch (b.type) {
    case 'heading': {
      const Tag = (['h2', 'h3', 'h4'] as const)[b.level - 1] ?? 'h4';
      return <Tag data-block-id={b.id}>{rt(b.text)}</Tag>;
    }
    case 'paragraph':
      return <p data-block-id={b.id}>{rt(b.text)}</p>;
    case 'math_display':
      return (
        <div className="math-display" data-block-id={b.id} dangerouslySetInnerHTML={{ __html: texToHtml(b.latex, true, ctx.math) }} />
      );
    case 'definition_box':
      return (
        <aside className="box definition" data-block-id={b.id}>
          <p className="label">Tanım</p>
          <p>
            <span className="term">{rt(b.term)}</span>: {rt(b.body)}
          </p>
        </aside>
      );
    case 'summary_box': {
      const next = /^sonraki adım/i.test(b.title);
      return (
        <aside className={`box ${next ? 'next-step' : 'summary'}`} data-block-id={b.id}>
          <p className="box-title">{rt(b.title)}</p>
          <ul>
            {b.bullets.map((x, i) => (
              <li key={i}>{rt(x)}</li>
            ))}
          </ul>
        </aside>
      );
    }
    case 'worked_example':
      return (
        <aside className="box worked" data-block-id={b.id}>
          <p className="label">Çözümlü örnek</p>
          <p className="box-title">{rt(b.title)}</p>
          <p>{rt(b.problem)}</p>
          <ol className="steps">
            {b.steps.map((s, i) => (
              <li key={i}>
                <span className="step-no" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="step-text">{rt(s)}</span>
              </li>
            ))}
          </ol>
          <p className="answer">Cevap: {rt(b.answer)}</p>
        </aside>
      );
    case 'common_mistake_callout': {
      const ref = b.pattern_ref ?? null;
      const date = trDate(ref?.date ?? ctx.generatedOn);
      return (
        <aside className="box mistake" data-block-id={b.id} data-pattern-id={b.pattern_id}>
          <svg className="mistake-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <div className="mistake-body">
            <p className="box-title">
              Senin sık yaptığın hata <span className="date">· {date}</span>
            </p>
            <p>{rt(b.text)}</p>
            {ref ? <p className="source">Kaynak: {PATTERN_SOURCE_LABEL[ref.source]} · {date}</p> : null}
          </div>
        </aside>
      );
    }
    case 'check_yourself': {
      const n = ctx.checkNo(b.id);
      return (
        <aside className="box check" data-block-id={b.id}>
          <p className="box-title">
            <span className="num">Kendini sına {n}</span>
          </p>
          <p>{rt(b.question)}</p>
          <span className="workspace" aria-hidden="true" />
          <p className="hint">Cevap belgenin son sayfasında.</p>
        </aside>
      );
    }
    case 'figure':
      return (
        <div data-block-id={b.id}>
          <Figure f={b} ctx={ctx} />
        </div>
      );
    case 'table':
      return (
        <table className="data" data-block-id={b.id}>
          {b.caption ? <caption>{rt(b.caption)}</caption> : null}
          {b.header.length > 0 ? (
            <thead>
              <tr>
                {b.header.map((h, i) => (
                  <th key={i} scope="col">
                    {rt(h)}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{rt(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'question':
      return <QuestionBlock b={b} ctx={ctx} />;
    case 'answer_sheet':
      return <AnswerSheet b={b} />;
    case 'answer_key_page':
      return <AnswerKeyPage b={b} ctx={ctx} />;
    case 'page_break':
      return <div className="page-start" data-block-id={b.id} />;
    case 'chart':
      return (
        <div data-block-id={b.id}>
          <ChartBlock kind={b.chart_kind} title={b.title} caption={b.caption} data={ctx.chartData[b.data_ref]} />
        </div>
      );
    default: {
      const _exhaustive: never = b;
      return _exhaustive;
    }
  }
}
