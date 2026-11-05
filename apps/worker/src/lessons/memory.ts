/**
 * Ders hafızası (`memory.apply` {source: 'lesson'}; supabase 0041 app.lesson_enqueue_memory): dersin öğrencilerinin
 * `/memories/courses/<kod>.md` dosyasında bu dersin bölümü, uygulanmış (onaylı) iddialardan kurulur. İdempotent: bölüm
 * `<!-- ders:<id> -->` işaretiyle değiştirilir; en yeni 8 ders tutulur, dosya 6 KB'yi aşarsa en eskiler düşer.
 *
 * Hafıza dosyası koçun her sohbette okuduğu nottur ve öğrenci Profil'de görür: yalnız öğrenciye uygun metinler
 * girer (izlence konusu, hocanın sınav notu, ödev, kaynak; sonraki adım ve yanılgı açıklaması). Ders öğrenciye kapalıysa
 * (student_visible=false; lesson_view/list_lessons da kapatır) yalnız işlenen konu girer, dersin başlığı girmez.
 * Eğitmene özel metin (text_instructor, for_instructor, konuşma dengesi) girmez.
 */
import { createHash } from 'node:crypto';
import type { Db } from '../db.js';

export const MEMORY_ACTOR = 'lesson';
export const MAX_SECTIONS = 8;
export const MAX_BYTES = 6 * 1024;
const MEMORY_CONFLICT = 'OGR-MEM-028';
const MEMORY_FULL = 'OGR-MEM-001';

export interface MemoryApplyPayload {
  source: string;
  lesson_id?: string;
  course_id?: string | null;
  course_code?: string | null;
  path?: string;
  student_ids?: string[];
  claim_ids?: string[];
}

export interface MemoryApplyResult {
  source: string;
  written: number;
  skipped: { student_id: string; reason: string }[];
}

interface ClaimRow {
  kind: string;
  value: Record<string, unknown>;
  skill_name: string | null;
}

const DATE_TR = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });

function line(s: unknown, max = 300): string {
  return String(s ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/<!--|-->/g, '')
    .trim()
    .slice(0, max);
}

/** Bu dersin bölümü (boşsa null: yazılacak öğrenciye uygun bilgi yok). */
export function lessonSection(meta: { lessonId: string; heldAt: string; title: string | null; studentVisible: boolean }, claims: readonly ClaimRow[]): string | null {
  const items: string[] = [];
  const val = (c: ClaimRow, k: string) => (c.value && typeof c.value === 'object' ? (c.value as Record<string, unknown>)[k] : undefined);
  for (const c of claims) {
    if (c.kind === 'course_insight') {
      const kind = String(val(c, 'kind') ?? 'other');
      // gizli ders: ödev, sınav notu, kaynak ve serbest not öğrenciye (ve koça) gitmez; yalnız işlenen konu
      if (!meta.studentVisible && kind !== 'syllabus_topic') continue;
      const label = { syllabus_topic: 'İşlenen konu', exam_hint: 'Hocanın sınav notu', assignment: 'Ödev', resource: 'Kaynak', other: 'Not' }[kind] ?? 'Not';
      const topic = line(val(c, 'topic'), 120);
      const text = line(val(c, 'text'));
      items.push(`- ${label}: ${kind === 'syllabus_topic' && topic ? `${topic}. ${text}` : text || topic}`);
    } else if (c.kind === 'homework' && meta.studentVisible) {
      items.push(`- Ödev: ${line(val(c, 'text'))}${val(c, 'due') ? ` (son gün ${line(val(c, 'due'), 10)})` : ''}`);
    } else if (c.kind === 'next_step' && meta.studentVisible) {
      const s = line(val(c, 'for_student'), 400);
      if (s) items.push(`- Sonraki adım: ${s}`);
    } else if (c.kind === 'misconception' && meta.studentVisible) {
      const s = line(val(c, 'text_student'));
      if (s) items.push(`- Üzerinde durulan nokta${c.skill_name ? ` (${line(c.skill_name, 80)})` : ''}: ${s}`);
    }
  }
  const unique = [...new Set(items)].filter((x) => x.length > 4);
  if (unique.length === 0) return null;
  const date = DATE_TR.format(new Date(meta.heldAt));
  const title = meta.studentVisible && meta.title ? `: ${line(meta.title, 120)}` : '';
  return [`<!-- ders:${meta.lessonId} -->`, `## ${date} dersi${title}`, ...unique, '<!-- /ders -->'].join('\n');
}

const SECTION = /<!-- ders:([0-9a-f-]{36}) -->[\s\S]*?<!-- \/ders -->/g;

/** Var olan dosyaya bölümü yerleştirir (aynı ders → değişir, yeni ders → en üste); sınırları uygular. */
export function mergeSection(existing: string | null, header: string, lessonId: string, section: string | null): string | null {
  const sections = [...(existing ?? '').matchAll(SECTION)].map((m) => ({ id: m[1]!, text: m[0] }));
  const others = sections.filter((s) => s.id !== lessonId);
  const all = section ? [{ id: lessonId, text: section }, ...others] : others;
  if (all.length === 0) return null;
  let kept = all.slice(0, MAX_SECTIONS);
  const render = (list: typeof kept) => `${header}\n\n${list.map((s) => s.text).join('\n\n')}\n`;
  while (kept.length > 1 && Buffer.byteLength(render(kept), 'utf8') > MAX_BYTES) kept = kept.slice(0, -1);
  return render(kept);
}

export async function applyLessonMemory(db: Db, p: MemoryApplyPayload): Promise<MemoryApplyResult> {
  const out: MemoryApplyResult = { source: p.source, written: 0, skipped: [] };
  if (p.source !== 'lesson' || !p.lesson_id || !p.path) {
    out.skipped.push({ student_id: '*', reason: `desteklenmeyen kaynak: ${p.source}` });
    return out;
  }
  const lr = await db.query(
    `select l.id, l.held_at, l.title, l.student_visible, c.title as course_title
       from public.lessons l left join public.courses c on c.id = coalesce(l.course_id, (select e.course_id from public.enrollments e where e.id = l.enrollment_id))
      where l.id = $1::uuid`,
    [p.lesson_id],
  );
  const l = lr.rows[0];
  if (!l) {
    out.skipped.push({ student_id: '*', reason: 'ders yok' });
    return out;
  }
  // iş kuyrukta beklerken geri alınan iddialar düşsün: yalnız hâlâ uygulanmış olanlar (son analiz)
  const cr = await db.query(
    `select lc.kind, coalesce(lc.edited_value, lc.value) as value, s.name as skill_name
       from public.lesson_claims lc
       left join public.skills s on s.curriculum_id = lc.curriculum_id and s.id = lc.skill_id
      where lc.applied_at is not null
        and lc.analysis_id = (select la.id from public.lesson_analyses la where la.lesson_id = $1::uuid order by la.version desc limit 1)
      order by lc.t_start_sec, lc.created_at`,
    [p.lesson_id],
  );
  const claims = cr.rows.map((x) => ({ kind: String(x.kind), value: (x.value ?? {}) as Record<string, unknown>, skill_name: x.skill_name ? String(x.skill_name) : null }));
  const heldAt = l.held_at instanceof Date ? l.held_at.toISOString() : String(l.held_at);
  const section = lessonSection({ lessonId: p.lesson_id, heldAt, title: l.title ? String(l.title) : null, studentVisible: l.student_visible === true }, claims);
  const header = `# ${line(l.course_title ?? p.course_code ?? 'Ders', 120)} ders notları\n\nDerslerden onaylanan bilgiler; en yeni ders üstte.`;
  for (const sid of p.student_ids ?? []) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = await db.query('select content from public.memory_files where student_id = $1::uuid and path = $2', [sid, p.path]);
      const existing = cur.rows[0] ? String(cur.rows[0].content) : null;
      const next = mergeSection(existing, header, p.lesson_id, section);
      if (next === null || next === existing) {
        out.skipped.push({ student_id: sid, reason: 'değişiklik yok' });
        break;
      }
      try {
        await db.query('select public.upsert_memory_file($1::uuid, $2, $3, $4, $5, null, $6)', [
          sid, p.path, next, 'create', MEMORY_ACTOR, existing === null ? null : createHash('md5').update(existing).digest('hex'),
        ]);
        out.written++;
        break;
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes(MEMORY_CONFLICT) && attempt === 0) continue;
        if (msg.includes(MEMORY_FULL) || msg.includes(MEMORY_CONFLICT)) {
          out.skipped.push({ student_id: sid, reason: msg.slice(0, 120) });
          break;
        }
        throw err;
      }
    }
  }
  return out;
}
