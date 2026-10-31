"""Ortak yardımcılar: zaman pencereleri, ayar/bayrak okuma, öğrenci eşlemesi, Türkçe sayı biçimi, metin kemerleri.

Zaman kuralları veritabanıyla aynıdır: "gün" Europe/Istanbul takvim günüdür (``check_spend``, ``spend_rollup``);
hafta penceresi ``[başlangıç, başlangıç + 7 gün)``'dür ve ``pilot_metrics.period`` başlangıcın ISO haftasının
pazartesisidir (``pilot_metrics.period`` yorumu: "hesaplanan haftanın pazartesi'si").
"""

from __future__ import annotations

import json
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from ogrenmen_common.adapters.base import DB, gte, in_, lt
from ogrenmen_common.adapters.postgrest import PostgrestDb, filter_params
from ogrenmen_common.clock import ISTANBUL, iso, istanbul_date, parse_ts
from ogrenmen_common.errors import DbError, OgrError
from ogrenmen_contracts import find_forbidden_word, normalize_tr

JUDGEMENT_WORDS = ("depresif", "depresyon", "tembel", "tembellik", "başarısız", "umutsuz", "beceriksiz",
                   "yeteneksiz", "motivasyonsuz")
"""Eğitmen alarmı ve rapor metinlerinde geçmeyecek yargı/tanı etiketleri (``instructor-alert`` şemasının
``x-forbidden-words`` listesini kapsar; yargı yok — "göstergesi düştü")."""

PROPHECY_WORDS = ("tahmin", "çıkacak", "kesin", "garanti")
"""İlke 10 kelimeleri (sınavda "ne çıkacak" kehaneti yok): LLM'in yazdığı olgu, tercih notu ve haftalık özet
metninde geçerse metin yazılmaz."""

MASK = "…"


class KulaklikError(OgrError):
    """Bu modülün hataları (``OGR-KLK-…``)."""


@dataclass(frozen=True)
class Window:
    """Yarı açık tarih penceresi ``[start, end)`` (Europe/Istanbul günleri)."""

    start: date
    end: date

    @property
    def period(self) -> date:
        """``pilot_metrics.period``: başlangıcın haftasının pazartesisi."""
        return self.start - timedelta(days=self.start.weekday())

    @property
    def start_ts(self) -> datetime:
        return istanbul_midnight(self.start)

    @property
    def end_ts(self) -> datetime:
        return istanbul_midnight(self.end)

    def contains(self, value: Any) -> bool:
        if value is None:
            return False
        ts = parse_ts(value)
        return self.start_ts <= ts < self.end_ts

    def label(self) -> str:
        return f"{self.start.isoformat()} – {(self.end - timedelta(days=1)).isoformat()}"


def istanbul_midnight(day: date) -> datetime:
    """``day::timestamp at time zone 'Europe/Istanbul'`` eşleniği (UTC farkında)."""
    return datetime.combine(day, time(0, 0), tzinfo=ISTANBUL)


def parse_day(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise KulaklikError(f"OGR-KLK-001 tarih YYYY-AA-GG biçiminde olmalı: {value}") from exc


def today(now: datetime) -> date:
    return istanbul_date(now)


def week_window(start: date | None, now: datetime) -> Window:
    """``--week`` verilmezse bugünden (Istanbul) önceki 7 gün; verilirse o günden başlayan 7 gün."""
    begin = start if start is not None else today(now) - timedelta(days=7)
    return Window(begin, begin + timedelta(days=7))


def day_window(day: date) -> Window:
    return Window(day, day + timedelta(days=1))


def month_window(month: str) -> Window:
    """``YYYY-AA`` → ayın ilk gününden sonraki ayın ilk gününe."""
    try:
        first = date.fromisoformat(f"{month}-01")
    except ValueError as exc:
        raise KulaklikError(f"OGR-KLK-001 ay YYYY-AA biçiminde olmalı: {month}") from exc
    nxt = date(first.year + (first.month == 12), first.month % 12 + 1, 1)
    return Window(first, nxt)


def select_window(db: DB, table: str, column: str, window: Window, *, where: Mapping[str, Any] | None = None,
                  columns: Sequence[str] | None = None, order: str | Sequence[str] | None = None) -> list[dict]:
    """``column`` penceredeki satırlar (alt sınır veritabanında, üst sınır burada)."""
    cond = dict(where or {})
    cond[column] = gte(iso(window.start_ts))
    if columns is not None and column not in columns:
        columns = (*columns, column)
    rows = db.select(table, where=cond, columns=columns, order=order)
    end = window.end_ts
    return [r for r in rows if r.get(column) is not None and parse_ts(r[column]) < end]


def select_days(db: DB, table: str, column: str, window: Window, *, where: Mapping[str, Any] | None = None,
                columns: Sequence[str] | None = None) -> list[dict]:
    """``date`` sütunu (ör. ``spend_ledger.day``) penceredeki satırlar: ``start <= column < end``
    (tarih karşılaştırması; zaman damgası metni ``date``'e dönüşürken gün kaymasın diye ``YYYY-AA-GG`` gönderilir)."""
    cond = dict(where or {})
    cond[column] = gte(window.start.isoformat())
    if columns is not None and column not in columns:
        columns = (*columns, column)
    rows = db.select(table, where=cond, columns=columns)
    return [r for r in rows if r.get(column) is not None and parse_ts(r[column]).date() < window.end]


def select_before(db: DB, table: str, column: str, before: datetime, *, where: Mapping[str, Any] | None = None,
                  columns: Sequence[str] | None = None) -> list[dict]:
    cond = dict(where or {})
    cond[column] = lt(iso(before))
    return db.select(table, where=cond, columns=columns)


def select_in(db: DB, table: str, column: str, values: Iterable[Any], **kwargs: Any) -> list[dict]:
    vals = list(dict.fromkeys(values))
    if not vals:
        return []
    where = dict(kwargs.pop("where", None) or {})
    where[column] = in_(vals)
    return db.select(table, where=where, **kwargs)


def setting(db: DB, key: str, default: Any = None) -> Any:
    rows = db.select("settings", where={"key": key}, limit=1)
    return rows[0]["value"] if rows else default


def flag(db: DB, key: str, default: Any = None) -> Any:
    rows = db.select("runtime_flags", where={"key": key}, limit=1)
    return rows[0]["value"] if rows else default


def int_setting(db: DB, key: str, default: int) -> int:
    value = setting(db, key, default)
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def float_setting(db: DB, key: str, default: float) -> float:
    value = setting(db, key, default)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def excluded_purposes(db: DB) -> tuple[str, ...]:
    """``runtime_flags.cap_excluded_purposes`` (ders amaçları; sohbet/toplu tavanına sayılmaz)."""
    value = flag(db, "cap_excluded_purposes", None)
    if not isinstance(value, list):
        raise KulaklikError("OGR-KLK-002 runtime_flags.cap_excluded_purposes yok ya da dizi değil")
    return tuple(str(v) for v in value)


@dataclass
class Students:
    """``students`` satırları: uuid ↔ ``public_ref``. Dış çıktıya yalnız ``public_ref`` gider."""

    by_id: dict[str, dict]

    @classmethod
    def load(cls, db: DB) -> Students:
        return cls({str(r["id"]): r for r in db.select("students")})

    def ref(self, student_id: Any) -> str | None:
        row = self.by_id.get(str(student_id)) if student_id is not None else None
        return row["public_ref"] if row else None

    def id_of(self, ref: str) -> str | None:
        for sid, row in self.by_id.items():
            if row.get("public_ref") == ref:
                return sid
        return None

    def active_ids(self) -> list[str]:
        return [sid for sid, r in self.by_id.items() if r.get("status") == "active"]

    def status(self, student_id: Any) -> str | None:
        row = self.by_id.get(str(student_id))
        return row.get("status") if row else None


def tr_number(value: float, digits: int = 2) -> str:
    """Türkçe ondalık: ``3.5`` → ``3,50`` (binlik ayırıcı yok)."""
    return f"{value:.{digits}f}".replace(".", ",")


def tr_usd(value: float | None, digits: int = 2) -> str:
    """``3.0`` → ``3,00 $`` (panel biçimi, §12 #50)."""
    if value is None:
        return "—"
    return f"{tr_number(float(value), digits)} $"


def tr_pct(value: float | None, digits: int = 1) -> str:
    if value is None:
        return "—"
    return f"%{tr_number(100 * float(value), digits)}"


def tr_stamp(value: Any, with_time: bool = False) -> str:
    """``app.tr_stamp`` eşleniği: ``19 Eki`` / ``19 Eki 21:04`` (Europe/Istanbul)."""
    months = ("Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara")
    local = parse_ts(value).astimezone(ISTANBUL)
    text = f"{local.day} {months[local.month - 1]}"
    return f"{text} {local:%H:%M}" if with_time else text


def judgement_word(text: str) -> str | None:
    """Metinde yargı/tanı etiketi varsa ilk eşleşen kelime (Türkçe büyük/küçük harf duyarsız; sözleşme
    ``x-forbidden-words`` denetimiyle aynı eşleme — ``ogrenmen_contracts.find_forbidden_word``)."""
    return find_forbidden_word(str(text), JUDGEMENT_WORDS)


def label_word(text: str) -> str | None:
    """LLM'in yazdığı metinde yargı/tanı etiketi ya da ilke 10 kelimesi (``PROPHECY_WORDS``) varsa ilki."""
    return judgement_word(text) or find_forbidden_word(str(text), PROPHECY_WORDS)


def _stems(word: str) -> list[str]:
    needle = normalize_tr(word)
    return [needle, needle[:-1] + "ğ"] if needle.endswith("k") else [needle]


def mask_words(text: str, words: Sequence[str] = JUDGEMENT_WORDS) -> str:
    """Alıntılanan kullanıcı/LLM metnindeki yasaklı kelimeleri (içinde geçtikleri sözcükle birlikte) ``…`` ile
    değiştirir: ``Neden hep başarısız oluyorum?`` → ``Neden hep … oluyorum?``. Eşleme ``find_forbidden_word`` ile
    aynıdır (Türkçe normalleştirme, k → ğ yumuşaması); şablon metni bu işlemden geçmez, sert denetimdedir."""
    nfc = unicodedata.normalize("NFC", str(text))
    norm: list[str] = []
    index: list[int] = []
    for i, ch in enumerate(nfc):
        for c in normalize_tr(ch):
            norm.append(c)
            index.append(i)
    hay = "".join(norm)
    spans: list[tuple[int, int]] = []
    for word in words:
        for stem in _stems(word):
            if not stem:
                continue
            start = hay.find(stem)
            while start != -1:
                s, e = index[start], index[start + len(stem) - 1] + 1
                while s > 0 and nfc[s - 1].isalnum():
                    s -= 1
                while e < len(nfc) and nfc[e].isalnum():
                    e += 1
                spans.append((s, e))
                start = hay.find(stem, start + 1)
    if not spans:
        return nfc
    merged: list[list[int]] = []
    for s, e in sorted(spans):
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    out, last = [], 0
    for s, e in merged:
        out.append(nfc[last:s])
        out.append(MASK)
        last = e
    out.append(nfc[last:])
    return "".join(out)


def load_name_hashes(path: Path | None) -> list[str]:
    """``--name-hashes`` dosyası: ad-token sha256 hex listesi (düz ad DEĞİL). Dosya yoksa boş liste.

    ``batch_worker`` ``secure`` şemasını göremez; hash listesi kurucunun makinesinde
    ``name_token_hashes`` çıktısından üretilip verilir. Liste olmadan da temizleyici e-posta, telefon, T.C. kimlik,
    IBAN, @kullanıcı, URL, "adım X", okul ve sınıf kalıplarını siler."""
    if path is None:
        return []
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise KulaklikError(f"OGR-KLK-003 ad hash dosyası okunamadı: {path}: {exc}") from exc
    if not isinstance(data, list) or not all(isinstance(h, str) and len(h) == 64 for h in data):
        raise KulaklikError("OGR-KLK-003 ad hash dosyası 64 karakterlik sha256 hex dizisi olmalı (düz ad değil)")
    return [h.lower() for h in data]


def write_text(out: Path, name: str, text: str) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    path = out / name
    path.write_text(text, encoding="utf-8")
    return path


def safe_select(db: DB, table: str, **kwargs: Any) -> list[dict] | None:
    """Tablo/görünüm yoksa (ör. JsonlDb'de görünüm) ya da bu rolün okuma yetkisi yoksa ``None``."""
    try:
        return db.select(table, **kwargs)
    except DbError:
        return None


# --- Dönüşsüz yazımlar (Prefer: return=minimal) ---------------------------------------------------
#
# ``PostgrestDb.insert/update`` her zaman ``return=representation`` gönderir; bu ``RETURNING *`` demektir ve
# ``batch_worker``'ın SELECT yetkisi olmayan sütunlarda (``messages.text_raw``, ``expires_at``) yazımı
# ``permission denied`` ile düşürür (``pilot_metrics`` 0018'e kadar SELECT'siz idi). Bu modül o
# tablolara aşağıdaki yardımcılarla yazar: canlıda isteği ``return=minimal`` ile gönderir; ``insert_minimal`` /
# ``update_minimal`` yöntemi olan bir DB (testlerdeki yetki taklidi) o yöntemle, JsonlDb doğrudan yazar.


def is_duplicate(exc: DbError) -> bool:
    """Birincil anahtar/tekillik çakışması mı (PostgREST 409 / 23505 ya da JsonlDb ``çakışması``)."""
    text = str(exc.message if hasattr(exc, "message") else exc)
    return any(k in text for k in ("23505", " 409", "duplicate key", "çakışması"))


def insert_minimal(db: DB, table: str, rows: Mapping[str, Any] | Sequence[Mapping[str, Any]], *,
                   on_conflict: str | None = None) -> None:
    """``RETURNING`` olmadan ekler (yalnız INSERT yetkisi gerekir; ``on_conflict='merge'`` ayrıca çakışma
    sütunlarında SELECT ister)."""
    body = [dict(rows)] if isinstance(rows, Mapping) else [dict(r) for r in rows]
    custom = getattr(db, "insert_minimal", None)
    if callable(custom):
        custom(table, body, on_conflict=on_conflict)
        return
    if isinstance(db, PostgrestDb):
        db._check_table(table)
        prefer = "return=minimal"
        if on_conflict == "ignore":
            prefer += ",resolution=ignore-duplicates"
        elif on_conflict == "merge":
            prefer += ",resolution=merge-duplicates"
        db._send("POST", table, json=body, prefer=prefer)
        return
    db.insert(table, body, on_conflict=on_conflict)


def update_minimal(db: DB, table: str, values: Mapping[str, Any], *, where: Mapping[str, Any]) -> None:
    """``RETURNING`` olmadan günceller (UPDATE yetkisi + ``where`` sütunlarında SELECT yeterli)."""
    if not where:
        raise DbError("OGR-DB-002 koşulsuz update yapılmaz")
    custom = getattr(db, "update_minimal", None)
    if callable(custom):
        custom(table, dict(values), where=where)
        return
    if isinstance(db, PostgrestDb):
        db._check_table(table)
        db._send("PATCH", table, params=filter_params(where), json=dict(values), prefer="return=minimal")
        return
    db.update(table, values, where=where)

