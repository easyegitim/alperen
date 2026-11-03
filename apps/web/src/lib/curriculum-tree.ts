// Müfredat ağaç editörünün saf mantığı (sunucu ve istemci ortak): satırlardan ağaç, numaralandırma, sayılar,
// geçerli taşıma/birleştirme hedefleri, durum etiketleri ve RPC hata metinleri (supabase/migrations/0025).

export const MAX_DEPTH = 4;

export type SkillKind = 'unit' | 'outcome' | 'sub_outcome';

export interface SkillRow {
  id: string;
  parent_id: string | null;
  name: string;
  kind: SkillKind | null;
  is_leaf: boolean;
  order_no: number;
  description?: string | null;
}

export interface TreeItem {
  id: string;
  name: string;
  kind: SkillKind | null;
  /** Kök = 1. */
  depth: number;
  /** Görünen numara (kök hariç): "1", "1.2", "1.2.3". */
  number: string;
  parentId: string | null;
  children: TreeItem[];
}

export interface BuiltTree {
  root: TreeItem | null;
  byId: Map<string, TreeItem>;
  /** Kök dışındaki düğümler, ağaç sırasıyla. */
  flat: TreeItem[];
}

function sortRows(a: SkillRow, b: SkillRow): number {
  return a.order_no - b.order_no || a.id.localeCompare(b.id);
}

/** Satırlardan tek köklü ağaç; köke ulaşmayan satırlar (bozuk veri) yok sayılır. */
export function buildTree(rows: readonly SkillRow[]): BuiltTree {
  const kids = new Map<string | null, SkillRow[]>();
  for (const r of rows) kids.set(r.parent_id, [...(kids.get(r.parent_id) ?? []), r]);
  for (const list of kids.values()) list.sort(sortRows);
  const byId = new Map<string, TreeItem>();
  const flat: TreeItem[] = [];
  const rootRow = (kids.get(null) ?? [])[0];
  if (!rootRow) return { root: null, byId, flat };
  const make = (r: SkillRow, depth: number, number: string): TreeItem => {
    const item: TreeItem = { id: r.id, name: r.name, kind: r.kind, depth, number, parentId: r.parent_id, children: [] };
    byId.set(r.id, item);
    if (depth > 1) flat.push(item);
    if (depth < 12) {
      item.children = (kids.get(r.id) ?? []).map((c, i) => make(c, depth + 1, depth === 1 ? String(i + 1) : `${number}.${i + 1}`));
    }
    return item;
  };
  return { root: make(rootRow, 1, ''), byId, flat };
}

/** Alt ağacın yüksekliği (yaprak = 1). */
export function height(item: TreeItem): number {
  return 1 + Math.max(0, ...item.children.map(height));
}

/** `id`, `ancestorId`'nin altında mı (kendisi dahil). */
export function isWithin(tree: BuiltTree, id: string, ancestorId: string): boolean {
  let cur = tree.byId.get(id);
  while (cur) {
    if (cur.id === ancestorId) return true;
    cur = cur.parentId ? tree.byId.get(cur.parentId) : undefined;
  }
  return false;
}

/** Düğümün taşınabileceği üst düğümler: kendisi ve alt ağacı değil, şimdiki üstü değil, derinlik ≤ 4 kalır. */
export function moveTargets(tree: BuiltTree, id: string): TreeItem[] {
  const item = tree.byId.get(id);
  if (!item || !tree.root) return [];
  const h = height(item);
  return [tree.root, ...tree.flat].filter((t) => t.id !== item.parentId && !isWithin(tree, t.id, id) && t.depth + h <= MAX_DEPTH);
}

/** Düğümün birleştirilebileceği (kalacak) düğümler: kendisi, üst zinciri ve alt ağacı değil; derinlik ≤ 4 kalır. */
export function mergeTargets(tree: BuiltTree, dropId: string): TreeItem[] {
  const drop = tree.byId.get(dropId);
  if (!drop) return [];
  const h = height(drop);
  return tree.flat.filter((t) => t.id !== dropId && !isWithin(tree, t.id, dropId) && !isWithin(tree, dropId, t.id) && t.depth + h - 1 <= MAX_DEPTH);
}

/** Yeni alt düğüm eklenebilir mi (derinlik ≤ 4). */
export function canAddChild(item: TreeItem): boolean {
  return item.depth < MAX_DEPTH;
}

/** "3 kazanım · 11 alt kazanım" gibi özet (alt ağaç). */
export function subtreeSummary(item: TreeItem): string {
  let outcomes = 0;
  let subs = 0;
  let others = 0;
  const walk = (t: TreeItem) => {
    for (const c of t.children) {
      if (c.kind === 'outcome') outcomes += 1;
      else if (c.kind === 'sub_outcome') subs += 1;
      else others += 1;
      walk(c);
    }
  };
  walk(item);
  const parts: string[] = [];
  if (others > 0) parts.push(`${others} ünite`);
  if (outcomes > 0) parts.push(`${outcomes} kazanım`);
  if (subs > 0) parts.push(`${subs} alt kazanım`);
  return parts.join(' · ');
}

export const KIND_LABELS: Record<SkillKind, string> = { unit: 'Ünite', outcome: 'Kazanım', sub_outcome: 'Alt kazanım' };

export type CurriculumStatus = 'draft' | 'active' | 'retired';
export const STATUS_LABELS: Record<CurriculumStatus, string> = { draft: 'Taslak', active: 'Yayında', retired: 'Emekli' };

export type DraftStatus = 'queued' | 'researching' | 'drafting' | 'saving' | 'ready' | 'failed' | 'skipped';
export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  queued: 'Sırada',
  researching: 'Kaynaklar araştırılıyor',
  drafting: 'Ağaç kuruluyor',
  saving: 'Kaydediliyor',
  ready: 'Taslak hazır',
  failed: 'Taslak kurulamadı',
  skipped: 'Var olan müfredata bağlandı',
};

export function draftInProgress(status: string | null | undefined): boolean {
  return status === 'queued' || status === 'researching' || status === 'drafting' || status === 'saving';
}

export type ProposalKind = 'add_subskill' | 'rename' | 'merge' | 'add_prereq' | 'add_tag';
export const PROPOSAL_KIND_LABELS: Record<ProposalKind, string> = {
  add_subskill: 'Yeni alt kazanım',
  rename: 'Yeniden adlandır',
  merge: 'Birleştir',
  add_prereq: 'Ön koşul ekle',
  add_tag: 'Yanılgı etiketi',
};

/** Önerinin tek satırlık özeti (kart başlığı). */
export function proposalHeadline(kind: string, payload: Record<string, unknown>, names: ReadonlyMap<string, string>): string {
  const n = (id: unknown) => (typeof id === 'string' ? (names.get(id) ?? id) : '');
  switch (kind) {
    case 'add_subskill':
      return `${String(payload.name ?? 'Yeni alt kazanım')} (${n(payload.parent_id)} altına)`;
    case 'rename':
      return `"${n(payload.skill_id)}" → "${String(payload.name ?? '')}"`;
    case 'merge': {
      const ids = Array.isArray(payload.skill_ids) ? payload.skill_ids : [];
      return `"${n(payload.keep_id ?? payload.into ?? ids[0])}" ile "${n(payload.drop_id ?? payload.from ?? ids[1])}"`;
    }
    case 'add_prereq':
      return `${n(payload.prereq_id)} → ${n(payload.skill_id)}`;
    case 'add_tag':
      return `${String(payload.tag ?? '')} (${n(payload.skill_id)})`;
    default:
      return kind;
  }
}

/** Güven 0..1 → kelime bandı (yüzde yazılmaz). */
export function confidenceBand(c: unknown): string | null {
  if (typeof c !== 'number' || !Number.isFinite(c)) return null;
  if (c >= 0.9) return 'güven çok yüksek';
  if (c >= 0.75) return 'güven yüksek';
  if (c >= 0.5) return 'güven orta';
  return 'güven düşük';
}

/** RPC hata iletisinin (OGR-CURR-0xx, OGR-PROP-0xx, OGR-AUTH-00x) eğitmene gösterilen Türkçe karşılığı. */
export function curriculumErrorMessage(message: string | undefined | null): string {
  const m = message ?? '';
  if (m.includes('OGR-AUTH')) return 'Bu müfredatı düzenleme yetkin yok. Müfredatın sahibi ya da yöneticiyle konuş.';
  if (m.includes('OGR-CURR-020')) return 'Yayındaki sürüm düzenlenmez. Önce yeni sürüm aç, değişiklikleri orada yap.';
  if (m.includes('OGR-CURR-022')) return 'Bu değişiklik ağacı dört düzeyden derin yapar ya da düğümü kendi altına taşır.';
  if (m.includes('OGR-CURR-023')) return 'Bu kazanımın öğrenci kanıtı var; bu sürümde birleştirilemez. Yeni sürüm açıp orada birleştir.';
  if (m.includes('OGR-CURR-021')) return 'Ad 2 ile 120 karakter arasında olmalı ve seçilen kazanım bu müfredatta bulunmalı.';
  if (m.includes('OGR-CURR-025')) return 'Yalnız taslak sürüm yayınlanır ve ağacın tek bir kökü olmalı.';
  if (m.includes('OGR-CURR-024')) return 'Emekli sürümden yeni sürüm açılmaz.';
  if (m.includes('OGR-CURR-026')) return 'Bu sürümden daha yeni bir taslak açılmış. Açık taslağa geç; yayını orada yap.';
  if (m.includes('OGR-CURR-031')) return 'Kabul yeni taslak sürüm ister; yeni sürümü müfredatın sahibi ya da yönetici açar.';
  if (m.includes('OGR-CURR-013')) return 'Yalnız kurulamayan ve henüz kazanımı olmayan taslak yeniden kurulur.';
  if (m.includes('OGR-PROP-002')) return 'Bu öneriye zaten karar verilmiş.';
  if (m.includes('OGR-PROP-003')) return 'Bu ön koşul bir döngü kurar; kabul edilemez.';
  if (m.includes('OGR-PROP-001')) return 'Önerinin içeriği bu müfredatla uyuşmuyor; reddet ya da elle düzenle.';
  return 'İşlem tamamlanamadı. Biraz sonra yeniden dene.';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Rota parametresi ve eylem girdisi denetimi. */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}
