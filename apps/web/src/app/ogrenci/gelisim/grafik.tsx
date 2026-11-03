import { lineGeometry, seriesAlt, type DayPoint } from '@/server/progress/present';

/**
 * Haftalık çizgi (mockup S08 "Günlük soru"): deterministik SVG, tek seri primary, ızgara ve eksen metni geri planda,
 * bugünün değeri yazılı. Sayılar alternatif metinde kelimeyle; renk tek başına anlam taşımaz.
 */
export function WeeklyLine({ days }: { days: DayPoint[] }) {
  const g = lineGeometry(days);
  const today = g.points.find((p) => p.today);
  return (
    <svg role="img" aria-label={seriesAlt(days)} width="100%" height={g.height} viewBox={`0 0 ${g.width} ${g.height}`} className="block overflow-visible" data-testid="haftalik-cizgi">
      <g aria-hidden="true" fill="none" className="stroke-line" strokeWidth={1}>
        {g.ticks.map((t) => (
          <path key={t.y} d={`M30 ${t.y}H302`} />
        ))}
      </g>
      <g aria-hidden="true" textAnchor="end" className="fill-ink-muted" style={{ fontFamily: 'var(--og-font-sans)', fontSize: 12 }}>
        {g.ticks.map((t) => (
          <text key={t.y} x={18} y={t.y + 4}>
            {t.label}
          </text>
        ))}
      </g>
      <polyline aria-hidden="true" points={g.polyline} fill="none" className="stroke-primary" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <g aria-hidden="true" className="fill-surface-raised stroke-primary" strokeWidth={2}>
        {g.points
          .filter((p) => !p.today)
          .map((p) => (
            <circle key={p.x} cx={p.x} cy={p.y} r={3.5} />
          ))}
      </g>
      {today ? (
        <>
          <circle aria-hidden="true" cx={today.x} cy={today.y} r={5.5} className="fill-primary" />
          <text aria-hidden="true" x={today.x} y={today.y - 14} textAnchor="middle" className="fill-ink" style={{ fontFamily: 'var(--og-font-sans)', fontSize: 13, fontWeight: 600 }}>
            {today.value}
          </text>
        </>
      ) : null}
      <g aria-hidden="true" textAnchor="middle" className="fill-ink-muted" style={{ fontFamily: 'var(--og-font-sans)', fontSize: 12 }}>
        {g.points.map((p) => (
          <text key={p.x} x={p.x} y={144} className={p.today ? 'fill-ink font-semibold' : undefined}>
            {p.label}
          </text>
        ))}
      </g>
    </svg>
  );
}
