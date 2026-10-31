"""``kalem plan --course <kod> --period <dönem>`` — sıklık analizine göre öncelik planı (§6.4, §4.5).

Yalnız elle çalışır (gece işinde yoktur). Plan ``exam-priority-plan`` sözleşmesinden geçer (başlık sabiti
"Sıklık analizine göre öncelikler", ``x-forbidden-words``: tahmin/çıkacak/kesin/garanti → red) ve
``exam_priority_plans(status='pending_review')`` olarak yazılır; onay panelde ``approve_priority_plan`` ile.

Satırlar: en çok 10 küme; sıra ölçütü kaç yılda soruldu (``years``) → madde sayısı (``hits``) → ortalama puan →
etiket. ``points_text = "≈{yuvarla(ort)} puan"`` (yarım yukarı). Plan **soru metni taşımaz**: konu etiketleri ham
OCR metninden 12+ karakter kopyalıyorsa (``COPY_WINDOW``; müfredat kazanım adı / izlence başlığıyla birebir aynı
etiket muaf) kazanım adına ya da "Konu kümesi N"e çevrilir. Yasaklı kelime taşıyan etiket ("Nokta tahmini" gibi
olağan bir ders konusu da olsa) aynı yoldan değiştirilir; ``uncovered_topics``'ten ise atılır. Değiştirilen ya da
atılan her etiket için stderr'e (etiketin kendisi yazılmadan) uyarı düşer; ``validate_plan`` son kapıdır.

Hazırlık (``prepare_course``): maddeler kümelenmemişse önce ``cluster`` çalışır. Sahte kipte (``--dry-run``)
maddesi olmayan kaynaklar için ``<fixtures>/ocr-*.json`` OCR çıktısı olarak yeniden oynatılır ve ders için
izlence satırı yoksa ``<fixtures>/syllabus.json`` yazılır — uçtan uca örnek ağsız ve modelsiz koşar.
"""

from __future__ import annotations

import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import ogrenmen_contracts as contracts

from .align import align_course, alignment
from .cluster import cluster_course
from .common import (
    KalemError,
    course_items,
    course_sources,
    course_vocabulary,
    curriculum_skills,
    insert_minimal,
    label_problem,
    now_iso,
    pick_label,
    round_half_up,
    select_in,
    sort_key_tr,
    write_json,
)
from .ingest import replay_ocr_fixtures
from .kinds import plan_kind

TITLE = "Sıklık analizine göre öncelikler"
MAX_ROWS = 10
TOPIC_MAX = 80


def prepare_course(rt: Any, course: Mapping[str, Any], *, name_hashes: Sequence[str] = (),
                   algorithm: str = "auto") -> dict[str, Any]:
    db = rt.db
    course_id = str(course["id"])
    notes: dict[str, Any] = {"replayed_items": 0, "syllabus_from_fixtures": False, "clustered": False}
    sources = course_sources(db, course_id)
    if rt.is_fake:
        notes["replayed_items"] = replay_ocr_fixtures(rt, course, sources)
    items = course_items(db, course_id)
    if rt.is_fake and rt.fixtures is not None:
        syllabus = Path(rt.fixtures) / "syllabus.json"
        if syllabus.is_file() and not db.select("syllabus_topics", where={"course_id": course_id},
                                                columns=("id",), limit=1):
            align_course(rt, course, syllabus=syllabus)
            notes["syllabus_from_fixtures"] = True
    clusters = {str(c["id"]) for c in db.select("exam_clusters", where={"course_id": course_id}, columns=("id",))}
    if items and any(not it.get("cluster_id") or str(it["cluster_id"]) not in clusters for it in items):
        cluster_course(rt, course, name_hashes=name_hashes, algorithm=algorithm, run_align=False)
        notes["clustered"] = True
    return notes


def _variant_ids(db: Any, skill_id: str | None, topic: str) -> list[str]:
    """Bu satır için daha önce üretilmiş, onaylı ÖZGÜN varyantlar (``questions.source='llm'``)."""
    if not skill_id:
        return []
    reqs = db.select("generation_requests", where={"kind": "exam_variant", "skill_id": skill_id},
                     columns=("topic", "served_question_id"))
    qids = [r["served_question_id"] for r in reqs if r.get("served_question_id") and r.get("topic") == topic]
    if not qids:
        return []
    rows = select_in(db, "questions", "id", qids, columns=("id", "status", "source"))
    return sorted(str(q["id"]) for q in rows if q.get("status") == "approved" and q.get("source") == "llm")


REASONS = {"forbidden": "yasaklı kelime taşıdığı", "copy": "ham soru metninden kopya olduğu"}


def _safe_topic(label: str, texts: Sequence[str], skills: Mapping[str, Mapping], skill_id: str | None,
                rank: int, vocabulary: set[str] | frozenset[str] = frozenset(),
                warnings: list[str] | None = None, where: str = "satır") -> str:
    skill_name = (skills.get(skill_id) or {}).get("name") if skill_id else None
    topic, rejected = pick_label((label, skill_name), texts, vocabulary, f"Konu kümesi {rank}", max_len=TOPIC_MAX)
    if rejected and warnings is not None:
        why = " ve ".join(dict.fromkeys(REASONS[r] for r in rejected))
        warnings.append(f"{rank}. {where} konu etiketi {why} için değiştirildi")
    return topic


def build_plan(rt: Any, course: Mapping[str, Any], period: str, *, align: Mapping[str, Any] | None = None,
               warnings: list[str] | None = None) -> dict[str, Any]:
    """Planı kurar (yazmaz); ``evidence_count`` = kümelenmiş madde sayısı. ``align`` verilmezse hesaplanır;
    değiştirilen/atılan etiketlerin uyarıları ``warnings``'e eklenir."""
    db = rt.db
    course_id = str(course["id"])
    items = course_items(db, course_id)
    years_total = len({int(it["_year"]) for it in items})
    if years_total < 2:
        raise KalemError(f"OGR-KALEM-004 öncelik planı için en az iki yılın arşivi gerekir ({course['code']}: "
                         f"{years_total} yıl)")
    clusters = {str(c["id"]): c for c in db.select("exam_clusters", where={"course_id": course_id})}
    members: dict[str, list[dict]] = {}
    for it in items:
        cid = str(it.get("cluster_id") or "")
        if cid in clusters:
            members.setdefault(cid, []).append(it)
    if not members:
        raise KalemError(f"OGR-KALEM-004 {course['code']} için kümelenmiş madde yok; önce kalem cluster")
    texts = [str(it.get("ocr_text") or "") for it in items]
    skills = curriculum_skills(db, str(course["curriculum_id"])) if course.get("curriculum_id") else {}
    vocabulary = course_vocabulary(db, course)
    if align is None:
        align = alignment(rt, course)
    by_cluster = {c["cluster_id"]: c["syllabus_alignment"] for c in align["clusters"]}
    warn = warnings if warnings is not None else []

    def points_of(ms: Sequence[Mapping[str, Any]]) -> float:
        pts = [float(m["points"]) for m in ms if m.get("points") is not None]
        return sum(pts) / len(pts) if pts else 0.0

    def rank_key(cid: str) -> tuple:
        ms = members[cid]
        return (-len({m["_year"] for m in ms}), -len(ms), -points_of(ms),
                sort_key_tr(str(clusters[cid].get("label") or "")), cid)

    ordered = sorted(members, key=rank_key)
    rows: list[dict] = []
    for rank, cid in enumerate(ordered[:MAX_ROWS], start=1):
        c, ms = clusters[cid], members[cid]
        topic = _safe_topic(str(c.get("label") or ""), texts, skills, c.get("skill_id"), rank, vocabulary, warn)
        rows.append({
            "rank": rank, "topic": topic, "kind": plan_kind(str(c.get("kind") or "other")),
            "skill_id": c.get("skill_id"), "hits": len(ms), "years": len({m["_year"] for m in ms}),
            "points_text": f"≈{round_half_up(points_of(ms))} puan", "evidence_count": len(ms),
            "evidence_item_ids": [str(m["id"]) for m in ms],
            "syllabus_alignment": by_cluster.get(cid, "asked_not_in_syllabus"),
            "variant_question_ids": _variant_ids(db, c.get("skill_id"), topic),
        })
    others = [_safe_topic(str(clusters[cid].get("label") or ""), texts, skills, clusters[cid].get("skill_id"), n,
                          vocabulary, warn, where="diğer küme")
              for n, cid in enumerate(ordered[MAX_ROWS:], start=MAX_ROWS + 1)]
    uncovered: list[str] = []
    for n, title in enumerate(align["uncovered_topics"], start=1):
        problem = label_problem(title, texts, vocabulary)
        if problem is None:
            uncovered.append(title)
        elif problem != "empty":
            warn.append(f"izlencede olup sorulmamış {n}. konu {REASONS[problem]} için plana alınmadı")
    evidence = sum(len(ms) for ms in members.values())
    return {"schema_version": "1.0", "course_code": str(course["code"]), "period": str(period), "title": TITLE,
            "years_total": years_total, "rows": rows, "others": others, "uncovered_topics": uncovered,
            "evidence_count": evidence, "generated_at": now_iso(rt.clock)}


def validate_plan(plan: Mapping[str, Any]) -> dict:
    try:
        return contracts.validate("exam-priority-plan", dict(plan))
    except contracts.ContractValidationError as exc:
        raise KalemError(f"OGR-KALEM-010 plan sözleşmeden geçmedi: {exc}") from exc


def plan_course(rt: Any, course: Mapping[str, Any], period: str, *, name_hashes: Sequence[str] = (),
                algorithm: str = "auto") -> dict[str, Any]:
    notes = prepare_course(rt, course, name_hashes=name_hashes, algorithm=algorithm)
    align = alignment(rt, course)
    warnings: list[str] = []
    plan = validate_plan(build_plan(rt, course, period, align=align, warnings=warnings))
    insert_minimal(rt.db, "exam_priority_plans", {"course_id": str(course["id"]), "period": str(period),
                                                  "plan": plan, "evidence_count": int(plan["evidence_count"])})
    write_json(rt.out, "priority_plan.json", plan)
    for w in warnings:
        print(f"UYARI: {w}", file=sys.stderr)
    if not align["has_syllabus"]:
        print("UYARI: dersin izlencesi yok; tüm satırlar 'izlencede yok' olarak işaretlendi (kalem align "
              "--syllabus ile ekle)", file=sys.stderr)
    notes["warnings"] = warnings
    return {"plan": plan, "notes": notes}
