"""Öğrenmen PII temizleyici (Python).

LLM'e gidecek metinden kişisel veriyi deterministik kurallarla siler. Aynı kurallar
`packages/pii/ts/src/scrub.ts` içinde TypeScript olarak yazılıdır; iki uygulama
`packages/pii/cases.json` vakalarını birebir aynı çıktıyla geçer ve
`python -m ogrenmen_pii.dump` ile `bun run dump` çıktıları CI'da diff'lenir. Dump,
desen dizgelerini ve kelime listelerini de içerdiği için iki dil arasındaki her
kural sapması diff'te görünür.

Kural sırası (bir kuralın çıktısı sonrakinin girdisidir):
   1. url            → [URL]        (https://, http://, www., t.me/)
   2. email          → [E-POSTA]
   3. iban           → [IBAN]       (TR + 24 hane; 4'lü boşluklu yazım da)
   4. tckn           → [TCKN]       (11 hane + mod-10 denetimi; geçersiz sayı dokunulmaz)
   5. phone          → [TELEFON]    (TR cep: (+90|0)? 5xx xxx xx xx)
   6. username       → [KULLANICI]  (@kullanici; `@hoca` yönlendirme anahtarı hariç)
   7. ad-token hash  → [ÖĞRENCİ] | [EĞİTMEN] | [VELİ] (roleHashes) ya da [AD] (nameHashes)
   8. intro_name     → "adım [AD]"  ("adım X", "benim adım X", "ismim X")
   9. honorific_name → "[AD] Hoca"  ("X Hoca", "X Bey", "X Hanım", "X Öğretmen")
  10. school         → [OKUL]       ("… Anadolu Lisesi", "… Koleji", "… Okulu", "… Ortaokulu" …)
  11. class_section  → [SINIF]      ("11-C", "9/A"; yalnız 9–12, soru/şık bağlamı hariç)

Düz ad listesi asla girdi değildir: adlar `sha256(normalize_token(token))` hex
hash'leriyle gelir (secure.student_pii.name_token_hashes ile aynı türetim; SQL eşleniği
`packages/pii/sql/name_token_hashes.sql`). Girdi önce NFC'ye çevrilir. Hatalı girdi sessizce
geçmez: OGR-SCR-00x hataları (README "Sapma notu"). Matematik
ifadeleri (`3/4`, `x^2`, `√5`, `%20`, `2*sqrt(3)`) ve kazanım adları dokunulmaz;
bilinmeyen özel adlar kaldırılmaz (yanlış pozitif terimleri bozar).
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections.abc import Callable, Iterable, Mapping
from typing import TypedDict

RULES_VERSION = "1.1"

# Temizleyici hata kodları (blueprint'teki OGR-PII-001 `update_student_pii`'ye aittir).
ERROR_CODES: dict[str, str] = {
    "badOptions": "OGR-SCR-001",
    "badHash": "OGR-SCR-002",
    "badRole": "OGR-SCR-003",
    "badText": "OGR-SCR-004",
}

# --- Karakter sınıfları (TS ile birebir aynı dizgeler) ------------------------------
UPPER = "A-ZÇĞİÖŞÜÂÎÛ"
LOWER = "a-zçğıöşüâîû"
LETTERS = UPPER + LOWER

# --- Kelime listeleri (TS ile birebir aynı; dump'a yazılır) ---------------------------
# Büyük harfle başlayan ama ad/okul sözcüğü olmayan cümle başı sözcükleri.
STOP_CAP: tuple[str, ...] = (
    "Acaba", "Adım", "Ama", "Artık", "Az", "Bana", "Belki", "Ben", "Bence", "Beni", "Bir", "Biz",
    "Bu", "Buna", "Bunlar", "Bunu", "Bunun", "Bugün", "Çok", "Çünkü", "Daha", "Dün", "En", "Evet",
    "Galiba", "Hangi", "Hani", "Hayır", "Hep", "Her", "Hiç", "Hoca", "Hocam", "Kim", "Lütfen",
    "Merhaba", "Nasıl", "Ne", "Neden", "O", "Ona", "Onlar", "Onu", "Onun", "Önce", "Peki", "Sana",
    "Selam", "Sen", "Seni", "Siz", "Sonra", "Şimdi", "Şu", "Şuna", "Şunu", "Tamam", "Teşekkürler",
    "Ve", "Veya", "Yani", "Yarın",
)
# "X Hoca" kalıbında X olamayacak branş ve kurum sözcükleri.
SUBJECTS: tuple[str, ...] = (
    "Almanca", "Beden", "Biyoloji", "Branş", "Coğrafya", "Dershane", "Din", "Edebiyat",
    "Eski", "Felsefe", "Fen", "Fizik", "Geometri", "İngilizce", "Kimya", "Kurs", "Lise",
    "Matematik", "Müzik", "Okul", "Özel", "Rehberlik", "Resim", "Sınıf", "Sosyal",
    "Tarih", "Türkçe", "Yeni",
)
# "ismim x" / "benim adım x" kalıbında küçük harfli ad sayılmayacak sözcükler.
LOW_STOP: tuple[str, ...] = (
    "belli", "bu", "da", "de", "gizli", "ile", "mi", "mu", "mı", "mü", "ne", "o",
    "önemli", "şu", "var", "ve", "yok",
)
SCHOOL_WORDS: tuple[str, ...] = (
    "[Ll]isesi", "[Kk]oleji", "[Oo]rtaokulu", "[İi]lkokulu", "[Oo]kulu",
    "[Üü]niversitesi", "[Dd]ershanesi",
)

# class_section'ı soru/şık atfı yapan önceki ya da sonraki sözcükler (kök; çekimli biçimler de eşleşir).
ANSWER_WORDS: tuple[str, ...] = (
    "[Ss]oru", "[Cc]evap", "[Cc]evab", "[Şş]ık", "[Ss]eçene", "[Yy]anıt", "[Mm]adde",
)
# class_section'dan hemen sonra gelince cevap değerlendirmesi sayılan sözcükler ("11-C doğru mu").
VERDICT_WORDS: tuple[str, ...] = ("[Dd]oğru", "[Yy]anlış")

ROLE_LABELS: dict[str, str] = {"ÖĞRENCİ": "student", "EĞİTMEN": "instructor", "VELİ": "guardian"}

# Çıktıdaki replacements sırası (yalnız count > 0 olanlar yazılır) ve yer tutucular.
KINDS: tuple[str, ...] = (
    "url", "email", "iban", "tckn", "phone", "username",
    "student", "instructor", "guardian", "name",
    "intro_name", "honorific_name", "school", "class_section",
)
PLACEHOLDERS: dict[str, str] = {
    "url": "[URL]", "email": "[E-POSTA]", "iban": "[IBAN]", "tckn": "[TCKN]",
    "phone": "[TELEFON]", "username": "[KULLANICI]", "student": "[ÖĞRENCİ]",
    "instructor": "[EĞİTMEN]", "guardian": "[VELİ]", "name": "[AD]",
    "intro_name": "[AD]", "honorific_name": "[AD]", "school": "[OKUL]",
    "class_section": "[SINIF]",
}


def _alt(words: Iterable[str]) -> str:
    return "|".join(words)


_STOP = _alt(STOP_CAP)
_NOT_STOP = rf"(?!(?:{_STOP})(?![{LETTERS}]))"
_NOT_STOP_OR_SUBJECT = rf"(?!(?:{_STOP}|{_alt(SUBJECTS)})(?![{LETTERS}]))"
_CAP_WORD = rf"[{UPPER}][{LOWER}]+"
_WS = r"[ \t\r\n]*"
_PAIR = r"[0-9]{1,3}[ ]?[-/][ ]?[A-Ha-h]"

# --- Desenler (TS ile birebir aynı dizgeler; dump'a yazılır) --------------------------
PATTERNS: dict[str, str] = {
    "url": r"""(?<![A-Za-z0-9@])(?:https?://|www\.|t\.me/)[^ \t\n\r<>"']*[^ \t\n\r<>"'.,;:!?)\]]""",
    "email": r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}",
    "iban": r"(?<![A-Za-z0-9])TR[0-9]{2}(?:[ ]?[0-9]{4}){5}[ ]?[0-9]{2}(?![0-9])",
    "tckn": r"(?<![0-9])[1-9][0-9]{10}(?![0-9])",
    "phone": (
        r"(?<![0-9A-Za-z+])(?:(?:\+90|0)[ -]?)?(?:\(5[0-9]{2}\)|5[0-9]{2})"
        r"[ -]?[0-9]{3}[ -]?[0-9]{2}[ -]?[0-9]{2}(?![0-9])"
    ),
    "username": r"(?<![A-Za-z0-9_.])@(?!hoca(?![A-Za-z0-9_]))[A-Za-z][A-Za-z0-9_]{2,31}(?![A-Za-z0-9_])",
    "token": rf"(?<![{LETTERS}\[])[{LETTERS}]+(?:['’][{LOWER}]+)?",
    "intro_cap": (
        rf"(?<![{LETTERS}])((?:[Bb]enim[ ]+)?[Aa]dım[ ]+|[İi]smim[ ]+){_NOT_STOP}"
        rf"({_CAP_WORD}(?:[ ]+{_NOT_STOP}{_CAP_WORD})?)"
    ),
    "intro_low": (
        rf"(?<![{LETTERS}])((?:[Bb]enim[ ]+[Aa]dım|[İi]smim)[ ]+)"
        rf"(?!(?:{_alt(LOW_STOP)})(?![{LETTERS}]))([{LOWER}]+)"
    ),
    "honorific": (
        rf"(?<![{LETTERS}\[]){_NOT_STOP_OR_SUBJECT}{_CAP_WORD}(?:[ ]+{_NOT_STOP_OR_SUBJECT}{_CAP_WORD})?"
        rf"(?=[ ]+(?:[Hh]oca|Bey(?![{LETTERS}])|Hanım|[Öö]ğretmen))"
    ),
    "school": (
        rf"(?<![{LETTERS}0-9])(?:{_NOT_STOP}(?:[{UPPER}][{LOWER}]*|[0-9]{{1,4}})\.?[ ]+){{1,4}}"
        rf"(?:{_alt(SCHOOL_WORDS)})[{LOWER}]*"
    ),
    "class_section": rf"(?<![{LETTERS}0-9/.,^])(?:1[0-2]|9)[ ]?[-/][ ]?[A-H](?![{LETTERS}0-9])",
    # class_section adayı soru/şık bağlamındaysa dokunulmaz ("Soru 10-A şıkkı", "Cevap: 9-B, 10-C").
    # Önceki metnin sonuna (class_prev) ve sonraki metnin başına (class_next) bakılır.
    "class_prev": (
        rf"(?:^|[^{LETTERS}])(?:{_alt(ANSWER_WORDS)})[{LETTERS}]*{_WS}[:.]?{_WS}$"
        rf"|{_PAIR}{_WS}[,;]{_WS}$"
    ),
    "class_next": (
        rf"^{_WS}(?:[,;]{_WS}{_PAIR}(?![{LETTERS}0-9])|(?:{_alt(ANSWER_WORDS)}|{_alt(VERDICT_WORDS)}))"
    ),
}

_RE: dict[str, re.Pattern[str]] = {k: re.compile(v) for k, v in PATTERNS.items()}
_APOS = re.compile(r"['’]")
_HASH_RE = re.compile(r"[0-9a-fA-F]{64}")

# Ad tokenı katlama tablosu (yerelden bağımsız): İ, I ve ı → i; diğer büyük harfler Türkçe
# küçük karşılığına. Böylece ELIF / ELİF / Elif / elıf aynı hash'i verir. Yalnız LETTERS kümesi
# tanımlıdır; token zaten yalnız bu harflerden oluşur. SQL eşleniği (M02 `app.refresh_name_hashes`,
# `app.staff_name_hashes`): packages/pii/sql/name_token_hashes.sql — düz lower() KULLANILMAZ.
FOLD_FROM = "ABCÇDEFGĞHIİıJKLMNOÖPQRSŞTUÜVWXYZÂÎÛ"
FOLD_TO = "abcçdefgğhiiijklmnoöpqrsştuüvwxyzâîû"
_FOLD_MAP = str.maketrans(FOLD_FROM, FOLD_TO)


class Replacement(TypedDict):
    kind: str
    count: int


class ScrubResult(TypedDict):
    text: str
    replacements: list[Replacement]


def normalize_token(token: str) -> str:
    """Ad tokenı katlama: NFC, sonra FOLD tablosu (İ/I/ı → i, Ç → ç …); tablo dışı karakterler aynen kalır."""
    return unicodedata.normalize("NFC", token).translate(_FOLD_MAP)


def _nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def token_hash(token: str) -> str:
    """Tek ad tokenının hash'i: kesme işaretli ek atılır, küçük harfe çevrilir, sha256 hex."""
    return sha256_hex(normalize_token(_APOS.split(token, maxsplit=1)[0]))


def name_token_hashes(full_name: str) -> list[str]:
    """Tam addan ad-token hash listesi (3+ harfli tokenlar; sıra korunur, tekrar yok).

    `secure.student_pii.name_token_hashes` tetikleyicisi (app.refresh_name_hashes) ve
    Worker FakeDb bununla aynı türetimi kullanır.
    """
    if not isinstance(full_name, str):
        raise TypeError(f"{ERROR_CODES['badText']} ad metni str olmalı")
    out: list[str] = []
    for m in _RE["token"].finditer(_nfc(full_name)):
        base = _APOS.split(m.group(0), maxsplit=1)[0]
        if len(base) < 3:
            continue
        h = sha256_hex(normalize_token(base))
        if h not in out:
            out.append(h)
    return out


def is_valid_tckn(digits: str) -> bool:
    """T.C. kimlik numarası denetimi: 11 hane, ilk hane 0 değil, iki kontrol hanesi."""
    if len(digits) != 11 or any(c not in "0123456789" for c in digits) or digits[0] == "0":
        return False
    d = [ord(c) - 48 for c in digits]
    odd = d[0] + d[2] + d[4] + d[6] + d[8]
    even = d[1] + d[3] + d[5] + d[7]
    if ((odd * 7 - even) % 10 + 10) % 10 != d[9]:
        return False
    return sum(d[:10]) % 10 == d[10]


def _check_hashes(values: object, where: str) -> list[str]:
    if isinstance(values, str) or not isinstance(values, (list, tuple)):
        raise TypeError(f"{ERROR_CODES['badOptions']} {where} bir hash listesi olmalı (list/tuple), tek dizge değil")
    out: list[str] = []
    for h in values:
        if not isinstance(h, str) or not _HASH_RE.fullmatch(h):
            raise ValueError(f"{ERROR_CODES['badHash']} düz ad değil 64 haneli hex sha256 hash bekleniyor ({where})")
        out.append(h.lower())
    return out


def _check_roles(values: object, out: dict[str, str]) -> None:
    if not isinstance(values, Mapping):
        raise TypeError(f"{ERROR_CODES['badOptions']} roleHashes {{hash: rol}} nesnesi olmalı")
    for h, label in values.items():
        if not isinstance(h, str) or not _HASH_RE.fullmatch(h):
            raise ValueError(f"{ERROR_CODES['badHash']} düz ad değil 64 haneli hex sha256 hash bekleniyor (roleHashes)")
        if not isinstance(label, str) or label not in ROLE_LABELS:
            raise ValueError(f"{ERROR_CODES['badRole']} bilinmeyen rol etiketi: {label}")
        out[h.lower()] = label


def _normalize_opts(
    opts: object,
    name_hashes: object,
    role_hashes: object,
) -> tuple[set[str], dict[str, str]]:
    """Seçenekleri doğrular; hatalı girdi sessizce geçmez (PII kapısı kapalı kalır).

    Denetim sırası TS `readOptions` ile aynıdır (hata paritesi cases.json `error_cases`).
    """
    names: list[str] = []
    roles: dict[str, str] = {}
    given = False
    if isinstance(opts, Mapping):
        key = "nameHashes" if "nameHashes" in opts else "name_hashes"
        if key in opts or name_hashes is None:
            names.extend(_check_hashes(opts.get(key), "nameHashes"))
            given = True
        rh = opts.get("roleHashes", opts.get("role_hashes"))
        if rh is not None:
            _check_roles(rh, roles)
    elif isinstance(opts, (list, tuple)):
        names.extend(_check_hashes(opts, "nameHashes"))
        given = True
    elif opts is not None:
        raise TypeError(f"{ERROR_CODES['badOptions']} seçenekler {{nameHashes, roleHashes?}} nesnesi olmalı")
    if name_hashes is not None:
        names.extend(_check_hashes(name_hashes, "name_hashes"))
        given = True
    if not given:
        raise TypeError(f"{ERROR_CODES['badOptions']} nameHashes zorunlu (boş liste olabilir)")
    if role_hashes is not None:
        _check_roles(role_hashes, roles)
    return set(names), roles


def _is_answer_reference(text: str, start: int, end: int) -> bool:
    """class_section adayı soru/şık atfı mı ("Soru 10-A şıkkı", "Cevap: 9-B, 10-C", "11-D doğru mu")?"""
    return _RE["class_prev"].search(text[:start]) is not None or _RE["class_next"].match(text[end:]) is not None


def scrub(
    text: str,
    opts: Mapping[str, object] | list[str] | tuple[str, ...] | None = None,
    *,
    name_hashes: list[str] | tuple[str, ...] | None = None,
    role_hashes: Mapping[str, str] | None = None,
) -> ScrubResult:
    """Metni temizler; `{"text": str, "replacements": [{"kind", "count"}]}` döner.

    `opts` TS ile aynı biçimdedir: `{"nameHashes": [...], "roleHashes": {hash: rol}}`;
    kolaylık için doğrudan hash listesi ya da `name_hashes=`/`role_hashes=` de verilebilir.
    Hash'ler `sha256(normalize_token(token))` hex'tir; roller 'ÖĞRENCİ'|'EĞİTMEN'|'VELİ'.
    """
    if not isinstance(text, str):
        raise TypeError(f"{ERROR_CODES['badText']} metin str olmalı")
    names, roles = _normalize_opts(opts, name_hashes, role_hashes)
    text = _nfc(text)
    counts: dict[str, int] = {k: 0 for k in KINDS}

    def apply(key: str, fn: Callable[[re.Match[str]], tuple[str, str] | None]) -> None:
        nonlocal text

        def inner(m: re.Match[str]) -> str:
            r = fn(m)
            if r is None:
                return m.group(0)
            kind, replacement = r
            counts[kind] += 1
            return replacement

        text = _RE[key].sub(inner, text)

    apply("url", lambda m: ("url", PLACEHOLDERS["url"]))
    apply("email", lambda m: ("email", PLACEHOLDERS["email"]))
    apply("iban", lambda m: ("iban", PLACEHOLDERS["iban"]))
    apply("tckn", lambda m: ("tckn", PLACEHOLDERS["tckn"]) if is_valid_tckn(m.group(0)) else None)
    apply("phone", lambda m: ("phone", PLACEHOLDERS["phone"]))
    apply("username", lambda m: ("username", PLACEHOLDERS["username"]))

    def by_hash(m: re.Match[str]) -> tuple[str, str] | None:
        tok = m.group(0)
        parts = _APOS.split(tok, maxsplit=1)
        base = parts[0]
        if len(base) < 3 or (not names and not roles):
            return None
        suffix = tok[len(base):]
        h = sha256_hex(normalize_token(base))
        label = roles.get(h)
        if label is not None:
            kind = ROLE_LABELS[label]
            return kind, PLACEHOLDERS[kind] + suffix
        if h in names:
            return "name", PLACEHOLDERS["name"] + suffix
        return None

    apply("token", by_hash)
    apply("intro_cap", lambda m: ("intro_name", m.group(1) + PLACEHOLDERS["intro_name"]))
    apply("intro_low", lambda m: ("intro_name", m.group(1) + PLACEHOLDERS["intro_name"]))
    apply("honorific", lambda m: ("honorific_name", PLACEHOLDERS["honorific_name"]))
    apply("school", lambda m: ("school", PLACEHOLDERS["school"]))
    apply(
        "class_section",
        lambda m: None
        if _is_answer_reference(m.string, m.start(), m.end())
        else ("class_section", PLACEHOLDERS["class_section"]),
    )

    return {
        "text": text,
        "replacements": [{"kind": k, "count": counts[k]} for k in KINDS if counts[k] > 0],
    }


def total_replacements(result: ScrubResult) -> int:
    """`bot_responses.pii_replacements` için toplam değişiklik sayısı."""
    return sum(r["count"] for r in result["replacements"])


def config() -> dict[str, object]:
    """Dump ve parite testi için kural yapılandırması (TS `config()` ile aynı)."""
    return {
        "rules_version": RULES_VERSION,
        "kinds": list(KINDS),
        "placeholders": dict(PLACEHOLDERS),
        "stop_cap": list(STOP_CAP),
        "subjects": list(SUBJECTS),
        "low_stop": list(LOW_STOP),
        "school_words": list(SCHOOL_WORDS),
        "answer_words": list(ANSWER_WORDS),
        "verdict_words": list(VERDICT_WORDS),
        "fold_from": FOLD_FROM,
        "fold_to": FOLD_TO,
        "error_codes": dict(ERROR_CODES),
        "patterns": dict(PATTERNS),
    }
