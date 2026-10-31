"""JsonlDb — fixtures JSON'dan bellek içi tablolar; ``out/<tablo>.jsonl`` yazar (§12 #42).

``batch_worker`` rolünün PostgREST'ten gördüğü dünyanın sahtesidir:

* **Yükleme.** Taban dünya ``fixtures/db/dev-seed.json``'dur. ``from_fixtures(<dizin>)`` ayrıca o
  dizindeki tablo dosyalarını okur; dizindeki bir tablo tabandaki aynı tablonun **yerine geçer**
  (senaryo verisi). Dosya → tablo eşlemesi: ``FIXTURE_TABLE_ALIASES`` (ör. ``messages-day.json`` →
  ``messages``), yoksa ad (``-`` → ``_``) bir tablo adıysa o tablo; çok tablolu dosyalar
  (``{"lessons": [...], ...}``) anahtar başına; sözleşme örnekleri (ör. ``facts-day.json``) atlanır.
  Aynı dizinde aynı tabloya düşen dosyalar birincil anahtara göre birleşir (ad sırası).
* **Yetki taklidi.** ``secure.*`` ve ``audit.events`` okunamaz, ``messages.text_raw`` hiçbir zaman
  dönmez (sütun yetkisi yok); yazma ``BATCH_WORKER_WRITES`` matrisine uyar (ör. ``observations``'a
  yazılamaz, ``questions.status``/``reviewed_*`` yalnız RPC ile). İhlal → ``DbPermissionError``.
* **Tetikleyiciler.** ``llm_calls`` eklemesi ``spend_ledger``'ı günceller (``app.spend_rollup``);
  ``messages`` eklemesi ``expires_at``'i yazar; ``questions``'ta ``app.questions_check_skills``.
* **RPC'ler.** ``rpc(ad, parametreler)`` ``fakes/jsonl_rpc.py``'deki eşlenikleri çağırır; adlar
  ``fakes/rpc-names.json``'da listelenir (M13 ``check-rpc-parity.sh`` migration'larla eşler).
* **Çıktı.** ``flush()`` yalnız bu çalışmada yazılan/güncellenen satırları ``out/<tablo>.jsonl``'e
  (son hâliyle), RPC çağrılarını ``out/rpc_calls.jsonl``'e (anahtar parametreleri gizlenmiş),
  silmeleri ``out/deletions.jsonl``'e yazar; ``secure.*`` tabloları hiçbir dosyaya yazılmaz.
"""

from __future__ import annotations

import copy
import json
import re
import uuid
from collections.abc import Iterable, Mapping, Sequence
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from ..adapters.base import Filter, Where
from ..clock import Clock, fake_clock_from_env, iso, istanbul_date, parse_ts
from ..errors import DbError, DbPermissionError, RpcError
from ..paths import dev_seed_path

NAMESPACE_OGRENMEN = uuid.uuid5(uuid.NAMESPACE_DNS, "ogrenmen.easy")
"""fixtures/README.md ile aynı ad alanı (deterministik kimlikler)."""

PRIMARY_KEYS: dict[str, tuple[str, ...]] = {
    "quota_tiers": ("tier",),
    "quota_limits": ("tier", "kind"),
    "settings": ("key",),
    "runtime_flags": ("key",),
    "retention_policies": ("id",),
    "skills": ("curriculum_id", "id"),
    "skill_prerequisites": ("curriculum_id", "skill_id", "prereq_id"),
    "misconception_tags": ("tag",),
    "secure.answer_keys": ("question_id",),
    "secure.student_pii": ("student_id",),
    "secure.telegram_identities": ("telegram_user_id",),
    "secure.auth_links": ("auth_user_id",),
    "staff_students": ("staff_id", "student_id"),
    "preferences": ("student_id",),
    "tg_chats": ("chat_id",),
    "chat_roles": ("chat_id", "telegram_user_id"),
    "tg_updates": ("update_id",),
    "sessions": ("student_id", "chat_id"),
    "spend_ledger": ("day", "purpose", "provider"),
    "provider_health": ("provider",),
    "mastery": ("enrollment_id", "skill_id"),
    "misconception_evidence": ("misconception_id", "observation_id"),
    "pilot_metrics": ("metric", "period"),
    "table_sizes_daily": ("day", "table_name"),
    "lesson_labels": ("hash",),
}
"""Birincil anahtarı ``id`` olmayan tablolar (§3)."""

IDENTITY_TABLES = frozenset({
    "messages", "observations", "mastery_history", "memory_facts", "bot_responses", "llm_calls", "quota_usage",
    "attempts", "library_chunks", "retention_runs", "storage_deletions", "audit.events",
})
"""``bigint generated always as identity`` birincil anahtarlı tablolar."""

KNOWN_TABLES = frozenset({
    "quota_tiers", "students", "secure.student_pii", "secure.telegram_identities", "secure.staff_codes",
    "secure.auth_links", "secure.guardian_codes", "staff", "staff_students", "legal_texts", "consents", "settings",
    "retention_policies", "curricula", "skills", "skill_prerequisites", "misconception_tags", "enrollments",
    "observations", "mastery", "mastery_history", "misconceptions", "misconception_evidence", "instructor_notes",
    "preferences", "figures", "questions", "secure.answer_keys", "question_templates", "attempts", "diagnostic_tests",
    "diagnostic_sessions", "content_pool", "generation_requests", "tg_chats", "chat_roles", "tg_updates", "messages",
    "sessions", "memory_facts", "weekly_summaries", "bot_responses", "llm_calls", "spend_ledger", "runtime_flags",
    "provider_health", "quota_limits", "quota_usage", "escalations", "instructor_alerts", "proactive_messages",
    "pilot_metrics", "lessons", "lesson_analyses", "lesson_claims", "courses", "syllabus_topics", "exam_sources",
    "exam_items", "exam_clusters", "exam_priority_plans", "research_requests", "research_outputs", "citations",
    "library_documents", "library_chunks", "audit.events", "retention_runs", "table_sizes_daily",
    "storage_deletions", "lesson_labels",
})
"""§3 tabloları; ``lesson_labels`` yalnız sahte dünyadadır (``resolve_lesson_labels`` yanıtı, ``ders/labels.json``)."""

FIXTURE_TABLE_ALIASES: dict[str, str] = {
    "messages-day": "messages",
    "bot-responses-week": "bot_responses",
    "llm-calls-month": "llm_calls",
    "spend-ledger-month": "spend_ledger",
    "memory-facts": "memory_facts",
    "questions-review": "questions",
    "chats": "tg_chats",
    "requests": "research_requests",
    "labels": "lesson_labels",
}
"""fixtures dosya adı (uzantısız) → tablo (fixtures/README.md "Dizinler" tablosu)."""

HIDDEN_TABLES = frozenset({"audit.events"})
"""batch_worker'ın okuyamadığı ``secure`` dışı tablolar."""

DENIED_READ_COLUMNS: dict[str, frozenset[str]] = {"messages": frozenset({"text_raw"})}
"""batch_worker sütun yetkisinde olmayan sütunlar (§3.8: ``messages.text_raw``)."""

_ALL = "*"
BATCH_WORKER_WRITES: dict[str, dict[str, Any]] = {
    # tablo: {"insert": bool, "update": "*" | {sütunlar}, "delete": bool, "deny_columns": {...}}
    "curricula": {"insert": True, "update": _ALL},
    "skills": {"insert": True, "update": _ALL},
    "skill_prerequisites": {"insert": True, "update": _ALL},
    "misconception_tags": {"insert": True, "update": _ALL},
    "question_templates": {"insert": True, "update": _ALL},
    "preferences": {"insert": False, "update": _ALL},
    "figures": {"insert": True, "update": _ALL, "deny_columns": {"review_status", "reviewed_by", "reviewed_at"}},
    "questions": {"insert": True, "update": _ALL, "deny_columns": {"reviewed_by", "reviewed_at"},
                  "guard_status": True},
    "content_pool": {"insert": True, "update": False},
    "generation_requests": {"insert": True, "update": {"served_question_id", "served_at", "needs_generation"}},
    "messages": {"insert": False, "update": {"is_question", "answered_at"}},
    "memory_facts": {"insert": True, "update": _ALL},
    "weekly_summaries": {"insert": True, "update": False},
    "bot_responses": {"insert": False, "update": {"review_week"}},
    "llm_calls": {"insert": True, "update": False},
    "provider_health": {"insert": False, "update": _ALL},
    "escalations": {"insert": False, "update": _ALL},
    "instructor_alerts": {"insert": True, "update": _ALL},
    "proactive_messages": {"insert": True, "update": False},
    "lessons": {"insert": False, "update": {"status", "transcript_path", "frames_count", "video_deleted_at"}},
    "lesson_analyses": {"insert": True, "update": False},
    "lesson_claims": {"insert": True, "update": False},
    "courses": {"insert": True, "update": _ALL},
    "syllabus_topics": {"insert": True, "update": _ALL},
    "exam_sources": {"insert": True, "update": _ALL},
    "exam_items": {"insert": True, "update": _ALL, "delete": True},
    "exam_clusters": {"insert": True, "update": _ALL, "delete": True},
    "exam_priority_plans": {"insert": True, "update": _ALL, "deny_columns": {"status", "approved_by", "approved_at"}},
    "research_requests": {"insert": False, "update": _ALL},
    "research_outputs": {"insert": True, "update": _ALL},
    "citations": {"insert": True, "update": _ALL},
    "pilot_metrics": {"insert": True, "update": _ALL},
    "library_documents": {"insert": True, "update": False},
    "library_chunks": {"insert": True, "update": False},
    "retention_runs": {"insert": True, "update": False},
    "table_sizes_daily": {"insert": True, "update": False},
    "storage_deletions": {"insert": True, "update": {"done_at", "error"}},
}
"""batch_worker'ın doğrudan yazabildikleri (§3.8 W sütunu); listede olmayan tabloya yazım → yetki hatası."""

_NOW = object()
_TODAY = object()

TABLE_DEFAULTS: dict[str, dict[str, Any]] = {
    "llm_calls": {"tokens_in": 0, "tokens_out": 0, "audio_sec": None, "images": None, "batch": False,
                  "error_code": None, "latency_ms": None, "cost_usd": 0, "ref_table": None, "ref_id": None,
                  "student_ref": None, "created_at": _NOW},
    "lessons": {"status": "uploaded", "video_deleted_at": None, "deletion_notified_at": None, "transcript_path": None,
                "frames_count": None, "created_at": _NOW},
    "lesson_analyses": {"version": 1, "status": "draft", "cost_usd": 0, "approved_by": None, "approved_at": None,
                        "created_at": _NOW},
    "lesson_claims": {"status": "pending", "edited_value": None, "decided_by": None, "decided_at": None,
                      "misconception_tag": None, "misconception_id": None, "skill_id": None, "t_end_sec": None},
    "questions": {"stem_values": {}, "figure_id": None, "options": None, "difficulty": None, "template_id": None,
                  "template_params": None, "status": "draft", "model": None, "cost_usd": 0, "prompt_version": None,
                  "reviewed_by": None, "reviewed_at": None, "review_note": None, "created_at": _NOW,
                  "verification": {"schema": True, "sympy": "pending", "render": "not_applicable",
                                   "vision": "not_applicable", "attempts": 0}},
    "figures": {"png_path": None, "svg_path": None, "width_px": None, "height_px": None, "bytes": None,
                "render_status": "pending", "vision_status": "pending", "vision_report": None, "attempts": 0,
                "review_status": "pending", "reviewed_by": None, "reviewed_at": None, "render_log": None,
                "created_at": _NOW},
    "instructor_alerts": {"student_id": None, "staff_id": None, "since": None, "ref": {}, "status": "open",
                          "created_at": _NOW, "resolved_at": None, "resolved_by": None},
    "proactive_messages": {"chat_id": None, "recipient": "student", "params": {}, "sent_at": None,
                           "telegram_message_id": None, "status": "scheduled"},
    "memory_facts": {"source_message_ids": [], "source_lesson_claim_id": None, "confidence": 0.7,
                     "requires_approval": False, "approved": False, "approved_by": None, "valid_from": _TODAY,
                     "valid_until": None, "morale_signal": None, "status": "active", "embedding": None,
                     "model": None, "cost_usd": 0, "created_at": _NOW},
    "weekly_summaries": {"facts_used": [], "model": None, "cost_usd": 0, "created_at": _NOW},
    "generation_requests": {"kind": "pool_miss", "difficulty_band": "mid", "topic": None, "question_kind": None,
                            "points": None, "plan_id": None, "requested_by": None, "requested_by_staff": None,
                            "served_question_id": None, "served_at": None, "needs_generation": False,
                            "created_at": _NOW},
    "exam_sources": {"status": "uploaded", "error": None, "instructor_alias": None, "uploaded_by": None,
                     "created_at": _NOW},
    "exam_items": {"topic": None, "kind": None, "points": None, "curriculum_id": None, "skill_id": None,
                   "ocr_text": None, "embedding": None, "cluster_id": None},
    "exam_clusters": {"kind": None, "curriculum_id": None, "skill_id": None, "item_count": 0, "years_hit": [],
                      "years_total": 0, "avg_points": None, "updated_at": _NOW},
    "exam_priority_plans": {"status": "pending_review", "approved_by": None, "approved_at": None,
                            "created_at": _NOW},
    "research_outputs": {"bibtex": None, "apa": None, "model": None, "status": "pending_review", "created_at": _NOW},
    "citations": {"doi": None, "authors": None, "venue": None, "year": None, "crossref_status": "pending",
                  "title_similarity": None, "verified_at": None, "oa_pdf_url": None, "tldr": None, "status": "kept",
                  "removed_reason": None, "relevance": None, "relevance_by": None, "relevance_at": None},
    "pilot_metrics": {"value": None, "detail": {}, "computed_at": _NOW},
    "content_pool": {"misconception_tag": None, "status": "pending_review", "model": None, "cost_usd": 0,
                     "hit_count": 0, "approved_by": None, "approved_at": None, "created_at": _NOW},
    "library_documents": {"curriculum_id": None, "pages": None, "uploaded_by": None, "created_at": _NOW},
    "library_chunks": {"page": None, "embedding": None},
    "retention_runs": {"detail": None, "ran_at": _NOW},
    "storage_deletions": {"requested_at": _NOW, "done_at": None, "error": None},
    "audit.events": {"at": _NOW, "actor_id": None, "row_id": None, "diff": None},
    "runtime_flags": {"updated_at": _NOW, "updated_by": None},
    "mastery_history": {"created_at": _NOW},
    "misconceptions": {"status": "pending_review", "evidence_count": 0, "first_seen": _NOW, "last_seen": _NOW,
                       "resolved_at": None, "resolved_by": None, "resolution_observation_id": None,
                       "rejected_by": None, "reject_note": None},
    "table_sizes_daily": {"row_estimate": None},
}
"""Migration'lardaki ``default`` değerleri (yalnız eksik sütunlara uygulanır)."""

REDACTED_RPC_PARAMS: dict[str, tuple[str, ...]] = {
    "register_answer_key": ("p_key",),
    "register_template_question": ("p_key",),
}
"""``rpc_calls.jsonl``'e değeri yazılmayan parametreler (cevap anahtarı dosyaya yazılmaz, §6.1)."""

_ISO_DT = re.compile(r"^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$")


def _pk(table: str) -> tuple[str, ...]:
    return PRIMARY_KEYS.get(table, ("id",))


def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return iso(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Mapping):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return value


def _as_time(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return parse_ts(value)
    if isinstance(value, date):
        return parse_ts(value)
    if isinstance(value, str) and _ISO_DT.match(value):
        try:
            return parse_ts(value)
        except ValueError:
            return None
    return None


def _cmp_pair(a: Any, b: Any) -> tuple[Any, Any] | None:
    """Karşılaştırılabilir çift; zaman damgası/tarih metinleri ``datetime``'a çevrilir."""
    if a is None or b is None:
        return None
    ta, tb = _as_time(a), _as_time(b)
    if ta is not None and tb is not None:
        return ta, tb
    if isinstance(a, bool) or isinstance(b, bool):
        return (a, b) if type(a) is type(b) else None
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a, b
    if isinstance(a, str) and isinstance(b, str):
        return a, b
    return (a, b) if type(a) is type(b) else None


def _eq(a: Any, b: Any) -> bool:
    if a is None or b is None:
        return False
    pair = _cmp_pair(a, b)
    if pair is not None:
        return pair[0] == pair[1]
    return _jsonable(a) == _jsonable(b)


def matches(row: Mapping[str, Any], where: Where | None) -> bool:
    """SQL anlamıyla eşleşme (``null`` hiçbir eşitliği sağlamaz; ``is``/``not_is`` ile sınanır)."""
    if not where:
        return True
    for col, cond in where.items():
        value = row.get(col)
        if isinstance(cond, Filter):
            op, arg = cond.op, cond.value
        elif isinstance(cond, (list, tuple, set, frozenset)):
            op, arg = "in", list(cond)
        else:
            op, arg = "eq", cond
        if op == "eq":
            ok = _eq(value, arg)
        elif op == "neq":
            ok = value is not None and arg is not None and not _eq(value, arg)
        elif op in ("gt", "gte", "lt", "lte"):
            pair = _cmp_pair(value, arg)
            if pair is None:
                ok = False
            else:
                x, y = pair
                ok = {"gt": x > y, "gte": x >= y, "lt": x < y, "lte": x <= y}[op]
        elif op == "in":
            ok = any(_eq(value, a) for a in arg)
        elif op == "is":
            ok = value is None if arg is None else value is arg
        elif op == "not_is":
            ok = value is not None if arg is None else value is not arg
        elif op == "cs":
            ok = isinstance(value, list) and all(any(_eq(v, a) for v in value) for a in arg)
        else:
            raise DbError(f"OGR-DB-002 bilinmeyen işleç: {op}")
        if not ok:
            return False
    return True


def _order_key(col: str, desc: bool):
    def key(row: Mapping[str, Any]):
        v = row.get(col)
        t = _as_time(v)
        if v is None:
            # Postgres: ASC'de null sonda, DESC'de başta → her iki yönde de 'en büyük' sayılır
            return (1, "")
        return (0, t if t is not None else v)

    return key


class JsonlDb:
    """``DB`` Protocol'ünün sahtesi (``batch_worker`` görünümü)."""

    def __init__(self, tables: Mapping[str, Sequence[Mapping[str, Any]]] | None = None, *,
                 out_dir: Path | str | None = None, clock: Clock | None = None, role: str = "batch_worker"):
        self.tables: dict[str, list[dict]] = {}
        for name, rows in (tables or {}).items():
            self.tables[name] = [copy.deepcopy(dict(r)) for r in rows]
        self.out_dir = Path(out_dir) if out_dir is not None else None
        self.clock: Clock = clock or fake_clock_from_env()
        self.role = role
        self._written: dict[str, dict[tuple, None]] = {}
        self._deleted: list[dict] = []
        self.rpc_log: list[dict] = []
        self.write_log: list[dict] = []
        self._uuid_seq: dict[str, int] = {}
        self._via: str = "direct"
        self.size_overrides: dict[str, int] = {}
        """``compute_table_sizes`` için sahte tablo boyutları (bayt)."""

    # --- kurulum -------------------------------------------------------------------------------

    @classmethod
    def from_fixtures(cls, fixtures: Path | str | None = None, *, out_dir: Path | str | None = None,
                      clock: Clock | None = None, base: Path | str | bool | None = True,
                      role: str = "batch_worker") -> JsonlDb:
        """Taban ``dev-seed.json`` (``base=False`` ile kapatılır) + ``fixtures`` dizinindeki tablolar."""
        tables: dict[str, list[dict]] = {}
        if base:
            base_path = dev_seed_path() if base is True else Path(base)
            tables.update(load_multi_table(base_path))
        if fixtures is not None:
            path = Path(fixtures)
            if path.is_file():
                overlay = load_multi_table(path)
            elif path.is_dir():
                overlay = load_fixture_dir(path) if path.resolve() != dev_seed_path().parent.resolve() else {}
            else:
                raise DbError(f"OGR-DB-002 fixture yolu yok: {path}")
            tables.update(overlay)
        return cls(tables, out_dir=out_dir, clock=clock, role=role)

    def seed(self, table: str, rows: Mapping[str, Any] | Sequence[Mapping[str, Any]], *, replace: bool = False) -> None:
        """Test kurulumu: satırları yetki/tetikleyici olmadan ekler (çıktıya yazılmaz)."""
        self._check_table(table)
        items = [rows] if isinstance(rows, Mapping) else list(rows)
        if replace:
            self.tables[table] = []
        self.tables.setdefault(table, []).extend(copy.deepcopy(dict(r)) for r in items)

    def now(self) -> datetime:
        return self.clock()

    def today(self) -> date:
        return istanbul_date(self.clock())

    # --- yardımcılar ----------------------------------------------------------------------------

    def _check_table(self, table: str) -> None:
        if table not in KNOWN_TABLES and table not in self.tables:
            raise DbError(f"OGR-DB-002 bilinmeyen tablo: {table}")

    def _rows(self, table: str) -> list[dict]:
        self._check_table(table)
        return self.tables.setdefault(table, [])

    def _key(self, table: str, row: Mapping[str, Any]) -> tuple:
        return tuple(_jsonable(row.get(c)) for c in _pk(table))

    def _privileged(self) -> bool:
        return self.role in ("service_role", "postgres")

    def _check_read(self, table: str, columns: Sequence[str] | None) -> None:
        if self._privileged():
            return
        if table.startswith("secure."):
            raise DbPermissionError("OGR-DB-001 permission denied for schema secure")
        if table in HIDDEN_TABLES:
            raise DbPermissionError(f"OGR-DB-001 permission denied for table {table}")
        denied = DENIED_READ_COLUMNS.get(table, frozenset())
        for col in columns or ():
            if col in denied:
                raise DbPermissionError(f"OGR-DB-001 permission denied for column {col} of relation {table}")

    def _check_write(self, table: str, op: str, values: Mapping[str, Any]) -> None:
        if self._privileged() or self._via != "direct":
            return
        if table.startswith("secure."):
            raise DbPermissionError("OGR-DB-001 permission denied for schema secure")
        policy = BATCH_WORKER_WRITES.get(table)
        if policy is None:
            raise DbPermissionError(f"OGR-DB-001 permission denied for table {table} ({op})")
        if op == "insert" and not policy.get("insert"):
            raise DbPermissionError(f"OGR-DB-001 permission denied for table {table} (insert)")
        if op == "delete" and not policy.get("delete"):
            raise DbPermissionError(f"OGR-DB-001 permission denied for table {table} (delete)")
        if op == "update":
            allowed = policy.get("update")
            if not allowed:
                raise DbPermissionError(f"OGR-DB-001 permission denied for table {table} (update)")
            if allowed != _ALL:
                extra = set(values) - set(allowed)
                if extra:
                    raise DbPermissionError(
                        f"OGR-DB-001 permission denied for column {sorted(extra)[0]} of relation {table}")
        deny = set(policy.get("deny_columns", ()))
        if op == "insert":
            defaults = TABLE_DEFAULTS.get(table, {})
            hit = sorted(c for c in deny & set(values) if values[c] != defaults.get(c))
        else:
            hit = sorted(deny & set(values))
        if hit:
            raise DbPermissionError(f"OGR-DB-001 permission denied for column {hit[0]} of relation {table}")
        if policy.get("guard_status"):
            if op == "update" and {"status", "review_note"} & set(values):
                raise RpcError("OGR-Q-004 inceleme sütunları yalnız onay RPC'leriyle değişir")
            if op == "insert" and values.get("status") == "approved":
                raise RpcError("OGR-Q-001 anahtarsız ya da doğrulanmamış soru onaylanamaz")

    def _next_identity(self, table: str) -> int:
        ids = [r.get("id") for r in self._rows(table) if isinstance(r.get("id"), int)]
        return (max(ids) if ids else 0) + 1

    def new_uuid(self, table: str) -> str:
        """Deterministik uuid: ``uuid5(NAMESPACE_OGRENMEN, "jsonldb:<tablo>:<sıra>")``."""
        existing = {r.get("id") for r in self._rows(table)}
        while True:
            n = self._uuid_seq.get(table, 0) + 1
            self._uuid_seq[table] = n
            value = str(uuid.uuid5(NAMESPACE_OGRENMEN, f"jsonldb:{table}:{n}"))
            if value not in existing:
                return value

    def _apply_defaults(self, table: str, row: dict) -> dict:
        for col, default in TABLE_DEFAULTS.get(table, {}).items():
            if col not in row:
                if default is _NOW:
                    row[col] = iso(self.now())
                elif default is _TODAY:
                    row[col] = self.today().isoformat()
                else:
                    row[col] = copy.deepcopy(default)
        if _pk(table) == ("id",) and row.get("id") is None:
            row["id"] = self._next_identity(table) if table in IDENTITY_TABLES else self.new_uuid(table)
        return row

    def _mark(self, table: str, row: Mapping[str, Any], op: str) -> None:
        key = self._key(table, row)
        self._written.setdefault(table, {})[key] = None
        self.write_log.append({"table": table, "op": op, "key": list(key), "via": self._via})

    # --- okuma ----------------------------------------------------------------------------------

    def select(self, table: str, *, where: Where | None = None, columns: Sequence[str] | None = None,
               order: str | Sequence[str] | None = None, limit: int | None = None) -> list[dict]:
        self._check_read(table, columns)
        rows = [r for r in self._rows(table) if matches(r, where)]
        for spec in reversed([order] if isinstance(order, str) else list(order or [])):
            desc = spec.startswith("-") or spec.endswith(".desc")
            col = spec.lstrip("-").removesuffix(".desc").removesuffix(".asc")
            rows.sort(key=_order_key(col, desc), reverse=desc)  # null: ASC'de sonda, DESC'de başta
        if limit is not None:
            rows = rows[: max(0, int(limit))]
        denied = DENIED_READ_COLUMNS.get(table, frozenset()) if not self._privileged() else frozenset()
        out = []
        for r in rows:
            item = {k: copy.deepcopy(v) for k, v in r.items() if k not in denied}
            if columns:
                item = {c: item.get(c) for c in columns}
            out.append(item)
        return out

    def get(self, table: str, **key: Any) -> dict | None:
        """Birincil anahtar ya da eşitlik koşuluyla tek satır (yetki denetimli)."""
        rows = self.select(table, where=key, limit=1)
        return rows[0] if rows else None

    # --- yazma ----------------------------------------------------------------------------------

    def insert(self, table: str, rows: Mapping[str, Any] | Sequence[Mapping[str, Any]], *,
               on_conflict: str | None = None) -> list[dict]:
        """Ekler; ``on_conflict``: ``None`` (çakışma → hata), ``"ignore"`` (do nothing), ``"merge"`` (upsert)."""
        items = [rows] if isinstance(rows, Mapping) else list(rows)
        out: list[dict] = []
        for raw in items:
            row = _jsonable(dict(raw))
            self._check_write(table, "insert", row)
            row = self._apply_defaults(table, row)
            self._before_insert(table, row)
            key = self._key(table, row)
            existing = next((r for r in self._rows(table) if self._key(table, r) == key), None)
            if existing is not None:
                if on_conflict == "ignore":
                    continue
                if on_conflict == "merge":
                    existing.update(row)
                    self._mark(table, existing, "upsert")
                    out.append(copy.deepcopy(existing))
                    continue
                raise DbError(f"OGR-DB-002 birincil anahtar çakışması: {table} {key}")
            self._check_unique(table, row)
            self._rows(table).append(row)
            self._mark(table, row, "insert")
            self._after_insert(table, row)
            out.append(copy.deepcopy(row))
        return out

    def update(self, table: str, values: Mapping[str, Any], *, where: Where) -> list[dict]:
        if not where:
            raise DbError("OGR-DB-002 koşulsuz update yapılmaz")
        vals = _jsonable(dict(values))
        self._check_write(table, "update", vals)
        changed = []
        for row in self._rows(table):
            if matches(row, where):
                row.update(copy.deepcopy(vals))
                self._mark(table, row, "update")
                changed.append(copy.deepcopy(row))
        return changed

    def delete(self, table: str, *, where: Where) -> int:
        if not where:
            raise DbError("OGR-DB-002 koşulsuz delete yapılmaz")
        self._check_write(table, "delete", {})
        return self._delete_rows(table, lambda r: matches(r, where))

    def _delete_rows(self, table: str, pred) -> int:
        rows = self._rows(table)
        keep, gone = [], []
        for r in rows:
            (gone if pred(r) else keep).append(r)
        self.tables[table] = keep
        for r in gone:
            key = self._key(table, r)
            self._written.get(table, {}).pop(key, None)
            self._deleted.append({"table": table, "key": list(key), "via": self._via})
        return len(gone)

    # --- tetikleyiciler -------------------------------------------------------------------------

    def _check_unique(self, table: str, row: Mapping[str, Any]) -> None:
        if table == "questions" and row.get("content_hash"):
            if any(r.get("content_hash") == row["content_hash"] for r in self._rows(table)):
                raise DbError("OGR-DB-002 questions.content_hash benzersiz olmalı")
        if table == "figures" and row.get("code_hash"):
            if any(r.get("code_hash") == row["code_hash"] for r in self._rows(table)):
                raise DbError("OGR-DB-002 figures.code_hash benzersiz olmalı")

    def _before_insert(self, table: str, row: dict) -> None:
        if table == "messages" and row.get("sent_at") and not row.get("expires_at"):
            chat = next((c for c in self._rows("tg_chats") if c.get("chat_id") == row.get("chat_id")), None)
            days = int((chat or {}).get("retention_days") or 90)
            row["expires_at"] = iso(parse_ts(row["sent_at"]) + timedelta(days=days))
        if table in ("questions", "syllabus_topics") and row.get("skill_ids"):
            skills = {(s.get("curriculum_id"), s.get("id")) for s in self._rows("skills")}
            for sid in row["skill_ids"]:
                if (row.get("curriculum_id"), sid) not in skills:
                    raise RpcError(f"OGR-CURR-001 kazanım müfredatta yok: {sid}")
        if table == "llm_calls":
            from ..adapters.base import LLM_PURPOSES

            if row.get("purpose") not in LLM_PURPOSES:
                raise DbError(f"OGR-DB-002 llm_calls.purpose geçersiz: {row.get('purpose')}")
            if row.get("status") not in ("ok", "error", "rate_limited", "timeout", "cap_blocked", "cooldown_skip",
                                         "bad_output"):
                raise DbError(f"OGR-DB-002 llm_calls.status geçersiz: {row.get('status')}")

    def _after_insert(self, table: str, row: dict) -> None:
        if table == "llm_calls":
            self._spend_rollup(row)

    def _spend_rollup(self, call: Mapping[str, Any]) -> None:
        """``app.spend_rollup()``: gün (Europe/Istanbul) × amaç × sağlayıcı toplamı."""
        day = istanbul_date(call.get("created_at") or self.now()).isoformat()
        key = (day, call["purpose"], call["provider"])
        rows = self._rows("spend_ledger")
        led = next((r for r in rows if (r.get("day"), r.get("purpose"), r.get("provider")) == key), None)
        if led is None:
            led = {"day": day, "purpose": call["purpose"], "provider": call["provider"], "calls": 0, "tokens_in": 0,
                   "tokens_out": 0, "cost_usd": 0.0}
            rows.append(led)
        led["calls"] = int(led.get("calls") or 0) + 1
        led["tokens_in"] = int(led.get("tokens_in") or 0) + int(call.get("tokens_in") or 0)
        led["tokens_out"] = int(led.get("tokens_out") or 0) + int(call.get("tokens_out") or 0)
        led["cost_usd"] = round(float(led.get("cost_usd") or 0) + float(call.get("cost_usd") or 0), 6)
        prev, self._via = self._via, "trigger:spend_rollup"
        try:
            self._mark("spend_ledger", led, "upsert")
        finally:
            self._via = prev

    # --- RPC ------------------------------------------------------------------------------------

    def rpc(self, name: str, params: Mapping[str, Any] | None = None) -> Any:
        from .jsonl_rpc import RPCS

        params = dict(params or {})
        fn = RPCS.get(name)
        if fn is None:
            raise RpcError(f"OGR-RPC-001 bilinmeyen RPC (JsonlDb eşleniği yok): {name}", rpc=name)
        logged = {k: ({"redacted": True, "sympy_status": (v or {}).get("sympy_status")}
                      if k in REDACTED_RPC_PARAMS.get(name, ()) and isinstance(v, Mapping) else _jsonable(v))
                  for k, v in params.items()}
        entry: dict[str, Any] = {"rpc": name, "params": logged, "at": iso(self.now())}
        prev, self._via = self._via, f"rpc:{name}"
        try:
            result = fn(self, **params)
        except TypeError as exc:
            entry["error"] = f"OGR-RPC-001 parametre uyuşmazlığı: {exc}"
            self.rpc_log.append(entry)
            raise RpcError(f"OGR-RPC-001 {name} parametre uyuşmazlığı: {exc}", rpc=name) from exc
        except RpcError as exc:
            entry["error"] = exc.message
            self.rpc_log.append(entry)
            if exc.rpc is None:
                exc.rpc = name
            raise
        finally:
            self._via = prev
        entry["ok"] = True
        self.rpc_log.append(entry)
        return copy.deepcopy(result)

    # İç (SECURITY DEFINER) erişim: RPC gövdeleri yetki denetimi olmadan okur/yazar.
    def _all(self, table: str) -> list[dict]:
        return self._rows(table)

    def _find(self, table: str, **eqs: Any) -> list[dict]:
        return [r for r in self._rows(table) if matches(r, eqs)]

    def _one(self, table: str, **eqs: Any) -> dict | None:
        found = self._find(table, **eqs)
        return found[0] if found else None

    def _insert_internal(self, table: str, row: Mapping[str, Any], *, on_conflict: str | None = None) -> dict | None:
        prev_role, self.role = self.role, "postgres"
        try:
            got = self.insert(table, row, on_conflict=on_conflict)
        finally:
            self.role = prev_role
        return got[0] if got else None

    def _update_internal(self, table: str, row: dict, values: Mapping[str, Any]) -> dict:
        row.update(_jsonable(dict(values)))
        self._mark(table, row, "update")
        return row

    # --- çıktı ----------------------------------------------------------------------------------

    def written(self, table: str) -> list[dict]:
        """Bu çalışmada yazılan/güncellenen satırların son hâli (yazım sırasıyla)."""
        keys = self._written.get(table, {})
        index = {self._key(table, r): r for r in self._rows(table)}
        denied = DENIED_READ_COLUMNS.get(table, frozenset())  # out/ batch_worker görünümüdür: text_raw yazılmaz
        return [{c: copy.deepcopy(v) for c, v in index[k].items() if c not in denied} for k in keys if k in index]

    def written_tables(self) -> list[str]:
        return [t for t, keys in self._written.items() if keys]

    def flush(self, out_dir: Path | str | None = None) -> list[Path]:
        """``out/<tablo>.jsonl`` + ``rpc_calls.jsonl`` + ``deletions.jsonl`` yazar; yazılan yolları döner."""
        target = Path(out_dir) if out_dir is not None else self.out_dir
        if target is None:
            return []
        target.mkdir(parents=True, exist_ok=True)
        paths = []
        for table in self.written_tables():
            if table.startswith("secure."):
                continue
            path = target / f"{table}.jsonl"
            _write_jsonl(path, self.written(table))
            paths.append(path)
        if self.rpc_log:
            path = target / "rpc_calls.jsonl"
            _write_jsonl(path, self.rpc_log)
            paths.append(path)
        visible_deletes = [d for d in self._deleted if not d["table"].startswith("secure.")]
        if visible_deletes:
            path = target / "deletions.jsonl"
            _write_jsonl(path, visible_deletes)
            paths.append(path)
        return paths


def _write_jsonl(path: Path, rows: Iterable[Mapping[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(_jsonable(row), ensure_ascii=False) + "\n")


def load_multi_table(path: Path) -> dict[str, list[dict]]:
    """``{"tablo": [satır…]}`` biçimli dosya (``dev-seed.json``, ``lesson-morale.json``)."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise DbError(f"OGR-DB-002 çok tablolu fixture bekleniyordu: {path}")
    out = {}
    for name, rows in data.items():
        if name not in KNOWN_TABLES:
            raise DbError(f"OGR-DB-002 {path.name}: bilinmeyen tablo {name}")
        if not isinstance(rows, list):
            raise DbError(f"OGR-DB-002 {path.name}: {name} satır dizisi değil")
        out[name] = [dict(r) for r in rows]
    return out


def fixture_table_name(stem: str) -> str | None:
    if stem in FIXTURE_TABLE_ALIASES:
        return FIXTURE_TABLE_ALIASES[stem]
    name = stem.replace("-", "_")
    return name if name in KNOWN_TABLES else None


def load_fixture_dir(folder: Path) -> dict[str, list[dict]]:
    """Dizindeki tablo dosyaları (ad sırası); aynı tablo birincil anahtara göre birleşir."""
    out: dict[str, dict[tuple, dict]] = {}
    for path in sorted(Path(folder).glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise DbError(f"OGR-DB-002 bozuk fixture: {path}: {exc}") from exc
        pieces: dict[str, list] = {}
        if isinstance(data, dict) and data and all(k in KNOWN_TABLES and isinstance(v, list) for k, v in data.items()):
            pieces = data
        elif isinstance(data, list) and all(isinstance(r, dict) for r in data):
            table = fixture_table_name(path.stem)
            if table is not None:
                pieces = {table: data}
        for table, rows in pieces.items():
            bucket = out.setdefault(table, {})
            for r in rows:
                bucket[tuple(_jsonable(r.get(c)) for c in _pk(table)) or (len(bucket),)] = dict(r)
    return {t: list(b.values()) for t, b in out.items()}
