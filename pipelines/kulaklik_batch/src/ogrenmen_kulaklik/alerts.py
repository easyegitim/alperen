"""Eğitmen alarmları (``metrics``; LLM yok) — ``public.cron_open_alerts()`` (0012) ile.

**Canlıda** (``Runtime.is_fake`` değil) alarmlar ``db.rpc('cron_open_alerts', {})`` ile SQL'de açılır, yükseltilir
ve kapatılır (``batch_worker``'ın EXECUTE yetkisi var; §6.2 "aynı kurallar SQL'de"). Bu yol SQL ile tam aynıdır:
``staff.active``, ``created_at`` sırası ve ``messages.expires_at`` gibi ``batch_worker``'ın okuyamadığı sütunlar
SECURITY DEFINER gövdede kullanılır. Ardından açık alarmlar okunur ve ``alerts.json`` yazılır.

**Dry-run'da** (JsonlDb'de ``cron_open_alerts`` eşleniği yoktur) aynı kuralların Python eşleniği çalışır ve
yalnız ``batch_worker``'ın yetkili olduğu sütunları okur/yazar. Aynı metinler, aynı tekilleştirme
(``alerts_dedup``: tür + öğrenci + ``coalesce(ref->>message_id, fact_id, escalation_id, chat_id, lesson_id,
source_id, staff_id)`` + ``detail``'in ilk 24 karakteri, yalnız açık alarmlar), aynı çözme/yükseltme
güncellemeleri. Yetki yüzünden SQL'den ayrılan noktalar (birebir değildir):

* ``staff``'tan yalnız ``(id, role)`` okunur: ``staff.active`` süzgeci uygulanmaz; eğitmen/koordinatör seçimi
  ``created_at`` yerine ``staff.id`` sırasıyla (grup için ``chat_roles.joined_at``, sonra ``staff_id``) yapılır.
* ``messages.expires_at`` okunmaz: süresi geçmiş mesaj için de (b) alarmı açılabilir (canlıda bu satırlar
  saklama işiyle zaten silinir).

Kurallar:

* ``unanswered`` — (a) açık yükseltme ``alert_unanswered_hours`` (6) saatten eski (``danger``: 24 sa);
  (b) soru işaretli, cevapsız, ``text_llm``'i dolu öğrenci mesajı (6 sa / 24 sa).
* ``silent`` — aktif öğrencinin son mesajı ``alert_silent_days`` (3) günden eski (``danger``: 7 gün).
* ``deadline`` — ``kind='deadline'`` aktif olgu, ``valid_until`` bugün … bugün + ``alert_deadline_days`` (2).
* ``morale`` — son 7 günde ``morale_signal`` ortalaması ≤ −1 ve ≥ 3 sinyal (ders kaynaklı ``kind='morale'``
  olguları — ``approve_lesson_analysis`` ``talk`` iddiasından — dahildir).
* ``response`` — eğitmenin son 14 gündeki yükseltme yanıt süresi medyanı ``response_target_hours`` (2) üstünde
  (personel başına ``ref.staff_id``; medyan ``round(numeric, 1)`` gibi yarım yukarı yuvarlanır, hedef
  ``v_target::text`` gibi yazılır: ``2`` → "2", ``2.0`` → "2,0").
* ``ops`` — grupta bot yönetici değil / gizlilik modu açık (``ref.chat_id``; koordinatöre).

Hiçbir şablon metni yargı ya da tanı etiketi taşımaz ("göstergesi düştü"). ``detail``'e alıntılanan kullanıcı ya
da LLM metni (öğrencinin sorusu, yükseltme sorusu, teslim olgusu) önce ``mask_words`` ile maskelenir; yine de
``instructor-alert`` sözleşmesinden (``x-forbidden-words``) ya da yerel listeden geçemeyen aday atlanır ve
``rejected``'a yazılır — tek bir mesaj işi durdurmaz. Çıktı sırası: önem (Acil → Dikkat → Bilgi), sonra ``since``.
"""

from __future__ import annotations

import statistics
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import ogrenmen_contracts as contracts
from ogrenmen_common.clock import iso, parse_ts
from ogrenmen_common.errors import OgrError

from .common import (
    KulaklikError,
    Students,
    float_setting,
    int_setting,
    judgement_word,
    mask_words,
    setting,
    today,
    tr_stamp,
)

SEVERITY_ORDER = {"danger": 0, "warning": 1, "neutral": 2}
REF_KEYS = ("message_id", "fact_id", "escalation_id", "chat_id", "lesson_id", "source_id", "staff_id")
"""``alerts_dedup`` dizinindeki ``coalesce`` sırası (0007_kulaklik.sql)."""
SCHEMA_REF_KEYS = ("message_id", "fact_id", "escalation_id", "lesson_id", "chat_id", "source_id")
"""``instructor-alert.ref`` sözleşmesinin anahtarları (``response`` alarmının ``ref.staff_id``'si DB'de durur,
sözleşmede ``staff_ref`` alanıyla taşınır)."""


@dataclass
class AlertsReport:
    candidates: int = 0
    opened: int = 0
    resolved: int = 0
    escalated: int = 0
    deduplicated: int = 0
    mode: str = "python"
    by_kind: dict[str, int] = field(default_factory=dict)
    rejected: list[dict] = field(default_factory=list)
    rows: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {"mode": self.mode, "candidates": self.candidates, "opened": self.opened,
                "deduplicated": self.deduplicated, "resolved": self.resolved, "escalated": self.escalated,
                "by_kind": self.by_kind, "rejected": self.rejected}


def _ref_key(ref: Mapping[str, Any] | None) -> str:
    for k in REF_KEYS:
        if (ref or {}).get(k) is not None:
            return str(ref[k])
    return ""


def dedup_key(row: Mapping[str, Any]) -> tuple:
    return (row["kind"], str(row.get("student_id") or ""), _ref_key(row.get("ref")), str(row["detail"])[:24])


def contract_view(row: Mapping[str, Any], students: Students) -> dict[str, Any]:
    """DB satırı → ``instructor-alert`` sözleşmesi (öğrenci yalnız ``public_ref`` ile)."""
    ref = {k: v for k, v in (row.get("ref") or {}).items() if k in SCHEMA_REF_KEYS}
    return {"schema_version": "1.0", "kind": row["kind"], "severity": row["severity"],
            "student_ref": students.ref(row.get("student_id")), "staff_ref": row.get("staff_id"),
            "detail": row["detail"], "since": row["since"], "ref": ref}


def round_half_up(value: float, digits: int = 1) -> str:
    """``round(x::numeric, 1)::text`` eşleniği: float8 → numeric 15 anlamlı basamak, yarım yukarı (2.25 → 2.3)."""
    exp = Decimal(1).scaleb(-digits)
    return str(Decimal(format(value, ".15g")).quantize(exp, rounding=ROUND_HALF_UP))


def numeric_text(raw: Any, default: str) -> str:
    """``(settings.value #>> '{}')::numeric::text`` eşleniği (ayar yoksa ``default``)."""
    if raw is None or isinstance(raw, bool):
        return default
    if isinstance(raw, (int, float, str)):
        try:
            return str(Decimal(str(raw)))
        except ArithmeticError:
            return default
    return default


def check_alert(row: Mapping[str, Any], students: Students) -> dict[str, Any]:
    word = judgement_word(str(row["detail"]))
    if word is not None:
        raise KulaklikError(f"OGR-KLK-010 alarm metninde yargı kelimesi: {word}")
    view = contract_view(row, students)
    contracts.validate("instructor-alert", view)
    return view


class AlertBuilder:
    def __init__(self, db: Any, now: datetime):
        self.db = db
        self.now = now
        self.unans = int_setting(db, "alert_unanswered_hours", 6)
        self.unans_danger = int_setting(db, "alert_unanswered_danger_hours", 24)
        self.silent = int_setting(db, "alert_silent_days", 3)
        self.silent_danger = int_setting(db, "alert_silent_danger_days", 7)
        self.deadline = int_setting(db, "alert_deadline_days", 2)
        self.target = float_setting(db, "response_target_hours", 2.0)
        self.target_text = numeric_text(setting(db, "response_target_hours", None), "2").replace(".", ",")
        self.students = Students.load(db)
        # batch_worker staff'tan yalnız (id, role) görür: active/created_at yok → kimlik sırası (deterministik)
        self.staff = {str(s["id"]): s for s in db.select("staff", columns=("id", "role"))}
        self.staff_students = db.select("staff_students")

    def _instructor_of(self, student_id: str) -> str | None:
        ids = sorted(str(link["staff_id"]) for link in self.staff_students
                     if str(link["student_id"]) == str(student_id)
                     and self.staff.get(str(link["staff_id"]), {}).get("role") == "instructor")
        return ids[0] if ids else None

    def _coordinator(self) -> str | None:
        ids = sorted(sid for sid, s in self.staff.items() if s.get("role") == "coordinator")
        return ids[0] if ids else None

    def _chat_instructor(self, chat_id: Any, roles: list[dict]) -> str | None:
        rows = sorted((r for r in roles if r.get("chat_id") == chat_id and r.get("staff_id") is not None
                       and self.staff.get(str(r["staff_id"]), {}).get("role") == "instructor"),
                      key=lambda r: (str(r.get("joined_at") or ""), str(r["staff_id"])))
        return str(rows[0]["staff_id"]) if rows else None

    def _sev_hours(self, ts: Any) -> str:
        return "danger" if parse_ts(ts) < self.now - timedelta(hours=self.unans_danger) else "warning"

    def build(self) -> list[dict]:
        out: list[dict] = []
        now = self.now
        db = self.db
        # (a) açık yükseltmeler
        for e in db.select("escalations", where={"status": "open"}):
            if parse_ts(e["created_at"]) < now - timedelta(hours=self.unans):
                text = mask_words((e.get("question_text") or "soru")[:160])
                out.append({"kind": "unanswered", "severity": self._sev_hours(e["created_at"]),
                            "student_id": e.get("student_id"), "staff_id": e.get("target_staff_id"),
                            "detail": f'Hocaya iletilen soru cevap bekliyor: "{text}"'[:240],
                            "since": iso(parse_ts(e["created_at"])), "ref": {"escalation_id": e["id"]}})
        # (b) soru işaretli, cevapsız öğrenci mesajları
        roles = db.select("chat_roles")
        msgs = db.select("messages", where={"sender_role": "student"},
                         columns=("id", "chat_id", "student_id", "text_llm", "is_question", "answered_at", "sent_at"))
        for m in msgs:
            if not (m.get("is_question") is True and m.get("answered_at") is None and m.get("text_llm")):
                continue
            if parse_ts(m["sent_at"]) >= now - timedelta(hours=self.unans):
                continue
            out.append({"kind": "unanswered", "severity": self._sev_hours(m["sent_at"]),
                        "student_id": m.get("student_id"), "staff_id": self._chat_instructor(m["chat_id"], roles),
                        "detail": f'Cevapsız soru: "{mask_words(str(m["text_llm"])[:180])}"'[:240],
                        "since": iso(parse_ts(m["sent_at"])), "ref": {"message_id": int(m["id"])}})
        # (c) sessiz öğrenciler
        last: dict[str, datetime] = {}
        for m in msgs:
            if m.get("student_id") is None:
                continue
            ts = parse_ts(m["sent_at"])
            key = str(m["student_id"])
            if key not in last or ts > last[key]:
                last[key] = ts
        for sid in self.students.active_ids():
            if sid in last and last[sid] < now - timedelta(days=self.silent):
                sev = "danger" if last[sid] < now - timedelta(days=self.silent_danger) else "warning"
                out.append({"kind": "silent", "severity": sev, "student_id": sid, "staff_id": self._instructor_of(sid),
                            "detail": f"Uzun süredir mesaj yok (son mesaj {tr_stamp(last[sid])})",
                            "since": iso(last[sid]), "ref": {}})
        # (d) yaklaşan teslimler ve (e) moral
        active = set(self.students.active_ids())
        day = today(now)
        facts = db.select("memory_facts", where={"status": "active"},
                          columns=("id", "student_id", "kind", "text", "requires_approval", "approved", "valid_until",
                                   "morale_signal", "created_at"))
        for f in sorted(facts, key=lambda x: int(x["id"])):
            if str(f["student_id"]) not in active or f.get("kind") != "deadline" or not f.get("valid_until"):
                continue
            if f.get("requires_approval") and not f.get("approved"):
                continue
            due = parse_ts(f["valid_until"]).date()
            if day <= due <= day + timedelta(days=self.deadline):
                out.append({"kind": "deadline", "severity": "neutral", "student_id": f["student_id"],
                            "staff_id": self._instructor_of(f["student_id"]),
                            "detail": f"Teslim yaklaşıyor: {mask_words(str(f['text']))}"[:240],
                            "since": iso(parse_ts(f["created_at"])),
                            "ref": {"fact_id": int(f["id"])}})
        signals: dict[str, list[dict]] = {}
        for f in facts:
            if f.get("morale_signal") is None or str(f["student_id"]) not in active:
                continue
            if parse_ts(f["created_at"]) > now - timedelta(days=7):
                signals.setdefault(str(f["student_id"]), []).append(f)
        for sid, rows in sorted(signals.items()):
            values = [int(r["morale_signal"]) for r in rows]
            if len(values) >= 3 and sum(values) / len(values) <= -1:
                out.append({"kind": "morale", "severity": "warning", "student_id": sid,
                            "staff_id": self._instructor_of(sid),
                            "detail": f"Moral göstergesi düştü (son 7 gün, {len(values)} sinyal)",
                            "since": iso(min(parse_ts(r["created_at"]) for r in rows)), "ref": {}})
        # (f) eğitmen yanıt süresi medyanı
        spans: dict[str, list[float]] = {}
        for e in db.select("escalations"):
            if e.get("answered_at") and e.get("answered_by") and parse_ts(e["created_at"]) > now - timedelta(days=14):
                hours = (parse_ts(e["answered_at"]) - parse_ts(e["created_at"])).total_seconds() / 3600
                spans.setdefault(str(e["answered_by"]), []).append(hours)
        for staff_id, hours in sorted(spans.items()):
            med = statistics.median(hours)
            if med > self.target:
                out.append({"kind": "response", "severity": "warning", "student_id": None, "staff_id": staff_id,
                            "detail": f"Yanıt süresi medyanı hedefin üstünde: "
                                      f"{round_half_up(med, 1).replace('.', ',')} saat (hedef {self.target_text} saat)",
                            "since": iso(now - timedelta(days=14)), "ref": {"staff_id": staff_id}})
        # (g) ops
        coord = self._coordinator()
        for chat in sorted(db.select("tg_chats"), key=lambda c: int(c["chat_id"])):
            if chat.get("kind") == "private":
                continue
            since = iso(parse_ts(chat.get("created_at") or now))
            if not chat.get("bot_is_admin"):
                out.append({"kind": "ops", "severity": "warning", "student_id": None, "staff_id": coord,
                            "detail": "Bot grupta yönetici değil; kayıt bildirimi sabitlenemedi", "since": since,
                            "ref": {"chat_id": int(chat["chat_id"])}})
            if not chat.get("privacy_mode_off_verified"):
                out.append({"kind": "ops", "severity": "warning", "student_id": None, "staff_id": coord,
                            "detail": "Grup gizlilik modu açık; bot yalnız etiketlenince görür", "since": since,
                            "ref": {"chat_id": int(chat["chat_id"])}})
        out.sort(key=lambda r: (SEVERITY_ORDER[r["severity"]], r["since"], r["kind"]))
        return out


def refresh_open(db: Any, builder: AlertBuilder, report: AlertsReport) -> None:
    """SQL'deki güncellemeler: durumu çözülen alarm ``done``, süresi uzayan ``danger``."""
    now = builder.now
    escalations = {str(e["id"]): e for e in db.select("escalations")}
    messages = {int(m["id"]): m for m in db.select("messages", columns=("id", "student_id", "sender_role",
                                                                       "answered_at", "sent_at"))}
    chats = {int(c["chat_id"]): c for c in db.select("tg_chats")}
    danger_h = now - timedelta(hours=builder.unans_danger)
    for a in db.select("instructor_alerts", where={"status": "open"}):
        ref = a.get("ref") or {}
        values: dict[str, Any] = {}
        if a["kind"] == "unanswered" and ref.get("escalation_id") is not None:
            e = escalations.get(str(ref["escalation_id"]))
            if e is not None and e.get("status") != "open":
                values = {"status": "done", "resolved_at": iso(now)}
            elif e is not None and a["severity"] != "danger" and parse_ts(e["created_at"]) < danger_h:
                values = {"severity": "danger"}
        elif a["kind"] == "unanswered" and ref.get("message_id") is not None:
            m = messages.get(int(ref["message_id"]))
            if m is not None and m.get("answered_at") is not None:
                values = {"status": "done", "resolved_at": iso(now)}
            elif m is not None and a["severity"] != "danger" and parse_ts(m["sent_at"]) < danger_h:
                values = {"severity": "danger"}
        elif a["kind"] == "silent" and a.get("since"):
            since = parse_ts(a["since"])
            if any(str(m.get("student_id")) == str(a.get("student_id")) and m.get("sender_role") == "student"
                   and parse_ts(m["sent_at"]) > since for m in messages.values()):
                values = {"status": "done", "resolved_at": iso(now)}
            elif a["severity"] != "danger" and since < now - timedelta(days=builder.silent_danger):
                values = {"severity": "danger"}
        elif a["kind"] == "ops" and ref.get("chat_id") is not None:
            c = chats.get(int(ref["chat_id"]))
            detail = str(a["detail"])
            if c is not None and ((detail.startswith("Bot grupta yönetici değil") and c.get("bot_is_admin"))
                                  or (detail.startswith("Grup gizlilik modu açık")
                                      and c.get("privacy_mode_off_verified"))):
                values = {"status": "done", "resolved_at": iso(now)}
        if values:
            db.update("instructor_alerts", values, where={"id": a["id"]})
            if values.get("status") == "done":
                report.resolved += 1
            else:
                report.escalated += 1


def open_alerts(db: Any, now: datetime, *, via_rpc: bool = False) -> AlertsReport:
    """``via_rpc`` (canlı): ``cron_open_alerts()`` SQL'de çalışır, açık alarmlar okunur. Aksi hâlde (dry-run)
    Python eşleniği: aday alarmları üretir, her adayı sözleşmeden geçirir (geçemeyen atlanır ve ``rejected``'a
    yazılır), açık eşi olanları atlar, kalanları yazar; sonra açık alarmları günceller."""
    if via_rpc:
        return _open_alerts_rpc(db)
    builder = AlertBuilder(db, now)
    candidates = builder.build()
    report = AlertsReport(candidates=len(candidates))
    seen = {dedup_key(a) for a in db.select("instructor_alerts", where={"status": "open"})}
    for row in candidates:
        try:
            check_alert(row, builder.students)
        except (OgrError, contracts.ContractValidationError) as exc:
            report.rejected.append({"kind": row["kind"], "student_ref": builder.students.ref(row.get("student_id")),
                                    "reason": str(getattr(exc, "message", exc))[:160]})
            continue
        key = dedup_key(row)
        if key in seen:
            report.deduplicated += 1
            continue
        seen.add(key)
        # status yazılmaz: sütun varsayılanı 'open' (batch_worker insert yetkisi: kind, severity, student_id,
        # staff_id, detail, since, ref)
        stored = db.insert("instructor_alerts", dict(row))
        report.opened += 1
        report.by_kind[row["kind"]] = report.by_kind.get(row["kind"], 0) + 1
        report.rows.append(contract_view(stored[0] if stored else row, builder.students))
    refresh_open(db, builder, report)
    return report


def _open_alerts_rpc(db: Any) -> AlertsReport:
    raw = db.rpc("cron_open_alerts", {})
    if isinstance(raw, list):
        raw = raw[0] if raw else 0
    if isinstance(raw, Mapping):
        raw = next(iter(raw.values()), 0)
    report = AlertsReport(mode="rpc", opened=int(raw or 0))
    students = Students.load(db)
    rows = db.select("instructor_alerts", where={"status": "open"})
    rows.sort(key=lambda r: (SEVERITY_ORDER.get(r["severity"], 9), str(r.get("since") or ""), r["kind"]))
    report.candidates = len(rows)
    for row in rows:
        report.by_kind[row["kind"]] = report.by_kind.get(row["kind"], 0) + 1
        try:
            report.rows.append(check_alert(row, students))
        except (OgrError, contracts.ContractValidationError) as exc:
            report.rejected.append({"kind": row["kind"], "id": str(row.get("id")),
                                    "reason": str(getattr(exc, "message", exc))[:160]})
    return report
