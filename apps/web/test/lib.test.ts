import { describe, expect, it } from 'vitest';
import { firstName, formatDateTimeTr } from '@/lib/format';
import { memorySortKey, memoryTitle } from '@/lib/memory';
import { INSTRUCTOR_NAV, PARENT_NAV, STUDENT_NAV, isNavActive } from '@/lib/nav';
import { parsePushPayload, safePushUrl } from '@/lib/push-payload';
import { serializeSubscription, urlBase64ToUint8Array } from '@/lib/push';

describe('format', () => {
  it('formatDateTimeTr İstanbul saatiyle yazar', () => {
    expect(formatDateTimeTr('2026-10-19T11:32:00Z')).toBe('19 Eki 14:32');
    expect(formatDateTimeTr('2026-01-02T23:05:00Z', 'UTC')).toBe('2 Oca 23:05');
    expect(formatDateTimeTr('geçersiz')).toBe('');
    expect(formatDateTimeTr(null)).toBe('');
  });
  it('firstName', () => {
    expect(firstName('Ayşe Yılmaz')).toBe('Ayşe');
    expect(firstName('  ')).toBe('');
    expect(firstName(null)).toBe('');
  });
});

describe('hafıza başlıkları', () => {
  it('bilinen dosyalar ve ders dosyaları', () => {
    expect(memoryTitle('/memories/profile.md')).toBe('Seni nasıl tanıyorum');
    expect(memoryTitle('/memories/courses/TYT-MAT.md')).toBe('Ders: TYT-MAT');
    expect(memoryTitle('/memories/ozel.md')).toBe('ozel');
  });
  it('sıralama: profil, hedefler, örüntüler, koç, dersler, diğer, veli özeti', () => {
    const paths = ['/memories/parent_summary.md', '/memories/courses/A.md', '/memories/coach_notes.md', '/memories/profile.md', '/memories/x.md', '/memories/patterns.md', '/memories/goals.md'];
    expect([...paths].sort((a, b) => memorySortKey(a).localeCompare(memorySortKey(b)))).toEqual([
      '/memories/profile.md',
      '/memories/goals.md',
      '/memories/patterns.md',
      '/memories/coach_notes.md',
      '/memories/courses/A.md',
      '/memories/x.md',
      '/memories/parent_summary.md',
    ]);
  });
});

describe('gezinme', () => {
  it('PLAN §13 sekmeleri ve sırası', () => {
    expect(STUDENT_NAV.map((n) => n.label)).toEqual(['Koç', 'Denemeler', 'Notlarım', 'Konu haritası', 'Profil']);
    expect(PARENT_NAV.map((n) => n.label)).toEqual(['Özet', 'Sohbet', 'Raporlar', 'Bildirimler', 'Ayarlar']);
    expect(INSTRUCTOR_NAV.map((n) => n.label)).toEqual(['Öğrenciler', 'Dersler', 'Müfredatlar', 'Soru tarzları', 'İçerik', 'Sınavlar', 'Kuyruk', 'Maliyet', 'Ayarlar']);
  });
  it('kök öğe yalnız tam eşleşmede, diğerleri alt yollarda etkin', () => {
    expect(isNavActive('/ogrenci', '/ogrenci', '/ogrenci')).toBe(true);
    expect(isNavActive('/ogrenci', '/ogrenci/profil', '/ogrenci')).toBe(false);
    expect(isNavActive('/ogrenci/profil', '/ogrenci/profil/hafiza', '/ogrenci')).toBe(true);
    expect(isNavActive('/ogrenci/profil', '/ogrenci/profilx', '/ogrenci')).toBe(false);
  });
});

describe('web-push', () => {
  it('urlBase64ToUint8Array base64url anahtarı çözer', () => {
    // 3 bayt: 0xfb 0xff 0xfe -> "-__-" (base64url)
    expect(Array.from(urlBase64ToUint8Array('-__-'))).toEqual([0xfb, 0xff, 0xfe]);
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array('AQI'))).toEqual([1, 2]);
  });
  it('serializeSubscription anahtarları ayıklar', () => {
    const sub = { toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'P', auth: 'A' } }) };
    expect(serializeSubscription(sub)).toEqual({ endpoint: 'https://push.example/abc', p256dh: 'P', auth: 'A' });
    expect(serializeSubscription({ toJSON: () => ({ endpoint: 'x' }) })).toBeNull();
  });
  it('parsePushPayload güvenli varsayılanlara düşer', () => {
    expect(parsePushPayload(JSON.stringify({ title: 'Haftalık özet', body: 'Hazır', url: '/veli/raporlar', tag: 'weekly' }))).toEqual({
      title: 'Haftalık özet',
      body: 'Hazır',
      url: '/veli/raporlar',
      tag: 'weekly',
    });
    expect(parsePushPayload(null).title).toBe('Öğrenmen');
    expect(parsePushPayload('düz metin').body).toBe('düz metin');
    expect(parsePushPayload(JSON.stringify({ title: 'x', url: 'https://kotu.example' })).url).toBe('/');
  });
  it('safePushUrl dış kökeni reddeder', () => {
    expect(safePushUrl('/ogrenci')).toBe('/ogrenci');
    expect(safePushUrl('//kotu.example')).toBe('/');
    expect(safePushUrl(42)).toBe('/');
  });
});
