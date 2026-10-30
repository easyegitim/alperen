/**
 * Sözleşme adları: 25 şemanın kısa adı ve `$id`'si (BLUEPRINT §4). JSON belgesi içe almaz;
 * Worker'ın yüklediği `validators.ts` de bunu kullanır. Kısa ad = dosya adı
 * (`schemas/<ad>.schema.json`), `$id` = `https://ogrenmen.easy/schemas/<ad>.json`.
 * `test/catalog.test.ts` listenin `schemas/` dizini ile birebir aynı olduğunu denetler.
 */
/** Tüm sözleşmelerin kısa adları (alfabetik). */
export const SCHEMA_NAMES = [
  'answer-key',
  'bot-response-log',
  'common',
  'curriculum',
  'diagnostic-keys',
  'diagnostic-test',
  'exam-item',
  'exam-priority-plan',
  'figure-render-report',
  'generation-request',
  'instructor-alert',
  'lesson-analysis',
  'memory-fact',
  'misconception-tags',
  'models',
  'nightly-facts-output',
  'query-expand',
  'question-generation',
  'question-item',
  'research-output',
  'telegram-update',
  'template-params',
  'transcript',
  'tutor-reply',
  'weekly-summary',
] as const;

export type SchemaName = (typeof SCHEMA_NAMES)[number];

/** Şemaların `$id` taban adresi. */
export const SCHEMA_BASE = 'https://ogrenmen.easy/schemas/';

/** Kısa ad → `$id` eşlemesi (ör. `Schemas['question-item']`). */
export const Schemas = Object.freeze(
  Object.fromEntries(SCHEMA_NAMES.map((n) => [n, `${SCHEMA_BASE}${n}.json`])) as { readonly [K in SchemaName]: string },
);

/**
 * Cevap anahtarı taşıyan sözleşmeler (`correct_option` ve çözüm). Önceden derlenmiş halleri
 * ayrı dosyadadır (`src/generated/validators-keys.js`) ve yalnız `@ogrenmen/contracts/answer-key`
 * onu içe alır; Worker'ın yüklediği `validators.js` bunları içermez (BLUEPRINT §4: Worker
 * answer-key şemasını içe alamaz).
 */
export const KEY_SCHEMA_NAMES = ['answer-key', 'diagnostic-keys', 'question-generation'] as const satisfies readonly SchemaName[];

export type KeySchemaName = (typeof KEY_SCHEMA_NAMES)[number];

const KEY_SET: ReadonlySet<string> = new Set(KEY_SCHEMA_NAMES);

/** Worker yolundaki (`validators.js`) sözleşmeler: anahtar taşıyanlar hariç hepsi. */
export const WORKER_SCHEMA_NAMES = SCHEMA_NAMES.filter((n) => !KEY_SET.has(n)) as Exclude<SchemaName, KeySchemaName>[];

export type WorkerSchemaName = Exclude<SchemaName, KeySchemaName>;

export function isKeySchema(name: SchemaName): name is KeySchemaName {
  return KEY_SET.has(name);
}

const NAME_SET: ReadonlySet<string> = new Set(SCHEMA_NAMES);
const DEF_FRAGMENT = /^\/\$defs\/([A-Za-z][A-Za-z0-9_-]*)$/;

/** Ayrıştırılmış sözleşme başvurusu: kısa ad ve isteğe bağlı `$defs` tanımı. */
export interface SchemaRef {
  name: SchemaName;
  /** `#/$defs/<def>` parçasındaki tanım adı; parça yoksa `null`. */
  def: string | null;
}

/**
 * Kısa adı, `$id`'yi ya da `<ad|$id>#/$defs/<tanım>` biçimindeki parçalı başvuruyu ayrıştırır
 * (ör. `transcript#/$defs/segment`, `https://ogrenmen.easy/schemas/curriculum.json#/$defs/skill`).
 * Parça olarak yalnız `#/$defs/<tanım>` kabul edilir; bilinmeyen ad ya da parça `OGR-SCHEMA-001`.
 */
export function parseSchemaRef(nameOrRef: string): SchemaRef {
  const hashAt = nameOrRef.indexOf('#');
  const base = hashAt === -1 ? nameOrRef : nameOrRef.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : nameOrRef.slice(hashAt + 1);
  let name = base;
  if (name.startsWith(SCHEMA_BASE)) name = name.slice(SCHEMA_BASE.length);
  if (name.endsWith('.schema.json')) name = name.slice(0, -'.schema.json'.length);
  else if (name.endsWith('.json')) name = name.slice(0, -'.json'.length);
  if (!NAME_SET.has(name)) {
    throw new Error(`OGR-SCHEMA-001 bilinmeyen sözleşme: ${nameOrRef}`);
  }
  if (fragment === '') return { name: name as SchemaName, def: null };
  const m = DEF_FRAGMENT.exec(fragment);
  if (!m) throw new Error(`OGR-SCHEMA-001 desteklenmeyen parça (yalnız #/$defs/<tanım>): ${nameOrRef}`);
  return { name: name as SchemaName, def: m[1] as string };
}

/** Kısa adı ya da `$id`'yi (isteğe bağlı `#/$defs/…` parçası yok sayılır) kısa ada çevirir. */
export function schemaNameOf(nameOrId: string): SchemaName {
  return parseSchemaRef(nameOrId).name;
}

/** Başvurunun tam `$id` biçimi (`…/<ad>.json` ya da `…/<ad>.json#/$defs/<tanım>`). */
export function schemaRefId(ref: SchemaRef): string {
  return ref.def === null ? Schemas[ref.name] : `${Schemas[ref.name]}#/$defs/${ref.def}`;
}

function camel(text: string): string {
  return text.replace(/[-_]([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * Önceden derlenmiş modüldeki dışa aktarım adı: `question-item` → `questionItem`,
 * `transcript#/$defs/segment` → `transcriptSegment`, `curriculum#/$defs/skill` → `curriculumSkill`.
 * `scripts/gen.ts` aynı fonksiyonla adlandırır.
 */
export function standaloneExportName(ref: SchemaRef): string {
  const head = camel(ref.name);
  if (ref.def === null) return head;
  const tail = camel(ref.def);
  return head + tail.charAt(0).toUpperCase() + tail.slice(1);
}
