// engine spec §9.6: uzunluk onarımı. Claude'a giden şema (toAnthropicJsonSchema) maxLength/maxItems taşımaz; bu yüzden
// model sınırı birkaç karakter aşabilir. CoachReport.safeParse sunucuda yetkili kalır; bu adım ondan önce çalışır ve
// yalnız kısaltır: metni sınırına kadar sözcük sınırında keser, diziyi en fazla öğe sayısına indirir. Yeni içerik
// üretmez, alan eklemez, tip değiştirmez (yanlış tipli değer olduğu gibi kalır ve şema denetiminde reddedilir). Saf.
import { z } from "zod";
import { CoachReport } from "@/lib/ai/reportSchema";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Sınırlar tek kaynaktan, CoachReport'tan okunur (elle kopyalanmış sayı yok). */
const REPORT_JSON_SCHEMA: Json = z.toJSONSchema(CoachReport) as Json;

/** Sondaki bağlaç gibi duran noktalama ve boşluk atılır. */
const TRAILING = /[\s,;:–—-]+$/u;

/** Metni en fazla `max` karaktere, mümkünse son tam sözcükte keser. */
export function cutAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const nextIsBoundary = /\s/.test(s.charAt(max));
  const lastSpace = head.search(/\s\S*$/);
  // Tek sözcük sınırı aşıyorsa (boşluk yoksa) sert kesim; aksi halde son boşlukta.
  const cut = nextIsBoundary ? head : lastSpace > 0 ? head.slice(0, lastSpace) : head;
  return cut.replace(TRAILING, "");
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v;
}

function matches(node: Json, v: unknown): boolean {
  const t = node.type;
  const vt = typeOf(v);
  const types = Array.isArray(t) ? t : [t];
  return types.includes(vt) || (vt === "integer" && types.includes("number"));
}

function fit(node: unknown, v: unknown): unknown {
  if (!isObj(node)) return v;
  const variants = Array.isArray(node.anyOf) ? node.anyOf : null;
  if (variants) {
    const branch = variants.find((b) => isObj(b) && matches(b, v));
    return branch === undefined ? v : fit(branch, v);
  }
  if (typeof v === "string") {
    return typeof node.maxLength === "number" ? cutAtWord(v, node.maxLength) : v;
  }
  if (Array.isArray(v)) {
    const sliced = typeof node.maxItems === "number" ? v.slice(0, node.maxItems) : v;
    return sliced.map((item) => fit(node.items, item));
  }
  if (isObj(v) && isObj(node.properties)) {
    const props = node.properties;
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, k in props ? fit(props[k], val) : val]));
  }
  return v;
}

/** Raporu CoachReport sınırlarına indirir (engine spec §9.6). Girdi değiştirilmez; yeni bir ağaç döner. */
export function fitReportLengths(report: unknown): unknown {
  return fit(REPORT_JSON_SCHEMA, report);
}
