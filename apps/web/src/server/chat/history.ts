/**
 * Sohbet geçmişi (saf işlevler): saklanan mesajlar ↔ API mesajları ve ekran öğeleri.
 *
 * Geçmiş kuralı (PLAN-v2 §3.4): özet (`conversations.summary`) + özetten sonraki son ~30 mesaj birebir. Kesim
 * noktası araç çiftini bölmez: kalan geçmiş, araç sonucu olmayan bir kullanıcı mesajıyla başlar (apps/worker
 * `conversation.summarize` aynı kuralla keser). Tur sistem mesajları (`role:"system"`, "Bugün … Mod: …") da saklanır;
 * böylece bir sonraki istekte önek bir öncekiyle aynı kalır (önbellek, PLAN-v2 §3.3).
 *
 * Pencere kademeli kayar (`steppedStart`): başlangıç, özetten sonraki mesaj sayısı 30 + 15'e varana dek sabit kalır,
 * sonra 15 mesaj birden ilerler. Her turda bir mesaj kaysaydı mesaj öneki her istekte değişir, önbellek hep ıskalardı.
 * Başlangıç yalnız önden düşer (ortadan düzenleme yok).
 *
 * Thinking blokları (PLAN-v2 §5; claude-api preserved thinking): Sonnet 5.5 ve Opus 5.5, önceki bir turun thinking
 * bloğunu yalnız system, araçlar ve o bloktan önceki her mesaj üretildiği andan beri değişmemişse kabul eder; aksi
 * hâlde istek 400 olur ve sohbet kalıcı bozulur. Bu geçmiş her turda düzenlenir: özet ilk kullanıcı mesajının başına
 * eklenir, pencere önden düşer, system[1]/system[2] (ders, dossier) yeni kanıtla değişir, "Çözümü göster" system[0]'ı
 * ve modeli değiştirir. Bu yüzden saklanan asistan mesajlarındaki `thinking` ve `redacted_thinking` blokları geçmişe
 * HİÇ konmaz (deterministik: önek her turda aynı kalır). Yalnız turlar arası akıl yürütme kaybolur; süren turun araç
 * döngüsündeki thinking geçitte (gateway) kalır. Kalıcı çözüm: `block_binding.prefix_mismatch_behavior: drop_block`
 * (packages/llm; bkz. apps/web README "Koç sohbeti").
 *
 * Ek bütçesi: bir istekteki base64 ekler en çok `MEDIA_BUDGET_B64`. Aşılırsa pencere önden, kalan ekler
 * `MEDIA_TARGET_B64` altına inene dek ilerler (eklerin ortadan çıkarılması bir düzenleme olurdu; önden düşmek değil).
 * Karar ekleme sırasıyla, yalnız saklanan geçmişin işlevidir (deterministik; aşım her eklemede değil, ara ara olur).
 *
 * Görsel ve PDF içerikleri veritabanında base64 olarak değil yükleme başvurusuyla saklanır
 * (`{type:'image', source:{type:'upload', upload_id}}`) ve her istekte aynı biçimde yeniden kurulur: Anthropic Files
 * kimliği varsa `file`, yoksa Storage'dan base64. Aynı yükleme her turda aynı bloğa döner (önek kararlı).
 */
import type { CallInput } from '@ogrenmen/llm';
import type { DisplayMessage } from '@/lib/chat';
import { isImageMime, sniffMime } from './mime';
import type { SeedContext, StoredBlock, StoredMessage, TurnRecord, UploadRow } from './types';

export type { DisplayMessage };

/** Anthropic içerik bloğu ve mesaj tipleri (geçidin girdi tiplerinden; SDK doğrudan bağımlılık değil). */
export type BetaContentBlockParam = Exclude<CallInput['user'], string>[number];
export type BetaMessageParam = NonNullable<CallInput['history']>[number];

export const HISTORY_LIMIT = 30;
/** Pencere başlangıcının bir seferde ilerlediği mesaj sayısı. */
export const HISTORY_STEP = 15;
/** Bir istekteki base64 eklerin üst sınırı (API isteği en çok 32 MB). */
export const MEDIA_BUDGET_B64 = 20 * 1024 * 1024;
/** Bütçe aşılınca pencere, kalan ekler bu sınıra inene dek önden ilerler (aşım sık tekrarlanmasın). */
export const MEDIA_TARGET_B64 = 12 * 1024 * 1024;
/** Tek turun eklerinin üst sınırı (base64; bütçenin altında kalır ki geçmişte de yer kalsın). */
export const TURN_MEDIA_B64 = 16 * 1024 * 1024;
export const SUMMARY_PREFIX = '[Önceki konuşmanın özeti]';
export const SEED_PREFIX = '[Teşhis bağlamı]';
export const MISSING_UPLOAD_TEXT = '[Bu ek artık okunamıyor]';

const ERROR_CAUSE_TR: Record<string, string> = {
  concept: 'kavram',
  procedure: 'işlem',
  careless: 'dikkat',
  reading: 'okuma',
  time: 'süre',
};
const VERDICT_TR: Record<string, string> = { correct: 'doğru', wrong: 'yanlış', incomplete: 'eksik', unreadable: 'okunamadı' };

function isToolResultMessage(m: Pick<StoredMessage, 'role' | 'content'>): boolean {
  return m.role === 'user' && m.content.some((b) => b.type === 'tool_result');
}

/** Kullanıcı turu mu (araç sonucu taşımayan kullanıcı mesajı). Pencere yalnız böyle bir mesajla başlar. */
function isUserTurn(m: Pick<StoredMessage, 'role' | 'content'>): boolean {
  return m.role === 'user' && !isToolResultMessage(m);
}

/**
 * Kademeli pencere başlangıcı: özetten sonraki `total` mesajın kaçıncısından başlanır. Pencere boyu
 * [limit, limit + step) aralığında kalır; başlangıç `step` mesajda bir ilerler.
 */
export function steppedStart(total: number, limit = HISTORY_LIMIT, step = HISTORY_STEP): number {
  if (total <= limit) return 0;
  return Math.floor((total - limit) / step) * step;
}

/** Base64 boyu (bayt → 4/3). */
export function base64Size(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

export interface WindowOptions {
  limit?: number;
  step?: number;
  /** Özetten sonraki toplam mesaj sayısı (`msgs` bunun son kısmıysa). Verilmezse `msgs.length`. */
  total?: number;
  /** Mesajın base64 eklerinin boyu (Files kimlikli ekler 0). Verilmezse ekler sayılmaz. */
  mediaSize?: (m: Pick<StoredMessage, 'role' | 'content'>) => number;
  /** Bu istekte geçmişe eklenecek yeni kullanıcı turunun ek boyu. */
  reserve?: number;
  budget?: number;
  target?: number;
}

/**
 * Pencere: kademeli başlangıçtan (`steppedStart`) ilk kullanıcı turuna; sonra ek bütçesi aşılıyorsa önden ilerler.
 * Kullanıcı turu hiç yoksa boş döner.
 */
export function windowMessages<T extends Pick<StoredMessage, 'role' | 'content'>>(msgs: readonly T[], opts: WindowOptions = {}): T[] {
  const { limit = HISTORY_LIMIT, step = HISTORY_STEP, mediaSize, reserve = 0, budget = MEDIA_BUDGET_B64, target = MEDIA_TARGET_B64 } = opts;
  const total = Math.max(opts.total ?? msgs.length, msgs.length);
  const offset = total - msgs.length;
  let start = Math.max(0, steppedStart(total, limit, step) - offset);
  while (start < msgs.length && !isUserTurn(msgs[start]!)) start++;
  if (!mediaSize) return msgs.slice(start);

  // Ekleme sırasıyla yürü (sonda bu turun ekleri): bir kullanıcı turu toplamı bütçenin üstüne taşırsa, o turdan
  // önceki mesajlar baştan, kalan ekler hedefe inene dek düşer (aşan tur kendisi hep kalır).
  const size = (i: number) => (i < msgs.length ? mediaSize(msgs[i]!) : reserve);
  let acc = 0;
  for (let i = start; i <= msgs.length; i++) {
    acc += size(i);
    if (acc <= budget || (i < msgs.length && !isUserTurn(msgs[i]!))) continue;
    while (start < i && acc > target) acc -= size(start++);
    while (start < i && !isUserTurn(msgs[start]!)) acc -= size(start++);
  }
  return msgs.slice(start);
}

/** Yükleme başvurusu bloğu mu (`source.type === 'upload'`). */
function uploadRef(b: StoredBlock): string | null {
  const src = b.source as { type?: string; upload_id?: string } | undefined;
  return (b.type === 'image' || b.type === 'document') && src?.type === 'upload' && typeof src.upload_id === 'string' ? src.upload_id : null;
}

/** Yükleme → API bloğu (Files kimliği varsa file, yoksa base64; okunamazsa null). */
export type UploadLoader = (uploadId: string) => Promise<BetaContentBlockParam | null>;

export function uploadBlock(upload: UploadRow, data: Uint8Array | null): BetaContentBlockParam | null {
  if (upload.anthropicFileId) {
    return upload.kind === 'pdf'
      ? { type: 'document', source: { type: 'file', file_id: upload.anthropicFileId } }
      : { type: 'image', source: { type: 'file', file_id: upload.anthropicFileId } };
  }
  if (!data) return null;
  // Tür saklanan mime'dan değil baytlardan: yanlış ya da desteklenmeyen tür API'de 400 olur ve sohbeti kalıcı bozar.
  const sniffed = sniffMime(data);
  const b64 = Buffer.from(data).toString('base64');
  if (upload.kind === 'pdf') {
    return sniffed === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } } : null;
  }
  return isImageMime(sniffed) ? { type: 'image', source: { type: 'base64', media_type: sniffed, data: b64 } } : null;
}

/** Mesajdaki yükleme kimlikleri (başvuru blokları). */
export function uploadIdsOf(m: Pick<StoredMessage, 'content'>): string[] {
  return m.content.map(uploadRef).filter((x): x is string => x !== null);
}

/**
 * Saklanan bloklar → API blokları (yükleme başvuruları çözülür). Görsel ve PDF yalnız yükleme başvurusuyla saklanır;
 * başka kaynaklı (url, file, base64) `image`/`document` bloğu bu yoldan yazılmamıştır ve düşer. Saklanan bloklardaki
 * `cache_control` de atılır: kesme noktalarını geçit koyar (en çok 4); fazlası sohbetin her turunu 400 yapardı.
 */
export async function hydrateBlocks(blocks: readonly StoredBlock[], load: UploadLoader): Promise<BetaContentBlockParam[]> {
  const out: BetaContentBlockParam[] = [];
  for (const b of blocks) {
    const ref = uploadRef(b);
    if (ref) {
      out.push((await load(ref)) ?? { type: 'text', text: MISSING_UPLOAD_TEXT });
      continue;
    }
    if (b.type === 'image' || b.type === 'document') continue;
    if ('cache_control' in b) {
      const { cache_control: _cc, ...rest } = b;
      out.push(rest as unknown as BetaContentBlockParam);
      continue;
    }
    out.push(b as unknown as BetaContentBlockParam);
  }
  return out;
}

type AnyBlock = { type: string; id?: unknown; tool_use_id?: unknown };

/** Önceki turlardan geçmişe konmayan bloklar (bkz. başlık: thinking bağı düzenlenen geçmişte 400 verir). */
export const STRIPPED_HISTORY_BLOCKS: ReadonlySet<string> = new Set(['thinking', 'redacted_thinking']);

/** Saklanan asistan içeriğinden thinking bloklarını ayıklar (saf; diğer roller olduğu gibi kalır). */
export function stripThinking(role: StoredMessage['role'], blocks: readonly StoredBlock[]): StoredBlock[] {
  return role === 'assistant' ? blocks.filter((b) => !STRIPPED_HISTORY_BLOCKS.has(b.type)) : [...blocks];
}

function blocksOf(m: BetaMessageParam): AnyBlock[] {
  return Array.isArray(m.content) ? (m.content as unknown as AnyBlock[]) : [];
}

/**
 * Güvenlik ağı: API'nin reddettiği diziler ayıklanır (tur kilidi bunları önler; eski ya da yarım kalmış kayıtlar için).
 *   - `tool_use` taşıyan asistan mesajı, hemen ardından tüm kimliklerin `tool_result`'ını taşıyan kullanıcı mesajı
 *     gelmiyorsa düşer; eşi olmayan `tool_result` blokları da düşer (mesaj boşalırsa mesaj da).
 *   - `role:"system"` mesajı yalnız bir kullanıcı mesajının hemen ardından kalır.
 */
export function sanitizeHistory(msgs: readonly BetaMessageParam[]): BetaMessageParam[] {
  const useIds = (m: BetaMessageParam | undefined) =>
    m && m.role === 'assistant' ? blocksOf(m).filter((b) => b.type === 'tool_use').map((b) => String(b.id)) : [];
  const resultIds = (m: BetaMessageParam | undefined) =>
    m && m.role === 'user' ? blocksOf(m).filter((b) => b.type === 'tool_result').map((b) => String(b.tool_use_id)) : [];
  const keep = msgs.map(() => true);
  const paired = new Set<number>();
  msgs.forEach((m, i) => {
    const uses = useIds(m);
    if (uses.length === 0) return;
    const next = resultIds(msgs[i + 1] as BetaMessageParam | undefined);
    if (uses.every((id) => next.includes(id))) paired.add(i + 1);
    else keep[i] = false;
  });
  const out: BetaMessageParam[] = [];
  msgs.forEach((m, i) => {
    if (!keep[i]) return;
    if (m.role === 'user' && resultIds(m).length > 0) {
      const allowed = paired.has(i) ? new Set(useIds(msgs[i - 1])) : new Set<string>();
      const content = blocksOf(m).filter((b) => b.type !== 'tool_result' || allowed.has(String(b.tool_use_id)));
      if (content.length === 0) return;
      out.push({ ...m, content } as unknown as BetaMessageParam);
      return;
    }
    if ((m.role as string) === 'system' && out[out.length - 1]?.role !== 'user') return;
    out.push(m);
  });
  return out;
}

/** Saklanan mesajlar → API geçmişi. Özet varsa ilk kullanıcı mesajının başına metin bloğu olarak eklenir. */
export async function buildHistory(
  messages: readonly StoredMessage[],
  summary: string | null,
  load: UploadLoader,
  opts: WindowOptions = {},
): Promise<BetaMessageParam[]> {
  const win = windowMessages(messages, opts);
  const built: BetaMessageParam[] = [];
  for (const m of win) {
    if (m.role === 'system') {
      // Tur sistem mesajı düz metin olarak gönderilmişti; aynı biçimde geri kurulur.
      const text = m.content.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('\n');
      built.push({ role: 'system', content: text } as unknown as BetaMessageParam);
      continue;
    }
    const content = await hydrateBlocks(stripThinking(m.role, m.content), load);
    if (content.length === 0) continue;
    built.push({ role: m.role, content } as BetaMessageParam);
  }
  const out = sanitizeHistory(built);
  if (summary && summary.trim() !== '') {
    const first = out.findIndex((m) => m.role === 'user');
    const block: BetaContentBlockParam = { type: 'text', text: `${SUMMARY_PREFIX}\n${summary.trim()}` };
    if (first === -1) out.unshift({ role: 'user', content: [block] });
    else out[first] = { role: 'user', content: [block, ...(out[first]!.content as BetaContentBlockParam[])] } as BetaMessageParam;
  }
  return out;
}

/** Teşhis bağlamı metni (modelin göreceği; ekranda gösterilmez). */
export function seedText(seed: SeedContext): string {
  const lines = [SEED_PREFIX, 'Öğrenci bu mesajı bir çözüm teşhisinin ardından "Koça sor" ile açtı. Teşhis:'];
  if (seed.questionText) lines.push(`Soru: ${seed.questionText}`);
  if (seed.studentWorkText) lines.push(`Öğrencinin çözümü: ${seed.studentWorkText}`);
  if (seed.verdict) lines.push(`Sonuç: ${VERDICT_TR[seed.verdict] ?? seed.verdict}`);
  if (seed.failingStepNo !== null) lines.push(`İlk bozulan adım: ${seed.failingStepNo}`);
  if (seed.errorCause) lines.push(`Hata nedeni: ${ERROR_CAUSE_TR[seed.errorCause] ?? seed.errorCause}`);
  if (seed.summary) lines.push(`Neden: ${seed.summary}`);
  if (seed.skillIds.length > 0) lines.push(`Kazanımlar: ${seed.skillIds.join(', ')}`);
  if (seed.misconceptionTags.length > 0) lines.push(`Yanılgı etiketleri: ${seed.misconceptionTags.join(', ')}`);
  return lines.join('\n');
}

/** Kullanıcı turunun saklanan içeriği: ekler (başvuru) + yazılan metin + (varsa) teşhis bağlamı. */
export function userContent(text: string, uploads: readonly UploadRow[], seed: SeedContext | null): StoredBlock[] {
  const blocks: StoredBlock[] = uploads.map((u) => ({
    type: u.kind === 'pdf' ? 'document' : 'image',
    source: { type: 'upload', upload_id: u.id },
  }));
  if (text.trim() !== '') blocks.push({ type: 'text', text: text.trim() });
  if (seed) blocks.push({ type: 'text', text: seedText(seed) });
  return blocks;
}

function textOf(blocks: readonly StoredBlock[], skipHidden: boolean): string {
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => String(b.text))
    .filter((t) => !skipHidden || (!t.startsWith(SEED_PREFIX) && !t.startsWith(SUMMARY_PREFIX)))
    .join('\n\n')
    .trim();
}

/**
 * Ekran öğeleri: öğrenci mesajları (araç sonucu olmayan) ve koçun son yanıtları (araç çağrısı içermeyen asistan
 * mesajları). Araçlar arası ara notlar ve tur sistem mesajları gösterilmez.
 */
export function toDisplay(messages: readonly StoredMessage[]): DisplayMessage[] {
  const out: DisplayMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      if (isToolResultMessage(m)) continue;
      const attachments = m.content
        .map((b) => {
          const id = uploadRef(b);
          return id ? { id, kind: (b.type === 'document' ? 'pdf' : 'photo') as 'photo' | 'pdf' } : null;
        })
        .filter((x): x is { id: string; kind: 'photo' | 'pdf' } => x !== null);
      const text = textOf(m.content, true);
      if (!text && attachments.length === 0) continue;
      const seeded = m.content.some((b) => b.type === 'text' && String(b.text ?? '').startsWith(SEED_PREFIX));
      out.push({ id: `m${m.id}`, from: 'student', text, attachments, escalated: false, seeded });
      continue;
    }
    if (m.role === 'assistant') {
      if (m.content.some((b) => b.type === 'tool_use' || b.type === 'server_tool_use')) continue;
      const text = textOf(m.content, false);
      if (!text) continue;
      const rec: TurnRecord | null = m.toolCalls;
      out.push({ id: `m${m.id}`, from: 'tutor', text, attachments: [], escalated: Boolean(rec?.escalated), seeded: false });
    }
  }
  return out;
}

/** Gateway transkriptindeki mesaj → saklanan biçim (system string → tek metin bloğu). */
export function toStored(m: BetaMessageParam): { role: StoredMessage['role']; content: StoredBlock[] } {
  const role = m.role as string as StoredMessage['role'];
  if (typeof m.content === 'string') return { role, content: [{ type: 'text', text: m.content }] };
  return { role, content: JSON.parse(JSON.stringify(m.content)) as StoredBlock[] };
}
