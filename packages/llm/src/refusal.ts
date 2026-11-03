/**
 * `stop_reason: "refusal"` eşlemesi. Dallanma her zaman `stop_reason` üzerinden yapılır; `stop_details`
 * bilgi amaçlıdır ve null olabilir (claude-api: shared/model-migration.md "refusal stop reason").
 * Kullanıcıya kibar bir Türkçe ileti gösterilir, eğitmene yönlendirilir, kategori deftere yazılır (PLAN-v2 §6).
 */
import type { BetaMessage, BetaRefusalStopDetails } from '@anthropic-ai/sdk/resources/beta/messages/messages';

export type RefusalCategory = NonNullable<BetaRefusalStopDetails['category']>;

export interface RefusalInfo {
  /** `stop_details.category`; null = kategori bildirilmedi (geçerli kalıcı durum). */
  category: RefusalCategory | null;
  /** Öğrenciye/veliye gösterilecek ileti (sen dili, ünlem/emoji yok). */
  user_message_tr: string;
  /** Eğitmene not düşülsün mü. */
  notify_instructor: boolean;
  /** Sunucunun önerdiği doğrudan yeniden deneme modeli (yedek koşamadıysa); yalnız ipucu. */
  recommended_model: string | null;
  explanation: string | null;
}

const MESSAGES: Record<RefusalCategory | 'none', string> = {
  bio: 'Bu konuda burada yardımcı olamıyorum. Sorunu hocana iletmeni öneririm; ona bir not bıraktım.',
  cyber: 'Bu isteğe burada yardımcı olamıyorum. Derse dönük bir soruysa hocana sorman daha iyi olur; ona bir not bıraktım.',
  frontier_llm: 'Bu isteğe burada yardımcı olamıyorum. İstersen sorunu farklı bir biçimde yeniden sorabilirsin.',
  reasoning_extraction:
    'Düşünme sürecimi olduğu gibi yazamıyorum, ama çözümü adım adım açıklayabilirim. Hangi adımı açmamı istersin?',
  general_harms: 'Bu isteğe burada yardımcı olamıyorum. Sorunu hocana iletmeni öneririm; ona bir not bıraktım.',
  none: 'Bu isteğe şu an yardımcı olamıyorum. Sorunu hocana iletmeni öneririm; ona bir not bıraktım.',
};

const NOTIFY: Record<RefusalCategory | 'none', boolean> = {
  bio: true,
  cyber: true,
  frontier_llm: false,
  reasoning_extraction: false,
  general_harms: true,
  none: true,
};

/** Yanıt bir ret ise eşlemeyi döndürür; değilse null. */
export function refusalOf(message: Pick<BetaMessage, 'stop_reason' | 'stop_details'>): RefusalInfo | null {
  if (message.stop_reason !== 'refusal') return null;
  return mapRefusal(message.stop_details);
}

export function mapRefusal(details: BetaRefusalStopDetails | null | undefined): RefusalInfo {
  const category = details?.category ?? null;
  const key = category ?? 'none';
  return {
    category,
    user_message_tr: MESSAGES[key] ?? MESSAGES.none,
    notify_instructor: NOTIFY[key] ?? true,
    recommended_model: details?.recommended_model ?? null,
    explanation: details?.explanation ?? null,
  };
}
