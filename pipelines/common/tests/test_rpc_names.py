"""fakes/rpc-names.json ↔ JsonlDb.rpc() eşlenikleri ↔ BLUEPRINT'teki batch_worker RPC'leri."""

from __future__ import annotations

import json
import re
from importlib import resources

import pytest

from conftest import REPO
from ogrenmen_common.errors import RpcError
from ogrenmen_common.fakes import rpc_names
from ogrenmen_common.fakes.jsonl_rpc import RPCS

BLUEPRINT = (REPO / "docs" / "BLUEPRINT.md").read_text(encoding="utf-8")
BATCH_WORKER_RPCS = {
    # §3.9 grant satırları (batch_worker'a execute verilenler) + §3.0 profile_for_prompt
    "register_lesson", "write_lesson_analysis", "resolve_lesson_labels", "confirm_video_deleted",
    "register_template_question", "register_answer_key", "run_retention", "compute_table_sizes",
    "recompute_is_minor", "rollup_spend", "cap_memory_facts", "anonymize_students", "cron_due_proactive",
    "cron_open_alerts", "cron_idle_sessions", "check_spend", "set_runtime_flag", "profile_for_prompt",
}


def test_rpc_names_file_matches_registry_sorted_unique():
    raw = json.loads(resources.files("ogrenmen_common.fakes").joinpath("rpc-names.json").read_text(encoding="utf-8"))
    assert isinstance(raw, list) and all(isinstance(n, str) for n in raw)
    assert raw == sorted(set(raw)) == rpc_names()
    assert raw == sorted(RPCS)


def test_every_name_is_a_batch_worker_rpc_in_blueprint():
    for name in rpc_names():
        assert name in BATCH_WORKER_RPCS, name
        assert re.search(rf"\b(public\.)?{name}\b", BLUEPRINT), name


def test_names_are_plain_identifiers():
    assert all(re.fullmatch(r"[a-z_][a-z0-9_]*", n) for n in rpc_names())


MIGRATIONS = "\n".join(p.read_text(encoding="utf-8") for p in sorted((REPO / "supabase" / "migrations").glob("*.sql")))


def test_every_name_is_created_and_granted_to_batch_worker_in_migrations():
    created = set(re.findall(r"create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_][a-z0-9_]*)\s*\(",
                             MIGRATIONS, re.I))
    granted: set[str] = set()
    for m in re.finditer(r"grant\s+execute\s+on\s+function\s+(.*?)\s+to\s+([^;]*);", MIGRATIONS, re.I | re.S):
        if re.search(r"\bbatch_worker\b", m.group(2)):
            granted |= set(re.findall(r"public\.([a-z_][a-z0-9_]*)\s*\(", m.group(1)))
    for name in rpc_names():
        assert name in created, name
        assert name in granted, name


def test_cron_open_alerts_fake_refuses_and_points_to_python_port(db):
    """Dry-run alarmları Python eşleniğiyle (``open_alerts(db, now)``) üretir; RPC eşleniği bilerek çalışmaz."""
    writes = len(db.write_log)
    with pytest.raises(RpcError, match="OGR-RPC-002") as exc:
        db.rpc("cron_open_alerts", {})
    assert exc.value.code == "OGR-RPC-002" and exc.value.rpc == "cron_open_alerts"
    assert "Python eşleniği" in exc.value.message and "via_rpc=False" in exc.value.message
    assert len(db.write_log) == writes
    assert db.rpc_log[-1]["rpc"] == "cron_open_alerts" and db.rpc_log[-1]["error"].startswith("OGR-RPC-002")
