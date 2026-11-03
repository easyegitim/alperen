/**
 * Sözleşme araç takımı: her şema `build(ctx)` fabrikasıdır ve iki kez kurulur.
 *
 * - `strict`: yapılandırılmış çıktı (output_config.format) kısıtlarına uyar. Özyineleme yok, min/max/
 *   minLength/maxLength/multipleOf yok (yalnız minItems 1 ile uuid/date/date-time biçimleri korunur), her nesne `additionalProperties: false`. Model çağrısına bu gider.
 * - `loose`: aynı biçim + istemci tarafı kısıtlar (uzunluk, aralık, desen) + çapraz alan kuralları
 *   (`refine`). Model çıktısı `parse` sonrası bu şemadan geçer; JSON Schema dışa aktarımı da bunun
 *   yapısal kısmıdır (Python tüketicileri için).
 *
 * İki şemanın TS tipi aynıdır (tek fabrikadan çıkar).
 */
import { z } from 'zod';

export type Mode = 'strict' | 'loose';

export type JsonObject = { [key: string]: unknown };

/** Her 8-4-4-4-12 onaltılık dize (sürüm/varyant denetimi yok; Ajv/jsonschema `uuid` biçimiyle aynı). */
const UUID_ANY = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const NO_EXCLAIM_EMOJI = /^[^\uFE0F!\uFF01\u203C\u2049\u2600-\u27BF\u2B50-\u2B55\u{1F000}-\u{1FAFF}]*$/u;

export interface StrOpts {
  min?: number;
  max?: number;
  pattern?: RegExp;
  desc?: string;
}
export interface NumOpts {
  min?: number;
  max?: number;
  desc?: string;
}
export interface ArrOpts {
  min?: number;
  max?: number;
}

/** İki kipte de aynı arayüz; strict kip kısıt eklemez. */
export interface Ctx {
  readonly mode: Mode;
  readonly isLoose: boolean;
  /** Metin; loose kipte uzunluk ve desen kısıtı eklenir. */
  str(o?: StrOpts): z.ZodType<string>;
  /** Öğrenciye/veliye gösterilen metin: loose kipte ünlem ve emoji reddedilir. */
  uiText(o?: StrOpts): z.ZodType<string>;
  int(o?: NumOpts): z.ZodType<number>;
  num(o?: NumOpts): z.ZodType<number>;
  /** 0..1 aralığında sayı. */
  prob(desc?: string): z.ZodType<number>;
  uuid(desc?: string): z.ZodType<string>;
  date(desc?: string): z.ZodType<string>;
  dateTime(desc?: string): z.ZodType<string>;
  arr<T extends z.ZodType>(item: T, o?: ArrOpts): z.ZodArray<T>;
  /** Ayrık birleşim: strict `anyOf` (z.union), loose `oneOf` (z.discriminatedUnion). */
  variants<const O extends readonly [z.ZodObject, z.ZodObject, ...z.ZodObject[]]>(
    key: string,
    options: O,
  ): z.ZodType<z.output<O[number]>>;
  /**
   * v2'de eklenen, v1 verisinde bulunmayan alan: strict kipte zorunlu (model üretir), loose kipte
   * varsayılanla doldurulur (eski veri geçerli kalır). JSON Schema'da zorunlu sayılmaz.
   */
  added<T extends z.ZodType>(schema: T, fallback: z.output<T>): T;
}

function mkStr(loose: boolean, o: StrOpts = {}): z.ZodType<string> {
  let s = z.string();
  if (loose) {
    if (o.min !== undefined) s = s.min(o.min);
    if (o.max !== undefined) s = s.max(o.max);
    if (o.pattern !== undefined) s = s.regex(o.pattern);
  }
  return o.desc ? s.describe(o.desc) : s;
}

function mkNum(loose: boolean, integer: boolean, o: NumOpts = {}): z.ZodType<number> {
  let n = integer ? z.number().int() : z.number();
  if (loose) {
    if (o.min !== undefined) n = n.min(o.min);
    if (o.max !== undefined) n = n.max(o.max);
  }
  return o.desc ? n.describe(o.desc) : n;
}

function build(mode: Mode): Ctx {
  const loose = mode === 'loose';
  const ctx: Ctx = {
    mode,
    isLoose: loose,
    str: (o) => mkStr(loose, o),
    uiText: (o) => {
      const base = mkStr(loose, o) as z.ZodString;
      // refine: JSON Schema'ya girmez (astral emoji aralığı motorlar arası taşınabilir değil); yalnız TS tarafında uygulanır.
      return loose ? (base.refine((v) => NO_EXCLAIM_EMOJI.test(v), 'ünlem ve emoji kullanılmaz') as unknown as z.ZodType<string>) : base;
    },
    int: (o) => mkNum(loose, true, o),
    num: (o) => mkNum(loose, false, o),
    prob: (desc) => mkNum(loose, false, { min: 0, max: 1, desc }),
    uuid: (desc) => {
      // z.uuid() RFC sürüm/varyant ister; biçim `uuid` olarak dışa aktarılır (desen json-schema.ts'te düşer).
      // Strict kipte de `format` korunur: API uuid/date/date-time biçimlerini destekler.
      const s = loose ? z.string().regex(UUID_ANY).meta({ format: 'uuid' }) : z.string().meta({ format: 'uuid' });
      return desc ? s.describe(desc) : s;
    },
    date: (desc) => {
      const s = loose ? z.iso.date() : z.string().meta({ format: 'date' });
      return desc ? s.describe(desc) : s;
    },
    dateTime: (desc) => {
      const s = loose ? z.iso.datetime({ offset: true }) : z.string().meta({ format: 'date-time' });
      return desc ? s.describe(desc) : s;
    },
    arr: (item, o = {}) => {
      let a = z.array(item);
      // minItems 0/1 yapılandırılmış çıktıda desteklenir: loose'ta en az 1 isteyen dizi model dilbilgisinde de boş kalmasın.
      if (!loose && o.min !== undefined && o.min >= 1) a = a.min(1);
      if (loose) {
        if (o.min !== undefined) a = a.min(o.min);
        if (o.max !== undefined) a = a.max(o.max);
      }
      return a;
    },
    variants: (key, options) =>
      (loose ? z.discriminatedUnion(key, options as never) : z.union(options as never)) as never,
    added: (schema, fallback) => (loose ? (schema.default(fallback as never) as unknown as typeof schema) : schema),
  };
  return ctx;
}

export const strictCtx: Ctx = build('strict');
export const looseCtx: Ctx = build('loose');

export interface ContractSpec<T extends z.ZodType> {
  /** Kısa ad (kebab-case); dosya adı ve `$id` bundan türer. */
  name: string;
  /** PascalCase başlık (JSON Schema `title`). */
  title: string;
  /** Türkçe açıklama (JSON Schema `description`). */
  description: string;
  /** Model çıktısı olarak (output_config.format) kullanılır mı; doğruysa strict kısıt testleri koşar. */
  llmOutput?: boolean;
  build: (c: Ctx) => T;
  /** Çapraz alan kuralları; yalnız loose şemaya eklenir ve JSON Schema'ya girmez. */
  refine?: (value: z.output<T>, ctx: z.RefinementCtx) => void;
  /**
   * JSON Schema dışa aktarımında `$defs`'e alınacak alt şemalar: tanım adı → özellik yolu
   * (ör. `segment: ['properties', 'segments', 'items']`). Python `<ad>#/$defs/<tanım>` başvurusu içindir.
   */
  defs?: Record<string, string[]>;
  /**
   * JSON Schema'ya koşullu kural eklemek için (yalnız v1'den taşınan, Python tüketicilerinin dayandığı kurallar:
   * if/then, oneOf-required, contains). TS tarafı aynı kuralı `refine`'da uygular; fikstürler ikisini birlikte sınar.
   */
  jsonSchemaPatch?: (doc: JsonObject) => void;
}

export interface Contract<T extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly llmOutput: boolean;
  readonly defs: Record<string, string[]>;
  readonly jsonSchemaPatch: ((doc: JsonObject) => void) | undefined;
  /** Yapılandırılmış çıktı şeması (`zodOutputFormat(contract.strict)`). */
  readonly strict: T;
  /** İstemci tarafı doğrulama şeması (kısıtlar + çapraz kurallar). */
  readonly loose: T;
  strictSchema(): T;
  looseSchema(): T;
  /** Loose şemayla ayrıştırır; uymazsa `ZodError` fırlatır. */
  parse(data: unknown): z.output<T>;
  safeParse(data: unknown): ReturnType<T['safeParse']>;
  isValid(data: unknown): boolean;
}

export function defineContract<T extends z.ZodType>(spec: ContractSpec<T>): Contract<T> {
  const strict = spec.build(strictCtx);
  const looseBase = spec.build(looseCtx);
  const loose = (spec.refine ? looseBase.superRefine(spec.refine as never) : looseBase) as unknown as T;
  const contract: Contract<T> = {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    llmOutput: spec.llmOutput ?? false,
    defs: spec.defs ?? {},
    jsonSchemaPatch: spec.jsonSchemaPatch,
    strict,
    loose,
    strictSchema: () => strict,
    looseSchema: () => loose,
    parse: (data) => loose.parse(data) as z.output<T>,
    safeParse: (data) => loose.safeParse(data) as ReturnType<T['safeParse']>,
    isValid: (data) => loose.safeParse(data).success,
  };
  return contract;
}

/** Çapraz alan kuralı hatası ekler (kısa yol). */
export function addIssue(ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: 'custom', path, message });
}

/** UTF-8 bayt uzunluğu (hafıza dosyası sınırları için). */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
