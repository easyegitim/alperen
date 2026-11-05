/**
 * `stop_reason: "refusal"` eşlemesi. Dallanma her zaman `stop_reason` üzerinden yapılır; `stop_details`
 * bilgi amaçlıdır ve null olabilir (claude-api: shared/model-migration.md "refusal stop reason").
 * Kullanıcıya kibar bir Türkçe ileti gösterilir, eğitmene yönlendirilir, kategori deftere yazılır (PLAN-v2 §6).
 *
 * İleti kitleye göre seçilir: öğrenciye "sen" dili, veliye "siz" dili (PLAN-v2 §10). Veli rotası (`parent_chat`)
 * veli metnini alır; diğer bütün rotalar öğrenci metnini.
 *
 * İletiler bir not bırakıldığını iddia ETMEZ: bu paket bildirim yazmaz. `notify_instructor: true` ise eğitmene not
 * düşmek çağıranın işidir (apps/web ya da apps/worker `notifications` satırı yazar; PLAN-v2 §6 "eğitmene not düşer").
 */
import type { BetaMessage, BetaRefusalStopDetails } from '@anthropic-ai/sdk/resources/beta/messages/messages';

export type RefusalCategory = NonNullable<BetaRefusalStopDetails['category']>;

/** İletinin kime gösterileceği. */
export type RefusalAudience = 'student' | 'parent';

export interface RefusalInfo {
  /** `stop_details.category`; null = kategori bildirilmedi (geçerli kalıcı durum). */
  category: RefusalCategory | null;
  /** İletinin kitlesi (rotadan türer: `parent_chat` → veli). */
  audience: RefusalAudience;
  /** Öğrenciye (sen dili) ya da veliye (siz dili) gösterilecek ileti; ünlem/emoji yok. */
  user_message_tr: string;
  /**
   * Eğitmene not düşülmeli mi. Paket bildirim yazmaz: true ise çağıran `notifications` satırı yazar
   * (kategori ve rota ile; içerik değil).
   */
  notify_instructor: boolean;
  /** Sunucunun önerdiği doğrudan yeniden deneme modeli (yedek koşamadıysa); yalnız ipucu. */
  recommended_model: string | null;
  explanation: string | null;
}

type Key = RefusalCategory | 'none';

const STUDENT: Record<Key, string> = {
  bio: 'Bu konuda burada yardımcı olamıyorum. İstersen bunu hocana sorabilirsin.',
  cyber: 'Bu isteğe burada yardımcı olamıyorum. Derse dönük bir soruysa hocana sorman daha iyi olur.',
  frontier_llm: 'Bu isteğe burada yardımcı olamıyorum. İstersen sorunu farklı bir biçimde yeniden sorabilirsin.',
  reasoning_extraction:
    'Düşünme sürecimi olduğu gibi yazamıyorum, ama çözümü adım adım açıklayabilirim. Hangi adımı açmamı istersin?',
  general_harms: 'Bu isteğe burada yardımcı olamıyorum. İstersen bunu hocana sorabilirsin.',
  none: 'Bu isteğe şu an yardımcı olamıyorum. İstersen bunu hocana sorabilirsin.',
};

const PARENT: Record<Key, string> = {
  bio: 'Bu konuda burada yardımcı olamıyorum. Dilerseniz sorunuzu çocuğunuzun eğitmenine iletebilirsiniz.',
  cyber: 'Bu isteğe burada yardımcı olamıyorum. Dilerseniz sorunuzu çocuğunuzun eğitmenine iletebilirsiniz.',
  frontier_llm: 'Bu isteğe burada yardımcı olamıyorum. Dilerseniz sorunuzu farklı bir biçimde yeniden sorabilirsiniz.',
  reasoning_extraction:
    'Düşünme sürecimi olduğu gibi aktaramıyorum, ancak sonucu ve dayandığı bilgileri kısaca açıklayabilirim.',
  general_harms: 'Bu isteğe burada yardımcı olamıyorum. Dilerseniz sorunuzu çocuğunuzun eğitmenine iletebilirsiniz.',
  none: 'Bu isteğe şu an yardımcı olamıyorum. Dilerseniz sorunuzu çocuğunuzun eğitmenine iletebilirsiniz.',
};

const NOTIFY: Record<Key, boolean> = {
  bio: true,
  cyber: true,
  frontier_llm: false,
  reasoning_extraction: false,
  general_harms: true,
  none: true,
};

/** Veli rotaları (veliye "siz" diliyle konuşulur). */
const PARENT_ROUTES: ReadonlySet<string> = new Set(['parent_chat']);

/** Rotadan kitle: `parent_chat` → veli; diğerleri → öğrenci. */
export function audienceForRoute(route: string): RefusalAudience {
  return PARENT_ROUTES.has(route) ? 'parent' : 'student';
}

/** Yanıt bir ret ise eşlemeyi döndürür; değilse null. */
export function refusalOf(
  message: Pick<BetaMessage, 'stop_reason' | 'stop_details'>,
  audience: RefusalAudience = 'student',
): RefusalInfo | null {
  if (message.stop_reason !== 'refusal') return null;
  return mapRefusal(message.stop_details, audience);
}

export function mapRefusal(details: BetaRefusalStopDetails | null | undefined, audience: RefusalAudience = 'student'): RefusalInfo {
  const category = details?.category ?? null;
  const key: Key = category ?? 'none';
  const table = audience === 'parent' ? PARENT : STUDENT;
  return {
    category,
    audience,
    user_message_tr: table[key] ?? table.none,
    notify_instructor: NOTIFY[key] ?? true,
    recommended_model: details?.recommended_model ?? null,
    explanation: details?.explanation ?? null,
  };
}
