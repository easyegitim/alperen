import { describe, expect, it } from 'vitest';
import { decideRoute, isPublicPath, needsOnboarding, safeNextPath } from '@/lib/routing';
import { areaOfPath, canUseArea, roleHome } from '@/lib/roles';

const base = { authed: true, onboarded: true };

describe('roller', () => {
  it('rol ana sayfaları', () => {
    expect(roleHome('student')).toBe('/ogrenci');
    expect(roleHome('parent')).toBe('/veli');
    expect(roleHome('instructor')).toBe('/egitmen');
    expect(roleHome('admin')).toBe('/egitmen');
  });
  it('alan öneki yoldan bulunur, benzer önekler karışmaz', () => {
    expect(areaOfPath('/ogrenci')).toBe('/ogrenci');
    expect(areaOfPath('/ogrenci/profil/hafiza')).toBe('/ogrenci');
    expect(areaOfPath('/ogrencilik')).toBeNull();
    expect(areaOfPath('/giris')).toBeNull();
  });
  it('yönetici üç alanı da kullanır, diğer roller yalnız kendi alanını', () => {
    expect(canUseArea('admin', '/veli')).toBe(true);
    expect(canUseArea('student', '/veli')).toBe(false);
    expect(canUseArea('parent', '/veli')).toBe(true);
    expect(canUseArea('instructor', '/ogrenci')).toBe(false);
  });
});

describe('decideRoute', () => {
  it('oturumsuz kullanıcı korumalı yolda /giris?next= ile karşılanır', () => {
    expect(decideRoute({ pathname: '/ogrenci/notlarim', authed: false, role: null, onboarded: false })).toEqual({
      type: 'redirect',
      to: `/giris?next=${encodeURIComponent('/ogrenci/notlarim')}`,
    });
    expect(decideRoute({ pathname: '/', authed: false, role: null, onboarded: false })).toEqual({ type: 'redirect', to: '/giris' });
  });
  it('oturumsuz davet bağlantısında sorgu (kod) next içinde korunur', () => {
    expect(decideRoute({ pathname: '/davet', search: '?kod=gi_abc', authed: false, role: null, onboarded: false })).toEqual({
      type: 'redirect',
      to: `/giris?next=${encodeURIComponent('/davet?kod=gi_abc')}`,
    });
  });
  it('/davet oturumluyken kurulum bitmemiş kullanıcıyı /hos-geldin\'e atmaz (sayfa kendisi yönlendirir)', () => {
    expect(decideRoute({ pathname: '/davet', authed: true, role: null, onboarded: false })).toEqual({ type: 'next' });
    expect(decideRoute({ pathname: '/davet', authed: true, role: 'parent', onboarded: false })).toEqual({ type: 'next' });
  });
  it('oturumsuz kullanıcı herkese açık yollarda geçer', () => {
    for (const pathname of ['/giris', '/cevrimdisi', '/api/health', '/auth/callback', '/manifest.webmanifest', '/icons/icon-192.png']) {
      expect(decideRoute({ pathname, authed: false, role: null, onboarded: false })).toEqual({ type: 'next' });
    }
  });
  it('profili olmayan oturumlu kullanıcı /hos-geldin e gider', () => {
    expect(decideRoute({ pathname: '/ogrenci', authed: true, role: null, onboarded: false })).toEqual({ type: 'redirect', to: '/hos-geldin' });
    expect(decideRoute({ pathname: '/hos-geldin', authed: true, role: null, onboarded: false })).toEqual({ type: 'next' });
  });
  it('onboarding tamamlanmamış öğrenci ve veli /hos-geldin e gider; eğitmen gitmez', () => {
    expect(decideRoute({ pathname: '/veli', authed: true, role: 'parent', onboarded: false })).toEqual({ type: 'redirect', to: '/hos-geldin' });
    expect(decideRoute({ pathname: '/ogrenci', authed: true, role: 'student', onboarded: false })).toEqual({ type: 'redirect', to: '/hos-geldin' });
    expect(decideRoute({ pathname: '/egitmen', authed: true, role: 'instructor', onboarded: false })).toEqual({ type: 'next' });
  });
  it('/ ve /giris rol ana sayfasına yönlendirir', () => {
    expect(decideRoute({ ...base, pathname: '/', role: 'student' })).toEqual({ type: 'redirect', to: '/ogrenci' });
    expect(decideRoute({ ...base, pathname: '/giris', role: 'parent' })).toEqual({ type: 'redirect', to: '/veli' });
    expect(decideRoute({ ...base, pathname: '/', role: 'instructor' })).toEqual({ type: 'redirect', to: '/egitmen' });
    expect(decideRoute({ ...base, pathname: '/hos-geldin', role: 'student' })).toEqual({ type: 'redirect', to: '/ogrenci' });
  });
  it('başka rolün alanı kendi ana sayfasına yönlenir', () => {
    expect(decideRoute({ ...base, pathname: '/egitmen/maliyet', role: 'student' })).toEqual({ type: 'redirect', to: '/ogrenci' });
    expect(decideRoute({ ...base, pathname: '/ogrenci', role: 'parent' })).toEqual({ type: 'redirect', to: '/veli' });
    expect(decideRoute({ ...base, pathname: '/veli/raporlar', role: 'instructor' })).toEqual({ type: 'redirect', to: '/egitmen' });
  });
  it('kendi alanında ve yönetici her alanda geçer', () => {
    expect(decideRoute({ ...base, pathname: '/ogrenci/profil', role: 'student' })).toEqual({ type: 'next' });
    expect(decideRoute({ ...base, pathname: '/veli/ayarlar', role: 'admin' })).toEqual({ type: 'next' });
  });
  it('bilinmeyen rol değeri onboarding sayılır', () => {
    expect(needsOnboarding('teacher', true)).toBe(true);
    expect(needsOnboarding(null, true)).toBe(true);
  });
});

describe('safeNextPath ve herkese açık yollar', () => {
  it('yalnız uygulama içi yolları kabul eder', () => {
    expect(safeNextPath('/ogrenci/notlarim')).toBe('/ogrenci/notlarim');
    expect(safeNextPath('/ogrenci?x=1')).toBe('/ogrenci?x=1');
    for (const bad of ['https://kotu.example', '//kotu.example', '/\\kotu', 'javascript:alert(1)', '', null, undefined, '/a\nb']) {
      expect(safeNextPath(bad)).toBe('/');
    }
    expect(safeNextPath('//x', '/giris')).toBe('/giris');
  });
  it('isPublicPath', () => {
    expect(isPublicPath('/giris')).toBe(true);
    expect(isPublicPath('/auth/confirm')).toBe(true);
    expect(isPublicPath('/ogrenci')).toBe(false);
    expect(isPublicPath('/giris/baska')).toBe(false);
  });
});
