/** POST /api/parent-chat gövdesi (zod; sınırlar sunucuda yeniden denetlenir). */
import { z } from 'zod';
import { ParentChatError, PARENT_MAX_TEXT } from './agent';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const parentChatRequestSchema = z.object({
  student_id: uuid,
  conversation_id: uuid.nullable().optional(),
  text: z.string().max(PARENT_MAX_TEXT),
  new: z.boolean().optional(),
});

export interface ParentChatRequestBody {
  studentId: string;
  conversationId: string | null;
  text: string;
  fresh: boolean;
}

export function parseParentChatRequest(raw: unknown): ParentChatRequestBody {
  const r = parentChatRequestSchema.safeParse(raw);
  if (!r.success) {
    if (r.error.issues.some((i) => i.path[0] === 'text' && i.code === 'too_big')) throw new ParentChatError('text_too_long', 400, 'Mesaj çok uzun. Daha kısa yazmayı deneyin.');
    throw new ParentChatError('bad_request', 400, 'İstek anlaşılamadı.');
  }
  return { studentId: r.data.student_id, conversationId: r.data.conversation_id ?? null, text: r.data.text, fresh: r.data.new === true };
}

/** Gövde üst sınırı (metin ≤ 2000 karakter + kimlikler; UTF-8 en kötü durum + pay). */
export const PARENT_CHAT_BODY_MAX = PARENT_MAX_TEXT * 4 + 2 * 1024;
