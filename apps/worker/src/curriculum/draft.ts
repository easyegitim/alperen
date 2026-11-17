/**
 * Müfredat taslağı yardımcıları (docs/PLAN-v2.md §3.5): kod öneki, yapı doğrulaması, ağaç metni ve kullanıcı mesajları.
 * Saf fonksiyonlardır (veritabanı ve LLM yok); işler (jobs/curriculum*.ts) ve testler kullanır.
 */
import type { CurriculumDraft } from '@ogrenmen/contracts';
import { CURRICULUM_MAX_DEPTH } from '@ogrenmen/contracts';

/** SKILL_CODE (packages/contracts common.ts) ile aynı. */
export const SKILL_CODE_RE = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/;
const EXAM_WORDS = ['tyt', 'ayt', 'lgs', 'kpss', 'yks', 'ales', 'dgs', 'yds'] as const;

const TR_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', i̇: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** SQL `app.norm_text` ile aynı biçim: Türkçe harfler ASCII, küçük harf, harf/rakam dışı tek boşluk. */
export function normText(text: string): string {
  return text
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .toLowerCase()
    .replace(/[çğıöşüâîû]/g, (ch) => TR_MAP[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Ders metninden kazanım kodu öneki: sınav parkurunda `tyt.kimya`, diğerlerinde `kimya-101` (SKILL_CODE).
 * Taslak promptu kökün ve tüm kodların bu önekle başlamasını ister (zorunlu değil; doğrulama yapıya bakar).
 */
export function codePrefix(courseText: string): string {
  const words = normText(courseText).split(' ').filter(Boolean);
  if (words.length === 0) return 'ders';
  const exam = (EXAM_WORDS as readonly string[]).includes(words[0]!) ? words.shift()! : null;
  let rest = words.join('-').slice(0, 40).replace(/-+$/, '');
  if (rest && !/^[a-z]/.test(rest)) rest = `d${rest}`;
  if (exam) return rest ? `${exam}.${rest}` : exam;
  return rest || 'ders';
}

/** Sınav parkuru (ilk kelime TYT/AYT/LGS …) mı; hedef sınav adı ya da null. */
export function examOf(courseText: string): string | null {
  const first = normText(courseText).split(' ')[0] ?? '';
  return (EXAM_WORDS as readonly string[]).includes(first) ? first.toUpperCase() : null;
}

export interface DraftCheck {
  ok: boolean;
  problems: string[];
  stats: { nodes: number; leaves: number; depth: number; prerequisites: number; tags: number };
}

/**
 * Taslağın yapı denetimi (sözleşmenin refine kurallarına ek olarak açık ve test edilebilir): tek kök, kodlar benzersiz ve
 * SKILL_CODE biçiminde, her düğüm köke bağlı (döngü/bilinmeyen üst yok), derinlik ≤ 4, ön koşullar var olan farklı
 * düğümlere ve döngüsüz, etiketler benzersiz ve var olan düğüme bağlı.
 */
export function checkDraft(draft: CurriculumDraft): DraftCheck {
  const problems: string[] = [];
  const byCode = new Map<string, CurriculumDraft['nodes'][number]>();
  for (const n of draft.nodes) {
    if (byCode.has(n.code)) problems.push(`yinelenen kod: ${n.code}`);
    byCode.set(n.code, n);
    if (!SKILL_CODE_RE.test(n.code)) problems.push(`geçersiz kod: ${n.code}`);
  }
  const roots = draft.nodes.filter((n) => n.parent_code === null);
  if (roots.length !== 1) problems.push(`tam bir kök olmalı (bulunan: ${roots.length})`);
  const children = new Map<string, string[]>();
  for (const n of draft.nodes) {
    if (n.parent_code === null) continue;
    if (!byCode.has(n.parent_code)) problems.push(`bilinmeyen üst düğüm: ${n.code} → ${n.parent_code}`);
    children.set(n.parent_code, [...(children.get(n.parent_code) ?? []), n.code]);
  }
  // kökten genişlik öncelikli iniş: ulaşılamayan düğüm döngüdedir ya da üstü yoktur
  const depthOf = new Map<string, number>();
  const queue: string[] = roots.length === 1 ? [roots[0]!.code] : [];
  if (queue[0]) depthOf.set(queue[0], 1);
  while (queue.length > 0) {
    const code = queue.shift()!;
    for (const ch of children.get(code) ?? []) {
      if (depthOf.has(ch)) continue;
      depthOf.set(ch, (depthOf.get(code) ?? 0) + 1);
      queue.push(ch);
    }
  }
  const unreached = draft.nodes.filter((n) => !depthOf.has(n.code)).map((n) => n.code);
  if (roots.length === 1 && unreached.length > 0) problems.push(`köke bağlı olmayan ya da döngüdeki düğümler: ${unreached.slice(0, 5).join(', ')}`);
  const depth = Math.max(0, ...depthOf.values());
  if (depth > CURRICULUM_MAX_DEPTH) problems.push(`derinlik ${depth} > ${CURRICULUM_MAX_DEPTH}`);

  const edges = new Map<string, string[]>();
  for (const p of draft.prerequisites) {
    if (!byCode.has(p.skill_code) || !byCode.has(p.prereq_code)) problems.push(`ön koşul bilinmeyen düğüme: ${p.skill_code} → ${p.prereq_code}`);
    if (p.skill_code === p.prereq_code) problems.push(`kendi ön koşulu: ${p.skill_code}`);
    edges.set(p.skill_code, [...(edges.get(p.skill_code) ?? []), p.prereq_code]);
  }
  const state = new Map<string, 1 | 2>();
  const cyclic = (code: string): boolean => {
    if (state.get(code) === 2) return false;
    if (state.get(code) === 1) return true;
    state.set(code, 1);
    for (const next of edges.get(code) ?? []) if (cyclic(next)) return true;
    state.set(code, 2);
    return false;
  };
  if ([...edges.keys()].some((k) => cyclic(k))) problems.push('ön koşul grafiğinde döngü var');

  const tags = new Set<string>();
  for (const t of draft.misconception_tags) {
    if (tags.has(t.tag)) problems.push(`yinelenen etiket: ${t.tag}`);
    tags.add(t.tag);
    if (!byCode.has(t.skill_code)) problems.push(`etiket bilinmeyen düğüme: ${t.tag} → ${t.skill_code}`);
  }
  const leaves = draft.nodes.filter((n) => !children.has(n.code)).length;
  return {
    ok: problems.length === 0,
    problems,
    stats: { nodes: draft.nodes.length, leaves, depth, prerequisites: draft.prerequisites.length, tags: draft.misconception_tags.length },
  };
}

export interface UploadSource {
  id: string;
  kind: string;
  mime: string | null;
  title: string;
  anthropic_file_id: string | null;
  extracted_text: string | null;
}

/** `document` bloğunun file_id ile kabul ettiği türler: PDF ve düz metin (görsel file_id belge bloğunda 400 verir). */
export function isDocumentMime(mime: string | null | undefined): boolean {
  return mime === 'application/pdf' || (typeof mime === 'string' && mime.startsWith('text/'));
}
/** isDocumentMime'ın SQL karşılığı (uploads u). */
export const DOCUMENT_MIME_SQL = "(u.mime = 'application/pdf' or u.mime like 'text/%')";

/**
 * Yüklenen kaynağın taslak isteğindeki `document` bloğu: Files API `file_id` (yalnız PDF/metin) ya da çıkarılmış metin
 * (OCR'lı fotoğraf dahil).
 */
export type DocumentBlock =
  | { type: 'document'; source: { type: 'file'; file_id: string }; title: string }
  | { type: 'document'; source: { type: 'text'; media_type: 'text/plain'; data: string }; title: string };

/** En çok 200 bin karakter çıkarılmış metin (bağlamı korumak için); file_id varsa o tercih edilir. */
export const MAX_EXTRACTED_CHARS = 200_000;

export function documentBlocks(uploads: readonly UploadSource[]): DocumentBlock[] {
  const out: DocumentBlock[] = [];
  for (const u of uploads) {
    if (u.anthropic_file_id && isDocumentMime(u.mime)) out.push({ type: 'document', source: { type: 'file', file_id: u.anthropic_file_id }, title: u.title });
    else if (u.extracted_text && u.extracted_text.trim()) {
      out.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: u.extracted_text.slice(0, MAX_EXTRACTED_CHARS) }, title: u.title });
    }
  }
  return out;
}

export interface CourseContext {
  courseText: string;
  courseTitle: string;
  courseKind: string;
  targetExam: string | null;
  prefix: string;
}

/** Araştırma adımının kullanıcı mesajı (curriculum_research): ders, hedef, düzey, yüklenen kaynak listesi. */
export function researchMessage(c: CourseContext, uploads: readonly UploadSource[]): string {
  const lines = [
    `Ders: ${c.courseTitle}`,
    `Öğrencinin yazdığı: ${c.courseText}`,
    `Hedef sınav ya da kurum: ${c.targetExam ?? 'belirtilmedi'}`,
    `Ders türü: ${c.courseKind}`,
  ];
  if (uploads.length > 0) {
    lines.push('Eğitmenin yüklediği kaynaklar (bir sonraki adımda tam metniyle verilecek):');
    for (const u of uploads) lines.push(`- ${u.title} (${u.mime ?? u.kind})`);
  } else {
    lines.push('Yüklenen kaynak yok.');
  }
  return lines.join('\n');
}

/** Taslak adımının metin bloğu (curriculum_draft): ders, kod öneki ve araştırma notu. */
export function draftMessage(c: CourseContext, researchNote: string): string {
  return [
    `Ders: ${c.courseTitle}`,
    `Hedef sınav ya da kurum: ${c.targetExam ?? 'belirtilmedi'}`,
    `Kod öneki: ${c.prefix}`,
    '',
    'Araştırma notu:',
    researchNote.trim() || '(araştırma notu boş; yalnız yüklenen kaynaklara ve genel programa dayan, güveni düşük tut)',
  ].join('\n');
}

/** Atıflı araştırma yanıtından kaynak listesi (curricula.source_refs): url'si olan atıflar, tekil. */
export function citationRefs(content: readonly unknown[]): { kind: 'url'; ref: string; title: string | null }[] {
  const seen = new Map<string, string | null>();
  for (const block of content) {
    const b = block as { type?: string; citations?: unknown[] | null };
    if (b.type !== 'text' || !Array.isArray(b.citations)) continue;
    for (const c of b.citations) {
      const cc = c as { url?: unknown; title?: unknown };
      if (typeof cc.url === 'string' && !seen.has(cc.url)) seen.set(cc.url, typeof cc.title === 'string' ? cc.title : null);
    }
  }
  return [...seen].slice(0, 40).map(([ref, title]) => ({ kind: 'url' as const, ref, title }));
}

export interface TreeRow {
  id: string;
  parent_id: string | null;
  name: string;
  order_no: number;
}

/** Ders bloğu için ağaç metni: girintili "kod · ad" satırları (proposal_review sistem bloğu). */
export function treeText(rows: readonly TreeRow[]): string {
  const kids = new Map<string | null, TreeRow[]>();
  for (const r of rows) kids.set(r.parent_id, [...(kids.get(r.parent_id) ?? []), r]);
  for (const list of kids.values()) list.sort((a, b) => a.order_no - b.order_no || a.id.localeCompare(b.id));
  const out: string[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const r of kids.get(parent) ?? []) {
      out.push(`${'  '.repeat(depth)}${r.id} · ${r.name}`);
      if (depth < 8) walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out.join('\n');
}
