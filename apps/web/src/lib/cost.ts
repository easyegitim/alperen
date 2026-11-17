// Eğitmen "Maliyet" sayfası: instructor_cost_overview (0047) yanıtının ayrıştırılması, para biçimi ve tavan durumu.
// Saf modül (sunucu ve testler).

export type CapState = 'normal' | 'near' | 'over';

/** Tavanın bu oranına gelince "tavana yakın" (runtime_flags alert_thresholds'un ilk eşiğiyle aynı varsayılan). */
export const NEAR_CAP_RATIO = 0.8;

export const CAP_STATE_LABELS: Record<CapState, string> = {
  normal: 'normal',
  near: 'tavana yakın',
  over: 'tavan aşıldı',
};

/** Toplam ↔ tavan: tavan yoksa (≤ 0) her zaman normal. */
export function capState(total: number, cap: number): CapState {
  if (!(cap > 0)) return 'normal';
  if (total >= cap) return 'over';
  if (total >= cap * NEAR_CAP_RATIO) return 'near';
  return 'normal';
}

/** "1,23 $"; sıfırdan büyük ama bir sentten küçük tutarlar dört haneyle ("0,0042 $"). */
export function formatUsd(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  const small = v > 0 && v < 0.01;
  const n = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: small ? 4 : 2 }).format(v);
  return `${n} $`;
}

export interface CostRoute {
  route: string;
  calls: number;
  costUsd: number;
}

export interface CostStudent {
  studentRef: string;
  studentId: string | null;
  name: string | null;
  costUsd: number;
  overCap: boolean;
}

export interface CostOverview {
  todayUsd: number;
  monthUsd: number;
  dailyCapUsd: number;
  monthlyCapUsd: number;
  studentMonthlyCapUsd: number;
  state: string;
  byRoute: CostRoute[];
  byStudent: CostStudent[];
  last7Days: { day: string; costUsd: number }[];
}

export const EMPTY_COST_OVERVIEW: CostOverview = {
  todayUsd: 0,
  monthUsd: 0,
  dailyCapUsd: 0,
  monthlyCapUsd: 0,
  studentMonthlyCapUsd: 0,
  state: 'normal',
  byRoute: [],
  byStudent: [],
  last7Days: [],
};

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : [];

/** RPC yanıtını ayrıştırır; nesne değilse hata atar (callRpc OGR-WEB-001'e çevirir). */
export function parseCostOverview(raw: unknown): CostOverview {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('nesne bekleniyordu');
  const r = raw as Record<string, unknown>;
  return {
    todayUsd: num(r.today_usd),
    monthUsd: num(r.month_usd),
    dailyCapUsd: num(r.daily_cap_usd),
    monthlyCapUsd: num(r.monthly_cap_usd),
    studentMonthlyCapUsd: num(r.student_monthly_cap_usd),
    state: str(r.state) ?? 'normal',
    byRoute: arr(r.by_route).map((x) => ({ route: str(x.route) ?? '—', calls: num(x.calls), costUsd: num(x.cost_usd) })),
    byStudent: arr(r.by_student).map((x) => ({
      studentRef: str(x.student_ref) ?? '',
      studentId: str(x.student_id),
      name: str(x.name),
      costUsd: num(x.cost_usd),
      overCap: x.over_cap === true,
    })),
    last7Days: arr(r.last_7_days).map((x) => ({ day: str(x.day) ?? '', costUsd: num(x.cost_usd) })),
  };
}
