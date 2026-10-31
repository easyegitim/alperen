'use client';
// "Pilot kapısı" bloğu: ölçüt başına PASS / FAIL / NO_DATA (Badge; required:false olanlar "bilgi") ve "Kapı: AÇIK / KAPALI".
import { Badge } from '../lib/ds';
import { decimal, usd } from '../lib/format';
import { METRIC_LABELS } from '../lib/pilot-gate';
import type { GateResult } from '../lib/data';

export function GateBlock({ gate }: { gate: GateResult }) {
  return (
    <section className="section" aria-labelledby="gate-h" data-testid="pilot-gate">
      <h2 id="gate-h" className="t-title-2">
        Pilot kapısı
      </h2>
      <table className="table">
        <thead>
          <tr>
            <th>Ölçüt</th>
            <th>Sonuç</th>
            <th>Değer</th>
            <th>Eşik</th>
          </tr>
        </thead>
        <tbody>
          {gate.rows.map((r) => (
            <tr key={r.metric} data-metric={r.metric} data-verdict={r.verdict}>
              <td>
                {METRIC_LABELS[r.metric] ?? r.metric}
                {!r.required && <span className="hint"> · bilgi</span>}
              </td>
              <td>
                <Badge tone={r.verdict === 'PASS' ? 'success' : r.verdict === 'FAIL' ? 'danger' : 'neutral'}>{r.verdict}</Badge>
              </td>
              <td className="num">
                {r.value === null ? 'henüz ölçülmedi' : r.metric === 'cost_per_student' ? usd(r.value) : decimal(r.value, 4)}
                {r.n !== null ? ` (n=${r.n})` : ''}
              </td>
              <td>{r.threshold}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="t-title-3" data-gate={gate.gate}>
        Kapı: {gate.gate}
      </span>
      <span className="hint">Zorunlu ölçütlerin hepsi PASS olmadan özellik tüm öğrencilere açılmaz; NO_DATA kapıyı açmaz. Eşikler settings.pilot_gate'tedir (ADR-0013).</span>
    </section>
  );
}

