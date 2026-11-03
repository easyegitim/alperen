import { useId, useState } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn, FOCUS_RING } from '../lib/cn';
import { formatNumber } from '../lib/format';

/** Kategorik seri paleti: base.css --og-viz-1..8, sabit sırada (doğrulanmış palet). 9. seri yoktur. */
export const VIZ_SLOTS = 8;
export const vizColor = (index: number): string => `var(--og-viz-${(index % VIZ_SLOTS) + 1})`;

export interface ReportSeries {
  key: string;
  name: string;
}

export type ReportDatum = Record<string, string | number | null>;

export interface ReportChartProps extends Omit<ComponentPropsWithRef<'figure'>, 'title'> {
  kind?: 'line' | 'bar';
  /** Grafiğin adı; tablo görünümünün başlığı da budur. */
  title: string;
  data: ReportDatum[];
  /** x ekseni anahtarı. */
  xKey: string;
  /** En fazla 8 seri; fazlası yok sayılır (kategorik palet 8 yuvadır). */
  series: ReportSeries[];
  /** Çok serili grafikte vurgulanan seri: o primary, diğerleri line-strong. */
  highlightKey?: string;
  /** Değer biçimi (varsayılan Türkçe sayı). */
  valueFormat?: (value: number) => string;
  yDomain?: [number, number];
  height?: number;
  /** Başlangıç görünümü. */
  defaultView?: 'chart' | 'table';
  /** Tek ölçü: ikinci eksen yoktur; iki ölçü iki grafik. */
  caption?: string;
}

function seriesColor(series: ReportSeries[], i: number, highlightKey?: string): string {
  if (series.length === 1) return 'var(--og-primary)';
  if (highlightKey) return series[i]?.key === highlightKey ? 'var(--og-primary)' : 'var(--og-line-strong)';
  return vizColor(i);
}

/**
 * Recharts sarmalayıcı: tek eksen, ince işaretler, sabit palet. ≥2 seride lejant her zaman vardır
 * ve renk tek başına anlam taşımaz; "Tablo görünümü" her zaman mevcuttur (tablo DOM'da kalır).
 */
export function ReportChart({
  kind = 'line',
  title,
  data,
  xKey,
  series: allSeries,
  highlightKey,
  valueFormat = (v) => formatNumber(v, 2),
  yDomain,
  height = 240,
  defaultView = 'chart',
  caption,
  className,
  ...rest
}: ReportChartProps) {
  const series = allSeries.slice(0, VIZ_SLOTS);
  const [view, setView] = useState<'chart' | 'table'>(defaultView);
  const tableId = useId();
  const showTable = view === 'table';
  const fmt = (v: unknown) => (typeof v === 'number' ? valueFormat(v) : '—');

  return (
    <figure {...rest} className={cn('m-0 box-border flex flex-col gap-3 rounded-lg border border-line bg-surface-raised p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-title-3 text-ink">{title}</figcaption>
        <button
          type="button"
          aria-pressed={showTable}
          aria-controls={tableId}
          onClick={() => setView(showTable ? 'chart' : 'table')}
          className={cn(
            'text-label min-h-11 cursor-pointer rounded-md border border-line-strong bg-surface-raised px-3 text-primary enabled:hover:bg-primary-soft',
            FOCUS_RING,
          )}
        >
          {showTable ? 'Grafik görünümü' : 'Tablo görünümü'}
        </button>
      </div>

      {series.length >= 2 ? (
        <ul className="text-small m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-ink" aria-label="Seriler">
          {series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              <span aria-hidden="true" className="h-0.5 w-4 rounded-full" style={{ background: seriesColor(series, i, highlightKey), height: 3 }} />
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}

      {!showTable ? (
        <div aria-hidden="true" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {kind === 'bar' ? (
              <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--og-line)" vertical={false} />
                <XAxis dataKey={xKey} tick={{ fill: 'var(--og-ink-muted)', fontSize: 12 }} stroke="var(--og-line-strong)" tickLine={false} />
                <YAxis domain={yDomain} tick={{ fill: 'var(--og-ink-muted)', fontSize: 12 }} tickFormatter={fmt} stroke="none" tickLine={false} width={44} />
                <Tooltip content={<ChartTooltip format={fmt} />} cursor={{ fill: 'var(--og-primary-soft)' }} />
                {series.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.name}
                    fill={seriesColor(series, i, highlightKey)}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                    stroke="var(--og-surface-raised)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            ) : (
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--og-line)" vertical={false} />
                <XAxis dataKey={xKey} tick={{ fill: 'var(--og-ink-muted)', fontSize: 12 }} stroke="var(--og-line-strong)" tickLine={false} />
                <YAxis domain={yDomain} tick={{ fill: 'var(--og-ink-muted)', fontSize: 12 }} tickFormatter={fmt} stroke="none" tickLine={false} width={44} />
                <Tooltip content={<ChartTooltip format={fmt} />} cursor={{ stroke: 'var(--og-line-strong)' }} />
                {series.map((s, i) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.name}
                    stroke={seriesColor(series, i, highlightKey)}
                    strokeWidth={2}
                    dot={{ r: 4, fill: seriesColor(series, i, highlightKey), stroke: 'var(--og-surface-raised)', strokeWidth: 2 }}
                    activeDot={{ r: 5, stroke: 'var(--og-surface-raised)', strokeWidth: 2 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      ) : null}

      <div id={tableId} className={cn(!showTable && 'sr-only')}>
        <table className="text-small w-full border-collapse text-left text-ink">
          <caption className="sr-only">{`${title} (tablo görünümü)`}</caption>
          <thead>
            <tr>
              <th scope="col" className="border-b border-line py-2 pr-3 font-medium text-ink-muted" />
              {series.map((s) => (
                <th key={s.key} scope="col" className="border-b border-line py-2 pr-3 text-right font-medium text-ink-muted">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, ri) => (
              <tr key={ri}>
                <th scope="row" className="border-b border-line py-2 pr-3 font-normal">
                  {String(row[xKey] ?? '')}
                </th>
                {series.map((s) => (
                  <td key={s.key} className="border-b border-line py-2 pr-3 text-right tabular-nums">
                    {fmt(row[s.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {caption ? <p className="text-caption m-0 text-ink-muted">{caption}</p> : null}
    </figure>
  );
}

interface TooltipPayloadItem {
  name?: string | number;
  value?: unknown;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({ active, payload, label, format }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string | number; format: (v: unknown) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="text-small rounded-md border border-line bg-surface-raised px-3 py-2 text-ink shadow-lg">
      <div className="font-medium">{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-ink-muted">{p.name}</span>
          <span className="ml-auto font-medium tabular-nums">{format(p.value)}</span>
        </div>
      ))}
    </div>
  );
}
