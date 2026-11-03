"""check-rpc-parity.py: küçük sahte depolarda ad ve parametre paritesi; gerçek depo geçer."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import SCRIPTS, write

SQL = """
create function public.foo(p_a int, p_b text default null) returns int
  language sql as $$ select p_a $$;
create or replace function public.bar() returns int language sql as $$ select 1 $$;
create function public.baz(p jsonb) returns setof record language plpgsql as $$ begin return; end $$;
create function public.tpl(p_item jsonb, p_key jsonb, p_figure jsonb) returns uuid
  language sql as $$ select null::uuid $$;
create function public.outs(p_x int, out total int, out label text) language sql as $$ select 1, 'a' $$;
create function app.helper(p_days int) returns int language sql as $$ select p_days $$;
create view public.my_view as select 1 as one;
"""

PY_CALLER = '''
RPC_NAME = "tpl"

class Variant:
    def rpc_params(self):
        return {"p_item": {}, "p_key": {}, "p_figure": None}

def run(db, v):
    db.rpc(RPC_NAME, v.rpc_params())
    db.rpc("foo", {"p_a": 1})
    db.rpc("bar")
    db.rpc("foo", dict(p_a=1, p_b="x"))
'''

JSONL_RPC = '''
def rpc(fn):
    return fn

@rpc
def foo(db, p_a, p_b=None):
    return 1

@rpc
def tpl(db, p_item, p_key, p_figure):
    return None

@rpc
def bar(db):
    return 1
'''


def make_world(root: Path, *, py: str = PY_CALLER, jsonl: str = JSONL_RPC, sql: str = SQL, common_names=None,
               blueprint: str | None = None) -> Path:
    write(root / "supabase/migrations/0001_all.sql", sql)
    write(root / "pipelines/common/src/ogrenmen_common/fakes/rpc-names.json",
          json.dumps(common_names if common_names is not None else ["bar", "foo", "tpl"]))
    write(root / "pipelines/common/src/ogrenmen_common/fakes/jsonl_rpc.py", jsonl)
    write(root / "pipelines/tablet/src/ogrenmen_tablet/fill.py", py)
    if blueprint is not None:
        write(root / "docs/BLUEPRINT.md", blueprint)
    return root


def run_check(parity, root: Path, objects=()):
    rows = parity.check(root, required_objects=tuple(objects))
    fails = [r for r in rows if r.status == "FAIL"]
    warns = [r for r in rows if r.status == "WARN"]
    return rows, fails, warns


def test_clean_world_passes(parity, tmp_path):
    rows, fails, warns = run_check(parity, make_world(tmp_path), objects=["my_view", "app.helper"])
    assert fails == [], fails
    assert warns == []
    calls = [r for r in rows if r.source.startswith("çağrı:")]
    assert sum(r.source == "çağrı:pipelines" for r in calls) == 4
    assert not any(r.source in ("çağrı:worker", "çağrı:panel") for r in rows)


def test_unknown_key_fails(parity, tmp_path):
    py = PY_CALLER.replace('db.rpc("foo", {"p_a": 1})', 'db.rpc("foo", {"p_a": 1, "p_zzz": 2})')
    _, fails, _ = run_check(parity, make_world(tmp_path, py=py))
    assert len(fails) == 1
    assert fails[0].rpc == "foo" and "bilinmeyen anahtar: p_zzz" in fails[0].detail


def test_missing_required_fails_but_default_may_be_omitted(parity, tmp_path):
    py = PY_CALLER.replace('db.rpc("foo", {"p_a": 1})', 'db.rpc("foo", {"p_b": "x"})')
    _, fails, _ = run_check(parity, make_world(tmp_path, py=py))
    assert [f.source for f in fails] == ["çağrı:pipelines"]
    assert "eksik zorunlu parametre: p_a" in fails[0].detail


def test_out_params_are_not_inputs(parity, tmp_path):
    py = PY_CALLER + '    db.rpc("outs", {"p_x": 1, "total": 2})\n'
    _, fails, _ = run_check(parity, make_world(tmp_path, py=py, common_names=["bar", "foo", "tpl", "outs"],
                                               jsonl=JSONL_RPC + "\n@rpc\ndef outs(db, p_x):\n    return 1\n"))
    assert len(fails) == 1 and "bilinmeyen anahtar: total" in fails[0].detail


def test_name_list_entry_without_function_fails(parity, tmp_path):
    jsonl = JSONL_RPC + "\n@rpc\ndef olmayan_rpc(db):\n    return 1\n"
    _, fails, _ = run_check(parity, make_world(tmp_path, common_names=["bar", "foo", "tpl", "olmayan_rpc"],
                                               jsonl=jsonl))
    assert ("ad:pipelines", "olmayan_rpc") in {(f.source, f.rpc) for f in fails}


def test_call_to_function_absent_from_sql_fails(parity, tmp_path):
    py = PY_CALLER.replace('db.rpc("bar")', 'db.rpc("nope")')
    _, fails, _ = run_check(parity, make_world(tmp_path, py=py))
    assert [(f.source, f.rpc) for f in fails] == [("çağrı:pipelines", "nope")]


def test_python_unknown_key_and_unresolved_builder(parity, tmp_path):
    py = PY_CALLER.replace('db.rpc("foo", {"p_a": 1})', 'db.rpc("foo", {"p_a": 1, "p_c": 3})')
    py = py.replace("v.rpc_params()", "make_params(v)")
    _, fails, _ = run_check(parity, make_world(tmp_path, py=py))
    details = sorted(f.detail for f in fails)
    assert len(fails) == 2
    assert any("bilinmeyen anahtar: p_c" in d for d in details)
    assert any("dict değişmezi değil" in d for d in details)


def test_python_builder_with_wrong_keys_fails(parity, tmp_path):
    py = PY_CALLER.replace('"p_figure": None', '"p_fig": None')
    _, fails, _ = run_check(parity, make_world(tmp_path, py=py))
    assert len(fails) == 1 and fails[0].rpc == "tpl"
    assert "p_fig" in fails[0].detail and "p_figure" in fails[0].detail


LOCAL_PARAMS = '''

def register(db, a):
    params = {"p_a": a, "p_b": "x"}
    lesson = db.rpc("foo", params)
    if params["p_b"]:
        return lesson
'''


def test_python_local_dict_variable_is_resolved(parity, tmp_path):
    rows, fails, _ = run_check(parity, make_world(tmp_path, py=PY_CALLER + LOCAL_PARAMS))
    assert fails == [], fails
    assert sum(r.source == "çağrı:pipelines" for r in rows if r.rpc == "foo") == 3


@pytest.mark.parametrize("change", [
    ('"p_b": "x"}', '"p_zz": "x"}'),                                   # bilinmeyen anahtar yine yakalanır
    ('    lesson =', '    params["p_c"] = 1\n    lesson ='),            # sonradan eklenen anahtar
    ('    lesson =', '    params.update(p_c=1)\n    lesson ='),         # update
    ('    lesson =', '    params = dict(p_a=a)\n    lesson ='),         # ikinci atama
    ('def register(db, a):', 'def register(db, a, params=None):'),      # parametre adı
])
def test_python_local_dict_variable_mutation_is_not_trusted(parity, tmp_path, change):
    _, fails, _ = run_check(parity, make_world(tmp_path, py=PY_CALLER + LOCAL_PARAMS.replace(*change)))
    assert len(fails) == 1 and fails[0].rpc == "foo", fails


def test_jsonl_fake_signature_checks(parity, tmp_path):
    jsonl = JSONL_RPC.replace("def foo(db, p_a, p_b=None)", "def foo(db, p_a, p_other=None)")
    jsonl = jsonl.replace("def tpl(db, p_item, p_key, p_figure)", "def tpl(db, p_item, p_key, p_figure=None)")
    _, fails, warns = run_check(parity, make_world(tmp_path, jsonl=jsonl))
    assert [(f.source, f.rpc) for f in fails] == [("jsonl", "foo")]
    assert "SQL'de olmayan: p_other" in fails[0].detail and "eşlenikte eksik: p_b" in fails[0].detail
    assert [(w.source, w.rpc) for w in warns] == [("jsonl", "tpl")]


def test_jsonl_registry_must_match_name_list(parity, tmp_path):
    _, fails, _ = run_check(parity, make_world(tmp_path, common_names=["foo", "tpl", "bar", "baz"]))
    assert ("jsonl", "baz") in {(f.source, f.rpc) for f in fails}


def test_pipeline_call_missing_from_fake_name_list_fails(parity, tmp_path):
    # SQL'de var ama JsonlDb'de eşleniği / fakes/rpc-names.json kaydı yok → --dry-run patlardı
    py = PY_CALLER + '    db.rpc("baz", {"p": {}})\n'
    _, fails, warns = run_check(parity, make_world(tmp_path, py=py))
    assert [(f.source, f.rpc) for f in fails] == [("çağrı:pipelines", "baz")]
    assert "rpc-names.json listesinde yok" in fails[0].detail
    assert not any(w.source == "çağrı:pipelines" for w in warns)


def test_uncalled_pipeline_fake_is_not_warned(parity, tmp_path):
    py = PY_CALLER.replace('    db.rpc("bar")\n', "")
    _, fails, warns = run_check(parity, make_world(tmp_path, py=py))
    assert fails == [] and warns == []


@pytest.mark.parametrize("sig, star", [("db, *args", "*args"), ("db, p_a, **kwargs", "**kwargs")])
def test_jsonl_fake_with_varargs_fails_clearly(parity, tmp_path, sig, star):
    jsonl = JSONL_RPC.replace("def foo(db, p_a, p_b=None)", f"def foo({sig})")
    _, fails, _ = run_check(parity, make_world(tmp_path, jsonl=jsonl))
    assert [(f.source, f.rpc) for f in fails] == [("jsonl", "foo")]
    assert f"eşlenik {star} kullanıyor; imza denetlenemez" in fails[0].detail


def test_section_3_0_objects_and_signatures(parity, tmp_path):
    blueprint = (
        "giriş\n\n**Görünümler ve yardımcılar (imza):**\n\n| Nesne | Dosya | Tanım |\n| --- | --- | --- |\n"
        "| `app.helper(p_gun int) returns int` | 0015 | x |\n| `my_view` | 0013 | y |\n"
        "| `app.missing_helper() returns trigger` | 0007 | z |\n\nsonraki paragraf\n"
    )
    _, fails, _ = run_check(parity, make_world(tmp_path, blueprint=blueprint), objects=["my_view"])
    by = {f.rpc: f.detail for f in fails}
    assert set(by) == {"app.helper", "app.missing_helper"}
    assert "imza farklı" in by["app.helper"]
    assert "migration'larda yok" in by["app.missing_helper"]


def test_blueprint_table_parser_reads_signatures(parity, repo):
    objs = parity.blueprint_objects(repo / "docs" / "BLUEPRINT.md")
    assert objs["app.numeric_equal"] == ["p_given", "p_key", "p_tol"]
    assert objs["mastery_view"] is None
    assert objs["panel_overview"] == []


def test_mask_preserves_length_and_hides_strings(parity):
    src = "a('x, y') // c(\n/* d( */ b(`t ${u}`) / 2; r = /[/(]/;"
    masked = parity.mask_ts(src)
    assert len(masked) == len(src)
    assert "x, y" not in masked and "c(" not in masked and "d(" not in masked
    assert masked.count("(") == 2  # a( ve b( kalır; regex içindeki ( maskelenir


def test_bad_sql_is_reported_as_error(parity, tmp_path):
    make_world(tmp_path, sql="create function broken(")
    assert parity.main(["--root", str(tmp_path)]) == 2


def test_real_repository_passes():
    proc = subprocess.run([sys.executable, str(SCRIPTS / "check-rpc-parity.py"), "--only-problems"],
                          capture_output=True, text=True, check=False)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "0 FAIL" in proc.stdout


def test_cli_exit_code_and_json(parity, tmp_path, capsys):
    py = PY_CALLER.replace('db.rpc("foo", {"p_a": 1})', 'db.rpc("foo", {"p_q": 1})')
    make_world(tmp_path, py=py)
    rc = parity.main(["--root", str(tmp_path), "--json", "--only-problems"])
    out = json.loads(capsys.readouterr().out)
    assert rc == 1
    assert out["counts"]["FAIL"] >= 1
    assert all(r["status"] != "PASS" for r in out["rows"])


STAFF_CALL = '''

def staff_keys(db):
    # rpc-parity: staff (eğitmen JWT'si)
    return db.rpc("baz", {"p": 1})
'''


def test_staff_marked_pipeline_call_is_checked_against_sql_only(parity, tmp_path):
    # İşaretli eğitmen çağrısı batch_worker eşlenik listesinde aranmaz; SQL imzasına uyması yeter.
    rows, fails, _ = run_check(parity, make_world(tmp_path, py=PY_CALLER + STAFF_CALL))
    assert not [r for r in fails if r.rpc == "baz"], fails
    assert any(r.rpc == "baz" and "eğitmen oturumu" in r.detail for r in rows)


def test_staff_marked_call_with_wrong_key_still_fails(parity, tmp_path):
    py = PY_CALLER + STAFF_CALL.replace('{"p": 1}', '{"q": 1}')
    _, fails, _ = run_check(parity, make_world(tmp_path, py=py))
    assert any(r.rpc == "baz" and "bilinmeyen anahtar: q" in r.detail for r in fails), fails


def test_unmarked_staff_only_call_still_fails(parity, tmp_path):
    py = PY_CALLER + STAFF_CALL.replace("# rpc-parity: staff (eğitmen JWT'si)", "# yorum")
    _, fails, _ = run_check(parity, make_world(tmp_path, py=py))
    assert any(r.rpc == "baz" and "rpc-names.json listesinde yok" in r.detail for r in fails), fails


# --- TypeScript çağrı ayrıştırıcısı (henüz bir pakete bağlı değil; apps/web gelince kullanılacak) ------------

TS_SAMPLE = """
// Yorumdaki çağrı sayılmaz: this.rpc('yok_boyle', { p_q: 1 })
const s = "this.rpc('dize_icinde', {})";
const re = /it's/g;
export class Db {
  async a() { return this.rpc<{ id: string }[]>('foo', { p_a: 1 }); }
  async b() {
    return this.rpc('foo', {
      p_a: 2,          // satır sonu yorumu
      'p_b': `x${1}`,
    });
  }
  async c() { const p_a = 3; return this.rpc('foo', { p_a, p_b: null }); }
  async d() { return this.rpc('bar'); }
  async e(name: string) { return this.rpc(name); }
  async f(extra: object) { return this.rpc('foo', { ...extra }); }
}
"""


def test_ts_rpc_call_parser(parity):
    calls = parity.ts_rpc_calls(TS_SAMPLE, Path("x.ts"))
    by_name = [(c.rpc, sorted(c.keys) if c.keys is not None else None) for c in calls]
    assert ("foo", ["p_a"]) in by_name
    assert by_name.count(("foo", ["p_a", "p_b"])) == 2
    assert ("bar", []) in by_name
    assert not any(c.rpc in ("yok_boyle", "dize_icinde") for c in calls)
    dynamic = [c for c in calls if c.rpc is None]
    assert len(dynamic) == 1 and "sabit dize değil" in dynamic[0].note
    spread = [c for c in calls if c.rpc == "foo" and c.keys is None]
    assert len(spread) == 1
