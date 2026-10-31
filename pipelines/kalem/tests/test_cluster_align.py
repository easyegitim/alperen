"""``kalem embed``, ``cluster`` ve ``align`` (§6.4)."""

from __future__ import annotations

import json

import numpy as np
import pytest

from conftest import CURRICULUM, DEMO_COURSE, KALEM, SOURCE_2022, SOURCE_2023, make_rt, read_jsonl, run_cli
from ogrenmen_kalem import align as AL
from ogrenmen_kalem import cluster as CL
from ogrenmen_kalem import embed as EM
from ogrenmen_kalem import ingest as IN
from ogrenmen_kalem.common import KalemError, course_by_code, parse_vector


def _rt_with_items(out=None):
    rt = make_rt(out)
    course = course_by_code(rt.db, "DEMO")
    from ogrenmen_kalem.common import course_sources

    IN.replay_ocr_fixtures(rt, course, course_sources(rt.db, DEMO_COURSE))
    return rt, course


def test_single_link_threshold():
    dist = np.array([[0.0, 0.2, 0.9, 0.9],
                     [0.2, 0.0, 0.24, 0.9],
                     [0.9, 0.24, 0.0, 0.9],
                     [0.9, 0.9, 0.9, 0.0]])
    assert CL.single_link(dist) == [0, 0, 0, 1]  # zincir (tek bağ) 0-1-2; 3 ayrı
    dist[1, 2] = dist[2, 1] = 0.25  # eşik dahil değil
    assert CL.single_link(dist) == [0, 0, 1, 2]


def test_distance_matrix_topic_and_skill_links():
    items = [{"id": "a", "topic": "Mutlak  Değer", "skill_id": None},
             {"id": "b", "topic": "mutlak-değer", "skill_id": None},
             {"id": "c", "topic": "Kesir", "skill_id": "tyt.mat.temel.uslu"},
             {"id": "d", "topic": "Üs", "skill_id": "tyt.mat.temel.uslu"},
             {"id": "e", "topic": "Başka", "skill_id": None}]
    vecs = {"a": [1.0, 0.0], "b": [0.0, 1.0], "c": [1.0, 0.0], "d": [0.0, 1.0]}
    dist = CL.distance_matrix(items, vecs)
    assert dist[0, 1] == 0.0 and dist[2, 3] == 0.0
    assert dist[0, 2] == pytest.approx(0.0)  # aynı vektör → kosinüs 0
    assert dist[0, 4] == 1.0  # gömmesiz madde
    assert CL.single_link(dist) == [0, 0, 0, 0, 1]


def test_embed_writes_halfvec_and_ledger(tmp_path):
    out = tmp_path / "out"
    rt, course = _rt_with_items(out)
    rep = EM.embed_course(rt, course)
    again = EM.embed_course(rt, course)
    rt.close()
    assert rep["embedded"] == 10 and again["embedded"] == 0
    rows = [r for r in read_jsonl(out / "exam_items.jsonl")]
    vec = parse_vector(rows[0]["embedding"])
    assert len(vec) == 768 and rows[0]["embedding"].startswith("[")
    calls = read_jsonl(out / "llm_calls.jsonl")
    assert {c["purpose"] for c in calls} == {"embedding"} and len(calls) == 1


def test_cluster_years_hit_le_total(tmp_path):
    out = tmp_path / "out"
    rt, course = _rt_with_items(out)
    summary = CL.cluster_course(rt, course, algorithm="numpy")
    rt.close()
    clusters = read_jsonl(out / "exam_clusters.jsonl")
    assert summary["clusters"] == len(clusters) == 8 and summary["years_total"] == 2
    for c in clusters:
        assert set(c["years_hit"]) <= {2022, 2023}
        assert len(c["years_hit"]) <= c["years_total"] == 2
        assert c["curriculum_id"] == CURRICULUM and c["course_id"] == DEMO_COURSE
    by_label = {c["label"]: c for c in clusters}
    assert by_label["Rasyonel sayılar"]["years_hit"] == [2022, 2023] and by_label["Rasyonel sayılar"]["item_count"] == 2
    assert by_label["Rasyonel sayılar"]["kind"] == "calc" and by_label["Rasyonel sayılar"]["avg_points"] == 10
    items = read_jsonl(out / "exam_items.jsonl")
    assert all(i["cluster_id"] in {c["id"] for c in clusters} for i in items)
    statuses = {s["id"]: s["status"] for s in read_jsonl(out / "exam_sources.jsonl")}
    assert statuses == {SOURCE_2022: "clustered", SOURCE_2023: "clustered"}


def test_cluster_is_deterministic(tmp_path):
    outs = []
    for name in ("a", "b"):
        out = tmp_path / name
        rt, course = _rt_with_items(out)
        CL.cluster_course(rt, course)
        rt.close()
        outs.append((out / "exam_clusters.jsonl").read_text())
    assert outs[0] == outs[1]


def test_recluster_reuses_ids_and_empties_stale(tmp_path):
    rt, course = _rt_with_items()
    CL.cluster_course(rt, course)
    first = {c["label"]: c["id"] for c in rt.db.select("exam_clusters", where={"course_id": DEMO_COURSE})}
    # bir maddenin konusu değişir: "Mutlak değer" kümesi boşalır, madde "Rasyonel sayılar"a katılır
    item = next(i for i in rt.db.select("exam_items", where={"source_id": SOURCE_2022})
                if i.get("topic") == "Mutlak değer")
    rt.db.update("exam_items", {"topic": "Rasyonel sayılar", "skill_id": "tyt.mat.temel.rasyonel-sayilar"},
                 where={"id": item["id"]})
    CL.cluster_course(rt, course)
    after = {c["id"]: c for c in rt.db.select("exam_clusters", where={"course_id": DEMO_COURSE})}
    assert after[first["Rasyonel sayılar"]]["item_count"] == 3
    assert after[first["Mutlak değer"]]["item_count"] == 0 and after[first["Mutlak değer"]]["years_hit"] == []
    assert len(after) == len(first)  # silme yok, yeni küme açılmadı
    rt.close()


def test_cluster_without_embedding_uses_topic_links(tmp_path, monkeypatch, capsys):
    from ogrenmen_common.errors import LedgerError

    rt, course = _rt_with_items()

    def refuse(texts):
        raise LedgerError("OGR-LLM-002 tavan ücretli embedding çağrısını engelledi")

    monkeypatch.setattr(rt.embedding, "embed", refuse)
    summary = CL.cluster_course(rt, course)
    rt.close()
    assert summary["embedding"].startswith("yok") and summary["clusters"] == 8
    assert "konu bağıyla" in capsys.readouterr().err


def test_cluster_label_never_copies_ocr_text():
    texts = ["3) |2x - 3| = 7 denklemini sağlayan x değerlerinin toplamını bulunuz."]
    skills = {"tyt.mat.cebir.mutlak-deger": {"name": "Mutlak değer"}}
    members = [{"topic": "denklemini sağlayan x değerleri"}]
    assert CL.cluster_label(members, texts, skills, "tyt.mat.cebir.mutlak-deger", 3) == "Mutlak değer"
    assert CL.cluster_label(members, texts, {}, None, 3) == "Konu kümesi 3"
    # 12–19 karakterlik kopya da yakalanır (§6.4: 12+)
    short = [{"topic": "x değerlerinin"}]  # 14 karakter, ham metinden birebir
    assert CL.cluster_label(short, texts, skills, "tyt.mat.cebir.mutlak-deger", 4) == "Mutlak değer"


def test_cluster_label_skips_forbidden_words_and_allows_curated_vocabulary():
    texts = ["5) Örneklemden nokta tahmini yapınız; birinci dereceden denklemler ve sistemler kullanılır."]
    skills = {"s.est": {"name": "Tahmin yöntemleri"}, "s.denk": {"name": "Birinci dereceden denklemler ve sistemler"}}
    members = [{"topic": "Nokta tahmini"}]
    assert CL.cluster_label(members, texts, skills, "s.est", 2) == "Konu kümesi 2"  # konu da kazanım da yasaklı
    vocab = {"birinci dereceden denklemler ve sistemler"}
    curated = [{"topic": "Birinci dereceden denklemler ve sistemler"}]  # metinde birebir geçer ama müfredat adı
    assert CL.cluster_label(curated, texts, skills, "s.denk", 1, vocab) == "Birinci dereceden denklemler ve sistemler"
    assert CL.cluster_label(curated, texts, {}, None, 1) == "Konu kümesi 1"  # sözlük yoksa kopya sayılır


def test_cluster_changed_cli(tmp_path, capsys, shared_runtime):
    out = tmp_path / "out"
    assert run_cli("cluster", "--changed", "--dry-run", "--fixtures", str(KALEM), "--out", str(out)) == 0
    report = json.loads((out / "cluster_report.json").read_text())
    assert [r["course_code"] for r in report] == ["DEMO"] and report[0]["items"] == 0  # 2023 kaynağı maddesiz
    # maddesiz ocr_done kaynak da clustered olur: ikinci gece aynı ders yeniden seçilmez
    capsys.readouterr()
    assert run_cli("cluster", "--changed", "--dry-run", "--fixtures", str(KALEM), "--out", str(out)) == 0
    assert "SKIP: no changed courses" in capsys.readouterr().out
    shared_runtime.close()
    assert {s["id"]: s["status"] for s in read_jsonl(out / "exam_sources.jsonl")} == {SOURCE_2023: "clustered"}
    fixtures = tmp_path / "fx"
    fixtures.mkdir()
    rows = json.loads((KALEM / "exam_sources.json").read_text())
    for r in rows:
        r["status"] = "clustered"
    (fixtures / "exam_sources.json").write_text(json.dumps(rows), encoding="utf-8")
    (fixtures / "courses.json").write_text((KALEM / "courses.json").read_text(), encoding="utf-8")
    capsys.readouterr()
    assert run_cli("cluster", "--changed", "--dry-run", "--fixtures", str(fixtures), "--out", str(tmp_path / "o")) == 0
    assert "SKIP: no changed courses" in capsys.readouterr().out


def test_ingest_then_cluster_changed_chain(tmp_path):
    """Gece zinciri: ingest --queue && cluster --changed (aynı DB üzerinde)."""
    rt = make_rt(tmp_path / "out")
    IN.ingest_queue(rt)
    courses = CL.changed_courses(rt)
    assert [c["code"] for c in courses] == ["DEMO"]
    summary = CL.cluster_course(rt, courses[0])
    assert summary["items"] == 5 and summary["years_total"] == 1
    rt.close()


def test_align_writes_syllabus_curriculum_id(tmp_path):
    out = tmp_path / "out"
    rt, course = _rt_with_items(out)
    CL.cluster_course(rt, course)
    rep = AL.align_course(rt, course, syllabus=KALEM / "syllabus.json")
    rt.close()
    rows = read_jsonl(out / "syllabus_topics.jsonl")
    assert len(rows) == 9  # 5 hafta, 9 konu ↔ kazanım eşi
    assert all(r["curriculum_id"] == CURRICULUM and r["course_id"] == DEMO_COURSE for r in rows)
    assert {r["title"]: r["skill_ids"] for r in rows}["Mutlak değer"] == ["tyt.mat.cebir.mutlak-deger"]
    assert rep["uncovered_topics"] == ["Ondalık gösterim", "Köklü ifadeler", "Hareket problemleri"]
    align = {c["label"]: c["syllabus_alignment"] for c in rep["clusters"]}
    assert align["Rasyonel sayılar"] == "covered_and_asked"
    assert align["İrrasyonel sayılar ispatı"] == "asked_not_in_syllabus"
    assert json.loads((out / "alignment.json").read_text())["uncovered_topics"] == rep["uncovered_topics"]


def test_align_is_idempotent_and_cluster_auto_aligns(tmp_path):
    out = tmp_path / "out"
    rt, course = _rt_with_items(out)
    AL.align_course(rt, course, syllabus=KALEM / "syllabus.json")
    AL.align_course(rt, course, syllabus=KALEM / "syllabus.json")
    assert len(rt.db.select("syllabus_topics", where={"course_id": DEMO_COURSE})) == 9
    summary = CL.cluster_course(rt, course)
    rt.close()
    assert summary["alignment"]["uncovered_topics"] == ["Ondalık gösterim", "Köklü ifadeler", "Hareket problemleri"]


def test_align_rejects_unknown_skill(tmp_path):
    bad = tmp_path / "s.json"
    bad.write_text(json.dumps([{"week": 1, "topics": ["Uydurma"], "skill_ids": ["tyt.mat.yok.boyle"]}]))
    rt, course = _rt_with_items()
    with pytest.raises(KalemError, match="OGR-KALEM-007"):
        AL.align_course(rt, course, syllabus=bad)
    rt.close()


@pytest.mark.parametrize("data", [[], {"week": 1}, [{"week": 0, "topics": ["A"]}], [{"week": 1, "topics": []}],
                                  [{"week": 1, "topics": ["A"], "extra": 1}]])
def test_parse_syllabus_rejects_bad_shapes(data):
    with pytest.raises(KalemError, match="OGR-KALEM-007"):
        AL.parse_syllabus(data)


def test_parse_syllabus_unpaired_week_is_one_row():
    rows = AL.parse_syllabus([{"week": 2, "topics": ["Üslü", "Köklü"], "skill_ids": ["tyt.mat.temel.uslu"]}])
    assert rows == [{"week": 2, "title": "Üslü, Köklü", "skill_ids": ["tyt.mat.temel.uslu"]}]


@pytest.mark.skipif(not CL.sklearn_available(), reason="scikit-learn kurulu değil (isteğe bağlı [sklearn] ekstrası)")
def test_sklearn_average_link_matches_numpy_on_linked_data():
    rt, course = _rt_with_items()
    a = CL.cluster_course(rt, course, algorithm="sklearn")
    rt.close()
    rt2, course2 = _rt_with_items()
    b = CL.cluster_course(rt2, course2, algorithm="numpy")
    rt2.close()
    assert a["algorithm"] == "sklearn-average" and a["clusters"] == b["clusters"]
