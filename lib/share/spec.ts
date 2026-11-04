// Paylaşım kartı sözleşmesi (KB §8 KARAR R2-Ö3; ONAYLI ÖNERİ R2-Ö2 berber kartı; K17; PLAN Faz 6; CONTRACTS_V2 Sprint 3 S3.3).
// SAF: canvas/DOM yok; web çizimi lib/share/card.ts (OffscreenCanvas), mobil çizimi Skia (mobile/src/features/share)
// bu spec'i alır. Kart cihazda üretilir; sunucuya hiçbir şey gitmez.
// Kurallar: varsayılan kart skor kartı; isteğe bağlı "En güçlü yanın: …"; berber kartı plan ekranından;
// REKLAM/MAĞAZA kartında kullanıcı fotoğrafı YOK (K17) — audience:"marketing" + withPhoto:true geçersizdir.
import type { BarberSpec } from "@/lib/coach/planTypes";
import { SUB_KEYS_V2, type SubKey } from "@/lib/config/teaser";

export const SHARE_CARD_KINDS = ["score", "strongest", "barber"] as const;
export type ShareCardKind = (typeof SHARE_CARD_KINDS)[number];

export const SHARE_CARD_FORMATS = ["story", "square"] as const;
export type ShareCardFormat = (typeof SHARE_CARD_FORMATS)[number];
export const SHARE_CARD_SIZES: Record<ShareCardFormat, { w: number; h: number }> = { story: { w: 1080, h: 1920 }, square: { w: 1080, h: 1080 } };

/** personal: kullanıcının kendi paylaşımı; marketing: reklam/mağaza görseli (yalnız izinli model/sentetik, K17). */
export const SHARE_AUDIENCES = ["personal", "marketing"] as const;
export type ShareAudience = (typeof SHARE_AUDIENCES)[number];

export const SHARE_RULES = {
  maxSubs: 3,
  maxLineChars: 120,
  maxTitleChars: 80,
  /** Fotoğraf yalnız kişisel paylaşımda ve yalnız skor/en güçlü kartında (berber kartı fotoğrafsız: S2.14 #27, varlık yok). */
  photoAllowed: (kind: ShareCardKind, audience: ShareAudience): boolean => audience === "personal" && kind !== "barber",
} as const;

type Common = {
  format: ShareCardFormat;
  audience: ShareAudience;
  /** "Aura" */
  appName: string;
  /** Kartın altındaki adres (ör. aura.app). */
  url: string;
  /** Sabit not (share.v2.disclaimer): YZ tahmini; kişisel değer ölçmez. */
  disclaimer: string;
  /** Kullanıcı fotoğrafı eklendi mi (yalnız bayrak; görselin kendisi spec'te yok). */
  withPhoto: boolean;
};

export type ScoreShareSpec = Common & {
  kind: "score";
  overall: number;
  /** Potansiyel (+delta çağıran hesaplar); kilitliyse null → satır çizilmez. */
  potential: number | null;
  /** En çok 3 alt skor; etiket tr.json analysis.sub.<key>. */
  subs: { key: SubKey; label: string; value: number }[];
};

export type StrongestShareSpec = Common & {
  kind: "strongest";
  sub: SubKey;
  /** "En güçlü yanın: {area}" (share.v2.strongestTitle) — sayı yok. */
  title: string;
  /** ExplanationV2.held[0] gibi tek nötr cümle (≤ 120 karakter) ya da boş. */
  line: string;
};

export type BarberShareSpec = Common & {
  kind: "barber";
  barber: BarberSpec;
  presetIds: { hair?: string; beard?: string };
  /** tr.json plan.v2.barber.* ile hazırlanmış satırlar (yanlar, üst, sakal hattı, not). */
  lines: string[];
  /** Önden/yandan stil görseli henüz yok (S2.14 #27); varlık gelince eklenir. */
  withPhoto: false;
};

export type ShareCardSpec = ScoreShareSpec | StrongestShareSpec | BarberShareSpec;

export type ShareSpecIssue =
  | "photo_on_marketing_card"
  | "photo_on_barber_card"
  | "score_out_of_range"
  | "too_many_subs"
  | "sub_out_of_range"
  | "title_too_long"
  | "line_too_long"
  | "barber_style_missing"
  | "url_missing";

const inRange = (v: number) => Number.isFinite(v) && v >= 1 && v <= 10;

/** Kart çizilmeden önce tek kapı: boş liste = geçerli. Çizici (web/mobil) sorunlu spec'i çizmez. */
export function shareSpecIssues(spec: ShareCardSpec): ShareSpecIssue[] {
  const issues: ShareSpecIssue[] = [];
  const withPhoto: boolean = spec.withPhoto; // BarberShareSpec tipte false; çalışma zamanı kapısı yine de çalışır
  if (withPhoto && spec.audience === "marketing") issues.push("photo_on_marketing_card");
  if (withPhoto && spec.kind === "barber") issues.push("photo_on_barber_card");
  if (!spec.url.trim()) issues.push("url_missing");
  if (spec.kind === "score") {
    if (!inRange(spec.overall) || (spec.potential !== null && !inRange(spec.potential))) issues.push("score_out_of_range");
    if (spec.subs.length > SHARE_RULES.maxSubs) issues.push("too_many_subs");
    if (spec.subs.some((s) => !inRange(s.value))) issues.push("sub_out_of_range");
  } else if (spec.kind === "strongest") {
    if (spec.title.length > SHARE_RULES.maxTitleChars) issues.push("title_too_long");
    if (spec.line.length > SHARE_RULES.maxLineChars) issues.push("line_too_long");
  } else if (!spec.barber.styleName.trim()) {
    issues.push("barber_style_missing");
  }
  return issues;
}

/** En yüksek açık alt skor; eşitlikte SUB_KEYS_V2 sırası; hiç açık değer yoksa null. */
export function strongestSub(subscores: Partial<Record<SubKey, { value: number } | null | undefined>>): SubKey | null {
  let best: SubKey | null = null;
  let bestValue = -Infinity;
  for (const key of SUB_KEYS_V2) {
    const v = subscores[key]?.value;
    if (typeof v === "number" && Number.isFinite(v) && v > bestValue) {
      best = key;
      bestValue = v;
    }
  }
  return best;
}

/** Skor kartı için en yüksek 3 alt skor (değer azalan; eşitlikte SUB_KEYS_V2 sırası). */
export function topSubs(subscores: Partial<Record<SubKey, { value: number } | null | undefined>>, labelOf: (k: SubKey) => string, max: number = SHARE_RULES.maxSubs): ScoreShareSpec["subs"] {
  return SUB_KEYS_V2.map((key, i) => ({ key, i, value: subscores[key]?.value }))
    .filter((s): s is { key: SubKey; i: number; value: number } => typeof s.value === "number" && Number.isFinite(s.value))
    .sort((a, b) => b.value - a.value || a.i - b.i)
    .slice(0, max)
    .map((s) => ({ key: s.key, label: labelOf(s.key), value: s.value }));
}

/** İndirme dosya adı: aura-<kind>-<YYYYMMDD>.jpg */
export function shareFileName(kind: ShareCardKind, now: Date = new Date()): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `aura-${kind}-${ymd}.jpg`;
}
