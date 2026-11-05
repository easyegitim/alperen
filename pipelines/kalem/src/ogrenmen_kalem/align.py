"""``kalem align --course <kod> [--syllabus <json>]`` — izlence ↔ küme hizalaması (§6.4).

``--syllabus`` verilirse (``[{"week": 1, "topics": [...], "skill_ids": [...]}]``) satırlar ``syllabus_topics``'e
yazılır: ``curriculum_id = courses.curriculum_id`` (tablo ``not null``; ``app.questions_check_skills`` her kazanımı
``(curriculum_id, skill_id)`` ile denetler — burada da önceden denetlenir, bilinmeyen kazanım ``OGR-KALEM-007``).
``topics`` ve ``skill_ids`` aynı uzunluktaysa her konu ayrı satırdır (konu ↔ kazanım eşi), değilse hafta tek
satırdır. Silme yetkisi olmadığından eski satırlar kalır; aynı (hafta, konu) satırı güncellenir.

Hizalama: kazanımı izlencede olan ya da etiketi bir izlence konusuyla aynı olan küme ``covered_and_asked``,
diğerleri ``asked_not_in_syllabus``; hiçbir kümenin karşılamadığı izlence konuları ``uncovered_topics``
(``covered_never_asked``). Çıktı ``out/alignment.json``.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from .common import (
    KalemError,
    curriculum_skills,
    insert_minimal,
    norm_topic,
    require_curriculum,
    stable_uuid,
    update_minimal,
    write_json,
)

ALIGNMENTS = ("covered_and_asked", "covered_never_asked", "asked_not_in_syllabus")
_ENTRY_KEYS = {"week", "topics", "skill_ids"}


def parse_syllabus(data: Any) -> list[dict]:
    """İzlence JSON'u → ``syllabus_topics`` satır taslakları (``week, title, skill_ids``)."""
    if not isinstance(data, list) or not data:
        raise KalemError("OGR-KALEM-007 izlence boş olmayan bir dizi olmalı: [{week, topics, skill_ids}]")
    rows: list[dict] = []
    for n, entry in enumerate(data, start=1):
        if not isinstance(entry, Mapping) or set(entry) - _ENTRY_KEYS or "topics" not in entry:
            raise KalemError(f"OGR-KALEM-007 izlence {n}. kaydı yalnız week, topics, skill_ids taşır")
        week = entry.get("week")
        if week is not None and (not isinstance(week, int) or isinstance(week, bool) or week < 1):
            raise KalemError(f"OGR-KALEM-007 izlence {n}. kaydında week pozitif tam sayı olmalı")
        topics = entry.get("topics")
        skill_ids = entry.get("skill_ids", [])
        if (not isinstance(topics, list) or not topics or
                not all(isinstance(t, str) and t.strip() for t in topics)):
            raise KalemError(f"OGR-KALEM-007 izlence {n}. kaydında topics boş olmayan metin dizisi olmalı")
        if not isinstance(skill_ids, list) or not all(isinstance(s, str) for s in skill_ids):
            raise KalemError(f"OGR-KALEM-007 izlence {n}. kaydında skill_ids metin dizisi olmalı")
        if len(topics) == len(skill_ids):
            rows.extend({"week": week, "title": t.strip(), "skill_ids": [s]} for t, s in zip(topics, skill_ids,
                                                                                            strict=True))
        else:
            rows.append({"week": week, "title": ", ".join(t.strip() for t in topics),
                         "skill_ids": list(dict.fromkeys(skill_ids))})
    return rows


def write_syllabus(rt: Any, course: Mapping[str, Any], entries: Sequence[Mapping[str, Any]]) -> int:
    db = rt.db
    course_id = str(course["id"])
    curriculum_id = require_curriculum(course)
    skills = curriculum_skills(db, curriculum_id)
    unknown = sorted({s for e in entries for s in e["skill_ids"] if s not in skills})
    if unknown:
        raise KalemError(f"OGR-KALEM-007 izlencedeki kazanım müfredatta yok: {', '.join(unknown)}")
    existing = {(r.get("week"), norm_topic(r.get("title"))): r
                for r in db.select("syllabus_topics", where={"course_id": course_id})}
    for entry in entries:
        key = (entry["week"], norm_topic(entry["title"]))
        values = {"curriculum_id": curriculum_id, "week": entry["week"], "title": entry["title"],
                  "skill_ids": list(entry["skill_ids"])}
        if key in existing:
            update_minimal(db, "syllabus_topics", values, where={"id": str(existing[key]["id"])})
        else:
            row = {"id": stable_uuid("syllabus_topic", course_id, entry["week"], entry["title"]),
                   "course_id": course_id, **values}
            insert_minimal(db, "syllabus_topics", row)
    return len(entries)


def alignment(rt: Any, course: Mapping[str, Any]) -> dict[str, Any]:
    db = rt.db
    course_id = str(course["id"])
    topics = db.select("syllabus_topics", where={"course_id": course_id}, order=["week", "title"])
    clusters = [c for c in db.select("exam_clusters", where={"course_id": course_id})
                if int(c.get("item_count") or 0) > 0]
    syllabus_skills = {s for t in topics for s in (t.get("skill_ids") or [])}
    syllabus_titles = {norm_topic(t.get("title")) for t in topics}
    out_clusters = []
    for c in sorted(clusters, key=lambda r: str(r["id"])):
        covered = (c.get("skill_id") in syllabus_skills) or (norm_topic(c.get("label")) in syllabus_titles)
        out_clusters.append({"cluster_id": str(c["id"]), "label": c.get("label"), "skill_id": c.get("skill_id"),
                             "syllabus_alignment": "covered_and_asked" if covered else "asked_not_in_syllabus"})
    asked_skills = {c.get("skill_id") for c in clusters if c.get("skill_id")}
    asked_labels = {norm_topic(c.get("label")) for c in clusters}
    uncovered: list[str] = []
    for t in topics:
        hit = set(t.get("skill_ids") or []) & asked_skills or norm_topic(t.get("title")) in asked_labels
        if not hit and t.get("title") not in uncovered:
            uncovered.append(str(t["title"]))
    return {"course_code": course["code"], "has_syllabus": bool(topics), "syllabus_topics": len(topics),
            "clusters": out_clusters, "uncovered_topics": uncovered}


def align_course(rt: Any, course: Mapping[str, Any], *, syllabus: Path | None = None) -> dict[str, Any]:
    written = 0
    if syllabus is not None:
        path = Path(syllabus)
        if not path.is_file():
            raise KalemError(f"OGR-KALEM-007 izlence dosyası yok: {path}")
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise KalemError(f"OGR-KALEM-007 izlence JSON değil: {exc}") from exc
        written = write_syllabus(rt, course, parse_syllabus(data))
    report = alignment(rt, course)
    report["written_topics"] = written
    write_json(rt.out, "alignment.json", report)
    return report
