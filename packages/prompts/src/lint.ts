/**
 * Prompt metni kuralları (claude-api shared/prompt-audit.md ve ürün katmanı). Derleme betiği (scripts/build-bundle.ts)
 * ve testler aynı denetimi koşar; ihlal OGR-PRM-005 ile düşer.
 *
 *   - Ünlem ve emoji yok: ürünün sesi sakindir; prompt'un tonu çıktının tonuna geçer.
 *   - Baskı dili yok (BÜYÜK HARF MUST/ASLA/MUTLAKA yığını): güncel modeller sistem metnine çok duyarlıdır, bağırılan
 *     kural aşırı uygulanır; kural düz cümleyle ve gerekçesiyle yazılır.
 *   - Eski iskeleler yok ("adım adım düşün"): derinlik `effort` ile ayarlanır, düşünme düzyazıyla yönetilmez.
 *   - Araç adı yok: araçlar kendi açıklamalarıyla gelir (packages/llm tools.ts); sistem metni aracı adıyla anarsa
 *     araç kapatıldığında boşta kalan bir gönderme olur. Metin ne bilgiye ne zaman bakılacağını anlatır.
 *   - Örnekler etiketli: "Örnek…" ile başlayan her satır "örnektir" der; model örneği birebir kopyalamasın.
 */
import { PromptError } from './errors.js';

export interface LintIssue {
  rule: string;
  detail: string;
}

const PRESSURE = /(?<![\p{L}\p{N}_])(MUST|NEVER|ALWAYS|CRITICAL|IMPORTANT|ASLA|MUTLAKA|KESİNLİKLE|ÖNEMLİ|DİKKAT|ZORUNLU)(?![\p{L}\p{N}_])/u;
const SCAFFOLDS = [/adım adım düşün/iu, /think step by step/i, /derin bir nefes/iu, /take a deep breath/i, /<scratchpad>/i];
const EMOJI = /\p{Extended_Pictographic}/u;
const EXAMPLE_LINE = /^\s*(#+\s*|[-*]\s+|\d+\.\s+)?(\*\*)?örnek/iu;

/** KaTeX `$…$` / `$$…$$` parçalarını çıkarır (matematik içindeki `!` faktöriyel olabilir). */
export function stripMath(text: string): string {
  return text.replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\$[^$\n]*\$/g, ' ');
}

export function lintPromptText(text: string, opts: { toolNames?: readonly string[] } = {}): LintIssue[] {
  const issues: LintIssue[] = [];
  const prose = stripMath(text);
  if (prose.includes('!')) issues.push({ rule: 'no-exclamation', detail: 'metinde ünlem var (matematik dışı)' });
  const emoji = EMOJI.exec(text);
  if (emoji) issues.push({ rule: 'no-emoji', detail: `emoji: ${emoji[0]}` });
  const caps = PRESSURE.exec(text);
  if (caps) issues.push({ rule: 'no-pressure-caps', detail: `baskı dili: ${caps[0]}` });
  for (const re of SCAFFOLDS) {
    const m = re.exec(text);
    if (m) issues.push({ rule: 'no-scaffold', detail: `eski iskele: ${m[0]}` });
  }
  for (const tool of opts.toolNames ?? []) {
    if (new RegExp(`(^|[^A-Za-z0-9_])${tool}([^A-Za-z0-9_]|$)`).test(text)) {
      issues.push({ rule: 'no-tool-names', detail: `sistem metni aracı adıyla anıyor: ${tool}` });
    }
  }
  text.split('\n').forEach((line, i) => {
    if (EXAMPLE_LINE.test(line) && !/örnektir/iu.test(line)) {
      issues.push({ rule: 'examples-labeled', detail: `${i + 1}. satır örnek açıyor ama "örnektir" demiyor: ${line.trim()}` });
    }
  });
  return issues;
}

export function assertLintClean(text: string, where: string, opts: { toolNames?: readonly string[] } = {}): void {
  const issues = lintPromptText(text, opts);
  if (issues.length > 0) {
    throw new PromptError('OGR-PRM-005', `${where}: ${issues.map((i) => `${i.rule} (${i.detail})`).join('; ')}`);
  }
}
