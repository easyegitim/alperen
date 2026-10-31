"""export-sql.py: SQL geçerliliği, içerik, anahtar yokluğu, yer tutucu çözümü, --as-version, determinizm."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pglast
import pytest
from conftest import CONTENT_DIR, REPO_ROOT

from templates import _common as C

SCRIPT = CONTENT_DIR / "scripts" / "export-sql.py"


@pytest.fixture(scope="module")
def seed_sql(tmp_path_factory) -> str:
    out = tmp_path_factory.mktemp("seed") / "seed.sql"
    proc = subprocess.run([sys.executable, str(SCRIPT), "--out", str(out)], capture_output=True, text=True, timeout=300)
    assert proc.returncode == 0, proc.stderr
    return out.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def seed2_sql(tmp_path_factory) -> str:
    out = tmp_path_factory.mktemp("seed2") / "seed2.sql"
    proc = subprocess.run([sys.executable, str(SCRIPT), "--as-version", "2027.1", "--out", str(out)],
                          capture_output=True, text=True, timeout=300)
    assert proc.returncode == 0, proc.stderr
    return out.read_text(encoding="utf-8")


def rows(lib, sql: str, table: str):
    return lib.sql_insert_rows(sql, table)


def test_seed_parses_and_has_no_keys(seed_sql):
    pglast.parse_sql(seed_sql)
    lowered = seed_sql.lower()
    assert "answer_keys" not in lowered and "correct_option" not in lowered
    assert "{{" not in seed_sql
    assert "<!-- ogrenmen:cocuk-dili:start -->" in seed_sql and "<!-- ogrenmen:cocuk-dili:end -->" in seed_sql


def test_seed_row_counts(lib, seed_sql):
    expected = {"curricula": 1, "skills": 21, "skill_prerequisites": 24, "misconception_tags": 27,
                "question_templates": 6, "figures": 3, "questions": 20, "diagnostic_tests": 1, "legal_texts": 4}
    for table, n in expected.items():
        assert len(rows(lib, seed_sql, table)) == n, table
    assert seed_sql.count("insert into public.skills ") == 21


def test_curriculum_status_written_verbatim(lib, seed_sql):
    (cur,) = rows(lib, seed_sql, "curricula")
    assert cur["status"] == "active" and cur["version"] == "2026.1" and cur["year"] == 2026
    assert cur["id"] == C.curriculum_uuid("TYT-MAT@2026.1")


def test_diagnostic_questions_are_draft_and_ordered(lib, seed_sql):
    content = lib.load_content()
    qs = rows(lib, seed_sql, "questions")
    assert {q["status"] for q in qs} == {"draft"}
    assert {q["source"] for q in qs} == {"diagnostic"}
    assert [q["id"] for q in qs] == [C.uid("question", i["code"]) for i in content.items]
    (test,) = rows(lib, seed_sql, "diagnostic_tests")
    assert test["version"] == "2026.1"
    assert test["item_ids"] == [C.uid("question", i["code"]) for i in content.items]
    for q, item in zip(qs, content.items, strict=True):
        assert json.loads(q["options"]) == item["options"]
        assert q["content_hash"] == C.content_hash(item["stem"], item["options"])
    # şekilli maddelerin figure_id'si alt sorguyla (code_hash) bağlanır
    assert seed_sql.count("(select f.id from public.figures f where f.code_hash = ") == 3


def test_figures_verified_with_real_dimensions(lib, seed_sql):
    figs = rows(lib, seed_sql, "figures")
    for f in figs:
        assert f["review_status"] == "verified" and f["vision_status"] == "not_applicable"
        png = CONTENT_DIR / "diagnostic" / f["png_path"]
        assert (f["width_px"], f["height_px"]) == C.png_size(png)
        assert f["bytes"] == png.stat().st_size
        assert f["code_hash"] == C.sha256_hex(f["code"])
        assert "def build" in f["code"]


def test_templates_rows(lib, seed_sql):
    import templates

    tpl = {r["id"]: r for r in rows(lib, seed_sql, "question_templates")}
    assert set(tpl) == set(templates.TEMPLATE_FILES)
    assert tpl["kesir-modeli-toplama"]["module_path"] == "content/tyt-matematik/templates/kesir_modeli_toplama.py:generate"
    assert tpl["islem-onceligi"]["has_figure"] is False and tpl["yuzde-grafik"]["has_figure"] is True
    for r in tpl.values():
        assert (REPO_ROOT / r["module_path"].split(":")[0]).exists()
        json.loads(r["params_schema"])


def test_legal_texts(lib, seed_sql):
    legal = {r["kind"]: r for r in rows(lib, seed_sql, "legal_texts")}
    assert set(legal) == {"kvkk_aydinlatma", "veli_onayi", "grup_kayit", "ders_kaydi"}
    for r in legal.values():
        assert r["version"] == "2026-10-v1" and r["effective_from"] == "2026-11-01"
        assert r["body_md"].startswith("> HUKUKİ İNCELEME GEREKLİ")
        assert "doc_version:" not in r["body_md"]
        assert " 0 gün" not in r["body_md"]
    assert "kaydedilir ve 90 gün sonra silinir" in legal["grup_kayit"]["body_md"]
    assert "<!-- ogrenmen:grup-kayit-kisa:start -->" in legal["grup_kayit"]["body_md"]
    assert "<!-- ogrenmen:onay-ozeti:start -->" in legal["kvkk_aydinlatma"]["body_md"]


def test_as_version_writes_same_skill_ids_under_new_curriculum(lib, seed_sql, seed2_sql):
    pglast.parse_sql(seed2_sql)
    (cur,) = rows(lib, seed2_sql, "curricula")
    assert cur["id"] == C.curriculum_uuid("TYT-MAT@2027.1") != C.curriculum_uuid("TYT-MAT@2026.1")
    assert (cur["version"], cur["year"], cur["status"], cur["label"]) == ("2027.1", 2027, "draft", "TYT Matematik 2027")
    s1 = {r["id"] for r in rows(lib, seed_sql, "skills")}
    s2 = rows(lib, seed2_sql, "skills")
    assert {r["id"] for r in s2} == s1
    assert {r["curriculum_id"] for r in s2} == {cur["id"]}
    assert len(rows(lib, seed2_sql, "skill_prerequisites")) == 24
    for table in ("questions", "figures", "legal_texts", "diagnostic_tests", "question_templates"):
        assert rows(lib, seed2_sql, table) == []
    assert "on conflict (tag) do nothing" in seed2_sql


def test_output_is_deterministic(tmp_path, seed_sql):
    out = tmp_path / "again.sql"
    subprocess.run([sys.executable, str(SCRIPT), "--out", str(out)], check=True, capture_output=True, timeout=300)
    assert out.read_text(encoding="utf-8") == seed_sql


@pytest.mark.parametrize("version", ["yeni", "1.2.3", "2027", "2027.1.0", "27.1", "2027.x"])
def test_invalid_as_version(tmp_path, version):
    proc = subprocess.run([sys.executable, str(SCRIPT), "--as-version", version, "--out", str(tmp_path / "x.sql")],
                          capture_output=True, text=True, timeout=120)
    assert proc.returncode == 1 and not (tmp_path / "x.sql").exists()
    assert "YYYY.N" in proc.stderr


@pytest.mark.parametrize("version", ["2026.1", "2025.9", "2026.0"])
def test_as_version_must_be_newer_than_current(tmp_path, version):
    """Aynı ya da eski sürüm etkin müfredatı (on conflict … status = excluded.status) taslağa düşürürdü."""
    proc = subprocess.run([sys.executable, str(SCRIPT), "--as-version", version, "--out", str(tmp_path / "x.sql")],
                          capture_output=True, text=True, timeout=120)
    assert proc.returncode == 1 and not (tmp_path / "x.sql").exists()
    assert "büyük olmalı" in proc.stderr


def test_figure_ids_derive_from_code_hash(lib, seed_sql):
    figs = rows(lib, seed_sql, "figures")
    assert {f["id"] for f in figs} == {C.uid("figure", f["code_hash"]) for f in figs}
    assert seed_sql.count("on conflict do nothing;") == 3


def test_approved_questions_are_not_overwritten_and_drift_guard(lib, seed_sql):
    assert seed_sql.count("where public.questions.status in ('draft', 'pending_review');") == 20
    assert "OGR-SEED-003" in seed_sql
    content = lib.load_content()
    guard = seed_sql[seed_sql.index("OGR-SEED-003") - 6000:seed_sql.index("OGR-SEED-003")]
    for item in content.items:
        assert C.content_hash(item["stem"], item["options"]) in guard


# --- yer tutucu çözümü -----------------------------------------------------------------------


def _source(lib, days=None, tg=90):
    return lib.RetentionSource(days=days or {"messages.hard_delete": 0, "bot_responses.prompt_null": 30},
                               tg_chats_retention_days=tg, origin=["test"])


PH = {
    "RETENTION_MESSAGES_DAYS": {"policy_id": "messages.hard_delete", "days_source": "tg_chats.retention_days",
                                "expected_days": 90},
    "RETENTION_PROMPT_DAYS": {"policy_id": "bot_responses.prompt_null", "days_source": "retention_policies.days"},
}


def test_messages_placeholder_uses_days_source_not_zero_policy(lib):
    out, warns = lib.resolve_placeholders("{{RETENTION_MESSAGES_DAYS}} gün, {{ RETENTION_PROMPT_DAYS }} gün", PH,
                                          _source(lib))
    assert out == "90 gün, 30 gün" and warns == []


def test_zero_or_missing_values_fail(lib):
    with pytest.raises(lib.ContentError, match="0 gün"):
        lib.resolve_placeholders("{{RETENTION_PROMPT_DAYS}}", PH, _source(lib, days={"bot_responses.prompt_null": 0}))
    naive = {"RETENTION_MESSAGES_DAYS": {"policy_id": "messages.hard_delete"}}  # days_source yok → policy days = 0
    with pytest.raises(lib.ContentError, match="0 gün"):
        lib.resolve_placeholders("{{RETENTION_MESSAGES_DAYS}}", naive, _source(lib))
    with pytest.raises(lib.ContentError, match="tanımsız"):
        lib.resolve_placeholders("{{RETENTION_YOK_DAYS}}", PH, _source(lib))
    with pytest.raises(lib.ContentError, match="seed'inde yok"):
        lib.resolve_placeholders("{{RETENTION_PROMPT_DAYS}}", PH, _source(lib, days={"x.y": 3}))
    with pytest.raises(lib.ContentError, match="varsayılanı"):
        lib.resolve_placeholders("{{RETENTION_MESSAGES_DAYS}}", PH, _source(lib, tg=None))


def test_expected_days_mismatch_is_warning(lib):
    _out, warns = lib.resolve_placeholders("{{RETENTION_MESSAGES_DAYS}}", PH, _source(lib, tg=60))
    assert warns and "expected_days 90" in warns[0]


def _fake_m02(tmp_path: Path, messages_days: int = 60) -> tuple[Path, Path]:
    seed = tmp_path / "04_retention_policies.sql"
    seed.write_text(
        "insert into public.retention_policies (id, table_name, ts_column, days, mode, handler, columns, condition_sql, "
        "user_facing_text) values\n"
        "  ('messages.hard_delete', 'messages', 'expires_at', 0, 'delete', null, null, null, 'x {days}'),\n"
        "  ('bot_responses.prompt_null', 'bot_responses', 'created_at', 31, 'null_columns', null, array['prompt_text'], "
        "null, null),\n"
        "  ('memory_facts.stale', 'memory_facts', 'created_at', 181, 'expire', null, null, 'valid_until is null', null)\n"
        "on conflict (id) do nothing;\n", encoding="utf-8")
    mig = tmp_path / "migrations"
    mig.mkdir()
    (mig / "0007_kulaklik.sql").write_text(
        "create table public.tg_chats (\n  chat_id bigint primary key,\n"
        f"  retention_days smallint not null default {messages_days}\n);\n", encoding="utf-8")
    return seed, mig


def test_load_retention_prefers_m02_files(lib, tmp_path):
    seed, mig = _fake_m02(tmp_path)
    src = lib.load_retention(REPO_ROOT, seed, mig, allow_fallback=False)
    assert src.days == {"messages.hard_delete": 0, "bot_responses.prompt_null": 31, "memory_facts.stale": 181}
    assert src.tg_chats_retention_days == 60 and not src.fallback


def test_blueprint_fallback_reads_section_3_10(lib):
    src = lib.retention_from_blueprint(REPO_ROOT / "docs" / "BLUEPRINT.md")
    assert src.days["bot_responses.prompt_null"] == 30
    assert src.days["bot_responses.flagged_delete"] == 365
    assert src.days["lessons.transcript"] == 730
    assert src.days["messages.hard_delete"] == 0
    assert src.tg_chats_retention_days == 90
    placeholders = json.loads((REPO_ROOT / "docs" / "hukuk" / "placeholders.json").read_text(encoding="utf-8"))
    for name, entry in placeholders.items():
        resolved, _ = lib.resolve_placeholders("{{" + name + "}}", placeholders, src)
        assert int(resolved) == entry["expected_days"], name


def _export_with_sources(tmp_path: Path, seed: Path, mig: Path, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPT), "--out", str(tmp_path / "s.sql"), "--retention-seed", str(seed),
                           "--migrations", str(mig), *extra], capture_output=True, text=True, timeout=300)


def test_present_but_unparseable_seed_fails_without_strict(tmp_path):
    """Dosya varsa yedeğe düşülmez: insert … select … from (values …) biçimi okunamaz → çıkış 1."""
    seed, mig = _fake_m02(tmp_path)
    seed.write_text(
        "insert into public.retention_policies (id, table_name, ts_column, days, mode)\n"
        "select * from (values ('messages.hard_delete', 'messages', 'expires_at', 0, 'delete')) v\n"
        "on conflict (id) do nothing;\n", encoding="utf-8")
    proc = _export_with_sources(tmp_path, seed, mig)
    assert proc.returncode == 1 and "retention_policies satırı okunamadı" in proc.stderr
    assert not (tmp_path / "s.sql").exists()


def test_non_literal_days_fails(lib, tmp_path):
    seed, mig = _fake_m02(tmp_path)
    seed.write_text(seed.read_text(encoding="utf-8").replace(", 31, ", ", 30 + 1, "), encoding="utf-8")
    with pytest.raises(lib.ContentError, match="tam sayı sabiti değil"):
        lib.load_retention(REPO_ROOT, seed, mig)


def test_migrations_without_tg_chats_default_fail(lib, tmp_path):
    seed, mig = _fake_m02(tmp_path)
    (mig / "0007_kulaklik.sql").write_text("create table public.tg_chats (\n  chat_id bigint primary key,\n"
                                           "  retention_days smallint not null\n);\n", encoding="utf-8")
    proc = _export_with_sources(tmp_path, seed, mig)
    assert proc.returncode == 1 and "retention_days varsayılanı okunamadı" in proc.stderr
    (mig / "0007_kulaklik.sql").write_text("create table public.diger (id int);\n", encoding="utf-8")
    with pytest.raises(lib.ContentError, match="tg_chats tablosu bulunamadı"):
        lib.load_retention(REPO_ROOT, seed, mig)


def test_alter_table_default_is_read(lib, tmp_path):
    seed, mig = _fake_m02(tmp_path, messages_days=90)
    (mig / "0015_storage.sql").write_text(
        "alter table public.tg_chats alter column retention_days set default 75;\n", encoding="utf-8")
    src = lib.load_retention(REPO_ROOT, seed, mig, allow_fallback=False)
    assert src.tg_chats_retention_days == 75 and not src.fallback


def test_strict_sources_without_m02_files_fails(tmp_path):
    proc = subprocess.run([sys.executable, str(SCRIPT), "--out", str(tmp_path / "s.sql"), "--strict-sources",
                           "--retention-seed", str(tmp_path / "yok.sql"), "--migrations", str(tmp_path / "yok")],
                          capture_output=True, text=True, timeout=300)
    assert proc.returncode == 1
    assert "saklama süreleri okunamadı" in proc.stderr


def test_export_with_m02_files_uses_their_values(lib, tmp_path):
    seed, mig = _fake_m02(tmp_path, messages_days=60)
    hukuk = tmp_path / "hukuk"
    hukuk.mkdir()
    shutil.copy(REPO_ROOT / "docs" / "hukuk" / "grup-kayit-bildirimi.md", hukuk)
    shutil.copy(REPO_ROOT / "docs" / "hukuk" / "placeholders.json", hukuk)
    out = tmp_path / "s.sql"
    proc = subprocess.run([sys.executable, str(SCRIPT), "--out", str(out), "--strict-sources", "--hukuk", str(hukuk),
                           "--retention-seed", str(seed), "--migrations", str(mig)],
                          capture_output=True, text=True, timeout=300)
    assert proc.returncode == 0, proc.stderr
    (legal,) = lib.sql_insert_rows(out.read_text(encoding="utf-8"), "legal_texts")
    assert "kaydedilir ve 60 gün sonra silinir" in legal["body_md"]
    assert "expected_days 90" in proc.stderr  # sapma uyarısı


def test_unresolved_placeholder_exits_1(tmp_path):
    hukuk = tmp_path / "hukuk"
    hukuk.mkdir()
    shutil.copy(REPO_ROOT / "docs" / "hukuk" / "placeholders.json", hukuk)
    text = (REPO_ROOT / "docs" / "hukuk" / "veli-onay-formu.md").read_text(encoding="utf-8")
    (hukuk / "veli-onay-formu.md").write_text(text + "\nYeni süre: {{RETENTION_TANIMSIZ_DAYS}} gün.\n", encoding="utf-8")
    out = tmp_path / "s.sql"
    proc = subprocess.run([sys.executable, str(SCRIPT), "--out", str(out), "--hukuk", str(hukuk)],
                          capture_output=True, text=True, timeout=300)
    assert proc.returncode == 1
    assert "RETENTION_TANIMSIZ_DAYS" in proc.stderr and not out.exists()


def test_legal_doc_parsing(lib):
    docs = {d.kind: d for d in lib.load_legal_docs(REPO_ROOT / "docs" / "hukuk")}
    assert set(docs) == {"kvkk_aydinlatma", "veli_onayi", "grup_kayit", "ders_kaydi"}
    assert docs["kvkk_aydinlatma"].path.name == "aydinlatma-metni.md"
    assert "```yaml" not in docs["kvkk_aydinlatma"].body_md
