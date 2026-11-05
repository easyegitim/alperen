// İlerleme: ±gürültü bandı içindeki fark "değişim yok" (KB §4.2 / PLAN Faz 6; CONTRACTS_V2 Sprint 3 S3.3).
// Tek kaynak NOISE_BAND = lib/config/scoring.ts (motor ve ClientAnalysisV2.noiseBand aynı değeri taşır). Saf; web ve mobil.
import { NOISE_BAND } from "@/lib/config/scoring";

export { NOISE_BAND };

export type ChangeKind = "no_change" | "up" | "down";

export type ScoreChange = {
  /** next − prev, tek ondalık (işaretli). */
  delta: number;
  kind: ChangeKind;
  /** Kullanılan bant (ClientAnalysisV2.noiseBand ya da NOISE_BAND). */
  band: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** |Δ| ≤ bant → "değişim yok"; ışık ve açı farkı değişim sayılmaz. Bant sınırı dahil (0,3 fark = değişim yok). */
export function classifyChange(prev: number, next: number, band: number = NOISE_BAND): ScoreChange {
  const delta = round1(next - prev);
  const kind: ChangeKind = Math.abs(delta) <= band + 1e-9 ? "no_change" : delta > 0 ? "up" : "down";
  return { delta, kind, band };
}

/** tr.json anahtarları (progress.v2.change.*); metin değerleri sözleşmede. */
export const CHANGE_LABEL_KEY: Record<ChangeKind, string> = {
  no_change: "progress.v2.change.noChange",
  up: "progress.v2.change.up",
  down: "progress.v2.change.down",
};

/** "0,3" biçimi (tr-TR, tek ondalık). */
export function formatBand(band: number = NOISE_BAND): string {
  return band.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "+0,4" / "−0,5" / "0,0" (tipografik eksi). */
export function formatDelta(delta: number): string {
  const abs = Math.abs(delta).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (delta > 0) return `+${abs}`;
  if (delta < 0) return `−${abs}`;
  return abs;
}

export type TrendInput = { id: string; date: string; overall: number };
export type TrendChange = { from: string; to: string; change: ScoreChange };

/** Ardışık analiz çiftleri (tarihe göre artan) için değişim sınıfı; kalibrasyon sürümü farklıysa çağıran karşılaştırmaz. */
export function trendChanges(points: readonly TrendInput[], band: number = NOISE_BAND): TrendChange[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const out: TrendChange[] = [];
  for (let i = 1; i < sorted.length; i++) out.push({ from: sorted[i - 1].id, to: sorted[i].id, change: classifyChange(sorted[i - 1].overall, sorted[i].overall, band) });
  return out;
}
