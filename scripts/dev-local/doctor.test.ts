import { describe, expect, test } from 'bun:test';
import { classifyAnthropicStatus, describeKey, formatReport, maskUrl, PYTHON_PACKAGES_CHECK, PYTHON_PACKAGES_FIX, pythonCmd, versionAtLeast, type CheckResult } from './doctor';

describe('doctor biçimi', () => {
  test('anahtar tarifi değeri sızdırmaz', () => {
    const d = describeKey('  sk-ant-api03-GIZLI  ');
    expect(d).toEqual({ present: true, length: 18, prefixOk: true });
    expect(JSON.stringify(d)).not.toContain('GIZLI');
    expect(describeKey('').present).toBe(false);
    expect(describeKey('abc').prefixOk).toBe(false);
  });

  test('anthropic durum kodları ayrışır', () => {
    expect(classifyAnthropicStatus(200).level).toBe('ok');
    expect(classifyAnthropicStatus(401).level).toBe('fail');
    expect(classifyAnthropicStatus(401).fix?.length).toBeGreaterThan(0);
    expect(classifyAnthropicStatus(null).detail).toContain('ağ');
    expect(classifyAnthropicStatus(500).level).toBe('warn');
    expect(classifyAnthropicStatus(402).fix?.join(' ')).toContain('Billing');
    const credit = classifyAnthropicStatus(400, '{"error":{"message":"Your credit balance is too low"}}');
    expect(credit.level).toBe('warn');
    expect(credit.detail).toContain('kredi');
  });

  test('python kontrolü worker ile aynı kipte (-I), --user önerilmez', () => {
    expect(PYTHON_PACKAGES_CHECK[0]).toBe('-I');
    const fixes = PYTHON_PACKAGES_FIX.filter((f) => !f.startsWith('Not:'));
    expect(fixes.some((f) => f.includes('--user'))).toBe(false);
    expect(fixes.join('\n')).toContain('python3-sympy');
    const saved = process.env.OGRENMEN_PYTHON;
    process.env.OGRENMEN_PYTHON = ' /opt/py/bin/python3 ';
    expect(pythonCmd()).toBe('/opt/py/bin/python3');
    delete process.env.OGRENMEN_PYTHON;
    expect(pythonCmd()).toBe('python3');
    if (saved !== undefined) process.env.OGRENMEN_PYTHON = saved;
  });

  test('sürüm karşılaştırma', () => {
    expect(versionAtLeast('1.4.2', [1, 4])).toBe(true);
    expect(versionAtLeast('v22.3.1', [22, 0])).toBe(true);
    expect(versionAtLeast('v20.1.0', [22, 0])).toBe(false);
    expect(versionAtLeast('', [1, 4])).toBe(false);
  });

  test('rapor: işaretler, çözüm satırları ve çıkış kodu', () => {
    const results: CheckResult[] = [
      { name: 'bun', level: 'ok', detail: '1.4.2' },
      { name: 'ffmpeg', level: 'warn', detail: 'yok', fix: ['brew install ffmpeg'] },
      { name: 'psql', level: 'fail', detail: 'yok', fix: ['brew install libpq'] },
    ];
    const { text, exitCode } = formatReport(results);
    expect(exitCode).toBe(1);
    expect(text).toContain('✓ bun: 1.4.2');
    expect(text).toContain('! ffmpeg: yok');
    expect(text).toContain('✕ psql: yok');
    expect(text).toContain('    brew install libpq');
    expect(text).toContain('1 zorunlu eksik');
    expect(formatReport(results.slice(0, 2)).exitCode).toBe(0);
    expect(formatReport(results.slice(0, 1)).text).toContain('her şey hazır');
  });

  test('adreste parola gizlenir', () => {
    expect(maskUrl('postgresql://u:sifre@h:5432/db')).toBe('postgresql://u:***@h:5432/db');
  });
});
