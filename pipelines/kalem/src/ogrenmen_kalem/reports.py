"""Çeldirici motoru analiz raporları (§6.4 (a)); motorun kendisi SQL'dedir (``grade_attempt → observations →
apply_observation → ön koşul çıkarımı``). İkisi de yalnız okur, LLM çağırmaz; çıktılar yalnız sayı ve kazanım/etiket
kimliği taşır (öğrenci, kayıt, personel kimliği yok).

* ``distractor-report [--curriculum TYT-MAT]`` — onaylı sorulardaki her etiketli çeldiricinin seçilme oranı;
  denenmiş soruda hiç seçilmeyen çeldiriciler yeniden yazım adayıdır (M07 ``distractor_unused_share`` ile aynı
  tanım). **Sayım kuralı (M07 ile ortak):** sorunun her denemesi sayılır — şık seçmeden (``chosen`` boş ya da
  ``key``'siz) yapılan deneme de çeldiriciyi öğrenciye göstermiştir; bu yüzden ``offered`` (sunulma) toplamına girer
  ve soruyu "denenmiş" yapar, hiçbir şıkkın ``chosen`` sayısına girmez. ``out/distractor_report.json`` + ``.md``.
* ``prerequisite-audit [--curriculum TYT-MAT] [--window-days 14]`` — ön koşul çıkarımı (``observations.kind=
  'inferred'``) ile düşen kazanımlar ve aynı kayıt × kazanımdaki **sonraki ilk doğrudan ölçümle** (teşhis, pratik,
  test) örtüşme: doğrudan ölçüm yanlışsa (``value < 0.5``) çıkarım doğrulanmış sayılır. ``out/prerequisite_audit.json``
  + ``.md``; ``diagnostic_agreement`` ile birlikte pilot ölçütüdür.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping
from datetime import timedelta
from typing import Any

from ogrenmen_common.clock import parse_ts

from .common import curricula_by_code, select_in

DIRECT_KINDS = ("diagnostic", "practice", "test")
DEFAULT_WINDOW_DAYS = 14


def _ratio(num: int, den: int) -> float | None:
    return round(num / den, 4) if den > 0 else None


# --- çeldirici raporu ------------------------------------------------------------------------------


def distractor_report(db: Any, *, curriculum: str | None = None) -> dict[str, Any]:
    cids = set(curricula_by_code(db, curriculum))
    questions = [q for q in db.select("questions", where={"status": "approved"},
                                      columns=("id", "options", "curriculum_id", "skill_ids"))
                 if q.get("options") and str(q.get("curriculum_id")) in cids]
    attempts = select_in(db, "attempts", "question_id", [q["id"] for q in questions],
                         columns=("question_id", "chosen"))
    by_q: dict[str, Counter] = defaultdict(Counter)
    for a in attempts:  # şıksız deneme None anahtarıyla sayılır (sunulma toplamına girer; M07 ile aynı kural)
        by_q[str(a["question_id"])][(a.get("chosen") or {}).get("key")] += 1
    tags: dict[str, dict[str, Any]] = {}
    unused: list[dict] = []
    offered_distractors = 0
    attempted_questions = 0
    for q in sorted(questions, key=lambda r: str(r["id"])):
        counts = by_q.get(str(q["id"]))
        if not counts:
            continue
        attempted_questions += 1
        total = sum(counts.values())
        for opt in q["options"]:
            tag = opt.get("misconception_tag")
            if not tag:
                continue
            offered_distractors += 1
            chosen = counts.get(opt.get("key"), 0)
            t = tags.setdefault(tag, {"offered": 0, "chosen": 0, "questions": 0})
            t["offered"] += total
            t["chosen"] += chosen
            t["questions"] += 1
            if chosen == 0:
                unused.append({"question_id": str(q["id"]), "key": opt.get("key"), "tag": tag,
                               "skill_id": (q.get("skill_ids") or [None])[0]})
    texts = {str(t["tag"]): t.get("text_instructor") for t in db.select("misconception_tags",
                                                                       columns=("tag", "text_instructor"))}
    by_tag = {tag: {**v, "rate": _ratio(v["chosen"], v["offered"]), "text_instructor": texts.get(tag)}
              for tag, v in sorted(tags.items())}
    never = sorted(tag for tag, v in by_tag.items() if v["chosen"] == 0)
    return {"curriculum": curriculum, "approved_questions": len(questions), "attempted_questions": attempted_questions,
            "n": offered_distractors, "unused": len(unused), "value": _ratio(len(unused), offered_distractors),
            "by_tag": by_tag, "never_chosen_tags": never, "rewrite_candidates": unused}


def distractor_markdown(rep: Mapping[str, Any]) -> str:
    lines = ["# Çeldirici raporu", "",
             f"Müfredat: {rep['curriculum'] or 'tümü'} · onaylı soru {rep['approved_questions']} · "
             f"denenmiş soru {rep['attempted_questions']}",
             f"Etiketli çeldirici {rep['n']}, hiç seçilmeyen {rep['unused']}"
             + (f" (pay {rep['value']:.2f})" if rep["value"] is not None else " (henüz ölçülmedi)"), "",
             "| Etiket | Sunulma | Seçilme | Oran |", "| --- | --- | --- | --- |"]
    for tag, v in rep["by_tag"].items():
        rate = "—" if v["rate"] is None else f"{v['rate']:.2f}"
        lines.append(f"| `{tag}` | {v['offered']} | {v['chosen']} | {rate} |")
    if rep["rewrite_candidates"]:
        lines += ["", "## Yeniden yazım adayları (hiç seçilmeyen çeldiriciler)", ""]
        for c in rep["rewrite_candidates"]:
            lines.append(f"- Soru `{c['question_id']}` şık {c['key']} · `{c['tag']}`")
    return "\n".join(lines) + "\n"


# --- ön koşul denetimi -----------------------------------------------------------------------------


def prerequisite_audit(db: Any, *, curriculum: str | None = None, window_days: int = DEFAULT_WINDOW_DAYS,
                       since: Any = None) -> dict[str, Any]:
    cids = set(curricula_by_code(db, curriculum))
    inferred = [o for o in db.select("observations", where={"kind": "inferred"}, order=["created_at", "id"])
                if str(o.get("curriculum_id")) in cids]
    if since is not None:
        floor = parse_ts(since)
        inferred = [o for o in inferred if parse_ts(o["created_at"]) >= floor]
    history = {int(h["observation_id"]): h for h in select_in(db, "mastery_history", "observation_id",
                                                              [o["id"] for o in inferred])
               if h.get("method") == "inferred"}
    direct: dict[tuple[str, str], list[dict]] = defaultdict(list)
    pairs = {(str(o["enrollment_id"]), str(o["skill_id"])) for o in inferred}
    for enrollment in sorted({p[0] for p in pairs}):
        for o in db.select("observations", where={"enrollment_id": enrollment}, order=["created_at", "id"]):
            if o.get("kind") in DIRECT_KINDS and o.get("value") is not None:
                direct[(enrollment, str(o["skill_id"]))].append(o)
    names = {str(s["id"]): s.get("name") for s in db.select("skills", columns=("id", "name"))}
    per_skill: dict[str, dict[str, Any]] = {}
    measured = agreed = 0
    for o in inferred:
        skill = str(o["skill_id"])
        s = per_skill.setdefault(skill, {"skill_id": skill, "name": names.get(skill), "inferred": 0, "dropped": 0,
                                         "drop_sum": 0.0, "measured": 0, "agreed": 0})
        s["inferred"] += 1
        h = history.get(int(o["id"]))
        if h is not None and h.get("p_before") is not None and float(h["p_after"]) < float(h["p_before"]):
            s["dropped"] += 1
            s["drop_sum"] += float(h["p_before"]) - float(h["p_after"])
        start = parse_ts(o["created_at"])
        end = start + timedelta(days=window_days)
        nxt = next((d for d in direct[(str(o["enrollment_id"]), skill)]
                    if start < parse_ts(d["created_at"]) <= end), None)
        if nxt is not None:
            s["measured"] += 1
            measured += 1
            if float(nxt["value"]) < 0.5:
                s["agreed"] += 1
                agreed += 1
    skills_out = []
    for skill in sorted(per_skill):
        s = per_skill[skill]
        skills_out.append({"skill_id": skill, "name": s["name"], "inferred": s["inferred"], "dropped": s["dropped"],
                           "avg_drop": round(s["drop_sum"] / s["dropped"], 4) if s["dropped"] else None,
                           "measured": s["measured"], "agreed": s["agreed"],
                           "agreement": _ratio(s["agreed"], s["measured"])})
    return {"curriculum": curriculum, "window_days": window_days, "n_inferred": len(inferred),
            "n_dropped": sum(s["dropped"] for s in per_skill.values()), "n_measured": measured, "n_agreed": agreed,
            "value": _ratio(agreed, measured), "by_skill": skills_out}


def prerequisite_markdown(rep: Mapping[str, Any]) -> str:
    value = "henüz ölçülmedi" if rep["value"] is None else f"{rep['value']:.2f}"
    lines = ["# Ön koşul çıkarımı denetimi", "",
             f"Müfredat: {rep['curriculum'] or 'tümü'} · pencere {rep['window_days']} gün",
             f"Çıkarım {rep['n_inferred']} (düşüren {rep['n_dropped']}) · sonradan doğrudan ölçülen "
             f"{rep['n_measured']} · örtüşen {rep['n_agreed']} · örtüşme {value}", "",
             "| Kazanım | Çıkarım | Düşüş ort. | Ölçülen | Örtüşen |", "| --- | --- | --- | --- | --- |"]
    for s in rep["by_skill"]:
        drop = "—" if s["avg_drop"] is None else f"{s['avg_drop']:.3f}"
        lines.append(f"| {s['name'] or s['skill_id']} | {s['inferred']} | {drop} | {s['measured']} | {s['agreed']} |")
    return "\n".join(lines) + "\n"
