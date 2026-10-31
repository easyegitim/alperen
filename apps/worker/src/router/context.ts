/** Bir güncellemenin işlenme bağlamı (adlar ayıklanmış güncelleme + kimlik + kapsamlı Db). */
import type { ChatKind, Db, Identity, SessionRow, TgChatRow } from '../data/repo.ts';
import type { ReplyOptions, ReplyResult } from '../services.ts';
import type { RoleLabel } from '@ogrenmen/pii';
import type { Services } from '../services.ts';
import type { TgCallbackQuery, TgMessage, TgUpdate } from '../telegram/types.ts';

export interface Actor {
  id: number;
  username: string | null;
  isBot: boolean;
}

export interface Ctx {
  s: Services;
  update: TgUpdate;
  chatId: number;
  chatKind: ChatKind;
  chat: TgChatRow;
  actor: Actor;
  identity: Identity;
  /** Öğrenci varsa onun başlığıyla, yoksa başlıksız. */
  db: Db;
  message?: TgMessage;
  callback?: TgCallbackQuery;
  /** `messages` satırı (öğrenci kapsamında yazıldıysa). */
  messageRowId: number | null;
  /** 4.000 karakterden uzun metin kırpıldı mı. */
  truncated: boolean;
  session: SessionRow | null;
  /**
   * Gönderenin kendi ad-token hash'leri → rol etiketi ('ÖĞRENCİ' / 'EĞİTMEN'). Hash'ler güncellemedeki
   * ad alanlarından bellek içinde türetilir; düz ad hiçbir yere yazılmaz (yalnız resolve_telegram'a gider).
   */
  selfRoles: Readonly<Record<string, RoleLabel>>;
}

export const MAX_TEXT_CHARS = 4000;

export function isPrivate(ctx: Ctx): boolean {
  return ctx.chatKind === 'private';
}

/** Öğrenci oturumunu getirir; yoksa oluşturur. */
export async function ensureSession(ctx: Ctx): Promise<SessionRow> {
  if (ctx.session) return ctx.session;
  const existing = await ctx.db.getSession(ctx.chatId);
  if (existing) {
    ctx.session = existing;
    return existing;
  }
  const prefs = await ctx.db.getPreferences().catch(() => null);
  ctx.session = await ctx.db.upsertSession({ chat_id: ctx.chatId, state: 'new', mode: prefs?.default_mode ?? 'socratic', last_activity_at: ctx.s.now().toISOString() });
  return ctx.session;
}

export async function saveSession(ctx: Ctx, patch: Partial<SessionRow>): Promise<SessionRow> {
  const cur = await ensureSession(ctx);
  ctx.session = await ctx.db.upsertSession({ ...cur, ...patch, chat_id: ctx.chatId });
  return ctx.session;
}

/** Komut cevabı (LLM yok, kota yok). */
export async function say(ctx: Ctx, parts: string | string[], extra: Partial<ReplyOptions> = {}): Promise<ReplyResult> {
  return ctx.s.reply({
    chatId: ctx.chatId,
    db: ctx.db,
    purpose: 'command',
    texts: Array.isArray(parts) ? parts : [parts],
    inMessageId: ctx.messageRowId,
    ...extra,
  });
}
