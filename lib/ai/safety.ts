// SPEC 9.9 güvenlik filtresi. Tüm AI metinleri Türkçe normalizasyonla taranır; alan bazlı izinler.
import { MAX_DAILY_DEFICIT_KCAL } from "@/lib/coach/bodyRules";

export type SafetyRule =
  | "slur"
  | "medical_procedure"
  | "drugs"
  | "harmful_practice"
  | "diagnosis"
  | "calorie"
  | "specialty"
  // hybrid.v2 (PLAN_V2 3f; KB Ek B): yapısal eleştiri, kıyas/sıralama dili ve düz yazıda sayı.
  | "structural_critique"
  | "comparison"
  | "score_in_text";

export function normalizeTr(s: string): string {
  return s
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u");
}

const TERMS: Record<Exclude<SafetyRule, "calorie" | "specialty" | "score_in_text">, string[]> = {
  slur: ["cirkin", "berbat", "igrenc", "kusurlu", "basarisiz yuz", "chad", "mog", "psl", "incel", "subhuman"],
  medical_procedure: ["ameliyat", "cerrahi", "rinoplasti", "botoks", "botox", "dolgu", "filler", "implant", "liposuction", "liposakşın", "bisektomi"],
  drugs: ["steroid", "testosteron", "hormon", "finasterid", "minoksidil", "minoxidil", "izotretinoin", "isotretinoin", "roakutan", "roaccutane", "retinoid", "sarm", "kreatin"],
  harmful_practice: ["mewing", "bonesmash", "ac kal", "ogun atla", "kus", "detoks cay", "termojenik"],
  diagnosis: ["rosacea", "rozasea", "egzama", "dermatit", "akne vulgaris", "sedef", "mantar"],
  // Ek B 1–5: "kusur", "en büyük sorunun", "ince dudak / zayıf çene / basık burun", "çok düşük / ideal değil", kemik yapısı yorumu.
  structural_critique: [
    "kusur",
    "en buyuk sorun",
    "en buyuk problem",
    "asimetrik",
    "orantisiz",
    "geri cene",
    "zayif cene",
    "kucuk cene",
    "basik burun",
    "egri burun",
    "buyuk burun",
    "ince dudak",
    "kemik yapi",
    "yamuk",
    "cok dusuk",
    "ideal degil",
    "idealden uzak",
  ],
  // Ek B 6, 9; K4/K14: kıyas, sıralama, yüzdelik, etnik grup, kadınsılık-erkeksilik ekseni, hayat başarısı.
  comparison: ["ortalamanin alt", "ortalamanin ust", "cogu insan", "diger insanlar", "kiyasla", "siralama", "yuzdelik", "unlu", "irk", "etnik", "kadinsi", "erkeksi", "maskulen", "feminen", "daha cok kazan"],
};

/** Kelime sınırıyla aranan kısa terimler: "dolgu" (dolgun sakal değil), "kus" (kusur değil), "irk" (birkaç değil), "unlu". */
const WORD_BOUNDARY_TERMS = new Set(["mog", "psl", "kus", "sarm", "dolgu", "irk", "unlu"]);

export type Violation = { rule: SafetyRule; path: string; term: string };

function findTerms(text: string, terms: string[]): string[] {
  const n = normalizeTr(text);
  return terms.filter((t) => (WORD_BOUNDARY_TERMS.has(t) ? new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(n) : n.includes(t)));
}

/** "… olabilir" kalıbı: yalnız seeProfessional.text içinde hastalık adı serbest (SPEC 9.6/9.9). */
export function hasMaybePattern(text: string): boolean {
  return /olabilir/i.test(text);
}

const CALORIE_RE = /(\d[\d.]*)\s*(kcal|kalori)/gi;

/**
 * Raporu (veya herhangi bir JSON ağacını) yol bazında tarar.
 * ctx.faceContoursEnabled false iken kalori/kalori sözcükleri her yerde ihlaldir; true iken yalnız faceContours.tips'te ve ≤ 500.
 */
export function scanReport(report: unknown, ctx: { faceContoursEnabled: boolean }): Violation[] {
  const out: Violation[] = [];
  walk(report, "", (path, text) => {
    const inSeePro = path === "seeProfessional.text";
    const inContours = path.startsWith("faceContours.tips");
    for (const rule of ["slur", "medical_procedure", "drugs", "harmful_practice"] as const) {
      for (const term of findTerms(text, TERMS[rule])) out.push({ rule, path, term });
    }
    for (const term of findTerms(text, TERMS.diagnosis)) {
      if (!(inSeePro && hasMaybePattern(text))) out.push({ rule: "diagnosis", path, term });
    }
    for (const m of text.matchAll(CALORIE_RE)) {
      const n = Number(m[1].replace(/\./g, ""));
      const ok = ctx.faceContoursEnabled && inContours && Number.isFinite(n) && n <= MAX_DAILY_DEFICIT_KCAL;
      if (!ok) out.push({ rule: "calorie", path, term: m[0] });
    }
    if (!/\d/.test(text) && /\b(kcal|kalori)\b/i.test(normalizeTr(text)) && !(ctx.faceContoursEnabled && inContours)) {
      out.push({ rule: "calorie", path, term: "kalori" });
    }
  });
  if (report && typeof report === "object" && "seeProfessional" in report) {
    const sp = (report as { seeProfessional?: { specialty?: string } | null }).seeProfessional;
    if (sp?.specialty && normalizeTr(sp.specialty).includes("plastik")) out.push({ rule: "specialty", path: "seeProfessional.specialty", term: sp.specialty });
  }
  return out;
}

function walk(node: unknown, path: string, visit: (path: string, text: string) => void) {
  if (typeof node === "string") return visit(path, node);
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
  if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, visit);
}

/**
 * İhlalli öğeleri çıkarır (SPEC 9.9 "ilgili öğeyi çıkar"). Dizi öğesi silinir; seeProfessional ihlalliyse null;
 * faceContours.tips temizlenir; summary/scoreNarrative ihlalliyse null döner (fallback gerekir).
 */
export function stripViolations<T extends Record<string, unknown>>(report: T, violations: Violation[]): T | null {
  if (violations.some((v) => v.path === "summary" || v.path === "scoreNarrative")) return null;
  const copy = structuredClone(report) as Record<string, unknown>;
  const removeIdx = new Map<string, Set<number>>();
  for (const v of violations) {
    const m = v.path.match(/^([a-zA-Z.]+)\[(\d+)\]/);
    if (m) {
      const set = removeIdx.get(m[1]) ?? new Set<number>();
      set.add(Number(m[2]));
      removeIdx.set(m[1], set);
    } else if (v.path.startsWith("seeProfessional")) copy.seeProfessional = null;
    else if (v.path.startsWith("hairColor")) copy.hairColor = null;
  }
  for (const [arrPath, idx] of removeIdx) {
    const parts = arrPath.split(".");
    let parent: Record<string, unknown> = copy;
    for (const p of parts.slice(0, -1)) parent = parent[p] as Record<string, unknown>;
    const key = parts[parts.length - 1];
    const arr = parent[key];
    if (Array.isArray(arr)) parent[key] = arr.filter((_, i) => !idx.has(i));
  }
  return copy as T;
}

export const SAFETY_RULES: SafetyRule[] = ["slur", "medical_procedure", "drugs", "harmful_practice", "diagnosis", "calorie", "specialty", "structural_critique", "comparison", "score_in_text"];

// ---------------------------------------------------------------------------------------------------------------------
// hybrid.v2 metin taraması (PLAN_V2 3f): denetim geçişinden sonra Claude kaynaklı her cümle buradan geçer; takılan cümle
// şablona düşer (lib/score/engine/audit.ts). Eski scanReport (CoachReport) değişmedi.

const DIGIT_RE = /\d/;

/**
 * Tek bir Claude cümlesini tarar. `allowMaybeDiagnosis`: yalnız seeProfessional metni ("… olabilir" kalıbı) hastalık adı
 * taşıyabilir. Kalori sözcüğü her yerde ihlaldir (v2 raporunda beden/kilo metni yok). Düz yazıda rakam → score_in_text.
 */
export function scanTextV2(text: string, path: string, opts: { allowMaybeDiagnosis?: boolean } = {}): Violation[] {
  const out: Violation[] = [];
  for (const rule of ["slur", "medical_procedure", "drugs", "harmful_practice", "structural_critique", "comparison"] as const) {
    for (const term of findTerms(text, TERMS[rule])) out.push({ rule, path, term });
  }
  for (const term of findTerms(text, TERMS.diagnosis)) {
    if (!(opts.allowMaybeDiagnosis && hasMaybePattern(text))) out.push({ rule: "diagnosis", path, term });
  }
  if (/\b(kcal|kalori)\b/i.test(normalizeTr(text))) out.push({ rule: "calorie", path, term: "kalori" });
  if (DIGIT_RE.test(text)) out.push({ rule: "score_in_text", path, term: text.match(/\d[\d.,]*/)?.[0] ?? "rakam" });
  return out;
}
