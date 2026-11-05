"""Runtime.from_env kipleri, cli_base ortak bayrakları ve selftest giriş noktası."""

from __future__ import annotations

import copy
import json
import subprocess
import sys

import ogrenmen_contracts as contracts
import pytest

from conftest import read_jsonl
from ogrenmen_common import cli_base, selftest
from ogrenmen_common.adapters.base import LLMRequest
from ogrenmen_common.errors import AdapterError, RpcError
from ogrenmen_common.runtime import Runtime


def test_acceptance_dry_run_is_fake():
    r = Runtime.from_env(dry_run=True)
    assert r.llm.__class__.__name__ == "FakeLLM" and r.mode == "fake" and r.is_fake
    assert type(r.db).__name__ == "JsonlDb" and r.clock().isoformat().startswith("2026-10-20T09:00")
    assert not hasattr(r, "scholars")  # bilimsel kaynak adaptörleri (pipelines/kitap ile birlikte) kaldırıldı


def test_ogrenmen_fakes_forces_fakes_even_with_keys(monkeypatch):
    monkeypatch.setenv("OGRENMEN_FAKES", "1")
    monkeypatch.setenv("GEMINI_PAID_KEY", "k")
    monkeypatch.setenv("SUPABASE_URL", "https://p.example.org")
    monkeypatch.setenv("SUPABASE_BATCH_JWT", "j")
    r = Runtime.from_env(dry_run=False, adapters="real")
    assert r.mode == "fake" and type(r.llm).__name__ == "FakeLLM" and type(r.db).__name__ == "JsonlDb"


def test_real_without_keys_falls_back_with_warnings(capsys):
    r = Runtime.from_env(dry_run=False, env={})
    assert r.mode == "mixed" and type(r.llm).__name__ == "FakeLLM" and type(r.db).__name__ == "JsonlDb"
    assert any("worker HTTP servisi" in w for w in r.warnings) and any("GROQ_API_KEY" in w for w in r.warnings)
    assert "UYARI:" in capsys.readouterr().err


def test_real_with_groq_key_builds_only_groq_stt():
    r = Runtime.from_env(dry_run=False, env={"GROQ_API_KEY": "q"}, quiet=True)
    assert r.mode == "mixed" and type(r.llm).__name__ == "ProviderRouter" and set(r.llm.adapters) == {"groq"}
    assert type(r.db).__name__ == "JsonlDb" and type(r.embedding.inner).__name__ == "FakeEmbedding"


@pytest.mark.parametrize("env", [
    {"SUPABASE_URL": "https://p.example.org", "SUPABASE_BATCH_JWT": "j", "SUPABASE_ANON_KEY": "a"},
    {"SUPABASE_BATCH_JWT": "j"},
    {"SUPABASE_SERVICE_ROLE_KEY": "s", "GROQ_API_KEY": "q"},
])
def test_real_refuses_direct_db_credentials(env):
    """v2: pipeline'lar DB'ye doğrudan yazmaz (PLAN §12); service_role yalnız apps/worker'da."""
    with pytest.raises(AdapterError, match="OGR-ADP-001 v2: pipelines DB'ye doğrudan yazmaz"):
        Runtime.from_env(dry_run=False, env=env, quiet=True)


def test_legacy_provider_keys_are_ignored_in_real_mode():
    env = {"GEMINI_PAID_KEY": "g1", "GROQ_KEY": "q", "ANTHROPIC_API_KEY": "x", "OPENROUTER_KEY": "o"}
    r = Runtime.from_env(dry_run=False, env=env, quiet=True)
    assert type(r.llm).__name__ == "FakeLLM" and r.batch.client is None


def test_embedding_model_and_dims_come_from_models_json(monkeypatch):
    import ogrenmen_common.runtime as runtime_mod

    models = copy.deepcopy(contracts.load_models())
    models["models"]["gemini-embedding-002"] = {**models["models"]["gemini-embedding-001"], "dims": 512}
    models["chains"]["embedding"] = ["gemini-embedding-002"]
    monkeypatch.setattr(runtime_mod.contracts, "load_models", lambda: models)
    fake = Runtime.from_env(dry_run=True)
    assert (fake.embedding.model, fake.embedding.dims) == ("gemini-embedding-002", 512)
    assert len(fake.embedding.embed(["x"])[0]) == 512


def test_dry_run_embedding_goes_through_ledger():
    r = Runtime.from_env(dry_run=True)
    vecs = r.embedding.embed(["kesir", "oran"])
    assert len(vecs) == 2 and len(vecs[0]) == 768 and r.embedding.calls == [2]
    row = r.db.written("llm_calls")[-1]
    assert (row["purpose"], row["provider"], row["model"], row["status"]) == (
        "embedding", "gemini-paid", "gemini-embedding-001", "ok")
    assert row["tokens_in"] > 0 and r.ledger.estimate()["by_purpose"]["embedding"]["calls"] == 1
    r.close()


def test_storage_is_private_per_runtime_and_removed_on_close():
    a, b = Runtime.from_env(dry_run=True), Runtime.from_env(dry_run=True)
    assert a.storage_tmp is not None and b.storage_tmp is not None and a.storage_tmp != b.storage_tmp
    assert a.storage_tmp.name.startswith("ogrenmen-storage-")
    a.storage.upload("figures", "q/1.png", b"png")
    assert a.storage.exists("figures", "q/1.png") and not b.storage.exists("figures", "q/1.png")
    root = a.storage_tmp
    a.close()
    assert not root.exists()
    c = Runtime.from_env(dry_run=True)
    assert not c.storage.exists("figures", "q/1.png")  # önceki çalışmanın nesnesi görünmez (determinizm)
    b.close()
    c.close()


def test_runtime_close_writes_outputs(tmp_path):
    r = Runtime.from_env(dry_run=True, out=tmp_path)
    assert "bot_responses" not in r.db.tables  # v1 tablosu sahte dünyaya yüklenmez
    r.ledger.call("nightly_facts", LLMRequest(purpose="nightly_facts", model="", prompt="gün",
                                              schema_id="nightly-facts-output"), student_ref="s_qk7m2rx4tn5a")
    written = {p.name for p in r.close()}
    assert {"llm_calls.jsonl", "spend_ledger.jsonl", "cost_estimate.json"} <= written
    assert read_jsonl(tmp_path / "llm_calls.jsonl")[0]["student_ref"] == "s_qk7m2rx4tn5a"


def _parser():
    p = cli_base.build_parser("ogrenmen_test", "deneme")
    sub = p.add_subparsers(dest="command", required=True)
    cmd = cli_base.add_command(sub, "facts", "gece olguları")
    cmd.add_argument("--day")
    return p


def test_common_flags_before_and_after_subcommand(tmp_path):
    a = _parser().parse_args(["--dry-run", "--out", str(tmp_path), "facts", "--day", "2026-10-18"])
    b = _parser().parse_args(["facts", "--dry-run", "--limit", "3", "--student-ref", "s_qk7m2rx4tn5a",
                              "--since", "2026-10-18", "--adapters", "fake"])
    ca, cb = cli_base.common_args(a), cli_base.common_args(b)
    assert ca.dry_run and ca.out == tmp_path and a.day == "2026-10-18"
    assert cb.dry_run and cb.limit == 3 and cb.student_ref == "s_qk7m2rx4tn5a" and cb.adapters == "fake"
    assert cb.since.isoformat() == "2026-10-18T00:00:00+00:00"
    plain = cli_base.common_args(_parser().parse_args(["facts"]))
    assert plain.dry_run is False and plain.out is None


@pytest.mark.parametrize("bad", [["facts", "--student-ref", "c661b28c-81a8-5c11-9a5e-b919b5231034"],
                                 ["facts", "--limit", "0"], ["facts", "--since", "dün"],
                                 ["facts", "--adapters", "canli"]])
def test_flag_validation(bad):
    with pytest.raises(SystemExit):
        _parser().parse_args(bad)


def test_missing_jwt_falls_back_to_dry_run(tmp_path, capsys):
    args = cli_base.CommonArgs(dry_run=False, fixtures=None, out=tmp_path / "o", limit=None, since=None,
                               student_ref=None, adapters="real")
    dry, message = cli_base.effective_dry_run(args, {})
    assert dry is True and "SUPABASE_URL/SUPABASE_BATCH_JWT yok" in message
    # İkisi birlikte gerçek veritabanıdır; biri eksikse dry-run (yarım gerçek kurulum yok).
    assert cli_base.effective_dry_run(args, {"SUPABASE_BATCH_JWT": "j"})[0] is True
    assert "SUPABASE_URL yok" in cli_base.effective_dry_run(args, {"SUPABASE_BATCH_JWT": "j"})[1]
    assert cli_base.effective_dry_run(args, {"SUPABASE_URL": "https://p.example.org"})[0] is True
    assert cli_base.effective_dry_run(args, {"SUPABASE_URL": "https://p.example.org",
                                             "SUPABASE_BATCH_JWT": "j"}) == (False, None)
    rt = cli_base.runtime_from_args(args, env={"GITHUB_ACTIONS": "true", "SUPABASE_BATCH_JWT": "j",
                                               "GEMINI_PAID_KEY": "g1"})
    assert rt.is_fake and rt.dry_run and type(rt.llm).__name__ == "FakeLLM"
    assert "::warning::SUPABASE_URL yok" in capsys.readouterr().err
    with pytest.raises(AdapterError, match="doğrudan yazmaz"):  # v2: DB kimliği verilirse kurulmaz
        cli_base.runtime_from_args(args, env={"SUPABASE_URL": "https://p.example.org", "SUPABASE_BATCH_JWT": "j"})
    with cli_base.open_runtime(args, env={}) as rt2:
        assert rt2.out == tmp_path / "o"
    assert (tmp_path / "o" / "cost_estimate.json").is_file()


def test_write_helpers_and_run_main(tmp_path, capsys):
    cli_base.write_json(tmp_path, "a.json", {"ş": 1})
    cli_base.write_jsonl(tmp_path, "b.jsonl", [{"x": 1}, {"x": 2}])
    assert json.loads((tmp_path / "a.json").read_text(encoding="utf-8")) == {"ş": 1}
    assert read_jsonl(tmp_path / "b.jsonl") == [{"x": 1}, {"x": 2}]

    def boom(argv):
        raise RpcError("OGR-KEY-003 anahtar kilitli")

    assert cli_base.run_main(boom, []) == 1 and "HATA: OGR-KEY-003" in capsys.readouterr().err
    assert cli_base.run_main(lambda argv: None, []) == 0


def test_selftest_main_passes_and_detects_failure(monkeypatch, capsys):
    assert selftest.main([]) == 0
    assert "selftest: 8/8 denetim geçti" in capsys.readouterr().out

    def broken(_):
        raise AssertionError("bozuk")

    monkeypatch.setattr(selftest, "CHECKS", [("bozuk", broken)])
    assert selftest.main([]) == 1
    assert "HATA  bozuk: bozuk" in capsys.readouterr().out


def test_selftest_module_entrypoint():
    proc = subprocess.run([sys.executable, "-m", "ogrenmen_common.selftest"], capture_output=True, text=True,
                          env={"OGRENMEN_FAKES": "1", "PATH": "/usr/bin:/bin"}, timeout=120)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout.count("TAMAM") == 8
