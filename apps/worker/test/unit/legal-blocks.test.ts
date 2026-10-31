import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fillDays, legalBlock, markedBlock } from '../../src/router/legal-blocks.ts';
import { extractChildBlock, extractConsentSummary } from '../../src/router/commands/gizlilik.ts';

const doc = (name: string): string => readFileSync(fileURLToPath(new URL(`../../../../docs/hukuk/${name}.md`, import.meta.url)), 'utf8');
/** export-sql.py'nin yaptığı gibi yer tutucu yükleme anında 90'a çözülür. */
const resolved = (name: string): string => doc(name).replaceAll('{{RETENTION_MESSAGES_DAYS}}', '90');

describe('legal-blocks', () => {
  it('grup-kayit-kisa: belgenin tamamı değil kısa blok; gün gönderim anındaki değer', () => {
    const body = resolved('grup-kayit-bildirimi');
    const t = legalBlock(body, 'grup-kayit-kisa', 60, 'grup_kayit') ?? '';
    expect(t.split('\n').length).toBeLessThanOrEqual(4);
    expect(t).toContain('60 gün sonra silinir');
    expect(t).not.toMatch(/90|HUKUKİ|<!--|Uzun sürüm/);
  });

  it('onay-ozeti ve cocuk-dili blokları; ham {{…}} kalırsa null', () => {
    const body = resolved('aydinlatma-metni');
    expect(extractConsentSummary(body, 60)).toContain('60 gün sonra siler');
    expect((extractConsentSummary(body, 90) ?? '').split('\n').length).toBe(4);
    expect(extractChildBlock(body)).not.toBeNull();
    expect(markedBlock('metin', 'onay-ozeti')).toBeNull();
    expect(extractConsentSummary('işaretsiz gövde', 90)).toBeNull();
    expect(legalBlock(doc('grup-kayit-bildirimi').replace('{{RETENTION_MESSAGES_DAYS}}', '{{BILINMEYEN}}'), 'grup-kayit-kisa', 60, 'grup_kayit')).toBeNull();
  });

  it('fillDays: {days} ve çözülmüş "N gün sonra silinir" değişir; başka sayılar değişmez', () => {
    expect(fillDays('{days} gün sonra silinir', 60)).toBe('60 gün sonra silinir');
    expect(fillDays('Mesajlar 90 gün sonra silinir; 4 satır.', 60)).toBe('Mesajlar 60 gün sonra silinir; 4 satır.');
  });
});
