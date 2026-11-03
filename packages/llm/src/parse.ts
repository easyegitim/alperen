/**
 * Yapılandırılmış çıktı: sözleşme → `output_config.format`, yanıt → doğrulanmış veri.
 *
 * Biçim `@ogrenmen/contracts` `outputFormat(contract)` ile kurulur (strict şemanın JSON Schema'sı, enum/const
 * korunmuş). SDK 1.4'ün `zodOutputFormat` dönüşümü enum ve const kısıtını açıklama metnine taşıyıp dilbilgisinden
 * düşürdüğü için kullanılmaz (P0-C kararı). Yanıt metni JSON olarak çözülür ve sözleşmenin loose şemasıyla
 * (uzunluk/aralık/desen + çapraz kurallar) doğrulanır; sonuç `parsed_output` (geçersizse null).
 *
 * Akış (PLAN-v2 §6 "Durdurma nedenleri"):
 *   - `max_tokens` → bir kez iki kat `max_tokens` ile yeniden (`withMaxTokensRetry`), yine keserse MaxTokensError
 *   - `parsed_output` null → bir onarım turu (hata ayrıntısıyla), yine null ise ParseError (kısmi analiz saklanmaz)
 *   - `refusal` → RefusalError (onarım denenmez)
 */
import type { Contract } from '@ogrenmen/contracts';
import { outputFormat } from '@ogrenmen/contracts';
import type {
  BetaContentBlock,
  BetaJSONOutputFormat,
  BetaMessage,
  BetaMessageParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { RequestBody } from './client.js';
import { MaxTokensError, ParseError, RefusalError } from './errors.js';
import { refusalOf } from './refusal.js';
import { MODEL_MAX_OUTPUT } from './routes.js';

/** `output_config.format` değeri; `parse` işlevi gövde JSON'a çevrilirken düşer (API'ye gitmez). */
export type StructuredFormat<T> = BetaJSONOutputFormat & { parse(text: string): T | null };

export type StructuredResult<T> = { ok: true; data: T; raw: string } | { ok: false; issues: string; raw: string };

/** Modelin JSON çıktısı: son metin bloğu (yapılandırılmış çıktıda tek metin bloğu döner). */
export function lastText(content: readonly BetaContentBlock[]): string | null {
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i];
    if (b && b.type === 'text') return b.text;
  }
  return null;
}

/** Tüm metin blokları (serbest metin rotaları). */
export function allText(content: readonly BetaContentBlock[]): string {
  return content
    .filter((b): b is Extract<BetaContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function formatIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  const lines = issues.slice(0, 8).map((i) => `- ${i.path.map(String).join('.') || '(kök)'}: ${i.message}`);
  if (issues.length > 8) lines.push(`- … ${issues.length - 8} sorun daha`);
  return lines.join('\n');
}

/** Metni sözleşmeyle doğrular. */
export function validateStructured<T>(contract: Contract, text: string | null): StructuredResult<T> {
  if (text === null || text.trim() === '') return { ok: false, issues: '- yanıtta metin bloğu yok', raw: '' };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { ok: false, issues: `- geçerli JSON değil: ${err instanceof Error ? err.message : String(err)}`, raw: text };
  }
  const r = contract.safeParse(json) as { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  return r.success ? { ok: true, data: r.data, raw: text } : { ok: false, issues: formatIssues(r.error.issues), raw: text };
}

/** Sözleşmeden `output_config.format` kurar. */
export function structuredFormat<T>(contract: Contract): StructuredFormat<T> {
  const base = outputFormat(contract);
  return {
    type: 'json_schema',
    schema: base.schema,
    parse: (text: string) => {
      const r = validateStructured<T>(contract, text);
      return r.ok ? r.data : null;
    },
  };
}

/** Yanıttan doğrulanmış veriyi çıkarır (`parsed_output`). */
export function extractStructured<T>(message: Pick<BetaMessage, 'content'>, contract: Contract): StructuredResult<T> {
  return validateStructured<T>(contract, lastText(message.content));
}

/**
 * Asistan içeriğini geri yollanabilir biçime getirir. Ortada bir yedek modele geçiş (fallback bloğu) olduysa son
 * `fallback` bloğundan önceki thinking / redacted_thinking / tool_use / eşsiz server_tool_use blokları atılır
 * (claude-api: "Echoing fallback turns back"). Thinking blokları başka durumda değiştirilmeden geri gider.
 */
export function echoableContent(content: readonly BetaContentBlock[]): BetaContentBlock[] {
  const lastFallback = content.map((b) => b.type).lastIndexOf('fallback');
  if (lastFallback === -1) return [...content];
  const resultIds = new Set(
    content
      .filter((b) => b.type.endsWith('_tool_result'))
      .map((b) => (b as { tool_use_id?: string }).tool_use_id)
      .filter((x): x is string => typeof x === 'string'),
  );
  return content.filter((b, i) => {
    if (i >= lastFallback) return true;
    if (b.type === 'thinking' || b.type === 'redacted_thinking' || b.type === 'tool_use') return false;
    if (b.type === 'server_tool_use') return resultIds.has(b.id);
    return true;
  });
}

export function repairPrompt(issues: string): string {
  return (
    'Önceki yanıtın istenen JSON şemasına uymadı. Sorunlar:\n' +
    `${issues}\n` +
    'Aynı görevi yeniden yap ve yalnız şemaya tam uyan JSON döndür. Uzunluk ve aralık sınırlarına, ' +
    'kimliklerin müfredatta bulunmasına ve alanlar arası kurallara dikkat et.'
  );
}

/** Onarım turu isteği: önceki asistan yanıtı + kullanıcı onarım iletisi sona eklenir (geçmiş değişmez). */
export function repairRequest(body: RequestBody, previous: Pick<BetaMessage, 'content'>, issues: string): RequestBody {
  const messages: BetaMessageParam[] = [
    ...body.messages,
    { role: 'assistant', content: echoableContent(previous.content) as never },
    { role: 'user', content: [{ type: 'text', text: repairPrompt(issues) }] },
  ];
  return { ...body, messages };
}

/** `max_tokens` ile kesilen tek isteği bir kez iki kat sınırla yeniden gönderir. */
export async function withMaxTokensRetry(
  send: (body: RequestBody, attempt: 'initial' | 'max_tokens_retry') => Promise<BetaMessage>,
  body: RequestBody,
  cap: number = MODEL_MAX_OUTPUT,
): Promise<{ message: BetaMessage; body: RequestBody }> {
  const first = await send(body, 'initial');
  if (first.stop_reason !== 'max_tokens') return { message: first, body };
  if (body.max_tokens >= cap) throw new MaxTokensError(body.max_tokens);
  const doubled: RequestBody = { ...body, max_tokens: Math.min(body.max_tokens * 2, cap) };
  const second = await send(doubled, 'max_tokens_retry');
  if (second.stop_reason === 'max_tokens') throw new MaxTokensError(doubled.max_tokens);
  return { message: second, body: doubled };
}

export interface ParseOutcome<T> {
  data: T;
  message: BetaMessage;
  /** Son yanıtı üreten istek. */
  body: RequestBody;
  repaired: boolean;
}

/**
 * Yapılandırılmış çağrı: gönder → (ret ise RefusalError) → doğrula → gerekirse bir onarım turu → ParseError.
 * `send` bir tam turu (araç döngüsü ve max_tokens yeniden denemesi dahil) koşar ve yanıtı üreten isteği döndürür.
 */
export async function parseWithRepair<T>(
  contract: Contract,
  body: RequestBody,
  send: (body: RequestBody, attempt: 'initial' | 'repair') => Promise<{ message: BetaMessage; body: RequestBody }>,
): Promise<ParseOutcome<T>> {
  const first = await send(body, 'initial');
  const ref1 = refusalOf(first.message);
  if (ref1) throw new RefusalError(ref1);
  const r1 = extractStructured<T>(first.message, contract);
  if (r1.ok) return { data: r1.data, message: first.message, body: first.body, repaired: false };

  const second = await send(repairRequest(first.body, first.message, r1.issues), 'repair');
  const ref2 = refusalOf(second.message);
  if (ref2) throw new RefusalError(ref2);
  const r2 = extractStructured<T>(second.message, contract);
  if (r2.ok) return { data: r2.data, message: second.message, body: second.body, repaired: true };
  throw new ParseError(r2.issues, r2.raw);
}
