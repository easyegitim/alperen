"""Canlı Postgres: gerçek ``register_template_question`` ve ``batch_worker`` yetkileri (§3.9, §6.1).

Yalnız ``OGRENMEN_DATABASE_URL`` tanımlıysa koşar (yoksa SKIP). Geçici veritabanına supabase migration'ları,
seed'ler ve müfredat seed'i uygulanır (conftest ``live_db``); her şablondan 3 varyantın ``p_item/p_key/p_figure``
yükü ``psql`` ile ``batch_worker`` rolünde RPC'ye verilir.
"""

from __future__ import annotations

import json

import pytest

from conftest import psql
from ogrenmen_tablet import templates as T

pytestmark = pytest.mark.live

CALL_SQL = r"""
\o /dev/null
begin;
set local role batch_worker;
select set_config('request.jwt.claims', '{"role":"batch_worker"}', true);
\o
select coalesce(public.register_template_question(:'p_item'::jsonb, :'p_key'::jsonb,
                                                  nullif(:'p_figure', 'null')::jsonb)::text, 'NULL');
commit;
"""

AS_BATCH_WORKER = r"""
\o /dev/null
begin;
set local role batch_worker;
select set_config('request.jwt.claims', '{"role":"batch_worker"}', true);
\o
"""


def _call(url: str, variant: T.Variant, tmp_path) -> str:
    sql = tmp_path / "call.sql"
    sql.write_text(CALL_SQL, encoding="utf-8")
    params = variant.rpc_params()
    proc = psql(url, file=sql, variables={k: json.dumps(v, ensure_ascii=False) for k, v in params.items()})
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    return lines[-1]


def _as_batch_worker(url: str, statement: str, tmp_path):
    sql = tmp_path / "direct.sql"
    sql.write_text(AS_BATCH_WORKER + statement + "\ncommit;\n", encoding="utf-8")
    return psql(url, file=sql, check=False)


def test_live_register_template_question_approves_every_template(live_db, tmp_path):
    seen_figures = 0
    for tid in T.template_ids():
        variants = T.generate_variants(tid, 3, 7)
        for v in variants:
            if v.figure is not None:
                v.render(tmp_path / "figures")
            qid = _call(live_db, v, tmp_path)
            assert qid != "NULL", (tid, v.index)
            row = psql(live_db, sql=(
                "select q.status, q.source, q.template_id, q.content_hash, k.sympy_status, k.written_by, "
                "k.correct_option, coalesce(f.review_status, '-'), coalesce(f.vision_status, '-'), "
                "coalesce(f.png_path, '-') "
                "from public.questions q join secure.answer_keys k on k.question_id = q.id "
                f"left join public.figures f on f.id = q.figure_id where q.id = '{qid}'")).stdout.strip()
            status, source, tpl, chash, sympy_status, written_by, correct, fig_rev, fig_vis, png = row.split("|")
            assert (status, source, tpl, chash) == ("approved", "template", tid, v.content_hash)
            assert (sympy_status, written_by) == ("verified", "batch_worker:template")
            assert correct == v.key["correct_option"]
            if v.figure is not None:
                seen_figures += 1
                assert (fig_rev, fig_vis, png) == ("verified", "not_applicable", v.storage_path)
            else:
                assert fig_rev == "-"
    assert seen_figures == 9
    audit = psql(live_db, sql="select count(*) from audit.events where action = 'RPC:register_template_question'")
    assert int(audit.stdout.strip()) == 18
    # aynı varyant ikinci kez: on conflict do nothing → NULL, yeni satır yok
    again = T.generate_variants("islem-onceligi", 1, 7)[0]
    assert _call(live_db, again, tmp_path) == "NULL"
    count = psql(live_db, sql=f"select count(*) from public.questions where content_hash = '{again.content_hash}'")
    assert count.stdout.strip() == "1"


def test_live_batch_worker_direct_insert_rejected(live_db, tmp_path):
    v = T.generate_variants("denklem-birinci-derece", 1, 99)[0]
    p_item = json.dumps(v.p_item(), ensure_ascii=False).replace("'", "''")
    insert_approved = (
        "insert into public.questions (curriculum_id, skill_ids, kind, stem, options, source, template_id, "
        "content_hash, status) select c.id, array['tyt.mat.cebir.denklem'], 'mcq', j->>'stem', j->'options', "
        "'template', 'denklem-birinci-derece', j->>'content_hash', 'approved' "
        f"from public.curricula c, (select '{p_item}'::jsonb as j) s "
        "where c.code = 'TYT-MAT' and c.version = '2026.1';")
    proc = _as_batch_worker(live_db, insert_approved, tmp_path)
    assert proc.returncode != 0
    assert "row-level security" in proc.stderr or "OGR-Q-001" in proc.stderr, proc.stderr
    proc = _as_batch_worker(live_db, (
        "insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by) "
        "select id, 'A', 'doğrudan yazma denemesi', 'verified', 'batch_worker:template' "
        "from public.questions limit 1;"),
        tmp_path)
    assert proc.returncode != 0 and "permission denied" in proc.stderr, proc.stderr
    proc = _as_batch_worker(live_db, (
        "insert into public.figures (tool, code, code_hash, alt_text, render_status, vision_status, review_status) "
        "values ('template', 'x', 'live-direct', 'Doğrudan yazılmış şekil denemesi', 'rendered', 'not_applicable', "
        "'verified');"), tmp_path)
    assert proc.returncode != 0, proc.stdout
    assert "permission denied" in proc.stderr or "row-level security" in proc.stderr, proc.stderr
    left = psql(live_db, sql=f"select count(*) from public.questions where content_hash = '{v.content_hash}'")
    assert left.stdout.strip() == "0"
    # aynı varyant RPC yoluyla girer
    assert _call(live_db, v, tmp_path) != "NULL"
