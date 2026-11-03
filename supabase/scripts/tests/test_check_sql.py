"""check_sql.py denetleyicisinin testleri (v2): gerçek migration kümesi temiz geçer; bilinçli hatalı kopyalar her
denetim kodunu tetikler (yanlış uygulanmış bir denetim bu testlerde düşer)."""

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

spec = importlib.util.spec_from_file_location("check_sql", SCRIPTS / "check_sql.py")
check_sql = importlib.util.module_from_spec(spec)
sys.modules["check_sql"] = check_sql
spec.loader.exec_module(check_sql)


def run(mig: Path, capsys, *extra: str) -> tuple[int, str]:
    code = check_sql.main([str(mig), *extra])
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


def replace(mig: Path, name: str, old: str, new: str) -> None:
    path = mig / name
    text = path.read_text(encoding="utf-8")
    assert old in text, f"{name}: {old!r} yok"
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


NEW_TABLE = ("create table public.yeni (  -- Deneme tablosu\n"
             "  id uuid primary key default gen_random_uuid(),  -- k\n"
             "  created_at timestamptz not null default now()  -- k\n);\n"
             "comment on table public.yeni is 'x'; comment on column public.yeni.id is 'x';\n"
             "comment on column public.yeni.created_at is 'x';\n")


def test_real_migrations_pass(capsys):
    code, out = run(MIGRATIONS, capsys)
    assert code == 0, out
    assert "hata yok" in out


def test_v2_migration_set_names():
    names = sorted(p.name for p in MIGRATIONS.glob("*.sql"))
    assert names[0] == "0001_extensions.sql" and names[1] == "0002_roles_and_helpers.sql"
    assert "0011_mastery.sql" in names and names[16:19] == ["0017_rpc.sql", "0018_rls.sql", "0019_views.sql"]
    # P1 ekleri 0020+ (öneriler, alıştırma, onboarding, hafıza düzeltmeleri, dossier v2)
    assert all(n[:4].isdigit() and int(n[:4]) >= 20 for n in names[19:]), names[19:]
    text = "\n".join(line.split("--", 1)[0] for p in MIGRATIONS.glob("*.sql")
                     for line in p.read_text(encoding="utf-8").splitlines() if not line.startswith("comment on"))
    for gone in ("bot_runtime", "batch_worker", "current_student", "public.staff ", "tg_chats", "consents", "quota_"):
        assert gone not in text, gone


def test_missing_force_rls(mig, capsys):
    append(mig, "0014_llm_ledger.sql", NEW_TABLE + "alter table public.yeni enable row level security;")
    code, out = run(mig, capsys)
    assert code == 1
    assert "OGR-LINT-RLS" in out and "public.yeni: FORCE" in out
    assert "OGR-LINT-POLICY" not in out


def test_real_migrations_pass_with_policies(capsys):
    """B2: her RLS tablosunda politika var; politikasızlar (secure.*, audit.events) no-policy-allowlist.json'da."""
    code, out = run(MIGRATIONS, capsys, "--require-policies")
    assert code == 0, out


def test_policy_check_only_when_required(mig, capsys):
    replace(mig, "0018_rls.sql",
            "create policy settings_select on public.settings for select to authenticated using (true);\n", "")
    code, out = run(mig, capsys)
    assert code == 0, out
    code, out = run(mig, capsys, "--require-policies")
    assert code == 1 and "OGR-LINT-POLICY" in out and "public.settings: CREATE POLICY yok" in out
    allow = mig.parent / "allow.json"
    allow.write_text(json.dumps({"tables": ["public.yok", "public.profiles"]}), encoding="utf-8")
    code, out = run(mig, capsys, "--require-policies", "--allowlist", str(allow))
    assert "public.yok: böyle bir tablo yok" in out
    assert "public.profiles: allowlist'te ama politikası var" in out
    assert "secure.answer_keys: CREATE POLICY yok" in out


def test_rls_removed_is_caught(mig, capsys):
    replace(mig, "0005_evidence.sql", "alter table public.mastery force row level security;\n", "")
    code, out = run(mig, capsys)
    assert code == 1 and "public.mastery: FORCE ROW LEVEL SECURITY yok" in out


def test_secure_grant_and_grant_all(mig, capsys):
    append(mig, "0014_llm_ledger.sql", "grant select on secure.answer_keys to authenticated;\ngrant all on public.mastery to anon;")
    code, out = run(mig, capsys)
    assert code == 1
    assert "OGR-LINT-SECURE" in out and "OGR-LINT-GRANTALL" in out


def test_service_role_on_secure_is_allowed(mig, capsys):
    append(mig, "0014_llm_ledger.sql", "grant select on secure.exam_answer_keys to service_role;")
    code, out = run(mig, capsys)
    assert code == 0, out


def test_schema_usage_on_secure_is_caught(mig, capsys):
    append(mig, "0014_llm_ledger.sql", "grant usage on schema secure to authenticated;")
    code, out = run(mig, capsys)
    assert code == 1 and "OGR-LINT-SECURE" in out


def test_baseline_revoke_required(mig, capsys):
    replace(mig, "0002_roles_and_helpers.sql", "revoke all on all tables in schema public from anon, authenticated;", "")
    code, out = run(mig, capsys)
    assert code == 1 and "OGR-LINT-BASELINE" in out


def test_security_definer_needs_search_path(mig, capsys):
    append(mig, "0011_mastery.sql",
           "create function public.kotu() returns int language sql security definer as $$ select 1 $$;")
    code, out = run(mig, capsys)
    assert code == 1 and "OGR-LINT-SEARCHPATH" in out and "public.kotu" in out


def test_generated_now_forbidden(mig, capsys):
    append(mig, "0014_llm_ledger.sql",
           "create table public.g (id int primary key,  -- k\n  created_at timestamptz generated always as (now()) stored  -- k\n);  -- G")
    code, out = run(mig, capsys)
    assert code == 1 and "OGR-LINT-GENERATED" in out


def test_order_sql_body_reading_later_table(mig, capsys):
    append(mig, "0003_identity.sql",
           "create function public.erken() returns bigint language sql stable as $$ select count(*) from public.llm_calls $$;")
    code, out = run(mig, capsys)
    assert code == 1 and "OGR-LINT-ORDER" in out and "public.llm_calls" in out


def test_varconflict_cases(mig, capsys):
    append(mig, "0011_mastery.sql", """create function public.cakisma(kind text) returns table (route text) language plpgsql as $$
declare sayac int;
begin
  select count(*) into sayac from public.llm_calls c where c.purpose = kind and route is not null;
  return query select kind;
end $$;""")
    code, out = run(mig, capsys)
    assert code == 1
    assert "parametre kind p_ önekli değil" in out
    assert "yerel değişken sayac v_ önekli değil" in out
    assert "'route' hem değişken/dönüş sütunu hem tablo sütunu" in out


def test_qualified_reference_is_fine(mig, capsys):
    append(mig, "0011_mastery.sql", """create function public.temiz(p_kind text) returns table (route text) language plpgsql as $$
declare v_n int;
begin
  select count(*) into v_n from public.llm_calls c where c.purpose = p_kind and c.route is not null;
  return query select p_kind;
end $$;""")
    code, out = run(mig, capsys)
    assert code == 0, out


def test_missing_comment(mig, capsys):
    replace(mig, "0003_identity.sql", "comment on column public.students.grade is 'Sınıf (''11'', ''mezun'', ''lisans-1'')';\n", "")
    code, out = run(mig, capsys)
    assert code == 1 and "public.students.grade: comment on column yok" in out


def test_created_at_required(mig, capsys):
    replace(mig, "0013_notifications.sql",
            "  ua text,  -- Tarayıcı / cihaz\n  created_at timestamptz not null default now()  -- Oluşturulma zamanı\n",
            "  ua text  -- Tarayıcı / cihaz\n")
    code, out = run(mig, capsys)
    assert code == 1 and "OGR-LINT-CREATEDAT" in out and "public.push_subscriptions" in out


def test_uuid_pk_default_required(mig, capsys):
    replace(mig, "0013_notifications.sql",
            "  id uuid primary key default gen_random_uuid(),  -- Abonelik kimliği",
            "  id uuid primary key,  -- Abonelik kimliği")
    code, out = run(mig, capsys)
    assert code == 1 and "OGR-LINT-UUIDPK" in out and "public.push_subscriptions.id" in out


def test_halfvec_dimension(mig, capsys):
    replace(mig, "0007_uploads_conversations.sql", "embedding halfvec(1024),  -- Metnin", "embedding halfvec(768),  -- Metnin")
    code, out = run(mig, capsys)
    assert code == 1 and "OGR-LINT-HALFVEC" in out and "public.uploads.embedding" in out


def test_public_execute_leak(mig, capsys):
    append(mig, "0016_cron.sql", "grant execute on function public.enqueue_job(text, jsonb) to public;")
    code, out = run(mig, capsys)
    assert code == 1 and "PUBLIC'e EXECUTE" in out
