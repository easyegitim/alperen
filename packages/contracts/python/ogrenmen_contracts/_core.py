"""Çalışma zamanı çekirdeği — ``src/runtime/core.js`` eşleniği (aynı vaka dosyalarıyla sınanır).

* Türkçe duyarlı normalleştirme ve ``x-forbidden-words`` denetimi,
* JSON Schema biçimleri (uuid, date, date-time, uri) — ajv-formats "full" kipiyle aynı karar,
* ``pattern`` anahtar kelimesinin JavaScript (Ajv, ``u`` bayrağı) anlamıyla aranması.
"""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from typing import Any

# --- Türkçe normalleştirme ve yasaklı kelimeler ---


def normalize_tr(text: str) -> str:
    """NFC, İ→i, I→ı, küçük harf, U+0307 silinir, ı→i (core.js ``ogrNormalizeTr``)."""
    text = unicodedata.normalize("NFC", text)
    text = text.replace("İ", "i").replace("I", "ı").lower()
    return text.replace("̇", "").replace("ı", "i")


def forbidden_stems(word: str) -> list[str]:
    """Aranacak biçimler: normalize kelime ve "k" ile bitiyorsa k → ğ yumuşamış gövde
    (core.js ``ogrForbiddenStems``; "çıkacak" → "çıkacağ")."""
    needle = normalize_tr(word)
    if not needle:
        return []
    return [needle, needle[:-1] + "ğ"] if needle.endswith("k") else [needle]


def contains_forbidden(text: str, word: str) -> bool:
    """``word`` normalize edilmiş metnin herhangi bir yerinde geçiyor mu (düz alt dize;
    core.js ``ogrContainsForbidden``)."""
    hay = normalize_tr(text)
    return any(stem in hay for stem in forbidden_stems(word))


def find_forbidden_word(data: Any, words: list[str] | tuple[str, ...]) -> str | None:
    """Verideki ilk yasaklı kelime (listedeki yazımıyla) ya da None; anahtarlar taranmaz."""
    if isinstance(data, str):
        for w in words:
            if contains_forbidden(data, w):
                return w
        return None
    if isinstance(data, list):
        for item in data:
            hit = find_forbidden_word(item, words)
            if hit is not None:
                return hit
        return None
    if isinstance(data, dict):
        for value in data.values():
            hit = find_forbidden_word(value, words)
            if hit is not None:
                return hit
    return None


# --- Biçimler (format) ---

_UUID = re.compile(r"^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\Z", re.I | re.A)
_DATE = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})\Z", re.A)
_DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
_TIME = re.compile(
    r"^([0-9]{2}):([0-9]{2}):([0-9]{2}(?:\.[0-9]+)?)(z|([+-])([0-9]{2})(?::?([0-9]{2}))?)?\Z", re.I | re.A
)
_NOT_URI_FRAGMENT = re.compile(r"/|:")
_URI = re.compile(
    r"^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?\Z",
    re.I | re.A,
)
_DT_SEPARATOR = re.compile(r"t|\s", re.I)


def _is_leap_year(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def format_date(value: str) -> bool:
    m = _DATE.match(value)
    if not m:
        return False
    year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not 1 <= month <= 12 or day < 1:
        return False
    return day <= (29 if month == 2 and _is_leap_year(year) else _DAYS[month])


def format_time(value: str) -> bool:
    m = _TIME.match(value)
    if not m:
        return False
    hr, mi, sec = int(m.group(1)), int(m.group(2)), float(m.group(3))
    tz = m.group(4)
    tz_sign = -1 if m.group(5) == "-" else 1
    tz_h = int(m.group(6) or 0)
    tz_m = int(m.group(7) or 0)
    if tz_h > 23 or tz_m > 59 or not tz:
        return False
    if hr <= 23 and mi <= 59 and sec < 60:
        return True
    utc_min = mi - tz_m * tz_sign
    utc_hr = hr - tz_h * tz_sign - (1 if utc_min < 0 else 0)
    return utc_hr in (23, -1) and utc_min in (59, -1) and sec < 61


def format_date_time(value: str) -> bool:
    parts = _DT_SEPARATOR.split(value)
    return len(parts) == 2 and format_date(parts[0]) and format_time(parts[1])


def format_uuid(value: str) -> bool:
    return _UUID.match(value) is not None


def format_uri(value: str) -> bool:
    return _NOT_URI_FRAGMENT.search(value) is not None and _URI.match(value) is not None


FORMATS = {
    "date": format_date,
    "date-time": format_date_time,
    "uri": format_uri,
    "uuid": format_uuid,
}


# --- pattern: JavaScript anlamıyla arama ---


@lru_cache(maxsize=512)
def js_pattern(pattern: str) -> re.Pattern[str]:
    """ECMAScript ``u`` kipindeki deseni Python'a çevirir: ``$`` yalnız metnin sonunda
    eşleşir (Python ``$`` sondaki satır sonundan önce de eşleşir) ve ``\\d`` yalnız ASCII."""
    out: list[str] = []
    i = 0
    in_class = False
    while i < len(pattern):
        ch = pattern[i]
        if ch == "\\" and i + 1 < len(pattern):
            nxt = pattern[i + 1]
            if nxt == "d":
                out.append("0-9" if in_class else "[0-9]")
            elif nxt == "D" and not in_class:
                out.append("[^0-9]")
            else:
                out.append(ch + nxt)
            i += 2
            continue
        if in_class:
            if ch == "]":
                in_class = False
            out.append(ch)
        elif ch == "[":
            in_class = True
            out.append(ch)
            if pattern[i + 1 : i + 2] == "^":
                out.append("^")
                i += 1
            if pattern[i + 1 : i + 2] == "]":
                out.append("\\]")
                i += 1
        elif ch == "$":
            out.append(r"\Z")
        else:
            out.append(ch)
        i += 1
    return re.compile("".join(out))


def js_pattern_search(pattern: str, value: str) -> bool:
    return js_pattern(pattern).search(value) is not None
