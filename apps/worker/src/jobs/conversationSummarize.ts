import { z } from 'zod';
import { systemPrompt } from '../prompts.js';
import { PermanentJobError } from './errors.js';
import { oncePer } from './dedupe.js';
import { acceptCamelAliases, uuid } from './schemas.js';
import type { JobContext, JobDefinition } from './types.js';

/** Son bu kadar mesaj birebir kalır (PLAN-v2 §3.4). */
export const KEEP_LAST_MESSAGES = 30;
/** Özetlenecek en az eski mesaj (az sayıda mesaj için Haiku çağrılmaz). */
export const MIN_TO_SUMMARIZE = 10;
const MAX_MESSAGE_CHARS = 2000;
const MAX_INPUT_CHARS = 60_000;

const payload = acceptCamelAliases(
  { conversationId: 'conversation_id' },
  z.object({
    /** Tek sohbet; verilmezse özetlenmesi gereken tüm sohbetler için iş açılır (gece). */
    conversation_id: uuid.optional(),
  }),
);

export type ConversationSummarizeResult =
  | { mode: 'fanout'; conversations: number }
  | { mode: 'conversation'; conversationId: string; summarized: number; uptoMessageId: number | null };

interface Msg {
  id: number;
  role: string;
  content: unknown;
}

/** Mesajın modele giden düz metni: metin blokları; görsel/belge yer tutucu; araç çağrıları adıyla; araç sonucu yok. */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, MAX_MESSAGE_CHARS);
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const b of content as { type?: string; text?: string; name?: string }[]) {
    if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b?.type === 'image') parts.push('[görsel]');
    else if (b?.type === 'document') parts.push('[belge]');
    else if (b?.type === 'tool_use' && b.name) parts.push(`[araç: ${b.name}]`);
  }
  const t = parts.join('\n').trim();
  return t.length > MAX_MESSAGE_CHARS ? `${t.slice(0, MAX_MESSAGE_CHARS - 1)}…` : t;
}

/** Araç sonucu taşıyan kullanıcı mesajı mı (kesim noktası olamaz: tool_use/tool_result çifti bölünmez). */
function isToolResult(m: Msg): boolean {
  return m.role === 'user' && Array.isArray(m.content) && (m.content as { type?: string }[]).some((b) => b?.type === 'tool_result');
}

/**
 * Kesim: son KEEP_LAST_MESSAGES mesaj kalır; ilk kalan mesaj araç sonucu ya da asistan mesajıysa kesim geriye
 * (daha çok mesaj kalacak yöne) kayar, böylece kalan geçmiş bir kullanıcı turuyla başlar.
 */
export function cutIndex(msgs: readonly Msg[], keep = KEEP_LAST_MESSAGES): number {
  let cut = msgs.length - keep;
  while (cut > 0 && (msgs[cut]!.role !== 'user' || isToolResult(msgs[cut]!))) cut--;
  return Math.max(0, cut);
}

/** Kesim noktası olabilir mi: kalan geçmiş bir kullanıcı turuyla (araç sonucu değil) başlamalı. */
function isTurnStart(m: Msg | undefined): boolean {
  return m !== undefined && m.role === 'user' && !isToolResult(m);
}

/**
 * Özet penceresi: eski mesajlar (0..cut) en eskiden başlayarak MAX_INPUT_CHARS dolana dek alınır. Pencere sonu
 * (`end`, hariç) bir kullanıcı turunun başına denk gelir; böylece `summary_upto_message_id` tool_use/tool_result
 * çiftini bölmez ve özetlenmeyen mesaj atlanmaz. Tek tur bile sığmazsa o tur kırpılmış metinle yine alınır.
 */
export function summaryWindow(msgs: readonly Msg[], cut: number, userLabel: string, maxChars = MAX_INPUT_CHARS): { lines: { role: string; text: string }[]; end: number } {
  const lines: { role: string; text: string }[] = [];
  let total = 0;
  let end = 0;
  let pending: { role: string; text: string }[] = [];
  let pendingChars = 0;
  for (let i = 0; i < cut; i++) {
    const msg = msgs[i]!;
    if (msg.role !== 'system' && !isToolResult(msg)) {
      const text = messageText(msg.content);
      if (text) {
        pending.push({ role: msg.role === 'user' ? userLabel : 'koç', text });
        pendingChars += text.length;
      }
    }
    // Tur sınırı: sonraki mesaj yeni bir kullanıcı turu (ya da eski kısmın sonu)
    if (i + 1 === cut || isTurnStart(msgs[i + 1])) {
      if (end > 0 && total + pendingChars > maxChars) break;
      lines.push(...pending);
      total += pendingChars;
      end = i + 1;
      pending = [];
      pendingChars = 0;
    }
  }
  return { lines, end };
}

async function fanOut(ctx: JobContext): Promise<ConversationSummarizeResult> {
  const r = await ctx.db.query(
    `select c.id from public.conversations c
      where (select count(*) from public.conversation_messages m
              where m.conversation_id = c.id and m.id > coalesce(c.summary_upto_message_id, 0)) > $1
      order by c.last_message_at desc nulls last, c.id
      limit 2000`,
    [KEEP_LAST_MESSAGES + MIN_TO_SUMMARIZE],
  );
  for (const row of r.rows) {
    await ctx.enqueue('conversation.summarize', { conversation_id: String(row.id) }, oncePer(`summary:${String(row.id)}`));
  }
  ctx.log.info('conversation.summarize yayıldı', { conversations: r.rows.length });
  return { mode: 'fanout', conversations: r.rows.length };
}

/**
 * Sohbet özeti (Haiku 5.5, `conversation_summary`): son 30 mesaj dışındaki (önceki özetten sonraki) mesajlar önceki
 * özetle birleştirilip `conversations.summary`'ye yazılır; `summary_upto_message_id` ilerler. İdempotent: özet yalnız
 * ileri gider (aynı ya da daha eski kesim yazılmaz).
 */
export const conversationSummarizeJob: JobDefinition<z.infer<typeof payload>, ConversationSummarizeResult> = {
  name: 'conversation.summarize',
  description: 'Sohbetin son 30 mesaj dışını özetler (Haiku) → conversations.summary.',
  process: 'worker',
  payload,
  concurrency: 2,
  retry: { retryLimit: 3, retryDelay: 30, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 300, deleteAfterSeconds: 86_400 },
  handler: async (p, ctx) => {
    if (!p.conversation_id) return fanOut(ctx);
    const id = p.conversation_id;
    const c = await ctx.db.query(
      `select c.id, c.summary, c.summary_upto_message_id, c.kind, s.public_ref
         from public.conversations c join public.students s on s.id = c.student_id where c.id = $1::uuid`,
      [id],
    );
    const conv = c.rows[0];
    if (!conv) throw new PermanentJobError(`sohbet yok: ${id}`, 'OGR-JOB-120');
    const upto = conv.summary_upto_message_id === null || conv.summary_upto_message_id === undefined ? 0 : Number(conv.summary_upto_message_id);
    const m = await ctx.db.query(
      `select id, role, content from public.conversation_messages where conversation_id = $1::uuid and id > $2 order by id`,
      [id, upto],
    );
    const msgs: Msg[] = m.rows.map((r) => ({ id: Number(r.id), role: String(r.role), content: r.content }));
    const cut = cutIndex(msgs);
    if (cut < MIN_TO_SUMMARIZE) return { mode: 'conversation', conversationId: id, summarized: 0, uptoMessageId: upto || null };
    const { lines, end } = summaryWindow(msgs, cut, conv.kind === 'parent' ? 'veli' : 'öğrenci');
    const old = msgs.slice(0, end);
    // Yalnız modele giden pencere özetlenmiş sayılır; pencereye sığmayan eski mesajlar sonraki çalıştırmada özetlenir
    const lastId = old[old.length - 1]!.id;
    const system = await systemPrompt(ctx.db, 'conversation_summary');
    const gateway = await ctx.gateway();
    const res = await gateway.call('conversation_summary', {
      system: { product: system.text },
      user: JSON.stringify({ kind: conv.kind === 'parent' ? 'parent' : 'student', previous_summary: conv.summary ?? null, messages: lines }),
      turn: { now: ctx.now() },
      promptVersion: system.version,
      studentRef: String(conv.public_ref),
      ref: { table: 'conversations', id },
      purpose: 'conversation.summarize',
      signal: ctx.signal,
    });
    const data = res.data as { summary: string; open_threads: string[]; skill_ids: string[] };
    const text = [data.summary.trim(), data.open_threads.length ? `Açık kalanlar:\n${data.open_threads.map((t) => `- ${t}`).join('\n')}` : null]
      .filter(Boolean)
      .join('\n\n');
    const u = await ctx.db.query(
      `update public.conversations set summary = $2, summary_upto_message_id = $3
        where id = $1::uuid and coalesce(summary_upto_message_id, 0) < $3`,
      [id, text, lastId],
    );
    if ((u.rowCount ?? 0) === 0) ctx.log.info('conversation.summarize: daha yeni özet var, yazılmadı', { conversationId: id });
    else if (end < cut) {
      // Pencere dolu: kalan eski mesajlar için hemen bir tur daha (anahtar kesimle değişir; aynı tur yinelenmez)
      await ctx.enqueue('conversation.summarize', { conversation_id: id }, oncePer(`summary:${id}:${lastId}`));
    }
    return { mode: 'conversation', conversationId: id, summarized: old.length, uptoMessageId: lastId };
  },
};
