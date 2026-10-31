"""``purge`` (§6.3, §3.10 ``lessons.video``): yalnız video dizinindeki süresi dolan videolar; confirm_video_deleted."""

from __future__ import annotations

import json
from datetime import timedelta

import pytest

from conftest import AYSE, DERS, LESSON, make_rt, read_jsonl, run_cli
from ogrenmen_ders import pipeline as P
from ogrenmen_ders.errors import DersError

FIXTURE_VIDEO = "2026-10-19-ders-01.mp4"   # fixtures/ders/lessons.json video_ref = local:<bu ad>


def _video_dir(tmp_path):
    d = tmp_path / "videolar"
    d.mkdir()
    (d / FIXTURE_VIDEO).write_bytes(b"ham video")
    return d


def test_purge_dry_run_keeps_files_and_queues_notices(tmp_path):
    vd = _video_dir(tmp_path)
    out = tmp_path / "out"
    assert run_cli("purge", "--older-than", "0d", "--video-dir", str(vd), "--dry-run", "--fixtures", str(DERS),
                   "--out", str(out)) == 0
    assert (vd / FIXTURE_VIDEO).exists()                       # dry-run dosyaya dokunmaz
    report = json.loads((out / "purge_report.json").read_text(encoding="utf-8"))
    assert report["dry_run"] is True
    assert [(i["lesson_id"], i["action"], i["confirmed"]) for i in report["items"]] == [(LESSON, "would_delete", True)]
    notices = read_jsonl(out / "proactive_messages.jsonl")
    assert sorted(n["recipient"] for n in notices) == ["guardian", "student"]
    assert all(n["template_id"] == "video_deleted" and n["params"] == {"lesson_id": LESSON} for n in notices)
    (lesson,) = read_jsonl(out / "lessons.jsonl")
    assert lesson["video_deleted_at"] == "2026-10-20T09:00:00Z"


def test_purge_respects_older_than(tmp_path):
    vd = _video_dir(tmp_path)
    out = tmp_path / "out"
    assert run_cli("purge", "--older-than", "30d", "--video-dir", str(vd), "--dry-run", "--fixtures", str(DERS),
                   "--out", str(out)) == 0
    assert json.loads((out / "purge_report.json").read_text(encoding="utf-8"))["items"] == []
    assert not (out / "proactive_messages.jsonl").exists()


def test_purge_deletes_only_inside_video_dir(tmp_path):
    vd = _video_dir(tmp_path)
    outside = tmp_path / "baska" / "kayit.mp4"
    outside.parent.mkdir()
    outside.write_bytes(b"dokunma")
    rt = make_rt(tmp_path / "out")
    old = "2026-09-01T10:00:00Z"
    rows = [("44444444-4444-4444-4444-444444444444", f"local:{outside}"),
            ("55555555-5555-5555-5555-555555555555", "drive:1AbCdEf"),
            ("66666666-6666-6666-6666-666666666666", "local:../baska/kayit.mp4")]
    for lid, ref in rows:
        rt.db.seed("lessons", {"id": lid, "enrollment_id": "8bef16e2-1fb1-56d1-9530-3cd5b1ea7cf3", "staff_id": AYSE,
                               "held_at": old, "duration_min": 60, "video_ref": ref, "video_deleted_at": None,
                               "status": "approved", "created_at": old})
    items = P.purge(rt, older_than=timedelta(days=30), video_dir=vd, delete_files=True)
    by_id = {i.lesson_id: i for i in items}
    assert by_id[rows[0][0]].action == "skipped_outside_video_dir" and not by_id[rows[0][0]].confirmed
    assert by_id[rows[1][0]].action == "skipped_drive" and not by_id[rows[1][0]].confirmed
    assert by_id[rows[2][0]].action == "skipped_outside_video_dir"   # ../ ile dizinden kaçış yok
    assert outside.exists() and LESSON not in by_id                # fixture dersi 1 günlük: süresi dolmadı
    items = P.purge(rt, older_than=timedelta(hours=1), video_dir=vd, delete_files=True)
    mine = [i for i in items if i.lesson_id == LESSON]
    assert mine[0].action == "deleted" and mine[0].confirmed and not (vd / FIXTURE_VIDEO).exists()
    assert rt.db.get("lessons", id=LESSON)["video_deleted_at"] is not None
    # Bir sonraki çalışma aynı dersi yeniden işlemez (video_deleted_at dolu).
    again = P.purge(rt, older_than=timedelta(hours=1), video_dir=vd, delete_files=True)
    assert LESSON not in {i.lesson_id for i in again}


def test_purge_missing_file_not_confirmed_without_flag(tmp_path):
    """Boş ya da yanlış dizin: dosya yok → onay yok, bildirim yok (aileye yanlış 'silindi' gitmez)."""
    empty = tmp_path / "bos"
    empty.mkdir()
    out = tmp_path / "out"
    assert run_cli("purge", "--older-than", "0d", "--video-dir", str(empty), "--dry-run", "--fixtures", str(DERS),
                   "--out", str(out)) == 0
    report = json.loads((out / "purge_report.json").read_text(encoding="utf-8"))
    assert [(i["action"], i["confirmed"]) for i in report["items"]] == [("missing", False)]
    assert not (out / "proactive_messages.jsonl").exists()
    assert not (out / "rpc_calls.jsonl").exists() or all(
        c["rpc"] != "confirm_video_deleted" for c in read_jsonl(out / "rpc_calls.jsonl"))
    # Kurucu dosyayı elle sildiyse açık bayrakla onaylanır.
    rt = make_rt(tmp_path / "out2")
    items = P.purge(rt, older_than=timedelta(0), video_dir=empty, delete_files=True, confirm_missing=True)
    assert [(i.action, i.confirmed) for i in items] == [("missing", True)]
    assert rt.db.get("lessons", id=LESSON)["video_deleted_at"] is not None
    assert sorted(m["recipient"] for m in rt.db.written("proactive_messages")) == ["guardian", "student"]


def test_purge_refuses_without_usable_video_dir(tmp_path):
    rt = make_rt(tmp_path / "out")
    with pytest.raises(DersError, match="OGR-DERS-007"):
        P.purge(rt, older_than=timedelta(0), video_dir=None, delete_files=True)
    with pytest.raises(DersError, match="OGR-DERS-001"):
        P.purge(rt, older_than=timedelta(0), video_dir=tmp_path / "bagli-degil", delete_files=True)
    afile = tmp_path / "dosya"
    afile.write_bytes(b"x")
    with pytest.raises(DersError, match="OGR-DERS-001"):
        P.purge(rt, older_than=timedelta(0), video_dir=afile, delete_files=True)
    assert not rt.db.written("proactive_messages") and rt.db.get("lessons", id=LESSON)["video_deleted_at"] is None


def test_parse_older_than():
    assert P.parse_older_than("30d") == timedelta(days=30)
    assert P.parse_older_than("12h") == timedelta(hours=12)
    with pytest.raises(DersError, match="OGR-DERS-007"):
        P.parse_older_than("bir ay")
