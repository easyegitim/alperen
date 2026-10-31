import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buttons, START_SENTENCE, texts } from '../../src/texts.ts';
import { lineCount } from '../../src/telegram/format.ts';
import { MAX_LABEL } from '../../src/telegram/keyboard.ts';

const EMOJI = /(?:\p{Extended_Pictographic}|[\u{1F300}-\u{1FAFF}]|\u{FE0F})/u;
const SAMPLE_ARGS: unknown[] = [12, 25, 3, 5, 'örnek', 'örnek', 2];

/** texts nesnesindeki her metni (işlevleri örnek argümanlarla çağırarak) toplar. */
function allTexts(node: unknown, path = 'texts'): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]];
  if (typeof node === 'function') {
    const fn = node as (...a: unknown[]) => unknown;
    const variants: unknown[][] = [SAMPLE_ARGS.slice(0, fn.length).map((a, i) => (typeof a === 'number' ? a : `örnek${i}`)), Array(fn.length).fill(null)];
    const out: Array<[string, string]> = [];
    for (const args of variants) {
      try {
        const v = fn(...args);
        if (typeof v === 'string') out.push([`${path}()`, v]);
      } catch {
        /* null argüman kabul etmeyen işlev */
      }
    }
    return out;
  }
  if (Array.isArray(node)) return node.flatMap((v, i) => allTexts(v, `${path}[${i}]`));
  if (typeof node === 'object' && node !== null) return Object.entries(node).flatMap(([k, v]) => allTexts(v, `${path}.${k}`));
  return [];
}

describe('texts', () => {
  const entries = allTexts(texts);

  it('emoji ve ünlem yok; her mesaj ≤ 4 satır', () => {
    expect(entries.length).toBeGreaterThan(60);
    for (const [path, t] of entries) {
      expect(t.includes('!'), path).toBe(false);
      expect(EMOJI.test(t), path).toBe(false);
      expect(lineCount(t), path).toBeLessThanOrEqual(4);
    }
  });

  it('dosyada ünlem karakteri hiç yok (kabul komutu eşleniği)', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/texts.ts', import.meta.url)), 'utf8');
    expect(/[!\u{1F300}-\u{1FAFF}]/u.test(src)).toBe(false);
  });

  it('düğmeler ≤ 20 karakter', () => {
    for (const [k, v] of Object.entries(buttons)) expect(Array.from(v).length, k).toBeLessThanOrEqual(MAX_LABEL);
  });

  it('/start cümlesi birebir (telegram.md)', () => {
    expect(START_SENTENCE).toBe("Merhaba, ben Öğrenmen. easy'nin yapay zekâ öğretmeniyim; hocaların da bu grupta.");
    expect(texts.start).toBe(START_SENTENCE);
  });

  it('BLUEPRINT §5.2–§5.4 sabit metinleri', () => {
    expect(texts.degraded).toBe('Şu an yanıt veremiyorum; birkaç dakika sonra tekrar dene. Acilse hocanı etiketleyebilirsin.');
    expect(texts.quotaFull(25)).toBe("Bugünlük mesaj hakkın doldu (25/25). Yarın 00:00'da yenilenir. Acil bir sorun varsa hocanı etiketleyebilirsin.");
    expect(texts.quotaWarn(5)).toBe("5 mesaj hakkın kaldı; yarın 00:00'da yenilenir.");
    expect(texts.kota(12, 25, 1, 5)).toBe("Bugün 12/25 mesaj, 1/5 test kullandın. Yarın 00:00'da yenilenir.");
    expect(texts.durdur).toBe('Hatırlatmaları kapattım. /baslat ile yeniden açabilirsin.');
    expect(texts.practiceEmpty).toBe('Bugün için uygun pratik sorusu kalmadı; hocan yeni soru ekleyince haber vereceğim.');
    expect(texts.cevapNone).toBe('Şu an açık bir soru yok; bir soru sor, sonra /cevap yazabilirsin.');
    expect(texts.unsure).toBe('Bundan emin değilim; hocana soralım.');
    expect(texts.staffQuotaFull).toBe('Bugünlük soru hakkınız doldu; yarın yenilenir.');
    expect(texts.diagOffer).toBe('Seni tanımak için 20 soruluk kısa bir test var. Başlayalım mı?');
  });

  it('aydınlatma metninin çocuk dili paragrafı texts.ts\'te yok (DB\'den okunur)', () => {
    const joined = entries.map(([, t]) => t).join('\n');
    expect(joined).not.toContain('Verilerin nasıl kullanılıyor?** Yazdıklarını');
    expect(joined).not.toContain('ogrenmen:cocuk-dili');
  });

  it('öncelik metinlerinde yasak kelime yok', () => {
    const o = [texts.oncelikHead('TYT-MAT', 'YKS 2027', 3), texts.oncelikNote, texts.oncelikNone].join('\n');
    expect(/(tahmin|çıkacak|kesin|garanti)/iu.test(o)).toBe(false);
  });
});
