"""check_sql.py denetleyicisinin testleri: gerçek migration kümesi temiz geçer; bilinçli hatalı kopyalar
her denetim kodunu tetikler (yanlış uygulanmış bir denetim bu testlerde düşer)."""

from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent
SUPABASE = SCRIPTS.parent
MIGRATIONS = SUPABASE / "migrations"
MATRIX = SUPABASE / "tests" / "grants_matrix.json"

spec = importlib.util.spec_from_file_location("check_sql", SCRIPTS / "check_sql.py")
check_sql = importlib.util.module_from_spec(spec)
sys.modules["check_sql"] = check_sql
spec.loader.exec_module(check_sql)


def run(mig: Path, capsys, matrix: Path | None = MATRIX) -> tuple[int, str]:
    args = [str(mig)] + (["--grants-matrix", str(matrix)] if matrix else [])
    code = check_sql.main(args)
    out = capsys.readouterr()
    return code, out.out + out.err


@pytest.fixture()
def mig(tmp_path: Path) -> Path:
    dst = tmp_path / "migrations"
    shutil.copytree(MIGRATIONS, dst)
    return dst


def append(mig: Path, name: str, sql: str) -> None:
    path = mig / name
    path.write_text(path.read_text(encoding="utf-8") + "\n" + sql + "\n", encoding="utf-8")


def test_real_migrations_pass(capsys):
    code, out = run(MIGRATIONS, capsys)
    assert code == 0, out
    assert "hata yok" in out


def test_missing_force_rls_and_policy(mig, capsys):
    append(mig, "0012_functions.sql", "create table public.yeni (id int primary key);  -- Deneme tablosu\n"
           "comment on table public.yeni is 'x'; comment on column public.yeni.id is 'x';\n"
           "alter table public.yeni enable row level security;")
    code, out = run(mig, capsys, matrix=None)
    assert code == 1
    assert "OGR-LINT-RLS" in out and "public.yeni: FORCE" in out
    assert "OGR-LINT-POLICY" in out


def test_rls_removed_from_0014_is_caught(mig, capsys):
    path = mig / "0014_rls.sql"
    text = path.read_text(encoding="utf-8").replace("alter table public.mastery force row level security;\n", "")
    path.write_text(text, encoding="utf-8")
    code, out = run(mig, capsys, matrix=None)
    assert code == 1 and "public.mastery: FORCE ROW LEVEL SECURITY yok" in out


def test_secure_grant_and_grant_all(mig, capsys):
    append(mig, "0014_rls.sql", "grant select on secure.answer_keys to batch_worker;\ngrant all on public.mastery to bot_runtime;")
    code, out = run(mig, capsys, matrix=None)
    assert code == 1
    assert "OGR-LINT-SECURE" in out and "OGR-LINT-GRANTALL" in out


def test_schema_usage_on_secure_is_caught(mig, capsys):
    append(mig, "0014_rls.sql", "grant usage on schema secure to bot_runtime;")
    code, out = run(mig, capsys, matrix=None)
    assert code == 1 and "OGR-LINT-SECURE" in out


def test_baseline_revoke_required(mig, capsys):
    path = mig / "0002_grants_baseline.sql"
    text = path.read_text(encoding="utf-8").replace(
        "revoke all on all tables in schema public from anon, authenticated;", "")
    path.write_text(text, encoding="utf-8")
    code, out = run(mig, capsys, matrix=None)
    assert code == 1 and "OGR-LINT-BASELINE" in out


def test_security_definer_needs_search_path(mig, capsys):
    append(mig, "0012_functions.sql",
           "create function public.kotu() returns int language sql security definer as $$ select 1 $$;")
    code, out = run(mig, capsys, matrix=None)
    assert code == 1 and "OGR-LINT-SEARCHPATH" in out and "public.kotu" in out


def test_generated_now_forbidden(mig, capsys):
    append(mig, "0012_functions.sql",
           "create table public.g (id int primary key,  -- k\n  t timestamptz generated always as (now()) stored  -- k\n);  -- G")
    code, out = run(mig, capsys, matrix=None)
    assert code == 1 and "OGR-LINT-GENERATED" in out


def test_order_sql_body_reading_later_table(mig, capsys):
    append(mig, "0012_functions.sql",
           "create function public.erken() returns bigint language sql stable as $$ select count(*) from public.retention_runs $$;")
    code, out = run(mig, capsys, matrix=None)
    assert code == 1 and "OGR-LINT-ORDER" in out and "public.retention_runs" in out


def test_varconflict_cases(mig, capsys):
    append(mig, "0012_functions.sql", """create function public.cakisma(kind text) returns table (used int) language plpgsql as $$
declare sayac int;
begin
  select u.used into sayac from public.quota_usage u where u.kind = kind and used > 0;
  return query select sayac;
end $$;""")
    code, out = run(mig, capsys, matrix=None)
    assert code == 1
    assert "parametre kind p_ önekli değil" in out
    assert "yerel değişken sayac v_ önekli değil" in out
    assert "'used' hem değişken/dönüş sütunu hem tablo sütunu" in out
    assert "'kind' hem değişken/dönüş sütunu hem tablo sütunu" in out


def test_qualified_reference_is_fine(mig, capsys):
    append(mig, "0012_functions.sql", """create function public.temiz(p_kind text) returns table (used int) language plpgsql as $$
declare v_n int;
begin
  select u.used into v_n from public.quota_usage u where u.kind = p_kind and u.used > 0;
  return query select v_n;
end $$;""")
    code, out = run(mig, capsys, matrix=None)
    assert code == 0, out


def test_missing_comment(mig, capsys):
    path = mig / "0003_identity.sql"
    text = path.read_text(encoding="utf-8").replace(
        "comment on column public.students.tz is 'Saat dilimi';\n", "")
    path.write_text(text, encoding="utf-8")
    code, out = run(mig, capsys, matrix=None)
    assert code == 1 and "public.students.tz: comment on column yok" in out


def test_matrix_extra_and_missing_grant(mig, tmp_path, capsys):
    matrix = json.loads(MATRIX.read_text(encoding="utf-8"))
    matrix["tables"]["public.mastery"]["anon"] = {"select": "*"}            # matriste fazla
    del matrix["tables"]["public.messages"]["authenticated"]["select"]     # matriste eksik
    matrix["functions"]["public.ping"]["grants"] = ["bot_runtime"]
    mpath = tmp_path / "m.json"
    mpath.write_text(json.dumps(matrix), encoding="utf-8")
    code, out = run(mig, capsys, matrix=mpath)
    assert code == 1
    assert "public.mastery anon select" in out
    assert "public.messages authenticated select" in out
    assert "public.ping" in out


def test_matrix_detects_new_grant_in_sql(mig, capsys):
    append(mig, "0014_rls.sql", "grant select (text_raw) on public.messages to authenticated;")
    code, out = run(mig, capsys)
    assert code == 1 and "public.messages authenticated select" in out


def test_messages_matrix_hides_text_raw():
    matrix = json.loads(MATRIX.read_text(encoding="utf-8"))
    for role in ("authenticated", "bot_runtime", "batch_worker"):
        assert "text_raw" not in matrix["tables"]["public.messages"][role]["select"]
    assert "ocr_text" not in matrix["tables"]["public.exam_items"]["authenticated"]["select"]
    assert matrix["tables"]["public.v_messages_staff"] == {"authenticated": {"select": "*"}}
    for name in ("secure.answer_keys", "secure.student_pii", "audit.events"):
        assert matrix["tables"][name] == {}
