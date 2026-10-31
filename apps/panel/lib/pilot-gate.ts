// Pilot kapısı (ADR-0013, BLUEPRINT §6.2 `kulaklik metrics --gate`, §7 /maliyet, §12 #57).
// settings.pilot_gate eşikleri son pilot_metrics dönemine uygulanır: ölçüt başına PASS / FAIL / NO_DATA
// (value=null ya da n < n_min → NO_DATA). required:false ölçütler bilgi satırıdır, kararı etkilemez.
// Zorunlu ölçütlerin hepsi PASS ise "Kapı: AÇIK", aksi KAPALI — NO_DATA kapıyı açmaz.
import type { GateResult, GateRow, PilotMetricRow } from './data/types';
import { decimal, usd } from './format';

type Threshold = { min?: number; max?: number; max_usd?: number; n_min?: number; required?: boolean };

function sampleSize(detail: Record<string, unknown> | undefined): number | null {
  if (!detail) return null;
  for (const k of ['n', 'n_rated']) {
    const v = detail[k];
    if (typeof v === 'number') return v;
  }
  return null;
}

function thresholdText(t: Threshold | string): string {
  if (typeof t === 'string') return `= ${t}`;
  const parts: string[] = [];
  if (typeof t.min === 'number') parts.push(`≥ ${decimal(t.min, 2)}`);
  if (typeof t.max === 'number') parts.push(`≤ ${decimal(t.max, 2)}`);
  if (typeof t.max_usd === 'number') parts.push(`≤ ${usd(t.max_usd)}`);
  if (typeof t.n_min === 'number') parts.push(`n ≥ ${t.n_min}`);
  return parts.join(', ');
}

/** Geçti/kaldı ölçütleri (settings.pilot_gate'te dize eşikli: isolation_tests, key_leak_tests). */
export const CI_STATUS_METRICS = ['isolation_tests', 'key_leak_tests'] as const;

/**
 * CI durumunu veriden okur: `pilot_metrics` satırı `metric in (isolation_tests, key_leak_tests)`, `detail.status`
 * 'pass' | 'fail' (CI adımı ya da M07 `kulaklik metrics --ci-status` yazar; value kullanılmaz). Ölçüt başına en son
 * dönem (eşitse en son computed_at) geçerlidir. Satır yoksa anahtar yoktur → NO_DATA. Panel ve CLI aynı kararı verir.
 */
export function ciStatusFromMetrics(metrics: PilotMetricRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const metric of CI_STATUS_METRICS) {
    const rows = metrics
      .filter((m) => m.metric === metric && (m.detail?.status === 'pass' || m.detail?.status === 'fail'))
      .sort((a, b) => (a.period === b.period ? b.computed_at.localeCompare(a.computed_at) : b.period.localeCompare(a.period)));
    if (rows[0]) out[metric] = String(rows[0].detail.status);
  }
  return out;
}

/**
 * @param gate settings.pilot_gate değeri (anahtar sırası korunur)
 * @param metrics pilot_metrics satırları (birden çok dönem olabilir; en son dönem kullanılır)
 * @param ciStatus isolation_tests / key_leak_tests gibi geçti/kaldı ölçütleri (CI'dan); yoksa NO_DATA
 */
export function evaluatePilotGate(
  gate: Record<string, unknown>,
  metrics: PilotMetricRow[],
  ciStatus: Record<string, string> = {},
): GateResult {
  // dönem, sayısal ölçütlerden seçilir (CI satırları ayrı bir dönemde olabilir ve kararı ciStatus üzerinden verir)
  const numeric = metrics.filter((m) => !(CI_STATUS_METRICS as readonly string[]).includes(m.metric));
  const period = numeric.reduce<string | null>((acc, m) => (acc === null || m.period > acc ? m.period : acc), null);
  const latest = new Map(numeric.filter((m) => m.period === period).map((m) => [m.metric, m]));
  const rows: GateRow[] = [];
  for (const [metric, raw] of Object.entries(gate)) {
    if (typeof raw === 'string') {
      const status = ciStatus[metric];
      rows.push({
        metric,
        required: true,
        value: null,
        n: null,
        threshold: thresholdText(raw),
        verdict: status === undefined ? 'NO_DATA' : status === raw ? 'PASS' : 'FAIL',
      });
      continue;
    }
    const t = (raw ?? {}) as Threshold;
    const row = latest.get(metric);
    const value = row && typeof row.value === 'number' ? row.value : null;
    const n = sampleSize(row?.detail);
    let verdict: GateRow['verdict'];
    if (value === null) verdict = 'NO_DATA';
    else if (typeof t.n_min === 'number' && (n === null || n < t.n_min)) verdict = 'NO_DATA';
    else {
      let ok = true;
      if (typeof t.min === 'number') ok = ok && value >= t.min;
      if (typeof t.max === 'number') ok = ok && value <= t.max;
      if (typeof t.max_usd === 'number') ok = ok && value <= t.max_usd;
      verdict = ok ? 'PASS' : 'FAIL';
    }
    rows.push({ metric, required: t.required !== false, value, n, threshold: thresholdText(t), verdict });
  }
  const open = rows.filter((r) => r.required).every((r) => r.verdict === 'PASS');
  return { rows, gate: open ? 'AÇIK' : 'KAPALI', period };
}

export const METRIC_LABELS: Record<string, string> = {
  question_accuracy: 'Soru doğruluğu',
  diagnostic_agreement: 'Teşhis örtüşmesi',
  citation_relevance: 'Atıf ilgisi',
  priority_uplift: 'Öncelik katkısı',
  cost_per_student: 'Öğrenci başına maliyet (ders hariç)',
  flagged_response_share: 'İşaretli cevap payı',
  degraded_share: 'Bozulmuş / şema onarımı payı',
  distractor_unused_share: 'Kullanılmayan çeldirici payı',
  isolation_tests: 'Veri yalıtımı testleri',
  key_leak_tests: 'Cevap anahtarı sızıntı testleri',
};
