"""fakes/rpc-names.json ↔ JsonlDb.rpc() eşlenikleri ↔ BLUEPRINT'teki batch_worker RPC'leri."""

from __future__ import annotations

import json
import re
from importlib import resources

from conftest import REPO
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
