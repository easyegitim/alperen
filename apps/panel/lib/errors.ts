// RPC hata kodları (BLUEPRINT §3.9: `OGR-<ALAN>-<NNN>`; mesajın başı koddur). Arayüz Türkçe, suçlamasız açıklama gösterir.
// OGR-* ad alanı bağlayıcıdır: panel bu kodları yalnız §3.9'daki anlamlarıyla kullanır. Yalnız istemcide doğan hatalar
// (form denetimi, ağ, giriş, bulunamayan kayıt) OGR olmayan `PANEL-*` önekini taşır; sunucuda karşılıkları yoktur (README "Hata kodları").
export class PanelError extends Error {
  readonly code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code} ${detail}` : code);
    this.name = 'PanelError';
    this.code = code;
  }
}

const CODE_RE = /OGR-[A-Z]+-\d{3}|PANEL-[A-Z]+/;

/** PostgREST hata gövdesinden ya da düz mesajdan kodu ayıklar. */
export function codeOf(message: string | null | undefined): string | null {
  const m = CODE_RE.exec(message ?? '');
  return m ? m[0] : null;
}

const TEXTS: Record<string, string> = {
  'OGR-AUTH-001': 'Bu işlem yalnız bot tarafından yapılabilir.',
  'OGR-AUTH-002': 'Bu işlem için yetkin yok.',
  'OGR-AUTH-003': 'Bu ayarı yalnız koordinatör değiştirebilir.',
  'OGR-ALERT-001': 'Uyarı bulunamadı; başka biri kapatmış olabilir.',
  'OGR-CONS-001': 'Bu onay türü panelden girilemez.',
  'OGR-CONS-004': 'Onay yöntemi kâğıt ya da panel olmalı.',
  'OGR-LESSON-001': 'Bu ders raporu için zaten karar verilmiş.',
  'OGR-LESSON-002': 'Ders kaydı için personel bulunamadı.',
  'OGR-PII-001': 'Bu alan düzenlenemez.',
  'OGR-PLAN-001': 'Karar onay ya da geri çekme olmalı.',
  'OGR-PLAN-002': 'Öncelik planı bulunamadı.',
  'OGR-Q-001': 'Soru onaylanamaz: cevap anahtarı ya da şekil denetimi eksik.',
  'OGR-Q-002': 'Soru onaylanamaz: şık kuralı sağlanmıyor.',
  'OGR-Q-003': 'Önce cevap anahtarını gör; anahtar görülmeden onay yok.',
  'OGR-STAFF-001': 'Personel bulunamadı.',
  'OGR-STAFF-002': 'Bu Telegram hesabı bir öğrenciye bağlı.',
  // istemci yerel (OGR değil)
  'PANEL-FORM': 'Form eksik ya da hatalı.',
  'PANEL-NOTFOUND': 'Kayıt bulunamadı; başka biri değiştirmiş olabilir.',
  'PANEL-LINK': 'Bağlantı geçersiz ya da süresi dolmuş.',
  'PANEL-AUTH': 'Giriş yapılamadı; e-posta ve şifreyi kontrol et.',
  'PANEL-NET': 'Sunucuya ulaşılamadı; biraz sonra tekrar dene.',
  'PANEL-DS': 'Arayüz yüklenemedi; sayfayı yenile.',
  'PANEL-ORPHAN': 'Soru kaydedildi ama cevap anahtarı yazılamadı; soru kuyrukta anahtarsız duruyor, koordinatöre bildir.',
};

/** Kullanıcıya gösterilen tek cümle. */
export function errorText(err: unknown): string {
  const code = err instanceof PanelError ? err.code : codeOf(err instanceof Error ? err.message : String(err));
  if (code && TEXTS[code]) return TEXTS[code];
  return code ? `İşlem tamamlanamadı (${code}).` : 'İşlem tamamlanamadı; biraz sonra tekrar dene.';
}
