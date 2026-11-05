"""fakes/rpc-names*.json ↔ JsonlDb.rpc() eşlenikleri ↔ v2 migration'ları (v2 küme) / legacy-v1 küme."""

from __future__ import annotations

import json
import re
from importlib import resources

from conftest import REPO
from ogrenmen_common.fakes import legacy_rpc_names, rpc_names
from ogrenmen_common.fakes.jsonl_rpc import RPCS

MIGRATIONS = "\n".join(p.read_text(encoding="utf-8") for p in sorted((REPO / "supabase" / "migrations").glob("*.sql")))
CREATED = set(re.findall(r"create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_][a-z0-9_]*)\s*\(", MIGRATIONS, re.I))


def _raw(name: str) -> list:
    return json.loads(resources.files("ogrenmen_common.fakes").joinpath(name).read_text(encoding="utf-8"))


def test_rpc_names_files_are_sorted_unique_and_match_registry():
    for name, loaded in (("rpc-names.json", rpc_names()), ("rpc-names-legacy-v1.json", legacy_rpc_names())):
        raw = _raw(name)
        assert isinstance(raw, list) and all(isinstance(n, str) for n in raw)
        assert raw == sorted(set(raw)) == loaded
    assert sorted(RPCS) == sorted(rpc_names() + legacy_rpc_names())
    assert not set(rpc_names()) & set(legacy_rpc_names())


def test_names_are_plain_identifiers():
    assert all(re.fullmatch(r"[a-z_][a-z0-9_]*", n) for n in rpc_names() + legacy_rpc_names())


def test_v2_names_are_created_in_migrations():
    assert rpc_names()
    for name in rpc_names():
        assert name in CREATED, name


def test_legacy_names_have_no_v2_function():
    """legacy-v1 kümesi v2'de karşılığı olmayanlardır; bir ad v2'de doğarsa bu listeden v2 listesine taşınmalıdır."""
    for name in legacy_rpc_names():
        assert name not in CREATED, f"{name} artık v2'de var: rpc-names.json'a taşıyın ve parite imzasını eşleyin"


def test_v1_retention_and_telegram_rpcs_are_gone():
    gone = {"run_retention", "compute_table_sizes", "recompute_is_minor", "rollup_spend", "cap_memory_facts",
            "anonymize_students", "cron_due_proactive", "cron_open_alerts", "cron_idle_sessions"}
    assert not gone & set(RPCS)
