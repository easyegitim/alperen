/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Rapor grafikleri: deterministik SVG/HTML (aynı veri -> bayt düzeyinde aynı çıktı). Palet tasarım sisteminden:
 * dolgu primary, iz line, yazı ink; sıralı rampa primary-soft -> primary. Yüzde yok: kelime bandı (düşük/orta/yüksek)
 * ve sayı doğrudan etikette (renk tek başına anlam taşımaz).
 */
import type { ReactElement } from 'react';
import { type Band, trDuration, trNumber, wordBand } from './format.js';
import { mixHex, readableOn, token } from './tokens.js';

export type ChartKind = 'score_by_section' | 'skill_heatmap' | 'mastery_trend' | 'time_per_question' | 'error_cause_histogram' | 'style_coverage';

/** `chart` bloğunun `data_ref` adına bağlanan veri. Render anında verilir; AST'de sayı taşınmaz. */
export type ChartData =
  | { kind: 'score_by_section'; rows: { label: string; net: number; max: number }[] }
  | { kind: 'skill_heatmap'; rows: { label: string; value: number; correct?: number; total?: number }[] }
  | { kind: 'mastery_trend'; points: { label: string; value: number }[] }
  | { kind: 'time_per_question'; rows: { label: string; seconds: number }[] }
  | { kind: 'error_cause_histogram'; rows: { label: string; count: number }[] }
  | { kind: 'style_coverage'; rows: { label: string; value: number }[] };

export type ChartDataMap = Readonly<Record<string, ChartData>>;

const FONT = 'Lexend, "Segoe UI", sans-serif';

/** Çubuk etiketi en çok bu kadar karakter; uzunu "…" ile kısaltılır, tam ad <title> içinde kalır. */
export const LABEL_MAX = 26;
export function clipLabel(text: string, max = LABEL_MAX): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

interface BarRow {
  label: string;
  /** 0..1 dolgu oranı */
  ratio: number;
  /** Çubuğun sağındaki doğrudan etiket */
  text: string;
}

function BarChart({ rows, title }: { rows: BarRow[]; title: string }): ReactElement {
  const labelW = 190;
  const trackX = labelW + 10;
  const trackW = 300;
  const rowH = 30;
  const barH = 12;
  const width = 640;
  const height = rows.length * rowH + 8;
  const ink = token('--og-ink');
  const muted = token('--og-ink-muted');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={title} className="chart-svg" xmlns="http://www.w3.org/2000/svg">
      <title>{title}</title>
      {rows.map((r, i) => {
        const y = 4 + i * rowH;
        const w = Math.max(0, Math.min(1, r.ratio)) * trackW;
        return (
          <g key={i}>
            <title>{r.label}</title>
            <text x={labelW} y={y + 15} textAnchor="end" fontFamily={FONT} fontSize="12" fill={ink}>
              {clipLabel(r.label)}
            </text>
            <rect x={trackX} y={y + 7} width={trackW} height={barH} rx="2" fill={token('--og-line')} />
            <rect x={trackX} y={y + 7} width={w} height={barH} rx="2" fill={token('--og-primary')} />
            {/* Sağ metin 640 birimlik kanvasa sığsın: uzun değer (ör. "yüksek · 123 / 200 net") küçük punto ile yazılır. */}
            <text x={trackX + trackW + 10} y={y + 17} fontFamily={FONT} fontSize={r.text.length > 20 ? '10' : '12'} fill={muted}>
              {r.text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ points, title }: { points: { label: string; value: number }[]; title: string }): ReactElement {
  const width = 640;
  const height = 200;
  const left = 70;
  const right = 20;
  const top = 14;
  const bottom = 34;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const xAt = (i: number) => left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yAt = (v: number) => top + (1 - Math.max(0, Math.min(1, v))) * plotH;
  const muted = token('--og-ink-muted');
  const bands: { y: number; text: Band }[] = [
    { y: yAt(0.85), text: 'yüksek' },
    { y: yAt(0.55), text: 'orta' },
    { y: yAt(0.2), text: 'düşük' },
  ];
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={title} className="chart-svg" xmlns="http://www.w3.org/2000/svg">
      <title>{title}</title>
      {[0.4, 0.7].map((t) => (
        <line key={t} x1={left} x2={width - right} y1={yAt(t)} y2={yAt(t)} stroke={token('--og-line')} strokeDasharray="3 3" />
      ))}
      <line x1={left} x2={width - right} y1={yAt(0)} y2={yAt(0)} stroke={token('--og-line-strong')} />
      {bands.map((b) => (
        <text key={b.text} x={left - 8} y={b.y + 4} textAnchor="end" fontFamily={FONT} fontSize="11" fill={muted}>
          {b.text}
        </text>
      ))}
      <path d={path} fill="none" stroke={token('--og-primary')} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={xAt(i)} cy={yAt(p.value)} r="4" fill={token('--og-surface-raised')} stroke={token('--og-primary')} strokeWidth="2" />
          <text x={xAt(i)} y={height - 14} textAnchor="middle" fontFamily={FONT} fontSize="11" fill={muted}>
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Heatmap({ rows, title }: { rows: Extract<ChartData, { kind: 'skill_heatmap' }>['rows']; title: string }): ReactElement {
  const lo = token('--og-primary-soft');
  const hi = token('--og-primary');
  return (
    <table className="heat" aria-label={title}>
      <tbody>
        {rows.map((r, i) => {
          const v = Math.max(0, Math.min(1, r.value));
          const bg = mixHex(lo, hi, v);
          const count = r.total !== undefined ? `${r.correct ?? 0}/${r.total}` : trNumber(v, 1);
          return (
            <tr key={i}>
              <th scope="row">{r.label}</th>
              <td className="heat-cell" style={{ background: bg, color: readableOn(bg) }}>
                <div className="heat-in">
                  <span className="heat-band">{wordBand(v)}</span>
                  <span className="heat-num">{count}</span>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function HeatLegend(): ReactElement {
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => mixHex(token('--og-primary-soft'), token('--og-primary'), t));
  return (
    <div className="heat-legend" aria-hidden="true">
      <span>düşük</span>
      <i style={{ background: `linear-gradient(90deg, ${stops.join(', ')})` }} />
      <span>yüksek</span>
    </div>
  );
}

const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Veriyi denetler, kind'a göre çizer. Veri yoksa ya da bozuksa sessizce boş grafik yerine açık not yazar. */
export function ChartBlock({ kind, title, caption, data }: { kind: ChartKind; title: string; caption?: string | undefined; data: ChartData | undefined }): ReactElement {
  let body: ReactElement | null = null;
  if (data && data.kind === kind) {
    switch (data.kind) {
      case 'score_by_section': {
        const rows = data.rows.filter((r) => valid(r.net) && valid(r.max) && r.max > 0);
        if (rows.length > 0) {
          body = (
            <BarChart
              title={title}
              rows={rows.map((r) => ({
                label: r.label,
                ratio: r.net / r.max,
                text: `${wordBand(r.net / r.max)} · ${trNumber(r.net)} / ${trNumber(r.max)} net`,
              }))}
            />
          );
        }
        break;
      }
      case 'skill_heatmap':
        if (data.rows.length > 0 && data.rows.every((r) => valid(r.value))) {
          body = (
            <>
              <Heatmap rows={data.rows} title={title} />
              <HeatLegend />
            </>
          );
        }
        break;
      case 'mastery_trend':
        if (data.points.length > 0 && data.points.every((p) => valid(p.value))) body = <LineChart title={title} points={data.points} />;
        break;
      case 'time_per_question': {
        const rows = data.rows.filter((r) => valid(r.seconds) && r.seconds >= 0);
        const max = Math.max(1, ...rows.map((r) => r.seconds));
        if (rows.length > 0) body = <BarChart title={title} rows={rows.map((r) => ({ label: r.label, ratio: r.seconds / max, text: trDuration(r.seconds) }))} />;
        break;
      }
      case 'error_cause_histogram': {
        const rows = data.rows.filter((r) => valid(r.count) && r.count >= 0);
        const max = Math.max(1, ...rows.map((r) => r.count));
        if (rows.length > 0) body = <BarChart title={title} rows={rows.map((r) => ({ label: r.label, ratio: r.count / max, text: `${r.count} soru` }))} />;
        break;
      }
      case 'style_coverage': {
        const rows = data.rows.filter((r) => valid(r.value));
        if (rows.length > 0) body = <BarChart title={title} rows={rows.map((r) => ({ label: r.label, ratio: r.value, text: wordBand(r.value) }))} />;
        break;
      }
    }
  }
  return (
    <figure className="chart" data-chart={kind}>
      <figcaption className="chart-title">{title}</figcaption>
      {body ?? <p className="chart-empty">Bu grafik için veri yok.</p>}
      {caption ? <p className="chart-caption">{caption}</p> : null}
    </figure>
  );
}
