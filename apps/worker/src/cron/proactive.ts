/**
 * Her 15 dakikada: `cron_due_proactive` → şablon mesajlar (LLM yok). Günde alıcı başına en çok 1, aktif saatte,
 * `proactive_enabled`. Veli satırında chat_id SECURITY DEFINER gövdesinde çözülür; ad/PII dönmez.
 */
import type { ProactiveRow } from '../data/repo.ts';
import type { Services } from '../services.ts';
import { splitLines, truncate } from '../telegram/format.ts';
import { texts } from '../texts.ts';
import { log } from '../ops/log.ts';

export const MAX_CITATIONS = 6;

async function researchParts(s: Services, row: ProactiveRow): Promise<string[] | null> {
  const outputId = typeof row.params.output_id === 'string' ? row.params.output_id : null;
  if (outputId === null) return null;
  const rel = await s.db.researchRelease(outputId);
  if (rel === null) return null;
  const summary = rel.synthesis[0]?.text ?? '';
  const lines = splitLines(truncate(summary, 600), 3)[0] ?? '';
  const head = `${lines}${lines.endsWith('.') ? '' : '…'}\n${texts.researchMore}`;
  const cites = rel.citations
    .filter((c) => c.status === 'kept' && (c.crossref_status === 'verified' || c.crossref_status === 'no_doi'))
    .filter((c) => (c.crossref_status === 'verified' && c.doi !== null) || (c.crossref_status === 'no_doi' && c.oa_pdf_url !== null))
    .slice(0, MAX_CITATIONS)
    .map((c) => [c.authors ?? 'Yazar belirtilmemiş', c.venue ?? c.title, String(c.year ?? ''), c.crossref_status === 'verified' ? `\`${c.doi ?? ''}\`` : (c.oa_pdf_url ?? '')].filter((x) => x !== '').join(' · '));
  const out = [head];
  for (let i = 0; i < cites.length; i += 4) out.push(cites.slice(i, i + 4).join('\n'));
  return out;
}

async function partsFor(s: Services, row: ProactiveRow): Promise<string[] | null> {
  const p = row.params;
  switch (row.template_id) {
    case 'exam_tomorrow':
      return [texts.proactive.exam_tomorrow(typeof p.topic === 'string' ? p.topic : null)];
    case 'deadline_soon':
      return [texts.proactive.deadline_soon(typeof p.what === 'string' ? p.what : null)];
    case 'silent_3d':
      return [texts.proactive.silent_3d];
    case 'video_deleted':
      return [row.recipient === 'guardian' ? texts.proactive.video_deleted_guardian : texts.proactive.video_deleted_student];
    case 'priority_plan_ready':
      return [texts.proactive.priority_plan_ready];
    case 'research_ready':
      return researchParts(s, row);
    default:
      return null;
  }
}

export async function runProactive(s: Services): Promise<number> {
  const now = s.now();
  const rows = await s.db.dueProactive(now.toISOString());
  let sent = 0;
  for (const row of rows) {
    // Satır başına hata yalıtımı: bir satır (araştırma okuması, Telegram 400) düşerse 'failed' olur,
    // sonraki satırlar aynı turda gönderilir. Log yalnız şablon ve chat_hash taşır.
    try {
      if (row.chat_id === null) {
        await s.db.markProactive(row.id, 'skipped', null, now.toISOString());
        continue;
      }
      const parts = await partsFor(s, row);
      if (parts === null) {
        await s.db.markProactive(row.id, 'skipped', null, now.toISOString());
        continue;
      }
      const db = s.db.forStudent(row.student_id);
      const res = await s.reply({ chatId: row.chat_id, db, purpose: 'proactive', texts: parts });
      const first = res.sent[0];
      await s.db.markProactive(row.id, first === undefined ? 'failed' : 'sent', first?.message_id ?? null, now.toISOString());
      if (first !== undefined) sent++;
      else log.warn('proactive_failed', { template: row.template_id, ...(row.chat_id === null ? {} : { chat: row.chat_id }) });
    } catch (err) {
      log.warn('proactive_failed', { template: row.template_id, ...(row.chat_id === null ? {} : { chat: row.chat_id }), err: err instanceof Error ? err.name : 'error' });
      await s.db.markProactive(row.id, 'failed', null, now.toISOString()).catch(() => undefined);
    }
  }
  return sent;
}
