"""Eğitmen alarmları (``metrics``): ders kaynaklı moral, iki grup → iki ops, sıralama, yargı kelimesi yok."""

from __future__ import annotations

import json
import shutil
from datetime import timedelta

import ogrenmen_contracts as contracts
import pytest

from conftest import KULAKLIK, STUDENT_B, make_rt, read_jsonl, run_cli
from ogrenmen_kulaklik import alerts as A
from ogrenmen_kulaklik.common import KulaklikError, Students, mask_words

LESSON_MORALE = KULAKLIK / "lesson-morale.json"
FORBIDDEN = ("depresif", "tembel", "başarısız", "umutsuz")


def test_lesson_morale_feeds_alert(tmp_path):
    assert run_cli("metrics", "--dry-run", "--fixtures", str(LESSON_MORALE), "--out", str(tmp_path)) == 0
    morale = [a for a in read_jsonl(tmp_path / "instructor_alerts.jsonl") if a["kind"] == "morale"]
    assert len(morale) == 1
    row = morale[0]
    assert row["student_id"] == STUDENT_B and row["severity"] == "warning"
    assert row["detail"] == "Moral göstergesi düştü (son 7 gün, 3 sinyal)"
    assert not any(w in row["detail"].lower() for w in FORBIDDEN)
    facts = json.loads(LESSON_MORALE.read_text())["memory_facts"]
    assert [f["morale_signal"] for f in facts] == [-2, -2, -2]
    assert all(f["source_lesson_claim_id"] and not f["source_message_ids"] for f in facts)


def test_two_groups_two_ops_alerts(tmp_path):
    assert run_cli("metrics", "--dry-run", "--fixtures", str(KULAKLIK), "--out", str(tmp_path)) == 0
    rows = read_jsonl(tmp_path / "instructor_alerts.jsonl")
    admin = [a for a in rows if a["kind"] == "ops" and a["detail"].startswith("Bot grupta yönetici değil")]
    assert len(admin) == 2
    assert len({a["ref"]["chat_id"] for a in admin}) == 2
    assert all(a["student_id"] is None for a in admin)
    views = json.loads((tmp_path / "alerts.json").read_text())
    ops = [v for v in views if v["kind"] == "ops"]
    for v in ops:
        contracts.validate("instructor-alert", v)
    # gizlilik modu kapalı doğrulanmamış grup ayrı nedenle ayrı satır (alerts_dedup: detail'in ilk 24 karakteri)
    assert len([a for a in rows if a["kind"] == "ops"]) == 3


def test_alerts_sorted_and_free_of_judgement(tmp_path):
    run_cli("metrics", "--dry-run", "--fixtures", str(KULAKLIK), "--out", str(tmp_path))
    views = json.loads((tmp_path / "alerts.json").read_text())
    order = {"danger": 0, "warning": 1, "neutral": 2}
    keys = [(order[v["severity"]], v["since"]) for v in views]
    assert keys == sorted(keys)
    assert views[0]["severity"] == "danger"
    text = (tmp_path / "instructor_alerts.jsonl").read_text(encoding="utf-8").lower()
    assert not any(w in text for w in FORBIDDEN)
    for v in views:
        contracts.validate("instructor-alert", v)
        assert v["student_ref"] is None or v["student_ref"].startswith("s_")


def test_alert_rules_match_cron_open_alerts(tmp_path):
    rt = make_rt(tmp_path)
    now = rt.clock()
    rt.db.seed("escalations", {"id": "aaaaaaaa-0000-4000-8000-000000000001", "chat_id": 700000001, "message_id": 19,
                               "student_id": "c661b28c-81a8-5c11-9a5e-b919b5231034", "reason": "bot_unsure",
                               "question_text": "Paydaları nasıl eşitlerim?", "target_staff_id": None,
                               "status": "answered", "created_at": (now - timedelta(days=2)).isoformat(),
                               "answered_at": (now - timedelta(days=2) + timedelta(hours=5)).isoformat(),
                               "answered_by": "de70e65e-1410-5026-a773-c5e55a3e6368"})
    rt.db.seed("memory_facts", {"id": 500, "student_id": "c661b28c-81a8-5c11-9a5e-b919b5231034", "kind": "deadline",
                                "text": "Öğrencinin kesir ödevi yarın teslim.", "source_message_ids": [17],
                                "requires_approval": False, "approved": False, "valid_until": "2026-10-21",
                                "status": "active", "morale_signal": None, "created_at": "2026-10-19T00:00:00Z"})
    rep = A.open_alerts(rt.db, now)
    rows = rt.db.written("instructor_alerts")
    kinds = {r["kind"] for r in rows if r.get("status") == "open"}
    assert {"unanswered", "morale", "ops", "deadline", "response"} <= kinds
    deadline = next(r for r in rows if r["kind"] == "deadline")
    assert deadline["ref"] == {"fact_id": 500} and deadline["severity"] == "neutral"
    response = next(r for r in rows if r["kind"] == "response")
    # medyan (0,75 + 5) / 2 = 2,9 saat > 2 saat; detail'de personel adı yok
    assert response["detail"] == "Yanıt süresi medyanı hedefin üstünde: 2,9 saat (hedef 2 saat)"
    unanswered = [r for r in rows if r["kind"] == "unanswered" and r.get("status") == "open"]
    assert {r["ref"].get("message_id") for r in unanswered} >= {27}
    assert all(r["severity"] == "danger" for r in unanswered)  # 24 saatten eski
    assert rep.opened == len([r for r in rows if r.get("created_at") == "2026-10-20T09:00:00Z"])
    rt.close()


def test_dedup_and_resolution(tmp_path):
    rt = make_rt(tmp_path)
    now = rt.clock()
    first = A.open_alerts(rt.db, now)
    second = A.open_alerts(rt.db, now)
    assert first.opened > 0 and second.opened == 0
    assert second.deduplicated == second.candidates
    rt.db.role = "postgres"
    rt.db.update("messages", {"answered_at": "2026-10-19T10:00:00Z"}, where={"id": 27})
    rt.db.update("tg_chats", {"bot_is_admin": True}, where={"chat_id": -1001000000003})
    rt.db.role = "batch_worker"
    third = A.open_alerts(rt.db, now)
    assert third.resolved == 2
    done = [a for a in rt.db.select("instructor_alerts", where={"status": "done"})]
    assert any(a["ref"].get("message_id") == 27 for a in done)
    assert any(a["ref"].get("chat_id") == -1001000000003 for a in done)
    rt.close()


def test_judgement_word_is_refused(tmp_path):
    rt = make_rt(tmp_path)
    students = Students.load(rt.db)
    bad = {"kind": "morale", "severity": "warning", "student_id": STUDENT_B, "staff_id": None,
           "detail": "Öğrenci tembel görünüyor", "since": "2026-10-19T00:00:00Z", "ref": {}}
    with pytest.raises(KulaklikError, match="OGR-KLK-010"):
        A.check_alert(bad, students)
    # sözleşmenin kendisi de (x-forbidden-words) aynı kelimeleri reddeder
    with pytest.raises(contracts.ContractValidationError):
        contracts.validate("instructor-alert", A.contract_view(dict(bad, detail="Öğrenci umutsuz"), students))
    rt.close()


SLOW_A = "aaaaaaaa-0000-4000-8000-0000000000a1"
SLOW_B = "aaaaaaaa-0000-4000-8000-0000000000b2"


def _seed_responder(db, staff_id, hours, n=1, start=0):
    now = db.now()
    db.seed("staff", {"id": staff_id, "role": "instructor", "active": True, "created_at": "2026-10-01T00:00:00Z"})
    for i in range(n):
        created = now - timedelta(days=3, minutes=start + i)
        db.seed("escalations", {"id": f"{staff_id[:-4]}{start + i:04d}", "chat_id": 700000001, "message_id": 19,
                                "student_id": "c661b28c-81a8-5c11-9a5e-b919b5231034", "reason": "bot_unsure",
                                "question_text": "Paydalar?", "target_staff_id": staff_id, "status": "answered",
                                "created_at": created.isoformat(),
                                "answered_at": (created + timedelta(hours=hours[i])).isoformat(),
                                "answered_by": staff_id})


def test_two_slow_responders_get_two_response_alerts(tmp_path):
    rt = make_rt(tmp_path)
    _seed_responder(rt.db, SLOW_A, [6.0])
    _seed_responder(rt.db, SLOW_B, [7.0])
    rep = A.open_alerts(rt.db, rt.clock())
    response = [r for r in rt.db.written("instructor_alerts") if r["kind"] == "response"]
    by_staff = {r["ref"]["staff_id"]: r for r in response}
    assert {SLOW_A, SLOW_B} <= set(by_staff)
    assert by_staff[SLOW_A]["detail"] == "Yanıt süresi medyanı hedefin üstünde: 6,0 saat (hedef 2 saat)"
    assert by_staff[SLOW_B]["detail"] == "Yanıt süresi medyanı hedefin üstünde: 7,0 saat (hedef 2 saat)"
    assert rep.by_kind["response"] == len(response)
    # alerts_dedup: aynı detail öneki, farklı ref.staff_id → farklı anahtar
    assert A.dedup_key(by_staff[SLOW_A]) != A.dedup_key(by_staff[SLOW_B])
    assert A.dedup_key({"kind": "response", "ref": {"staff_id": "A"}, "detail": "x"}) != A.dedup_key(
        {"kind": "response", "ref": {"staff_id": "B"}, "detail": "x"})
    rt.close()


def test_response_numbers_formatted_like_sql(tmp_path):
    # round(numeric, 1) yarım yukarı: medyan (2,0 + 2,5) / 2 = 2,25 → "2,3"; hedef 2.0 → v_target::text "2,0"
    assert A.round_half_up(2.25) == "2.3" and A.round_half_up(2.35) == "2.4" and A.round_half_up(3.0) == "3.0"
    assert A.numeric_text(2, "2") == "2" and A.numeric_text(2.0, "2") == "2.0" and A.numeric_text(None, "2") == "2"
    rt = make_rt(tmp_path)
    rt.db.role = "postgres"
    rt.db.update("settings", {"value": 2.0}, where={"key": "response_target_hours"})
    rt.db.role = "batch_worker"
    _seed_responder(rt.db, SLOW_A, [2.0, 2.5], n=2)
    A.open_alerts(rt.db, rt.clock())
    row = next(r for r in rt.db.written("instructor_alerts") if r["kind"] == "response"
               and r["ref"]["staff_id"] == SLOW_A)
    assert row["detail"] == "Yanıt süresi medyanı hedefin üstünde: 2,3 saat (hedef 2,0 saat)"
    rt.close()


def _fixture_copy(tmp_path):
    folder = tmp_path / "fixtures"
    shutil.copytree(KULAKLIK, folder)
    return folder


def test_quoted_judgement_word_is_masked_not_fatal(tmp_path):
    folder = _fixture_copy(tmp_path)
    path = folder / "messages-day.json"
    msgs = json.loads(path.read_text(encoding="utf-8"))
    for m in msgs:
        if m["id"] == 27:
            m["text_llm"] = "Neden hep başarısız oluyorum?"
    path.write_text(json.dumps(msgs, ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "out"
    assert run_cli("metrics", "--gate", "--dry-run", "--fixtures", str(folder), "--out", str(out)) == 0
    rows = read_jsonl(out / "instructor_alerts.jsonl")
    alert = next(r for r in rows if r["ref"].get("message_id") == 27)
    assert alert["detail"] == 'Cevapsız soru: "Neden hep … oluyorum?"'
    assert "başarısız" not in (out / "instructor_alerts.jsonl").read_text(encoding="utf-8").lower()
    assert len(read_jsonl(out / "pilot_metrics.jsonl")) == 8
    assert (out / "pilot_gate.md").is_file()


def test_unmaskable_candidate_is_rejected_and_run_continues(tmp_path, monkeypatch):
    rt = make_rt(tmp_path)
    monkeypatch.setattr(A, "mask_words", lambda text, *a, **k: text)  # maskeleme olmasa bile iş durmaz
    rt.db.role = "postgres"
    rt.db.update("messages", {"text_llm": "Ben tembel miyim?"}, where={"id": 27})
    rt.db.role = "batch_worker"
    rep = A.open_alerts(rt.db, rt.clock())
    assert rep.rejected and rep.rejected[0]["kind"] == "unanswered"
    assert rep.opened > 0
    assert not any("tembel" in r["detail"] for r in rt.db.written("instructor_alerts"))
    rt.close()


def test_mask_words_turkish_case_and_word_boundary():
    assert mask_words("BAŞARISIZIM ben") == "… ben"
    assert mask_words("Tembellik değil, yorgunluk") == "… değil, yorgunluk"
    assert mask_words("Kesirleri anlamadım") == "Kesirleri anlamadım"


def test_real_mode_uses_cron_open_alerts_rpc(tmp_path):
    rt = make_rt(tmp_path)
    calls = []

    def rpc(name, params=None):
        calls.append(name)
        if name == "cron_open_alerts":
            return 4
        raise AssertionError(name)

    rt.db.seed("instructor_alerts", {"id": "bbbbbbbb-0000-4000-8000-000000000001", "kind": "ops",
                                     "severity": "warning", "student_id": None, "staff_id": None,
                                     "detail": "Bot grupta yönetici değil; kayıt bildirimi sabitlenemedi",
                                     "since": "2026-10-14T17:00:00Z", "ref": {"chat_id": -1001000000001},
                                     "status": "open", "created_at": "2026-10-20T09:00:00Z"})
    rt.db.rpc = rpc
    rep = A.open_alerts(rt.db, rt.clock(), via_rpc=True)
    assert calls == ["cron_open_alerts"]
    assert rep.mode == "rpc" and rep.opened == 4
    assert rt.db.written("instructor_alerts") == []  # Python kuralları çalışmaz, satırı SQL yazar
    assert any(v["kind"] == "ops" for v in rep.rows)
    rt.close()
