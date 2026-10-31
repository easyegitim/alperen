'use client';
// "Yanıt süresi (14 gün)": tek seri SVG çizgi (primary 2 px, ızgara line), uç nokta 8 px surface-raised halkalı,
// eksen metni ink-muted; tablo görünümü <details> içinde (egitmen-paneli.md "Grafikler"). Panelde başka grafik yok.
import { dayMonth, hours } from '../lib/format';

export interface SeriesPoint {
  day: string;
  median_hours: number | null;
}

const W = 720;
const H = 220;
const PAD = { l: 44, r: 16, t: 16, b: 32 };

export function ResponseChart({ series, targetHours }: { series: SeriesPoint[]; targetHours: number }) {
  const values = series.map((p) => p.median_hours).filter((v): v is number => v !== null);
  const max = Math.max(targetHours, ...values, 1);
  const yMax = Math.ceil(max);
  const x = (i: number) => PAD.l + (series.length <= 1 ? 0 : (i * (W - PAD.l - PAD.r)) / (series.length - 1));
  const y = (v: number) => PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b);
  const segments: string[] = [];
  let current = '';
  series.forEach((p, i) => {
    if (p.median_hours === null) {
      if (current) segments.push(current);
      current = '';
      return;
    }
    current += `${current ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.median_hours).toFixed(1)}`;
  });
  if (current) segments.push(current);
  const lastIdx = series.map((p) => p.median_hours !== null).lastIndexOf(true);
  const ticks = Array.from({ length: yMax + 1 }, (_, i) => i);
  return (
    <figure className="stack" aria-labelledby="chart-title">
      <figcaption id="chart-title" className="t-title-3">
        Yanıt süresi (14 gün)
      </figcaption>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Eğitmen medyan yanıt süresi, son 14 gün; değerler aşağıdaki tabloda">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.l - 8} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {series.map((p, i) =>
          i % 2 === 0 ? (
            <text key={p.day} className="axis" x={x(i)} y={H - 10} textAnchor="middle">
              {dayMonth(`${p.day}T12:00:00Z`)}
            </text>
          ) : null,
        )}
        {segments.map((d, i) => (
          <path key={i} className="series" d={d} />
        ))}
        {lastIdx >= 0 && <circle className="endpoint" cx={x(lastIdx)} cy={y(series[lastIdx].median_hours as number)} r={4} />}
      </svg>
      <details>
        <summary>Tablo görünümü</summary>
        <table className="table">
          <thead>
            <tr>
              <th>Gün</th>
              <th className="num">Medyan yanıt süresi</th>
            </tr>
          </thead>
          <tbody>
            {series.map((p) => (
              <tr key={p.day}>
                <td>{dayMonth(`${p.day}T12:00:00Z`)}</td>
                <td className="num">{p.median_hours === null ? 'yanıt yok' : hours(p.median_hours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
