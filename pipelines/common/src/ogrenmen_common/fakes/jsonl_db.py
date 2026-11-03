"""JsonlDb — fixtures JSON'dan bellek içi tablolar; ``out/<tablo>.jsonl`` yazar (§12 #42).

Pipeline'ların (``service_role``; v2'de uygulama rolü yoktur) PostgREST'ten gördüğü dünyanın sahtesidir:

* **Yükleme.** Taban dünya ``fixtures/db/dev-seed.json``'dur. ``from_fixtures(<dizin>)`` ayrıca o
  dizindeki tablo dosyalarını okur; dizindeki bir tablo tabandaki aynı tablonun **yerine geçer**
  (senaryo verisi). Dosya → tablo eşlemesi: ``FIXTURE_TABLE_ALIASES`` (ör. ``messages-day.json`` →
  ``messages``), yoksa ad (``-`` → ``_``) bir tablo adıysa o tablo; çok tablolu dosyalar
  (``{"lessons": [...], ...}``) anahtar başına; sözleşme örnekleri (ör. ``facts-day.json``) atlanır.
  Aynı dizinde aynı tabloya düşen dosyalar birincil anahtara göre birleşir (ad sırası).
* **Şema denetimi.** ``fakes/grants-v2.json`` (migration'lardan üretilir, ``scripts/gen_grants_v2.py``) tablo ve
  sütun listesidir: olmayan tabloya ya da sütuna yazım/okuma canlıda hata vereceği için reddedilir
  (``OGR-DB-002``); rol yetkisi ``grants.require`` ile denetlenir (``service_role`` tam yetkili; ``postgres`` ve
  ``service_role`` dışındaki roller matriste tanımlı olmalıdır). Matris okunamazsa ``OGR-DB-004``.
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
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .. import grants
from ..adapters.base import Filter, Where, resolve_returning
from ..clock import Clock, fake_clock_from_env, iso, istanbul_date, parse_ts
from ..errors import DbError, DbPermissionError, RpcError
from ..paths import dev_seed_path

NAMESPACE_OGRENMEN = uuid.uuid5(uuid.NAMESPACE_DNS, "ogrenmen.easy")
"""fixtures/README.md ile aynı ad alanı (deterministik kimlikler)."""

PRIMARY_KEYS: dict[str, tuple[str, ...]] = {
    "settings": ("key",),
    "runtime_flags": ("key",),
    "skills": ("curriculum_id", "id"),
    "skill_prerequisites": ("curriculum_id", "skill_id", "prereq_id"),
    "misconception_tags": ("tag",),
    "secure.answer_keys": ("question_id",),
    "secure.exam_answer_keys": ("question_id",),
    "preferences": ("student_id",),
    "spend_ledger": ("day", "purpose", "provider"),
    "mastery": ("enrollment_id", "skill_id"),
    "misconception_evidence": ("misconception_id", "observation_id"),
    "style_coverage": ("enrollment_id", "style_id"),
    "memory_files": ("student_id", "path"),
    "notification_rules": ("recipient_id", "kind"),
    "student_dossier_cache": ("student_id", "course_id"),
    "lesson_labels": ("hash",),
    # pipeline mirası (aşağıda LEGACY_PIPELINE_TABLES)
    "staff_students": ("staff_id", "student_id"),
    "secure.student_pii": ("student_id",),
    "provider_health": ("provider",),
}
"""Birincil anahtarı ``id`` olmayan tablolar (§3)."""

IDENTITY_TABLES = frozenset({
    "observations", "mastery_history", "attempts", "conversation_messages", "memory_file_versions", "memory_facts",
    "library_chunks", "llm_calls", "audit.events",
})
"""``bigint generated always as identity`` birincil anahtarlı tablolar."""

FIXTURE_TABLE_ALIASES: dict[str, str] = {
    "llm-calls-month": "llm_calls",
    "spend-ledger-month": "spend_ledger",
    "memory-facts": "memory_facts",
    "questions-review": "questions",
    "labels": "lesson_labels",
}
"""fixtures dosya adı (uzantısız) → tablo (fixtures/README.md "Dizinler" tablosu)."""

LEGACY_PIPELINE_TABLES = frozenset({
    "generation_requests", "exam_clusters", "instructor_alerts", "proactive_messages", "provider_health",
    "diagnostic_tests", "staff", "staff_students", "secure.student_pii",
})
"""v2 şemasında bulunmayan ama pipelines/{tablet,kalem,ders} ile ``CostLedger``'ın (Gemini zinciri) hâlâ kullandığı v1
tabloları. Sahte dünyada **sütun denetimi olmadan** tutulur; ilgili kod yolları P3/P5 servislerine taşındıkça bu
liste küçülür ve boşalınca silinir (docs/PLAN-v2-detail.md §13)."""

LEGACY_PIPELINE_COLUMNS: dict[str, frozenset[str]] = {
    "exam_items": frozenset({"cluster_id"}),
    "exam_sources": frozenset({"legal_basis", "instructor_alias", "uploaded_by"}),
    "courses": frozenset({"instructor_alias"}),
    "students": frozenset({"deleted_at", "is_minor", "tier", "tz"}),
    "preferences": frozenset({"voice_reply"}),
    "lessons": frozenset({"deletion_notified_at", "staff_id", "video_deleted_at", "video_ref"}),
    "questions": frozenset({"guard_status"}),
}
"""v2 tablosunda olmayan ama aynı pipeline'ların hâlâ yazdığı sütunlar (tablo başına izinli küme)."""

LEGACY_V1_TABLES = frozenset({
    "quota_tiers", "quota_limits", "retention_policies", "legal_texts", "diagnostic_sessions",
    "secure.telegram_identities", "secure.guardian_codes", "secure.staff_codes", "secure.auth_links", "consents",
    "tg_chats", "chat_roles", "tg_updates", "sessions", "messages", "bot_responses", "quota_usage", "escalations",
    "research_requests", "research_outputs", "citations", "pilot_metrics", "retention_runs", "table_sizes_daily",
    "storage_deletions",
})
"""v1'de olup ne v2'de ne pipeline'larda kullanılan tablolar (Telegram, kota, oturum, saklama, bilimsel kaynak,
pilot metrikleri): eski fixture dosyalarında geçebilir, yüklenirken **atlanır**; yazılamaz/okunamaz
(``tests/test_jsonl_db.py::test_legacy_v1_tables_are_dropped``)."""

def _known_tables() -> frozenset[str]:
    """Migration'lardaki tablolar (``public.`` öneksiz; ``secure.*`` ve ``audit.events`` şemalı) + sahte dünyaya özgü
    ``lesson_labels``."""
    names = {t.removeprefix("public.") for t in grants.load_matrix()["tables"]}
    return frozenset(names | {"lesson_labels"} | LEGACY_PIPELINE_TABLES)


KNOWN_TABLES = _known_tables()
"""v2 tabloları (grants-v2.json) + ``LEGACY_PIPELINE_TABLES``; ``lesson_labels`` yalnız sahte dünyadadır."""

LLM_CALL_STATUSES = frozenset({"ok", "error", "rate_limited", "overloaded", "timeout", "cap_blocked", "bad_output",
                               "refusal", "max_tokens"})
"""``llm_calls.status`` check kısıtı (0014_llm_ledger.sql)."""

_NOW = object()
_TODAY = object()

TABLE_DEFAULTS: dict[str, dict[str, Any]] = {
    "llm_calls": {
        "tokens_in": 0, "tokens_out": 0, "audio_sec": None, "images": None, "batch": False, "error_code": None,
        "latency_ms": None, "cost_usd": 0, "ref_table": None, "ref_id": None, "student_ref": None,
        "created_at": _NOW, "provider": "anthropic", "cache_read_tokens": 0, "cache_write_tokens": 0, "route": None,
        "effort": None, "prompt_version": None
    },
    "lessons": {
        "status": 'uploaded', "transcript_path": None, "frames_count": None, "created_at": _NOW,
        "student_visible": False, "auto_apply_threshold": 0.8
    },
    "lesson_analyses": {
        "version": 1, "status": "draft", "cost_usd": 0, "approved_by": None, "approved_at": None, "created_at": _NOW
    },
    "lesson_claims": {
        "status": "pending", "edited_value": None, "decided_by": None, "decided_at": None, "misconception_tag": None,
        "misconception_id": None, "skill_id": None, "t_end_sec": None
    },
    "questions": {
        "stem_values": {}, "figure_id": None, "options": None, "difficulty": None, "template_id": None,
        "template_params": None, "status": "draft", "model": None, "cost_usd": 0, "prompt_version": None,
        "reviewed_by": None, "reviewed_at": None, "review_note": None, "created_at": _NOW,
        "verification": {"schema": True, "sympy": "pending", "render": "not_applicable",
                         "vision": "not_applicable", "attempts": 0},
        "kind": "mcq"
    },
    "figures": {
        "png_path": None, "svg_path": None, "width_px": None, "height_px": None, "bytes": None,
        "render_status": "pending", "vision_status": "pending", "vision_report": None, "attempts": 0,
        "review_status": "pending", "reviewed_by": None, "reviewed_at": None, "render_log": None, "created_at": _NOW
    },
    "memory_facts": {
        "source_message_ids": [], "source_lesson_claim_id": None, "confidence": 0.7, "requires_approval": False,
        "approved": False, "approved_by": None, "valid_from": _TODAY, "valid_until": None, "morale_signal": None,
        "status": 'active', "embedding": None, "model": None, "cost_usd": 0, "created_at": _NOW
    },
    "weekly_summaries": {"facts_used": [], "model": None, "cost_usd": 0, "created_at": _NOW},
    "exam_sources": {
        "status": 'uploaded', "error": None, "instructor_alias": None, "uploaded_by": None, "created_at": _NOW
    },
    "exam_items": {
        "topic": None, "kind": None, "points": None, "curriculum_id": None, "skill_id": None, "ocr_text": None,
        "embedding": None
    },
    "exam_priority_plans": {"status": 'pending_review', "approved_by": None, "approved_at": None, "created_at": _NOW},
    "content_pool": {
        "misconception_tag": None, "status": 'pending_review', "model": None, "cost_usd": 0, "hit_count": 0,
        "approved_by": None, "approved_at": None, "created_at": _NOW
    },
    "library_documents": {"curriculum_id": None, "pages": None, "uploaded_by": None, "created_at": _NOW},
    "library_chunks": {"page": None, "embedding": None},
    "audit.events": {"actor_id": None, "row_id": None, "diff": None},
    "runtime_flags": {"updated_at": _NOW, "updated_by": None},
    "mastery_history": {"created_at": _NOW},
    "misconceptions": {
        "status": 'pending_review', "evidence_count": 0, "first_seen": _NOW, "last_seen": _NOW, "resolved_at": None,
        "resolved_by": None, "resolution_observation_id": None, "rejected_by": None, "reject_note": None
    },
    "courses": {"kind": 'other', "visibility": 'private'},
    "syllabus_topics": {"skill_ids": []},
    "question_templates": {"enabled": True, "has_figure": True},
}
TABLE_DEFAULTS.update({
    "generation_requests": {"kind": "pool_miss", "difficulty_band": "mid", "topic": None, "question_kind": None,
                            "points": None, "plan_id": None, "requested_by": None, "requested_by_staff": None,
                            "served_question_id": None, "served_at": None, "needs_generation": False,
                            "created_at": _NOW},
    "exam_clusters": {"kind": None, "curriculum_id": None, "skill_id": None, "item_count": 0, "years_hit": [],
                      "years_total": 0, "avg_points": None, "updated_at": _NOW},
    "instructor_alerts": {"student_id": None, "staff_id": None, "since": None, "ref": {}, "status": "open",
                          "created_at": _NOW, "resolved_at": None, "resolved_by": None},
    "proactive_messages": {"recipient": "student", "params": {}, "sent_at": None, "status": "scheduled"},
})
TABLE_DEFAULTS["exam_items"] = {**TABLE_DEFAULTS.get("exam_items", {}), "cluster_id": None}
TABLE_DEFAULTS["exam_sources"] = {**TABLE_DEFAULTS.get("exam_sources", {}), "error": None, "instructor_alias": None,
                                  "uploaded_by": None}
TABLE_DEFAULTS["lessons"] = {**TABLE_DEFAULTS.get("lessons", {}), "video_deleted_at": None,
                             "deletion_notified_at": None}
"""Migration ``default`` değerleri (yalnız eksik sütunlara uygulanır) + pipeline mirası tabloların varsayılanları."""

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
    """``DB`` Protocol'ünün sahtesi (``service_role`` görünümü)."""

    def __init__(self, tables: Mapping[str, Sequence[Mapping[str, Any]]] | None = None, *,
                 out_dir: Path | str | None = None, clock: Clock | None = None, role: str = "service_role"):
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
                      role: str = "service_role") -> JsonlDb:
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
        """Olmayan tablo/sütun okuması canlıda hata verir; yetki matrisi service_role dışı roller içindir."""
        if self._via != "direct":
            return
        known = grants.columns(table)
        if known is None:
            return
        known = known | LEGACY_PIPELINE_COLUMNS.get(table, frozenset())
        for col in columns or ():
            if col not in known:
                raise DbError(f"OGR-DB-002 {table}.{col} v2 şemasında yok")
        if not self._privileged():
            grants.require(self.role, table, "select", columns or [])

    def _check_write(self, table: str, op: str, values: Mapping[str, Any]) -> None:
        """Doğrudan (PostgREST) yazımda sütunlar v2 şemasında olmalıdır (RPC/tetikleyici yolları denetlenmez)."""
        if self._via != "direct" or self.role == "postgres":
            return
        known = grants.columns(table)
        if known is None:
            if table in LEGACY_PIPELINE_TABLES:
                known = frozenset(values)  # pipeline mirası: sütun denetimi yok
            else:
                raise DbError(f"OGR-DB-002 {table} v2 şemasında yok")
        known = known | LEGACY_PIPELINE_COLUMNS.get(table, frozenset())
        unknown = sorted(set(values) - known)
        if unknown:
            raise DbError(f"OGR-DB-002 {table}.{unknown[0]} v2 şemasında yok (sütunlar: grants-v2.json)")
        if table == "questions":
            if op == "update" and {"status", "review_note"} & set(values):
                raise RpcError("OGR-Q-004 inceleme sütunları yalnız onay RPC'leriyle değişir")
            if op == "insert" and values.get("status") == "approved":
                raise RpcError("OGR-Q-001 anahtarsız ya da doğrulanmamış soru onaylanamaz")

    def _check_grants(self, table: str, op: str, columns: Iterable[str], *, where: Where | None = None,
                      on_conflict: str | None = None, returning: str = "minimal") -> None:
        """Rol yetkisi (``grants-v2.json``; çalışma anında okunur). ``service_role`` ve ``postgres`` tam yetkilidir
        (RLS'i aşar); matriste tanımlı başka bir rol için: yazılan sütunlar INSERT/UPDATE yetkisinde, ``merge`` için
        ayrıca UPDATE ve çakışma sütunlarında SELECT, ``where`` sütunları SELECT, ``returning='representation'``
        tablo düzeyi SELECT ister. İhlal → ``OGR-DB-001``."""
        if self._privileged() or self._via != "direct":
            return
        cols = list(columns)
        grants.require(self.role, table, op, cols)
        if op == "insert" and on_conflict == "merge":
            grants.require(self.role, table, "update", cols, why="on conflict do update")
            grants.require(self.role, table, "select", _pk(table), why="on conflict hedefi")
        if where:
            grants.require(self.role, table, "select", list(where), why=f"{op} where")
        if returning == "representation" and not grants.has_full(self.role, table, "select"):
            raise DbPermissionError(f"OGR-DB-001 permission denied for table {table} ({op} RETURNING *: {self.role} "
                                    "tablo düzeyi SELECT yetkisi yok; returning='minimal' kullan)")

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
        out = []
        for r in rows:
            item = {k: copy.deepcopy(v) for k, v in r.items()}
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
               on_conflict: str | None = None, returning: str | None = None) -> list[dict]:
        """Ekler; ``on_conflict``: ``None`` (çakışma → hata), ``"ignore"`` (do nothing), ``"merge"`` (upsert).
        ``returning``: ``"minimal"`` → ``[]`` (SELECT gerekmez), ``"representation"`` → satırlar (tablo düzeyi
        SELECT gerekir); ``None`` → satır dizisi minimal, tek satır representation (PostgrestDb ile aynı)."""
        mode = resolve_returning(returning, single_row=isinstance(rows, Mapping))
        if on_conflict not in (None, "ignore", "merge"):
            raise DbError(f"OGR-DB-002 bilinmeyen on_conflict: {on_conflict}")
        items = [rows] if isinstance(rows, Mapping) else list(rows)
        out: list[dict] = []
        for raw in items:
            supplied = _jsonable(dict(raw))
            self._check_write(table, "insert", supplied)
            self._check_grants(table, "insert", supplied, on_conflict=on_conflict, returning=mode)
            # Çakışma, çağıranın gönderdiği anahtarla aranır; üretilen id yalnız yeni satıra verilir.
            new_identity = _pk(table) == ("id",) and supplied.get("id") is None
            # Anahtar sütunlarının varsayılanı (ör. gün) da anahtara girer; id üretimi yalnız gerçek eklemede.
            probe = supplied if new_identity else self._apply_defaults(table, copy.deepcopy(supplied))
            existing = None if new_identity else next(
                (r for r in self._rows(table) if self._key(table, r) == self._key(table, probe)), None)
            if existing is not None:
                if on_conflict == "ignore":
                    continue
                if on_conflict == "merge":
                    # PostgREST resolution=merge-duplicates: yalnız gönderilen sütunlar güncellenir.
                    existing.update(copy.deepcopy(supplied))
                    self._mark(table, existing, "upsert")
                    out.append(copy.deepcopy(existing))
                    continue
                raise DbError(f"OGR-DB-002 birincil anahtar çakışması: {table} {self._key(table, probe)}")
            row = self._apply_defaults(table, supplied) if new_identity else probe
            self._before_insert(table, row)
            self._check_unique(table, row)
            self._rows(table).append(row)
            self._mark(table, row, "insert")
            self._after_insert(table, row)
            out.append(copy.deepcopy(row))
        return out if mode == "representation" else []

    def update(self, table: str, values: Mapping[str, Any], *, where: Where,
               returning: str | None = None) -> list[dict]:
        """``returning``: ``"minimal"`` (varsayılan) → ``[]``; ``"representation"`` → güncellenen satırlar (tablo
        düzeyi SELECT gerekir; ör. ``messages``'ta yoktur)."""
        if not where:
            raise DbError("OGR-DB-002 koşulsuz update yapılmaz")
        mode = resolve_returning(returning, single_row=False)
        vals = _jsonable(dict(values))
        self._check_write(table, "update", vals)
        self._check_grants(table, "update", vals, where=where, returning=mode)
        changed = []
        for row in self._rows(table):
            if matches(row, where):
                row.update(copy.deepcopy(vals))
                self._mark(table, row, "update")
                changed.append(copy.deepcopy(row))
        return changed if mode == "representation" else []

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
        if table in ("questions", "syllabus_topics") and row.get("skill_ids"):
            skills = {(s.get("curriculum_id"), s.get("id")) for s in self._rows("skills")}
            for sid in row["skill_ids"]:
                if (row.get("curriculum_id"), sid) not in skills:
                    raise RpcError(f"OGR-CURR-001 kazanım müfredatta yok: {sid}")
        if table == "llm_calls":
            if not row.get("purpose"):
                raise DbError("OGR-DB-002 llm_calls.purpose boş olamaz")
            if row.get("status") not in LLM_CALL_STATUSES:
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
                   "tokens_out": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "cost_usd": 0.0}
            rows.append(led)
        led["calls"] = int(led.get("calls") or 0) + 1
        led["tokens_in"] = int(led.get("tokens_in") or 0) + int(call.get("tokens_in") or 0)
        led["tokens_out"] = int(led.get("tokens_out") or 0) + int(call.get("tokens_out") or 0)
        for col in ("cache_read_tokens", "cache_write_tokens"):
            led[col] = int(led.get(col) or 0) + int(call.get(col) or 0)
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
            got = self.insert(table, row, on_conflict=on_conflict, returning="representation")
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
        return [copy.deepcopy(index[k]) for k in keys if k in index]

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
        if name in LEGACY_V1_TABLES:
            continue
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
        if isinstance(data, dict) and data and all(
                (k in KNOWN_TABLES or k in LEGACY_V1_TABLES) and isinstance(v, list) for k, v in data.items()):
            pieces = {k: v for k, v in data.items() if k in KNOWN_TABLES}
        elif isinstance(data, list) and all(isinstance(r, dict) for r in data):
            table = fixture_table_name(path.stem)
            if table is not None:
                pieces = {table: data}
        for table, rows in pieces.items():
            bucket = out.setdefault(table, {})
            for i, r in enumerate(rows):
                key = tuple(_jsonable(r.get(c)) for c in _pk(table))
                if all(v is None for v in key):  # anahtarsız satır (ör. kimliği DB'nin vereceği llm_calls)
                    key = ("__row__", path.name, table, i)
                bucket[key] = dict(r)
    return {t: list(b.values()) for t, b in out.items()}
