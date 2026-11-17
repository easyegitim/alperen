"""Kalem ortak yardımcıları: hata kodları, ders/kaynak/madde okuma, Türkçe normalize, deterministik kimlik.

Hata kodları (``OGR-KALEM-NNN``):

* ``001`` ders bulunamadı · ``002`` sınav kaynağı bulunamadı · ``003`` PDF okunamadı/boş/çok uzun/çok büyük
* ``004`` öncelik planı için en az iki yılın arşivi gerekir · ``005`` plan yok ya da onaylı değil
* ``006`` dersin müfredat eşlemesi yok (``courses.curriculum_id``) · ``007`` izlence geçersiz
* ``008`` OCR çıktısı geçersiz ya da madde yok · ``009`` bilinmeyen müfredat kodu
* ``010`` plan sözleşmeden geçmedi (``x-forbidden-words`` dahil) · ``011`` girdi/depolama ya da beklenmeyen hata
"""

from __future__ import annotations

import hashlib
import json
import math
import unicodedata
import uuid
from collections.abc import Iterable, Mapping, Sequence
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

import ogrenmen_contracts as contracts
from ogrenmen_common.adapters.base import DB, insert_minimal, update_minimal
from ogrenmen_common.clock import iso
from ogrenmen_common.errors import OgrError

NAMESPACE_OGRENMEN = uuid.uuid5(uuid.NAMESPACE_DNS, "ogrenmen.easy")
"""fixtures/README.md ile aynı ad alanı (deterministik kimlikler)."""
SELECT_CHUNK = 100
"""``in`` sorgularında tek istekteki en çok değer (PostgREST URL uzunluğu)."""
ITEM_COLUMNS = ("id", "source_id", "item_no", "topic", "kind", "points", "curriculum_id", "skill_id", "ocr_text",
                "embedding", "cluster_id")

__all__ = ["KalemError", "NAMESPACE_OGRENMEN", "insert_minimal", "update_minimal"]


class KalemError(OgrError):
    """Kalem hatası; mesaj ``OGR-KALEM-NNN …`` ile başlar (``run_main`` tek satır Türkçe hata yazar)."""


def stable_uuid(kind: str, *parts: Any) -> str:
    """``uuid5(NAMESPACE_OGRENMEN, "<tür>:<parça>:…")`` — aynı girdi → aynı kimlik."""
    key = ":".join([kind, *(str(p) for p in parts)])
    return str(uuid.uuid5(NAMESPACE_OGRENMEN, key))


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


_TR_LOWER = str.maketrans({"I": "ı", "İ": "i"})


def tr_lower(text: str) -> str:
    """Türkçe küçük harf (``I → ı``, ``İ → i``)."""
    return unicodedata.normalize("NFC", str(text)).translate(_TR_LOWER).lower()


def norm_topic(text: Any) -> str:
    """Konu karşılaştırma anahtarı: Türkçe küçük harf, tire/noktalama → boşluk, tek boşluk."""
    low = tr_lower(str(text or ""))
    out = "".join(ch if ch.isalnum() else " " for ch in low)
    return " ".join(out.split())


def sort_key_tr(text: str) -> tuple:
    """Türkçe alfabeye yakın deterministik sıralama anahtarı (ç, ğ, ı, ö, ş, ü kendi harflerinin ardında)."""
    order = "abcçdefgğhıijklmnoöprsştuüvyz"
    low = tr_lower(text)
    return tuple((order.index(ch) if ch in order else 100 + ord(ch)) for ch in low)


def round_half_up(value: float) -> int:
    """``round(avg)`` insan beklentisiyle (4,5 → 5; Python'un bankacı yuvarlaması değil, SQL ``round`` gibi)."""
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def now_iso(clock) -> str:  # noqa: ANN001 - Clock çağrılabilir
    return iso(clock())


def chunked(values: Sequence[Any], size: int = SELECT_CHUNK) -> Iterable[list[Any]]:
    for i in range(0, len(values), size):
        yield list(values[i:i + size])


def select_in(db: DB, table: str, column: str, values: Iterable[Any], *, columns: Sequence[str] | None = None,
              order: str | None = None) -> list[dict]:
    """``column in (…)`` — parça parça (boş liste → boş sonuç)."""
    uniq = sorted({v for v in values if v is not None}, key=str)
    rows: list[dict] = []
    for part in chunked(uniq):
        rows.extend(db.select(table, where={column: part}, columns=columns, order=order))
    return rows


# --- ders / kaynak / madde -------------------------------------------------------------------------


def course_by_code(db: DB, code: str) -> dict:
    rows = db.select("courses", where={"code": code}, limit=1)
    if not rows:
        raise KalemError(f"OGR-KALEM-001 ders bulunamadı: {code}")
    return rows[0]


def course_by_id(db: DB, course_id: str) -> dict:
    rows = db.select("courses", where={"id": course_id}, limit=1)
    if not rows:
        raise KalemError(f"OGR-KALEM-001 ders bulunamadı: {course_id}")
    return rows[0]


def require_curriculum(course: Mapping[str, Any]) -> str:
    cid = course.get("curriculum_id")
    if not cid:
        raise KalemError(f"OGR-KALEM-006 dersin müfredat eşlemesi yok (courses.curriculum_id): {course.get('code')}")
    return str(cid)


def course_sources(db: DB, course_id: str) -> list[dict]:
    return db.select("exam_sources", where={"course_id": course_id}, order=["year", "created_at", "id"])


def is_retired(item: Mapping[str, Any]) -> bool:
    """Yeniden OCR'da gelmeyen (emekli) madde: ``ocr_text`` boş (``None``). OCR'ın yazdığı her maddede
    ``ocr_text`` vardır (``exam-item`` şemasında zorunlu); ``store_items`` emekli maddenin metnini boşaltır."""
    return item.get("ocr_text") is None


def course_items(db: DB, course_id: str, *, sources: Sequence[Mapping[str, Any]] | None = None) -> list[dict]:
    """Dersin etkin maddeleri (emekliler hariç; kaynak yılıyla: ``_year``); kaynak/yıl/madde sırasıyla."""
    srcs = list(sources) if sources is not None else course_sources(db, course_id)
    year_of = {str(s["id"]): int(s["year"]) for s in srcs}
    items = [it for it in select_in(db, "exam_items", "source_id", list(year_of), columns=ITEM_COLUMNS)
             if not is_retired(it)]
    for it in items:
        it["_year"] = year_of[str(it["source_id"])]
    items.sort(key=lambda r: (r["_year"], str(r["source_id"]), int(r["item_no"])))
    return items


def curriculum_skills(db: DB, curriculum_id: str) -> dict[str, dict]:
    return {str(s["id"]): s for s in db.select("skills", where={"curriculum_id": curriculum_id},
                                                columns=("id", "name", "is_leaf"))}


def curricula_by_code(db: DB, code: str | None) -> list[str]:
    """Müfredat kodu (``TYT-MAT``) → tüm sürümlerin kimlikleri; ``None`` → hepsi."""
    if code is None:
        return [str(c["id"]) for c in db.select("curricula", columns=("id",))]
    rows = db.select("curricula", where={"code": code}, columns=("id",))
    if not rows:
        raise KalemError(f"OGR-KALEM-009 bilinmeyen müfredat kodu: {code}")
    return [str(r["id"]) for r in rows]


# --- telif kemeri ve yasaklı kelimeler --------------------------------------------------------------

COPY_WINDOW = 12
"""Konu etiketi ham soru metniyle bu uzunlukta (ve üstü) ortak bir parça taşıyorsa kopya sayılır (§6.4 telif;
``test_plan_never_contains_ocr_text`` ile aynı ölçü: 12+ karakterlik alt dizi).

Konu adları soru metniyle doğal olarak ortak öbekler paylaşır ("birinci dereceden"); bu yüzden **derlenmiş
sözlük** (dersin müfredatındaki ``skills.name`` ve ``syllabus_topics.title``) ile normalize hâli birebir aynı olan
etiket kemerden muaftır — müfredat/izlence adı soru metni değildir. Diğer her etiket 12 karakter kemerinden geçer."""


def _flat(text: str) -> str:
    return " ".join(tr_lower(text).split())


def copies_text(candidate: str, sources: Iterable[str], *, window: int = COPY_WINDOW) -> bool:
    """``candidate`` içinde ``sources`` metinlerinden birinin ``window``+ karakterlik alt dizisi var mı."""
    cand = _flat(candidate)
    if len(cand) < window:
        return False
    flats = [_flat(s) for s in sources if s]
    for i in range(len(cand) - window + 1):
        piece = cand[i:i + window]
        if any(piece in s for s in flats):
            return True
    return False


def plan_forbidden_words() -> list[str]:
    """``exam-priority-plan`` şemasının ``x-forbidden-words`` listesi (tek kaynak: sözleşme)."""
    return list(contracts.schema("exam-priority-plan").get("x-forbidden-words") or [])


def forbidden_word(text: str, words: Sequence[str] | None = None) -> str | None:
    """Metindeki ilk yasaklı kelime (``ogrenmen_contracts.find_forbidden_word``) ya da ``None``."""
    return contracts.find_forbidden_word(str(text or ""), list(words if words is not None else plan_forbidden_words()))


def course_vocabulary(db: DB, course: Mapping[str, Any]) -> set[str]:
    """Derlenmiş sözlük: dersin müfredatındaki kazanım adları + izlence başlıkları (``norm_topic`` hâli)."""
    vocab: set[str] = set()
    if course.get("curriculum_id"):
        vocab |= {norm_topic(s.get("name")) for s in curriculum_skills(db, str(course["curriculum_id"])).values()}
    vocab |= {norm_topic(t.get("title")) for t in db.select("syllabus_topics", where={"course_id": str(course["id"])},
                                                           columns=("title",))}
    vocab.discard("")
    return vocab


def label_problem(candidate: str, texts: Sequence[str], vocabulary: set[str] | frozenset[str] = frozenset(),
                  words: Sequence[str] | None = None) -> str | None:
    """Etiket plana/kümeye yazılabilir mi: ``None`` → evet; ``"forbidden"`` yasaklı kelime; ``"copy"`` ham metinden
    12+ karakter kopya (derlenmiş sözlükteki ad muaf); ``"empty"`` boş."""
    cand = str(candidate or "").strip()
    if not cand:
        return "empty"
    if forbidden_word(cand, words) is not None:
        return "forbidden"
    if norm_topic(cand) not in vocabulary and copies_text(cand, texts):
        return "copy"
    return None


def pick_label(candidates: Iterable[Any], texts: Sequence[str], vocabulary: set[str] | frozenset[str],
               fallback: str, *, max_len: int = 120, words: Sequence[str] | None = None,
               ) -> tuple[str, list[str]]:
    """İlk uygun aday (kırpılmış) ya da ``fallback``; ikinci değer reddedilen adayların nedenleri
    (``forbidden``/``copy``; boş adaylar sayılmaz)."""
    rejected: list[str] = []
    for raw in candidates:
        cand = str(raw or "").strip()[:max_len].strip()
        problem = label_problem(cand, texts, vocabulary, words)
        if problem is None:
            return cand, rejected
        if problem != "empty":
            rejected.append(problem)
    return fallback, rejected


# --- gömme biçimi ----------------------------------------------------------------------------------


def to_halfvec(vec: Sequence[float]) -> str:
    """pgvector ``halfvec`` metin biçimi (``[0.0123,-0.04,…]``; yarı hassasiyete yetecek 6 anlamlı basamak)."""
    return "[" + ",".join(f"{float(x):.6g}" for x in vec) + "]"


def parse_vector(value: Any) -> list[float] | None:
    """``halfvec`` metni ya da sayı listesi → float listesi; boş/geçersiz → ``None``."""
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text or text in ("None", "null"):
            return None
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return None
    else:
        data = value
    if not isinstance(data, list) or not data:
        return None
    try:
        out = [float(x) for x in data]
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(x) for x in out):
        return None
    return out


# --- girdi dosyaları -------------------------------------------------------------------------------


def load_name_hashes(path: Path | None) -> list[str]:
    """``--name-hashes``: ad-token sha256 hex listesi (JSON dizi); düz ad kabul edilmez."""
    if path is None:
        return []
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, list) or not all(isinstance(h, str) and len(h) == 64 for h in data):
        raise KalemError("OGR-KALEM-011 --name-hashes 64 karakterlik sha256 hex dizisi olmalı (düz ad değil)")
    return [h.lower() for h in data]


def write_json(out: Path | None, name: str, data: Any) -> Path | None:
    if out is None:
        return None
    out.mkdir(parents=True, exist_ok=True)
    path = out / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    return path


def write_text(out: Path | None, name: str, text: str) -> Path | None:
    if out is None:
        return None
    out.mkdir(parents=True, exist_ok=True)
    path = out / name
    path.write_text(text, encoding="utf-8")
    return path
