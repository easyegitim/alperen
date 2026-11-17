"""``tablet generate``: hedef listesi, istek kapatma, 2 deneme kuralı, anahtar yalıtımı, havuz yeterliliği (§6.1)."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from ogrenmen_common.runtime import Runtime

from conftest import FIXTURES, TABLET_FIXTURES, read_jsonl
from ogrenmen_tablet import cli
from ogrenmen_tablet import generate as G
from scripted import ScriptedLLM

KEY_FIELDS = ("correct_option", "canonical_expr", "numeric_value", "solution", "sympy_report")
REQUESTED = ["tyt.mat.temel.ondalik", "tyt.mat.problem.kesir", "tyt.mat.cebir.mutlak-deger"]


def make_rt(tmp_path: Path, llm, *, fixtures: Path = TABLET_FIXTURES) -> Runtime:
    rt = Runtime.from_env(dry_run=True, fixtures=fixtures, out=tmp_path / "out", env={})
    rt.llm = llm
    rt.ledger.llm = llm
    return rt


def run(tmp_path: Path, llm, opts: G.Options, *, seed=None) -> tuple[dict, Runtime]:
    rt = make_rt(tmp_path, llm)
    if seed:
        seed(rt)
    report = G.run(rt, opts)
    rt.close()
    return report, rt


def templated_skills() -> set[str]:
    seed = json.loads((FIXTURES / "db" / "dev-seed.json").read_text(encoding="utf-8"))
    return {t["skill_id"] for t in seed["question_templates"] if t.get("enabled")}


def test_generate_skips_templated_skills(tmp_path):
    rt = make_rt(tmp_path, ScriptedLLM())
    ctx = G.load_context(rt)
    templated = templated_skills()
    assert templated and templated == ctx.templated
    targets, _skipped, _warnings = G.build_targets(rt, ctx, G.Options(count=50))
    stock_targets = [t.skill_id for t in targets if t.source == "stock"]
    assert stock_targets and not set(stock_targets) & templated
    # şablonlu yaprak yalnız açık istekle gelir: mutlak-deger şablonlu, generation_requests'te exam_variant istemi var
    assert "tyt.mat.cebir.mutlak-deger" in templated
    assert [t.source for t in targets if t.skill_id == "tyt.mat.cebir.mutlak-deger"] == ["request"]
    # istek olmadan (fixture'sız taban dünya) şablonlu yapraklar hiç gelmez
    rt2 = Runtime.from_env(dry_run=True, fixtures=None, out=tmp_path / "out2", env={})
    targets2, _, _ = G.build_targets(rt2, G.load_context(rt2), G.Options(count=50))
    assert targets2 and not {t.skill_id for t in targets2} & templated
    rt.close()
    rt2.close()


def test_generate_reads_requests(tmp_path):
    llm = ScriptedLLM()
    report, _rt = run(tmp_path, llm, G.Options())
    out = tmp_path / "out"
    targets = report["targets"]
    assert len(targets) <= 10 == report["limit"]
    assert [t["source"] for t in targets[:3]] == ["request"] * 3
    assert {t["skill_id"] for t in targets[:3]} == set(REQUESTED)
    assert all(t["source"] == "stock" for t in targets[3:]) and len(targets) == 10
    assert all(t["status"] == "generated" and t["question_id"] for t in targets), targets
    served = read_jsonl(out / "generation_requests.jsonl")
    assert len(served) == 3 and all(r["served_question_id"] and r["served_at"] for r in served)
    by_req = {r["id"]: r["served_question_id"] for r in served}
    for t in targets[:3]:
        assert by_req[t["request_ids"][0]] == t["question_id"]
    prompts = llm.prompts()
    assert len(prompts) == 10
    assert not any("ocr_text" in p for p in prompts)
    # sınav arşivinin ham metni (exam_items.ocr_text) hiçbir isteme girmez
    seed = json.loads((FIXTURES / "db" / "dev-seed.json").read_text(encoding="utf-8"))
    ocr = [str(e["ocr_text"]) for e in seed["exam_items"] if e.get("ocr_text")]
    assert ocr
    for text in ocr:
        for piece in {text[:30], text[-30:]}:
            assert not any(piece in p for p in prompts), piece
    variant = next(p for p in prompts if "tyt.mat.cebir.mutlak-deger" in p)
    assert "Mutlak değer" in variant and "ortalama puan: 4" in variant
    # stok sırası: < 30 stoklu şablonsuz yapraklar en düşük stoktan
    stocks = [t["stock_before"] for t in targets[3:]]
    assert stocks == sorted(stocks)
    questions = read_jsonl(out / "questions.jsonl")
    assert {q["status"] for q in questions} == {"pending_review"}  # pilotta her LLM sorusu eğitmen onayına
    assert all(q["source"] == "llm" and q["prompt_version"] == "question_gen.v1" for q in questions)
    calls = read_jsonl(out / "llm_calls.jsonl")
    assert {c["purpose"] for c in calls} >= {"question_gen"}
    assert all(c.get("student_ref") is None for c in calls)


def test_count_caps_nightly_and_numeric_kind(tmp_path):
    llm = ScriptedLLM()
    report, _ = run(tmp_path, llm, G.Options(count=2))
    assert len(report["targets"]) == 2 and report["limit"] == 2
    assert all(t["source"] == "request" for t in report["targets"])
    ondalik = next(t for t in report["targets"] if t["skill_id"] == "tyt.mat.temel.ondalik")
    assert ondalik["question_kind"] == "mcq"


def test_two_retries_then_review_queue(tmp_path):
    skill = "tyt.mat.problem.sayi"
    llm = ScriptedLLM({skill: ["bad_sympy", "bad_sympy"]})
    report, _ = run(tmp_path, llm, G.Options(skill=skill, count=1, dump_keys=True))
    out = tmp_path / "out"
    [target] = report["targets"]
    assert target["status"] == "review" and target["attempts"] == G.MAX_ATTEMPTS == 2
    assert target["sympy"] == "failed"
    prompts = llm.prompts()
    assert len(prompts) == 2 and "Önceki deneme reddedildi" in prompts[1] and "SymPy" in prompts[1]
    [q] = read_jsonl(out / "questions.jsonl")
    assert q["status"] == "pending_review" and q["review_note"] is None  # batch_worker review_note yazamaz
    assert q["verification"]["sympy"] == "failed" and q["verification"]["attempts"] == 2
    assert "2 başarısız deneme" in q["verification"]["review_note"] and "SymPy" in q["verification"]["review_note"]
    rpcs = [r["rpc"] for r in read_jsonl(out / "rpc_calls.jsonl")]
    assert "register_answer_key" not in rpcs  # başarısız anahtar DB'ye yazılmaz
    assert report["_keys"] == []  # --dump-keys açıkken bile başarısız anahtar dökülmez
    # ikinci denemede düzelen soru: tek soru, register_answer_key ile pending_review
    llm2 = ScriptedLLM({skill: ["bad_sympy", "ok"]})
    report2, _ = run(tmp_path / "b", llm2, G.Options(skill=skill, count=1))
    assert report2["targets"][0]["status"] == "generated" and report2["targets"][0]["attempts"] == 2


def test_figure_mismatch_twice_goes_to_review(tmp_path):
    skill = "tyt.mat.problem.sayi"
    llm = ScriptedLLM({skill: ["figure", "figure"]}, vision=["mismatch", "mismatch"])
    report, _ = run(tmp_path, llm, G.Options(skill=skill, count=1))
    out = tmp_path / "out"
    [target] = report["targets"]
    assert target["status"] == "review" and target["vision"] == "mismatch" and target["render"] == "ok"
    [fig] = read_jsonl(out / "figures.jsonl")
    assert fig["render_status"] == "rendered" and fig["vision_status"] == "mismatch" and fig["attempts"] == 2
    assert fig["review_status"] == "pending" and fig["png_path"] == f"figures/{fig['id']}.png"
    assert (out / "storage" / "figures" / f"{fig['id']}.png").is_file()
    assert "kodu düzelt" in llm.prompts()[1]
    rpcs = [r for r in read_jsonl(out / "rpc_calls.jsonl") if r["rpc"] == "register_answer_key"]
    assert len(rpcs) == 1 and rpcs[0]["params"]["p_key"] == {"redacted": True, "sympy_status": "verified"}
    # şekil eşleşirse: vision match, figure attempts 0
    report2, _ = run(tmp_path / "b", ScriptedLLM({skill: ["figure"]}, vision=["match"]), G.Options(skill=skill,
                                                                                                    count=1))
    assert report2["targets"][0]["status"] == "generated" and report2["targets"][0]["vision"] == "match"


def test_discarded_attempts_keep_request_open(tmp_path):
    llm = ScriptedLLM({s: ["wrong_skill", "bad_schema"] for s in REQUESTED})
    report, _ = run(tmp_path, llm, G.Options(count=3))
    assert {t["status"] for t in report["targets"]} == {"failed"}
    assert not (tmp_path / "out" / "generation_requests.jsonl").exists()
    assert not (tmp_path / "out" / "questions.jsonl").exists()


def test_item_json_has_no_key_field(tmp_path):
    out = tmp_path / "out"
    code = cli.main(["generate", "--skill", "tyt.mat.temel.rasyonel-sayilar", "--count", "2", "--dry-run",
                     "--fixtures", str(TABLET_FIXTURES), "--out", str(out)], env={})
    assert code == 0
    assert (out / "cost_estimate.json").is_file()
    text = (out / "questions.jsonl").read_text(encoding="utf-8") if (out / "questions.jsonl").exists() else ""
    for field in KEY_FIELDS:
        assert f'"{field}"' not in text
    assert not (out / "keys.jsonl").exists()
    report = json.loads((out / "generate_report.json").read_text(encoding="utf-8"))
    assert "_keys" not in report and "correct_option" not in json.dumps(report)
    # scripted: her hedef soru üretir; --dump-keys yalnız dry-run'da keys.jsonl yazar
    report2, _ = run(tmp_path / "s", ScriptedLLM(), G.Options(skill="tyt.mat.problem.yas", count=2, dump_keys=True))
    out2 = tmp_path / "s" / "out"
    rows = read_jsonl(out2 / "questions.jsonl")
    assert len(rows) == 2
    for row in rows:
        assert not set(KEY_FIELDS) & set(row)
    assert report2["_keys"] and all("correct_option" in k for k in report2["_keys"])
    with pytest.raises(G.GenerateError, match="OGR-GEN-003"):
        cli.main(["generate", "--skill", "tyt.mat.problem.yas", "--dump-keys", "--out", str(tmp_path / "r")],
                 env={"SUPABASE_URL": "http://127.0.0.1:9", "SUPABASE_BATCH_JWT": "test-jwt"})


def test_pool_sufficient_skips_generation(tmp_path):
    skill = "tyt.mat.problem.yas"

    def seed(rt):
        cur = rt.db.select("curricula", where={"status": "active"})[0]["id"]
        rt.db.seed("questions", [{
            "id": f"00000000-0000-4000-8000-{i:012d}", "curriculum_id": cur, "skill_ids": [skill], "kind": "mcq",
            "stem": f"Havuz sorusu {i} için kök metni", "options": [], "source": "instructor", "status": "approved",
            "content_hash": f"havuz-{i}", "verification": {}} for i in range(30)])

    llm = ScriptedLLM()
    report, _ = run(tmp_path, llm, G.Options(skill=skill, count=3), seed=seed)
    assert [t["status"] for t in report["targets"]] == ["pool_sufficient"]
    assert llm.calls == [] and report["check_spend"] is None
    # gece modunda da ≥ 30 stoklu yaprak hedef listesine girmez
    llm2 = ScriptedLLM()
    report2, _ = run(tmp_path / "n", llm2, G.Options(count=10), seed=seed)
    generated = [t["skill_id"] for t in report2["targets"] if t["status"] != "pool_sufficient"]
    assert skill not in generated and len(generated) == 10


def test_cap_blocked_makes_no_llm_call(tmp_path):
    def seed(rt):
        flags = [dict(f, value=False) if f["key"] == "paid_llm_enabled" else f for f in rt.db.tables["runtime_flags"]]
        rt.db.seed("runtime_flags", flags, replace=True)

    llm = ScriptedLLM()
    report, _ = run(tmp_path, llm, G.Options(skill="tyt.mat.problem.yas", count=2), seed=seed)
    assert {t["status"] for t in report["targets"]} == {"cap_blocked"}
    assert llm.calls == []


def test_batch_mode_uses_batch_pricing(tmp_path):
    llm = ScriptedLLM()
    report, _ = run(tmp_path, llm, G.Options(count=3, batch=True))
    assert report["batch"] and {t["status"] for t in report["targets"]} == {"generated"}
    calls = [c for c in read_jsonl(tmp_path / "out" / "llm_calls.jsonl") if c["purpose"] == "question_gen"]
    assert calls and all(c["batch"] for c in calls)


def test_library_chunks_enter_prompt(tmp_path):
    from ogrenmen_tablet import library as L

    def seed(rt):
        rt.db.seed("library_documents", [{"id": "11111111-1111-4111-8111-111111111111", "curriculum_id":
                                          rt.db.select("curricula", where={"status": "active"})[0]["id"],
                                          "title": "Yaş problemleri notu", "storage_path": "library/x/not.pdf",
                                          "pages": 1}])
        texts = ["Yaş problemlerinde kişilerin yaş farkı hiç değişmez; bu yüzden fark sabittir.",
                 "Köklü ifadelerde eşlenik ile çarpılır."]
        rt.db.seed("library_chunks", [{"id": i + 1, "document_id": "11111111-1111-4111-8111-111111111111",
                                       "page": 1, "text": t, "embedding": None} for i, t in enumerate(texts)])
        assert L.terms("Yaş problemleri") <= L.terms(texts[0])

    llm = ScriptedLLM()
    report, _ = run(tmp_path, llm, G.Options(skill="tyt.mat.problem.yas", count=1), seed=seed)
    assert report["targets"][0]["library_chunk_ids"] == [1]
    assert "Ders notu örneği (sayfa 1): Yaş problemlerinde" in llm.prompts()[0]
    calls = [c for c in read_jsonl(tmp_path / "out" / "llm_calls.jsonl") if c["purpose"] == "question_gen"]
    assert calls[0]["ref_table"] == "library_chunks" and calls[0]["ref_id"] == "1"


def test_unknown_or_node_skill_is_rejected(tmp_path):
    rt = make_rt(tmp_path, ScriptedLLM())
    with pytest.raises(G.GenerateError, match="OGR-GEN-001"):
        G.run(rt, G.Options(skill="tyt.mat.yok-boyle"))
    with pytest.raises(G.GenerateError, match="yaprak"):
        G.run(rt, G.Options(skill="tyt.mat.temel"))
    rt.close()


def test_two_sympy_failures_leak_no_key_value(tmp_path):
    """SymPy'nin bulduğu şık/değer yalnız yeniden üretim istemine gider; rapora ve questions'a girmez."""
    skill = "tyt.mat.problem.sayi"
    llm = ScriptedLLM({skill: ["bad_sympy", "bad_sympy"]})
    report, _ = run(tmp_path, llm, G.Options(skill=skill, count=1))
    answers = {"11", "14"}  # senaryo: deneme 1 → 4 + 7, deneme 2 → 5 + 9 (doğru şık A, anahtar C)
    assert "SymPy doğru şıkkı A buldu, anahtar C diyor" in llm.prompts()[1]  # istem ayrıntıyı görür
    report_text = json.dumps(G.strip_keys(report)[0], ensure_ascii=False)
    [q] = read_jsonl(tmp_path / "out" / "questions.jsonl")
    public = [q["verification"]["review_note"], *report["targets"][0]["errors"], report["targets"][0]["review_note"]]
    for text in public:
        assert not re.search(r"\b[A-D]\b", text), text
        assert not any(a in text for a in answers), text
    assert "şıkkı" not in report_text and "anahtar C" not in report_text
    assert "anahtar C" not in json.dumps(q, ensure_ascii=False)


def test_key_rpc_failure_leaves_retryable_draft(tmp_path, monkeypatch):
    from ogrenmen_common.errors import RpcError

    skill = "tyt.mat.problem.yas"
    rt = make_rt(tmp_path, ScriptedLLM())
    real_rpc = rt.db.rpc
    failures = {"n": 1}

    def flaky(name, params=None, **kw):
        if name == "register_answer_key" and failures["n"]:
            failures["n"] -= 1
            raise RpcError("OGR-KEY-004 soru yok")
        return real_rpc(name, params, **kw)

    monkeypatch.setattr(rt.db, "rpc", flaky)
    report = G.run(rt, G.Options(skill=skill, count=1))
    [target] = report["targets"]
    assert target["status"] == "error" and "OGR-KEY-004" in target["errors"][-1]
    [row] = [q for q in rt.db.tables["questions"] if q["id"] == target["question_id"]]
    assert row["status"] == "draft" and row["verification"]["review_note"] == G.KEY_RPC_NOTE
    # sonraki çalışma: aynı içerik tekrar sayılmaz, satır güncellenir ve anahtar kaydedilir
    rt.llm = rt.ledger.llm = ScriptedLLM()
    ctx = G.load_context(rt)
    assert row["id"] in ctx.stale_drafts and row["content_hash"] not in ctx.hashes
    report2 = G.run(rt, G.Options(skill=skill, count=1))
    [target2] = report2["targets"]
    assert target2["status"] == "generated" and target2["question_id"] == row["id"]
    rows = [q for q in rt.db.tables["questions"] if q["id"] == row["id"]]
    assert len(rows) == 1 and rows[0]["status"] == "pending_review"
    assert rows[0]["verification"]["review_note"] is None
    rt.close()


def test_pool_sufficient_requests_reported_open(tmp_path):
    skill = "tyt.mat.temel.ondalik"

    def seed(rt):
        cur = rt.db.select("curricula", where={"status": "active"})[0]["id"]
        rt.db.seed("questions", [{
            "id": f"00000000-0000-4000-8000-{i:012d}", "curriculum_id": cur, "skill_ids": [skill], "kind": "mcq",
            "stem": f"Ondalık havuz sorusu {i}", "options": [], "source": "instructor", "status": "approved",
            "content_hash": f"ondalik-{i}", "verification": {}} for i in range(30)])

    report, _ = run(tmp_path, ScriptedLLM(), G.Options(count=3), seed=seed)
    sufficient = [t for t in report["targets"] if t["status"] == "pool_sufficient"]
    assert [t["skill_id"] for t in sufficient] == [skill]
    assert report["requests_left_open"] == sufficient[0]["request_ids"] and report["requests_left_open"]
