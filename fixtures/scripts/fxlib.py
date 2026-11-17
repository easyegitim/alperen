"""Fixture üreticilerinin ortak yardımcıları ve "dünya" sabitleri.

Tüm kimlikler deterministiktir: `uid(tür, anahtar)` = uuid5(NAMESPACE_OGRENMEN, "tür:anahtar").
NAMESPACE_OGRENMEN = uuid5(NAMESPACE_DNS, "ogrenmen.easy"). Müfredat satırının kimliği
`uuid5(NAMESPACE_OGRENMEN, "TYT-MAT@2026.1")` (code@version) olarak sabitlenmiştir.
"""

from __future__ import annotations

import base64
import hashlib
import json
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "fixtures"

sys.path.insert(0, str(ROOT / "packages" / "pii" / "py"))
from ogrenmen_pii import name_token_hashes, scrub  # noqa: E402

NAMESPACE_OGRENMEN = uuid.uuid5(uuid.NAMESPACE_DNS, "ogrenmen.easy")


def uid(kind: str, key: str) -> str:
    return str(uuid.uuid5(NAMESPACE_OGRENMEN, f"{kind}:{key}"))


def uuid_b64url(u: str) -> str:
    """UUID'nin 16 baytı → base64url, dolgusuz (22 karakter). Telegram callback_data ≤ 64 bayt:
    `ans:` + 22 + `:` + 22 + `:` + anahtar = 51 bayt; kayıpsızdır (M04 tam UUID'ye geri çevirir)."""
    return base64.urlsafe_b64encode(uuid.UUID(u).bytes).rstrip(b"=").decode("ascii")


def uuid_from_b64url(s: str) -> str:
    """`uuid_b64url` tersi (Worker `decodeUuid` eşleniği; başvuru uygulaması)."""
    if len(s) != 22:
        raise ValueError(f"22 karakterlik base64url bekleniyor: {s!r}")
    return str(uuid.UUID(bytes=base64.urlsafe_b64decode(s + "==")))


CURRICULUM_ID = str(uuid.uuid5(NAMESPACE_OGRENMEN, "TYT-MAT@2026.1"))
CURRICULUM_CODE = "TYT-MAT@2026.1"
PERIOD = "YKS 2027"

# Dünyanın "şimdi"si: dev-seed 20 Ekim 2026 sabahı (UTC) itibarıyla yazılmıştır.
NOW = datetime(2026, 10, 20, 9, 0, 0, tzinfo=UTC)


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def at(day: int, hh: int, mm: int = 0, month: int = 10) -> datetime:
    """İstanbul saatiyle (UTC+3) 2026-<month>-<day> hh:mm → UTC datetime."""
    return datetime(2026, month, day, hh, mm, tzinfo=UTC) - timedelta(hours=3)


def unix(dt: datetime) -> int:
    return int(dt.timestamp())


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def write(rel: str, obj: Any) -> Path:
    p = FIX / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return p


# --- Kişiler ------------------------------------------------------------------------------
BOT = {"id": 800000001, "is_bot": True, "first_name": "Öğrenmen", "username": "ogrenmen_bot"}

STAFF = {
    "coord": {"id": uid("staff", "coord"), "full_name": "Selin Arslan", "role": "coordinator", "subject": None,
              "tg": 700000102, "username": "selin_koord", "mention": "@selin_koord"},
    "inst": {"id": uid("staff", "inst"), "full_name": "Ayşe Yılmaz", "role": "instructor", "subject": "matematik",
             "tg": 700000101, "username": "ayse_hoca", "mention": "@ayse_hoca"},
    "obs": {"id": uid("staff", "obs"), "full_name": "Deniz Koç", "role": "observer", "subject": None,
            "tg": None, "username": None, "mention": None},
}

STUDENTS = {
    "elif": {"id": uid("student", "elif"), "ref": "s_qk7m2rx4tn5a", "first": "Elif", "last": "Kaya",
             "tg": 700000001, "username": "elif_k", "birth_year": 2007, "is_minor": False, "status": "active",
             "school": "Kadıköy Anadolu Lisesi", "grade": "12", "guardian_name": None, "guardian_relation": None,
             "guardian_contact": None},
    "mert": {"id": uid("student", "mert"), "ref": "s_vd3hp6wz2kc7", "first": "Mert", "last": "Demir",
             "tg": 700000002, "username": "mert_d", "birth_year": 2010, "is_minor": True, "status": "active",
             "school": "Üsküdar Fen Lisesi", "grade": "11", "guardian_name": "Fatma Demir",
             "guardian_relation": "anne", "guardian_contact": "fatma.demir@example.com"},
    "zeynep": {"id": uid("student", "zeynep"), "ref": "s_mb5tj7ye4ql2", "first": "Zeynep", "last": "Çelik",
               "tg": 700000003, "username": "zeynep_c", "birth_year": 2011, "is_minor": True,
               "status": "pending_consent", "school": "Maltepe Anadolu Lisesi", "grade": "10",
               "guardian_name": "Hakan Çelik", "guardian_relation": "baba", "guardian_contact": "0532 765 43 21"},
}
ENROLL = {k: uid("enrollment", k) for k in STUDENTS}

# Onay satırı olmayan grup üyesi (students satırı yok)
UNCONSENTED = {"id": 700000201, "is_bot": False, "first_name": "Barış", "last_name": "Tunç", "username": "baris_t"}
# Botla hiç konuşmamış yeni kullanıcı (/start senaryosu)
NEWCOMER = {"id": 700000004, "is_bot": False, "first_name": "Can", "last_name": "Öztürk", "username": "can_o",
            "language_code": "tr"}

GROUP_A = -1001000000001
GROUP_A_TITLE = "TYT Matematik · Pilot A"
GROUP_B = -1001000000002
GROUP_B_TITLE = "TYT Matematik · Pilot B"
GROUP_C = -1001000000003
GROUP_C_TITLE = "Hafta sonu etüt grubu"

LESSON_ID = "00000000-0000-0000-0000-000000000001"


def tg_user(key: str) -> dict[str, Any]:
    s = STUDENTS[key]
    return {"id": s["tg"], "is_bot": False, "first_name": s["first"], "last_name": s["last"],
            "username": s["username"], "language_code": "tr"}


def staff_tg_user(key: str) -> dict[str, Any]:
    s = STAFF[key]
    first, last = s["full_name"].split(" ", 1)
    return {"id": s["tg"], "is_bot": False, "first_name": first, "last_name": last, "username": s["username"],
            "language_code": "tr"}


def student_hashes(key: str) -> list[str]:
    s = STUDENTS[key]
    names = f"{s['first']} {s['last']}"
    if s["guardian_name"]:
        names += " " + s["guardian_name"]
    return name_token_hashes(names)


def all_name_hashes() -> list[str]:
    out: list[str] = []
    for k in STUDENTS:
        for h in student_hashes(k):
            if h not in out:
                out.append(h)
    for s in STAFF.values():
        for h in name_token_hashes(s["full_name"]):
            if h not in out:
                out.append(h)
    return out


def role_hashes_for(student_key: str) -> dict[str, str]:
    """Ders transkripti için: öğrenci → ÖĞRENCİ, eğitmen → EĞİTMEN, veli → VELİ."""
    s = STUDENTS[student_key]
    roles = {h: "ÖĞRENCİ" for h in name_token_hashes(f"{s['first']} {s['last']}")}
    if s["guardian_name"]:
        for h in name_token_hashes(s["guardian_name"].split(" ")[0]):
            roles.setdefault(h, "VELİ")
    for h in name_token_hashes(STAFF["inst"]["full_name"]):
        roles[h] = "EĞİTMEN"
    return roles


def scrub_text(text: str) -> tuple[str, int]:
    r = scrub(text, {"nameHashes": all_name_hashes()})
    return r["text"], sum(x["count"] for x in r["replacements"])
