// Öğrenmen sözleşmeleri — çalışma zamanı çekirdeği (bağımlılıksız, düz ESM JavaScript).
//
// Bu dosya iki yerde kullanılır:
//   1. src/forbidden-words.ts ve src/index.ts doğrudan içe alır;
//   2. scripts/gen.ts metnini olduğu gibi src/generated/validators.js içine gömer
//      (Ajv standalone kodu böylece hiçbir require/import taşımaz; Worker yalnız onu yükler).
// Bu yüzden dosyada yalnız "export function" / "export const" bildirimleri bulunur ve
// başka modül içe alınmaz. Python eşleniği: python/ogrenmen_contracts/_core.py.

/**
 * Türkçe duyarlı küçük harfe çevirme ve İ/ı katlama: "TAHMİN", "TAHMIN", "tahmin"
 * aynı metne iner. Sıra: NFC, İ→i, I→ı, küçük harf, birleşik nokta (U+0307) silinir, ı→i.
 */
export function ogrNormalizeTr(text) {
  return text
    .normalize('NFC')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/̇/g, '')
    .replace(/ı/g, 'i');
}

/**
 * Yasaklı kelimenin aranacak biçimleri: normalize edilmiş kelime ve kelime "k" ile bitiyorsa
 * ünsüz yumuşaması (k → ğ) uğramış gövdesi ("çıkacak" → "çıkacağ": "çıkacağı", "çıkacağını").
 */
export function ogrForbiddenStems(word) {
  const needle = ogrNormalizeTr(word);
  if (needle.length === 0) return [];
  return needle.endsWith('k') ? [needle, needle.slice(0, -1) + 'ğ'] : [needle];
}

/**
 * Kelime normalize edilmiş metnin herhangi bir yerinde geçiyor mu (BLUEPRINT §4: "geçerse"
 * düşer). Düz alt dize araması: "tahminen", "öntahmin", "TAHMİN" hepsi yakalanır.
 */
export function ogrContainsForbidden(text, word) {
  const hay = ogrNormalizeTr(text);
  for (const stem of ogrForbiddenStems(word)) {
    if (hay.includes(stem)) return true;
  }
  return false;
}

/**
 * x-forbidden-words denetimi: verideki tüm metin DEĞERLERİNİ (anahtarlar hariç) derinlik
 * öncelikli gezer; ilk eşleşen yasaklı kelimeyi (listedeki yazımıyla) döner, yoksa null.
 */
export function ogrFindForbiddenWord(data, words) {
  if (typeof data === 'string') {
    for (const w of words) {
      if (ogrContainsForbidden(data, w)) return w;
    }
    return null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const hit = ogrFindForbiddenWord(item, words);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (data !== null && typeof data === 'object') {
    for (const key of Object.keys(data)) {
      const hit = ogrFindForbiddenWord(data[key], words);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/** Dizenin kod noktası sayısı (Ajv runtime/ucs2length ile aynı; Python len() ile eşit). */
export function ogrUcs2length(str) {
  const len = str.length;
  let length = 0;
  let pos = 0;
  let value;
  while (pos < len) {
    length++;
    value = str.charCodeAt(pos++);
    if (value >= 0xd800 && value <= 0xdbff && pos < len) {
      value = str.charCodeAt(pos);
      if ((value & 0xfc00) === 0xdc00) pos++;
    }
  }
  return length;
}

// --- Biçimler (format): ajv-formats "full" kipinin uuid/date/date-time/uri tanımlarıyla aynı ---

const OGR_UUID = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const OGR_DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
const OGR_DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const OGR_TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
const OGR_NOT_URI_FRAGMENT = /\/|:/;
const OGR_URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;

function ogrIsLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** RFC 3339 full-date (YYYY-MM-DD; artık yıl denetimli). */
export function ogrFormatDate(str) {
  const m = OGR_DATE.exec(str);
  if (!m) return false;
  const year = +m[1];
  const month = +m[2];
  const day = +m[3];
  return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && ogrIsLeapYear(year) ? 29 : OGR_DAYS[month]);
}

/** RFC 3339 saat; saat dilimi zorunlu (z ya da ±hh:mm). */
export function ogrFormatTime(str) {
  const m = OGR_TIME.exec(str);
  if (!m) return false;
  const hr = +m[1];
  const min = +m[2];
  const sec = +m[3];
  const tz = m[4];
  const tzSign = m[5] === '-' ? -1 : 1;
  const tzH = +(m[6] || 0);
  const tzM = +(m[7] || 0);
  if (tzH > 23 || tzM > 59 || !tz) return false;
  if (hr <= 23 && min <= 59 && sec < 60) return true;
  const utcMin = min - tzM * tzSign;
  const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
  return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
}

/** RFC 3339 date-time (ayraç t, T ya da boşluk). */
export function ogrFormatDateTime(str) {
  const parts = str.split(/t|\s/i);
  return parts.length === 2 && ogrFormatDate(parts[0]) && ogrFormatTime(parts[1]);
}

/** UUID (RFC 4122 biçimi; büyük/küçük harf duyarsız). */
export function ogrFormatUuid(str) {
  return OGR_UUID.test(str);
}

/** Mutlak URI (RFC 3986). */
export function ogrFormatUri(str) {
  return OGR_NOT_URI_FRAGMENT.test(str) && OGR_URI.test(str);
}

/** Şemalarda kullanılan biçimlerin tamamı; standalone doğrulayıcılar bu nesneyi kullanır. */
export const ogrFormats = {
  date: ogrFormatDate,
  'date-time': ogrFormatDateTime,
  uri: ogrFormatUri,
  uuid: ogrFormatUuid,
};
