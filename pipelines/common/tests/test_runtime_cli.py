"""Runtime.from_env kipleri, cli_base ortak bayrakları ve selftest giriş noktası."""

from __future__ import annotations

import copy
import json
import subprocess
import sys

import ogrenmen_contracts as contracts
import pytest

from conftest import FIXTURES, read_jsonl
from ogrenmen_common import cli_base, selftest
from ogrenmen_common.adapters.base import LLMRequest
from ogrenmen_common.errors import AdapterError, RpcError
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
           "CF_ACCOUNT_ID": "acc", "UNPAYWALL_EMAIL": "ops@example.org"}
    r = Runtime.from_env(dry_run=False, env=env, quiet=True)
    assert r.mode == "real" and r.warnings == []
    assert type(r.llm).__name__ == "ProviderRouter" and set(r.llm.adapters) == {"gemini-paid", "gemini-free", "groq",
                                                                                 "cf-ai"}
    assert r.llm.available("gemini-2.5-flash-lite") and not r.llm.available("meta-llama/llama-3.3-70b-instruct:free")
    names = {type(x).__name__ for x in (r.db, r.storage, r.embedding, r.oa, r.doi, r.notifier)}
    assert names == {"PostgrestDb", "SupabaseStorage", "LedgeredEmbedding", "UnpaywallResolver", "CrossrefResolver",
                     "LogNotifier"}
    assert type(r.embedding.inner).__name__ == "GeminiEmbedding"
    assert (r.embedding.inner.model, r.embedding.dims) == ("gemini-embedding-001", 768)
    assert r.embedding.inner.client.headers["x-goog-api-key"] == "g1"  # ücretli anahtar (gemini-paid)
    assert r.batch.client is not None and r.ledger.dry_run is False
    assert r.storage_tmp is None


DB_ENV = {"SUPABASE_URL": "https://p.example.org", "SUPABASE_BATCH_JWT": "j", "SUPABASE_ANON_KEY": "a"}


def test_real_db_without_llm_key_refuses():
    """Gerçek veritabanına sahte model çıktısı (fixture olguları, sahte maliyet satırları) yazılmaz."""
    with pytest.raises(AdapterError, match="OGR-ADP-001 gerçek veritabanıyla sahte model kullanılmaz"):
        Runtime.from_env(dry_run=False, env=dict(DB_ENV), quiet=True)


@pytest.mark.parametrize("keys", [{"GEMINI_PAID_KEY": "g1"}, {"GROQ_KEY": "q"}, {"ANTHROPIC_KEY": "x"},
                                  {"GEMINI_PAID_KEY": "g1", "SUPABASE_URL": "https://p.example.org"},
                                  {"GEMINI_PAID_KEY": "g1", "SUPABASE_BATCH_JWT": "j"}])
def test_real_llm_without_db_refuses(keys):
    """Ücretli/gerçek çağrı gerçek defter ve check_spend tavanı olmadan yapılmaz (fixture spend_ledger'a bakmaz)."""
    with pytest.raises(AdapterError, match="gerçek maliyet defteri ve tavan olmadan"):
        Runtime.from_env(dry_run=False, env=keys, quiet=True)


def test_embedding_never_uses_free_key():
    """gemini-embedding-001 sağlayıcısı gemini-paid; ücretsiz katman veriyle eğitir (§9.1) — anahtarı kullanılmaz."""
    env = {**DB_ENV, "GEMINI_FREE_KEY": "free-only"}
    r = Runtime.from_env(dry_run=False, env=env, quiet=True)
    assert type(r.embedding.inner).__name__ == "RefusingEmbedding"
    assert any("GEMINI_PAID_KEY" in w for w in r.warnings)
    with pytest.raises(AdapterError, match="sahte vektör yazılmaz"):
        r.embedding.embed(["ders notu"])  # ağa ve deftere gitmeden reddedilir


def test_embedding_model_and_dims_come_from_models_json(monkeypatch):
    import ogrenmen_common.runtime as runtime_mod

    models = copy.deepcopy(contracts.load_models())
    models["models"]["gemini-embedding-002"] = {**models["models"]["gemini-embedding-001"], "dims": 512}
    models["chains"]["embedding"] = ["gemini-embedding-002"]
    monkeypatch.setattr(runtime_mod.contracts, "load_models", lambda: models)
    real = Runtime.from_env(dry_run=False, env={**DB_ENV, "GEMINI_PAID_KEY": "g1"}, quiet=True)
    assert (real.embedding.inner.model, real.embedding.inner.dims) == ("gemini-embedding-002", 512)
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
    with pytest.raises(AdapterError, match="sahte model"):  # gerçek DB + model anahtarı yok → kurulmaz
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
