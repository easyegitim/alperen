/**
 * Sahte LLM'de (OGRENMEN_LLM=fake: E2E, yerel geliştirme) koçun belge isteğini tanıması: öğrencinin cümlesinden
 * `request_document` çağrısı ve ardından tek cümlelik yanıt sıraya konur. Gerçek modelde kullanılmaz (araç açıklaması
 * modeli yönlendirir); amaç uçtan uca akışı (Koç → istek → kart → Bugün → Belge) anahtarsız sınamak.
 */
import type { FakeTransport, RequestDocumentInput } from '@ogrenmen/llm';

const ASK = /(iste|isti|hazırla|oluştur|çıkar|ver)/i;

/** Cümleden belge isteği (saf; testli). Tanımazsa null. */
export function detectDocumentRequest(text: string): RequestDocumentInput | null {
  const t = text.trim();
  if (!ASK.test(t)) return null;
  const count = /(\d{1,3})\s*soru/i.exec(t);
  if (/deneme/i.test(t)) {
    return { kind: 'mock_exam', question_count: count ? Number(count[1]) : 40, ...(topicBefore(t, /deneme/i) ? { topic: topicBefore(t, /deneme/i) as string } : {}) };
  }
  if (/\bnot(u|um|lar)?\b/i.test(t)) {
    const topic = topicBefore(t, /\bnot/i);
    return topic ? { kind: 'notes', topic } : null;
  }
  if (count) {
    const topic = topicBefore(t, /\d+\s*soru/i);
    return topic ? { kind: 'question_set', topic, question_count: Number(count[1]) } : null;
  }
  return null;
}

function topicBefore(text: string, marker: RegExp): string | undefined {
  const m = marker.exec(text);
  if (!m) return undefined;
  const raw = text
    .slice(0, m.index)
    .replace(/\d+\s*soruluk?/gi, '')
    .replace(/\b(bana|bir|lütfen|şu|bu)\b/gi, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return raw.length > 0 && raw.length <= 120 ? raw : undefined;
}

export function fakeCoachScript(transport: FakeTransport, route: string, text: string): void {
  const input = detectDocumentRequest(text);
  if (!input) return;
  transport.enqueue(route, { toolUses: [{ name: 'request_document', input }] }, { text: 'Tamam, hazırlıyorum. Hazır olunca Bugün’de görürsün.' });
}
