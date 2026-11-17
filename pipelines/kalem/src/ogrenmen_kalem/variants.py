"""``kalem variants --plan <uuid> --top 5`` — onaylı planın ilk N satırı için Tablet varyant İSTEKLERİ (§6.4).

**Tablet'i çağırmaz ve içe almaz**; yalnız ``generation_requests(kind='exam_variant', skill_id,
difficulty_band='mid', question_kind=kinds.question_kind_for_plan(kind), topic, points, plan_id,
requested_by_staff=plan.approved_by, needs_generation=true)`` satırları yazar. Her satır ``generation-request``
sözleşmesinden geçer (``ocr_text``/``stem`` alanı tanımsız → ham soru metni taşınamaz). Gece ``tablet generate``
bu satırları okur.

Atlananlar ``out/variants_report.json``'da sayılır: ``proof`` (ispat satırı — Tablet ispat üretmez),
``no_skill`` (``skill_id`` boş), ``exists`` (aynı plan + kazanım + konu için açık istek zaten var).
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

import ogrenmen_contracts as contracts

from .common import KalemError, course_by_id, insert_minimal, require_curriculum, select_in, write_json
from .kinds import question_kind_for_plan, variant_allowed

DEFAULT_TOP = 5
_POINTS = re.compile(r"^≈([0-9]+) puan$")


def _row_points(db: Any, row: Mapping[str, Any]) -> float | None:
    """Kümenin ortalama puanı (``exam_clusters.avg_points``); bulunamazsa ``points_text``'teki sayı."""
    ids = list(row.get("evidence_item_ids") or [])
    if ids:
        items = select_in(db, "exam_items", "id", ids, columns=("id", "cluster_id"))
        cids = sorted({str(i["cluster_id"]) for i in items if i.get("cluster_id")})
        if len(cids) == 1:
            got = db.select("exam_clusters", where={"id": cids[0]}, columns=("avg_points",), limit=1)
            if got and got[0].get("avg_points") is not None:
                return round(float(got[0]["avg_points"]), 2)
    m = _POINTS.match(str(row.get("points_text") or ""))
    return float(m.group(1)) if m else None


def variants_for_plan(rt: Any, plan_id: str, *, top: int = DEFAULT_TOP) -> dict[str, Any]:
    db = rt.db
    found = db.select("exam_priority_plans", where={"id": plan_id}, limit=1)
    if not found:
        raise KalemError(f"OGR-KALEM-005 plan yok: {plan_id}")
    plan_row = found[0]
    if plan_row.get("status") != "approved":
        raise KalemError(f"OGR-KALEM-005 yalnız onaylı plandan varyant istenir (durum: {plan_row.get('status')})")
    if top < 1:
        raise KalemError("OGR-KALEM-011 --top en az 1")
    course = course_by_id(db, str(plan_row["course_id"]))
    curriculum_id = require_curriculum(course)
    plan = plan_row["plan"]
    open_keys = {(r.get("skill_id"), r.get("topic"))
                 for r in db.select("generation_requests", where={"kind": "exam_variant", "plan_id": plan_id},
                                    columns=("skill_id", "topic", "served_question_id"))
                 if not r.get("served_question_id")}
    written: list[dict] = []
    skipped = {"proof": 0, "no_skill": 0, "exists": 0}
    details: list[dict] = []
    for row in list(plan.get("rows") or [])[:top]:
        info = {"rank": row.get("rank"), "topic": row.get("topic"), "kind": row.get("kind")}
        if not variant_allowed(str(row.get("kind"))):
            skipped["proof"] += 1
            details.append({**info, "result": "skipped: proof"})
            continue
        if not row.get("skill_id"):
            skipped["no_skill"] += 1
            details.append({**info, "result": "skipped: no_skill"})
            continue
        if (row["skill_id"], row.get("topic")) in open_keys:
            skipped["exists"] += 1
            details.append({**info, "result": "skipped: exists"})
            continue
        request = {"kind": "exam_variant", "curriculum_id": curriculum_id, "skill_id": row["skill_id"],
                   "difficulty_band": "mid", "question_kind": question_kind_for_plan(str(row["kind"])),
                   "topic": row["topic"], "points": _row_points(db, row), "plan_id": str(plan_id),
                   "requested_by_staff": plan_row.get("approved_by"), "needs_generation": True}
        contracts.validate("generation-request", request)
        written.append(request)
        open_keys.add((row["skill_id"], row.get("topic")))
        details.append({**info, "result": "written", "question_kind": request["question_kind"]})
    if written:
        insert_minimal(db, "generation_requests", written)
    report = {"plan_id": str(plan_id), "course_code": course["code"], "top": top, "written": len(written),
              "skipped": skipped, "rows": details}
    write_json(rt.out, "variants_report.json", report)
    return report
