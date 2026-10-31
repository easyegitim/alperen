"""Runtime.from_env kipleri, cli_base ortak bayrakları ve selftest giriş noktası."""

from __future__ import annotations

import json
import subprocess
import sys

import pytest

from conftest import FIXTURES, read_jsonl
from ogrenmen_common import cli_base, selftest
from ogrenmen_common.adapters.base import LLMRequest
from ogrenmen_common.errors import RpcError
from ogrenmen_common.runtime import Runtime


def test_acceptance_dry_run_is_fake():
    r = Runtime.from_env(dry_run=True)
    assert r.llm.__class__.__name__ == "FakeLLM" and r.mode == "fake" and r.is_fake
    assert type(r.db).__name__ == "JsonlDb" and r.clock().isoformat().startswith("2026-10-20T09:00")
    assert {s.source for s in r.scholars} == {"openalex", "semantic_scholar", "arxiv"}
    assert r.scholar("arxiv").source == "arxiv"
    with pytest.raises(KeyError):
        r.scholar("pubmed")


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
    assert any("SUPABASE" in w for w in r.warnings) and any("model anahtarı" in w for w in r.warnings)
    assert "UYARI:" in capsys.readouterr().err


def test_real_with_keys_builds_real_adapters():
    env = {"SUPABASE_URL": "https://p.example.org", "SUPABASE_BATCH_JWT": "j", "SUPABASE_ANON_KEY": "a",
           "GEMINI_PAID_KEY": "g1", "GEMINI_FREE_KEY": "g2", "GROQ_KEY": "q", "CF_AI_TOKEN": "c",
           "CF_ACCOUNT_ID": "acc", "UNPAYWALL_EMAIL": "ops@example.org", "TELEGRAM_OPS_BOT_TOKEN": "1:t",
           "ADMIN_CHAT_ID": "9"}
    r = Runtime.from_env(dry_run=False, env=env, quiet=True)
    assert r.mode == "real" and r.warnings == []
    assert type(r.llm).__name__ == "ProviderRouter" and set(r.llm.adapters) == {"gemini-paid", "gemini-free", "groq",
                                                                                 "cf-ai"}
    assert r.llm.available("gemini-2.5-flash-lite") and not r.llm.available("meta-llama/llama-3.3-70b-instruct:free")
    names = {type(x).__name__ for x in (r.db, r.storage, r.embedding, r.oa, r.doi, r.notifier)}
    assert names == {"PostgrestDb", "SupabaseStorage", "GeminiEmbedding", "UnpaywallResolver", "CrossrefResolver",
                     "TelegramNotifier"}
    assert r.batch.client is not None and r.ledger.dry_run is False


def test_runtime_close_writes_outputs(tmp_path):
    r = Runtime.from_env(dry_run=True, fixtures=FIXTURES / "kulaklik", out=tmp_path)
    assert len(r.db.tables["bot_responses"]) == 30
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
    assert dry is True and "SUPABASE_BATCH_JWT yok" in message
    assert cli_base.effective_dry_run(args, {"SUPABASE_BATCH_JWT": "j"}) == (False, None)
    rt = cli_base.runtime_from_args(args, env={"GITHUB_ACTIONS": "true"})
    assert rt.is_fake and rt.dry_run
    assert "::warning::SUPABASE_BATCH_JWT yok" in capsys.readouterr().err
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
