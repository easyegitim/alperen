"""``render --queue``, ``vision --queue`` ("kodu düzelt" yolu), ``verify``, ``review-queue --push`` (§6.1, §10.5)."""

from __future__ import annotations

import json
import re

from ogrenmen_common.runtime import Runtime

from conftest import TABLET_FIXTURES, read_jsonl
from ogrenmen_tablet import cli
from ogrenmen_tablet import figures as FG
from ogrenmen_tablet import review as R
from scripted import GOOD_FIGURE, ScriptedLLM

FIG_ID = "22222222-2222-4222-8222-222222222222"
Q_ID = "33333333-3333-4333-8333-333333333333"


def _rt(tmp_path, llm=None) -> Runtime:
    rt = Runtime.from_env(dry_run=True, fixtures=TABLET_FIXTURES, out=tmp_path / "out", env={})
    if llm is not None:
        rt.llm = llm
        rt.ledger.llm = llm
    return rt


def _seed_llm_question(rt, *, render_status: str, png: bytes | None = None) -> None:
    cur = rt.db.select("curricula", where={"status": "active"})[0]["id"]
    path = None
    if png is not None:
        rt.storage.upload("figures", f"{FIG_ID}.png", png, content_type="image/png")
        path = f"figures/{FIG_ID}.png"
    rt.db.seed("figures", [{"id": FIG_ID, "tool": "matplotlib", "code": GOOD_FIGURE, "code_hash": FG.code_hash(
        GOOD_FIGURE), "alt_text": "İki kesir modeli: 5/6 ve 1/4 boyalı dikdörtgenler.", "png_path": path,
        "render_status": render_status, "vision_status": "pending", "review_status": "pending", "attempts": 0,
        "created_at": "2026-10-19T00:00:00Z"}])
    rt.db.seed("questions", [{
        "id": Q_ID, "curriculum_id": cur, "skill_ids": ["tyt.mat.temel.rasyonel-sayilar"], "kind": "mcq",
        "stem": "Şekilde 6 eş parçadan 5'i ve 4 eş parçadan 1'i boyalı. `5/6 - 1/4` kaçtır?",
        "stem_values": {"pay1": 5, "payda1": 6, "pay2": 1, "payda2": 4}, "figure_id": FIG_ID,
        "options": [{"key": k, "text": t, "misconception_tag": None} for k, t in
                    zip("ABCD", ["`7/12`", "`4/2`", "`1/12`", "`4/6`"], strict=True)],
        "source": "llm", "status": "pending_review", "content_hash": "kuyruk-sorusu",
        "verification": {"schema": True, "sympy": "verified", "render": "pending", "vision": "pending",
                         "attempts": 0, "status": "pending_review", "review_note": None},
        "created_at": "2026-10-19T00:00:00Z"}])


def test_render_queue_renders_pending_figures(tmp_path):
    rt = _rt(tmp_path)
    _seed_llm_question(rt, render_status="pending")
    [res] = FG.render_queue(rt)
    assert res.status == "ok" and res.attempts == 1
    rt.close()
    [fig] = read_jsonl(tmp_path / "out" / "figures.jsonl")
    assert fig["render_status"] == "rendered" and fig["png_path"] == f"figures/{FIG_ID}.png"
    assert (fig["width_px"], fig["height_px"]) == (800, 400) and fig["vision_status"] == "pending"
    assert (tmp_path / "out" / "storage" / "figures" / f"{FIG_ID}.png").is_file()
    assert fig["review_status"] == "pending"  # batch_worker inceleme sütununu yazmaz


def test_vision_queue_fixes_mismatched_figure(tmp_path):
    from ogrenmen_tablet import sandbox as S

    png = S.render("matplotlib", GOOD_FIGURE).png
    llm = ScriptedLLM(vision=["mismatch", "match"])
    rt = _rt(tmp_path, llm)
    _seed_llm_question(rt, render_status="rendered", png=png)
    [res] = FG.vision_queue(rt, curriculum_code="TYT-MAT@2026.1")
    assert res.status == "fixed", res
    new_fid = res.extra["new_figure_id"]
    assert new_fid != FIG_ID
    fix_prompt = llm.prompts()[0]
    assert "Uyuşmazlıklar" in fix_prompt and "payda2" in fix_prompt
    rt.close()
    figs = {f["id"]: f for f in read_jsonl(tmp_path / "out" / "figures.jsonl")}
    assert figs[FIG_ID]["vision_status"] == "mismatch" and figs[FIG_ID]["attempts"] == 1
    assert figs[new_fid]["vision_status"] == "match" and figs[new_fid]["render_status"] == "rendered"
    [q] = read_jsonl(tmp_path / "out" / "questions.jsonl")
    assert q["figure_id"] == new_fid and q["verification"]["vision"] == "match"
    assert q["status"] == "pending_review"
    assert res.extra["superseded_figure_id"] == FIG_ID


def test_superseded_figure_not_counted_in_review_queue(tmp_path):
    from ogrenmen_tablet import sandbox as S

    png = S.render("matplotlib", GOOD_FIGURE).png
    rt = _rt(tmp_path, ScriptedLLM(vision=["mismatch", "match"]))
    _seed_llm_question(rt, render_status="rendered", png=png)
    before = R.collect(rt)["figures"]["pending"]
    [res] = FG.vision_queue(rt, curriculum_code="TYT-MAT@2026.1")
    assert res.status == "fixed"
    summary = R.collect(rt)
    # eski şekil review_status='pending' kalır (batch_worker yazamaz) ama hiçbir soruya bağlı değil: sayılmaz
    old = next(f for f in rt.db.tables["figures"] if f["id"] == FIG_ID)
    assert old["review_status"] == "pending"
    assert summary["figures"]["pending"] == before
    linked = {q.get("figure_id") for q in rt.db.tables["questions"] if q.get("status") == "pending_review"}
    assert FIG_ID not in linked and res.extra["new_figure_id"] in linked
    rt.close()


def test_vision_queue_leaves_approved_question_alone(tmp_path):
    from ogrenmen_tablet import sandbox as S

    png = S.render("matplotlib", GOOD_FIGURE).png
    llm = ScriptedLLM(vision=["mismatch", "match"])
    rt = _rt(tmp_path, llm)
    _seed_llm_question(rt, render_status="rendered", png=png)
    q = next(q for q in rt.db.tables["questions"] if q["id"] == Q_ID)
    q["status"] = "approved"
    verification_before = json.dumps(q["verification"], sort_keys=True)
    figures_before = len(rt.db.tables["figures"])
    [res] = FG.vision_queue(rt, curriculum_code="TYT-MAT@2026.1")
    assert res.status == "mismatch" and "approved" in res.detail
    assert llm.prompts() == []  # düzeltme istenmedi (question_gen çağrısı yok)
    assert [c.purpose for c in llm.calls] == ["vision_check"]
    q = next(q for q in rt.db.tables["questions"] if q["id"] == Q_ID)
    assert q["figure_id"] == FIG_ID and json.dumps(q["verification"], sort_keys=True) == verification_before
    fig = next(f for f in rt.db.tables["figures"] if f["id"] == FIG_ID)
    assert fig["vision_status"] == "mismatch" and fig["vision_report"]["status"] == "mismatch"
    assert len(rt.db.tables["figures"]) == figures_before  # yeni (yetim) şekil satırı yok
    rt.close()


def test_review_message_counts_only_two_attempt_notes():
    base = {"questions": {"pending_review": 3, "with_generation_note": 2, "failed_two_attempts": 0, "oldest_days": 0},
            "figures": {"pending": 1}}
    text = R.message(base)
    assert "2 sorunun üretim notu var" in text and "iki denemede" not in text
    two = dict(base, questions=dict(base["questions"], failed_two_attempts=1))
    text2 = R.message(two)
    assert "1 soru iki denemede doğrulamayı geçemedi" in text2 and "üretim notu" not in text2
    assert all("!" not in t for t in (text, text2))


def test_vision_queue_second_mismatch_stays_in_review(tmp_path):
    from ogrenmen_tablet import sandbox as S

    png = S.render("matplotlib", GOOD_FIGURE).png
    rt = _rt(tmp_path, ScriptedLLM(vision=["mismatch"]))
    _seed_llm_question(rt, render_status="rendered", png=png)
    rt.db.tables["figures"][-1]["attempts"] = 1
    [res] = FG.vision_queue(rt, curriculum_code="TYT-MAT@2026.1")
    assert res.status == "mismatch" and res.attempts == 2
    rt.close()
    [q] = read_jsonl(tmp_path / "out" / "questions.jsonl")
    assert q["verification"]["vision"] == "mismatch" and "eğitmen" in q["verification"]["review_note"]


def test_verify_command(tmp_path):
    out = tmp_path / "v"
    assert cli.main(["verify", "--question", str(TABLET_FIXTURES / "llm-question.json"), "--out", str(out)],
                    env={}) == 0
    report = json.loads((out / "verify_report.json").read_text(encoding="utf-8"))
    assert report["status"] == "verified" and report["render"]["status"] == "ok"
    assert cli.main(["verify", "--question", str(TABLET_FIXTURES / "llm-question-bad-sympy.json"), "--out",
                     str(out)], env={}) == 1
    assert cli.main(["verify", "--question", str(TABLET_FIXTURES / "llm-question-bad-schema.json"), "--out",
                     str(out)], env={}) == 1
    bad = json.loads((out / "verify_report.json").read_text(encoding="utf-8"))
    assert bad["rule"] == "schema"


def test_review_queue_push_text_rules(tmp_path):
    rt = _rt(tmp_path)
    summary = R.collect(rt)
    assert summary["questions"]["pending_review"] >= 1
    text = R.push(rt, summary)
    assert rt.notifier.sent and text in rt.notifier.sent[-1]["text"]
    assert "!" not in text and len(text.splitlines()) <= 4
    assert not re.search(r"[\U0001F300-\U0001FAFF]", text)
    assert not re.search(r"s_[a-z2-7]{12}", text)
    rt.close()
    out = tmp_path / "rq"
    assert cli.main(["review-queue", "--push", "--dry-run", "--out", str(out)], env={}) == 0
    data = json.loads((out / "review_queue.json").read_text(encoding="utf-8"))
    assert data["pushed_text"].startswith("Onay kuyruğunda")


def test_render_queue_real_mode_needs_no_model_key(tmp_path):
    import httpx

    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path, request.url.query.decode()))
        return httpx.Response(200, json=[])

    env = {"SUPABASE_URL": "http://supabase.test", "SUPABASE_BATCH_JWT": "batch-test-jwt"}
    out = tmp_path / "real"
    assert cli.main(["render", "--queue", "--out", str(out)], env=env, transport=httpx.MockTransport(handler)) == 0
    assert seen and seen[0][0] == "GET" and seen[0][1] == "/rest/v1/figures"
    assert "render_status=eq.pending" in seen[0][2]
    assert json.loads((out / "render_queue.json").read_text(encoding="utf-8"))["total"] == 0
    assert (out / "cost_estimate.json").is_file()
