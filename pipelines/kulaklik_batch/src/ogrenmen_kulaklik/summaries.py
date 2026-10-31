"""Haftalık özet (``summaries --week``) — BLUEPRINT §6.2, §4.3 ``weekly-summary``.

Öğrenci başına (``students.status='active'``) haftanın olguları + ölçüleri → zincir ``weekly_summary``.
Ölçüler LLM'den gelmez: canlı veritabanında ``panel_metrics_weekly`` görünümü **doğrudan okunur** (normal
görünüm; hafta pazartesi başlıyorsa), aksi hâlde (dry-run/JsonlDb ya da pazartesi dışı pencere) aynı tanımlar
Python'da hesaplanır. ``morale_trend`` ``morale_signal`` ortalamasındandır (ders kaynaklı ``kind='morale'``
olguları dahil): ≥ 0.5 ``up``, ≤ −0.5 ``down``, arası ``flat``, sinyal yoksa ``unknown``.

Modelden yalnız ``body`` ve ``next_week_focus`` alınır; ``student_ref``, ``week_start``, ``metrics`` ve
``facts_used`` (istemde verilen olgularla kesişim) pipeline tarafından yazılır ve sonuç sözleşmeden geçer.
Gövde temizleyiciden geçer; yargı/tanı etiketi ya da ilke 10 kelimesi (``tahmin``, ``çıkacak``, ``kesin``,
``garanti``) taşıyan gövde yazılmaz (``rejected``, ``yargi_kelimesi``). ``weekly_summaries`` ekleme yalnızdır
(``batch_worker`` ``r w``; aynı hafta varsa atlanır).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import ogrenmen_contracts as contracts
from ogrenmen_common.adapters.base import LLMRequest
from ogrenmen_common.batch import BatchItem
from ogrenmen_common.clock import istanbul_date, parse_ts
from ogrenmen_common.errors import LedgerError
from ogrenmen_common.pii import scrub_for_llm

from .common import Students, Window, int_setting, label_word, safe_select, select_in, select_window

SYSTEM = (
    "Sen Öğrenmen'in haftalık özet yazarısın. Yalnız weekly-summary şemasına uygun JSON döndür.\n"
    "- body: 3–6 cümle, üçüncü tekil ve isimsiz ('Öğrenci …'): ne çalıştı, nerede takıldı, ne söz verdi, moral.\n"
    "- Yargı ya da tanı etiketi kullanma; yüzde yazma; yalnız verilen olgu ve ölçülere dayan.\n"
    "- facts_used: gerçekten kullandığın olgu numaraları; next_week_focus: en çok 3 kazanım kimliği."
)


@dataclass
class SummariesReport:
    week_start: str
    written: int = 0
    skipped_existing: list[str] = field(default_factory=list)
    rejected: list[dict] = field(default_factory=list)
    errors: dict[str, str] = field(default_factory=dict)
    batch_status: str = "done"
    metrics_source: dict[str, str] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


def morale_trend(avg: float | None) -> str:
    if avg is None:
        return "unknown"
    if avg >= 0.5:
        return "up"
    if avg <= -0.5:
        return "down"
    return "flat"


def weekly_metrics(db: Any, student_id: str, window: Window) -> dict[str, Any]:
    """``panel_metrics_weekly`` tanımlarının Python eşleniği (+ ``mastery_deltas``)."""
    msgs = select_window(db, "messages", "sent_at", window, where={"student_id": student_id, "sender_role": "student"},
                         columns=("id", "is_question", "answered_at", "sent_at"))
    enrollments = [str(e["id"]) for e in db.select("enrollments", where={"student_id": student_id})]
    attempts = [a for a in select_in(db, "attempts", "enrollment_id", enrollments,
                                     columns=("is_correct", "created_at")) if window.contains(a.get("created_at"))]
    graded = [a for a in attempts if a.get("is_correct") is not None]
    days = {istanbul_date(m["sent_at"]) for m in msgs} | {istanbul_date(a["created_at"]) for a in attempts}
    misconceptions = select_in(db, "misconceptions", "enrollment_id", enrollments, where={"status": "open"},
                               columns=("id",))
    facts = select_window(db, "memory_facts", "created_at", window, where={"student_id": student_id},
                          columns=("morale_signal",))
    signals = [int(f["morale_signal"]) for f in facts if f.get("morale_signal") is not None]
    morale_avg = round(sum(signals) / len(signals), 2) if signals else None
    min_evidence = int_setting(db, "min_evidence", 5)
    evidence = {(str(m["enrollment_id"]), m["skill_id"]): int(m.get("evidence_count") or 0)
                for m in select_in(db, "mastery", "enrollment_id", enrollments,
                                   columns=("enrollment_id", "skill_id", "evidence_count"))}
    history = [h for h in select_in(db, "mastery_history", "enrollment_id", enrollments)
               if window.contains(h.get("created_at"))]
    pairs: dict[tuple[str, str], list[dict]] = {}
    for h in sorted(history, key=lambda h: (parse_ts(h["created_at"]), int(h["id"]))):
        pairs.setdefault((str(h["enrollment_id"]), h["skill_id"]), []).append(h)
    deltas = []
    for (enr, skill), rows in sorted(pairs.items(), key=lambda kv: kv[0][1]):
        before = rows[0].get("p_before")
        before = float(before) if before is not None else float(rows[0]["p_after"])
        delta = max(-1.0, min(1.0, round(float(rows[-1]["p_after"]) - before, 4)))
        deltas.append({"skill_id": skill, "delta": delta, "reliable": evidence.get((enr, skill), 0) >= min_evidence})
    accuracy = round(sum(1 for a in graded if a["is_correct"]) / len(graded), 4) if graded else None
    return {"messages": len(msgs), "questions_solved": len(attempts), "accuracy": accuracy,
            "active_days": min(7, len(days)), "open_misconceptions": len(misconceptions),
            "unanswered_questions": sum(1 for m in msgs
                                        if m.get("is_question") is True and m.get("answered_at") is None),
            "morale_trend": morale_trend(morale_avg), "mastery_deltas": deltas}


def view_metrics(db: Any, student_id: str, window: Window) -> dict[str, Any] | None:
    """Canlı veritabanında ``panel_metrics_weekly`` (yalnız pazartesi başlayan pencere için)."""
    if window.start.weekday() != 0:
        return None
    rows = safe_select(db, "panel_metrics_weekly", where={"student_id": student_id,
                                                          "week_start": window.start.isoformat()}, limit=1)
    if not rows:
        return None
    r = rows[0]
    out = {k: r.get(k) for k in ("messages", "questions_solved", "accuracy", "active_days", "open_misconceptions",
                                 "unanswered_questions", "morale_trend")}
    out["accuracy"] = None if out["accuracy"] is None else float(out["accuracy"])
    return out


def _facts_for(db: Any, student_id: str, window: Window) -> list[dict]:
    """Son 7 günün kullanılabilir olguları (aktif; onay gerektiren yalnız onaylıysa)."""
    rows = select_window(db, "memory_facts", "created_at", window, where={"student_id": student_id},
                         columns=("id", "kind", "text", "status", "requires_approval", "approved", "morale_signal"))
    return sorted((f for f in rows if f.get("status") in ("active", "merged")
                   and (not f.get("requires_approval") or f.get("approved"))), key=lambda f: int(f["id"]))


def build_prompt(ref: str, window: Window, metrics: dict, facts: list[dict], name_hashes: Sequence[str]) -> str:
    lines = [f"Öğrenci: {ref}", f"Hafta: {window.start.isoformat()}", "Ölçüler:"]
    for key in ("messages", "questions_solved", "accuracy", "active_days", "open_misconceptions",
                "unanswered_questions", "morale_trend"):
        lines.append(f"- {key}: {metrics.get(key)}")
    for d in metrics.get("mastery_deltas") or []:
        trust = "güvenilir" if d["reliable"] else "az kanıt"
        lines.append(f"- kazanım {d['skill_id']}: değişim {d['delta']} ({trust})")
    lines.append("Olgular (numara = memory_facts.id):")
    for f in facts:
        lines.append(f"[#{f['id']}] {f['kind']}: {scrub_for_llm(str(f['text']), name_hashes).text}")
    return "\n".join(lines)


def run_summaries(rt: Any, window: Window, *, batch: bool = False, name_hashes: Sequence[str] = (),
                  student_ref: str | None = None, limit: int | None = None) -> SummariesReport:
    db = rt.db
    report = SummariesReport(week_start=window.start.isoformat())
    students = Students.load(db)
    plans: list[tuple[str, str, dict, list[dict], LLMRequest]] = []
    for sid in sorted(students.active_ids(), key=lambda s: students.ref(s) or s):
        ref = students.ref(sid)
        if ref is None or (student_ref is not None and ref != student_ref):
            continue
        if db.select("weekly_summaries", where={"student_id": sid, "week_start": window.start.isoformat()}, limit=1):
            report.skipped_existing.append(ref)
            continue
        metrics = view_metrics(db, sid, window)
        report.metrics_source[ref] = "panel_metrics_weekly" if metrics else "python"
        computed = weekly_metrics(db, sid, window)
        if metrics is None:
            metrics = computed
        else:
            metrics["mastery_deltas"] = computed["mastery_deltas"]
        facts = _facts_for(db, sid, window)
        if metrics["messages"] == 0 and metrics["questions_solved"] == 0 and not facts:
            continue
        req = LLMRequest(purpose="weekly_summary", model="", prompt=build_prompt(ref, window, metrics, facts,
                                                                                 name_hashes),
                         system=SYSTEM, schema_id="weekly-summary", max_tokens=800, temperature=0.3)
        plans.append((sid, ref, metrics, facts, req))
    if limit is not None:
        plans = plans[:limit]
    results: dict[str, Any] = {}
    if batch:
        outcome = rt.batch.run("weekly_summary", [BatchItem(key=ref, request=req, student_ref=ref,
                                                            ref_table="weekly_summaries")
                                                  for _, ref, _, _, req in plans],
                               display_name=f"ogrenmen-weekly-{window.start.isoformat()}")
        report.batch_status = outcome.status
        report.errors.update(outcome.errors)
        results = outcome.results
    else:
        for _, ref, _, _, req in plans:
            try:
                results[ref] = rt.ledger.call("weekly_summary", req, student_ref=ref, ref_table="weekly_summaries")
            except LedgerError as exc:
                report.errors[ref] = exc.message
    for sid, ref, metrics, facts, _ in plans:
        res = results.get(ref)
        if res is None or not isinstance(res.data, dict):
            continue
        given = {int(f["id"]) for f in facts}
        used = [int(i) for i in res.data.get("facts_used") or [] if int(i) in given]
        body = scrub_for_llm(str(res.data.get("body") or ""), name_hashes).text[:600]
        summary = {"schema_version": "1.0", "student_ref": ref, "week_start": window.start.isoformat(),
                   "body": body, "metrics": metrics, "facts_used": used}
        focus = [s for s in res.data.get("next_week_focus") or []][:3]
        if focus:
            summary["next_week_focus"] = focus
        word = label_word(body)
        if word is not None:
            report.rejected.append({"student_ref": ref, "reason": "yargi_kelimesi", "word": word})
            continue
        errs = contracts.errors("weekly-summary", summary)
        if errs or not body.strip():
            report.rejected.append({"student_ref": ref, "reason": errs[0].message if errs else "boş gövde"})
            continue
        db.insert("weekly_summaries", {"student_id": sid, "week_start": window.start.isoformat(), "body": body,
                                       "metrics": metrics, "facts_used": used, "model": res.model,
                                       "cost_usd": res.cost_usd}, on_conflict="ignore")
        report.written += 1
    return report
