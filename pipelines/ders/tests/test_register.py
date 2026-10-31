"""``register`` (§6.3): ``register_lesson`` RPC, uuid stdout'a, ``lessons`` tek satır, video yüklenmez."""

from __future__ import annotations

import json
import uuid

import pytest

from conftest import AYSE, DERS, ELIF_REF, WAV, make_rt, read_jsonl, run_cli
from ogrenmen_ders import pipeline as P
from ogrenmen_ders.errors import DersError


def _register(tmp_path, *extra: str) -> list[str]:
    return ["register", "--student-ref", ELIF_REF, "--staff-id", AYSE, "--held-at", "2026-10-20T18:00",
            "--duration", "90", "--video", str(WAV), "--video-dir", str(DERS), "--dry-run", "--fixtures", str(DERS),
            "--out", str(tmp_path / "out"), *extra]


def test_register_prints_uuid_and_rpc(tmp_path, capsys):
    assert run_cli(*_register(tmp_path)) == 0
    stdout = capsys.readouterr().out
    lines = stdout.strip().splitlines()
    assert len(lines) == 1, stdout                       # make ders: $(register …) → analyze --lesson
    lesson_id = str(uuid.UUID(lines[0]))
    out = tmp_path / "out"
    rows = read_jsonl(out / "lessons.jsonl")
    assert len(rows) == 1 and rows[0]["id"] == lesson_id
    row = rows[0]
    assert row["status"] == "uploaded" and row["enrollment_id"] == "8bef16e2-1fb1-56d1-9530-3cd5b1ea7cf3"
    assert row["staff_id"] == AYSE and row["duration_min"] == 90
    assert row["held_at"] == "2026-10-20T15:00:00Z"      # saat dilimsiz giriş Europe/Istanbul (UTC+3)
    assert row["video_ref"] == "local:lesson-01.wav" and row["transcript_path"] is None   # mutlak yol yazılmaz
    calls = read_jsonl(out / "rpc_calls.jsonl")
    assert [c["rpc"] for c in calls] == ["register_lesson", "resolve_lesson_labels"] and calls[0]["ok"] is True
    assert str(DERS) not in json.dumps(calls, ensure_ascii=False)
    assert calls[0]["params"]["p_student_ref"] == ELIF_REF
    assert not (out / "storage").exists() or not any((out / "storage").rglob("*"))   # dosya yüklenmez
    assert not (out / "llm_calls.jsonl").exists()        # kayıt LLM çağırmaz


def test_register_video_ref_relative_to_video_dir(tmp_path, capsys):
    video_dir = tmp_path / "videolar"
    (video_dir / "ekim").mkdir(parents=True)
    video = video_dir / "ekim" / "ders-02.mp4"
    video.write_bytes(b"video")
    args = _register(tmp_path)
    args[args.index("--video") + 1] = str(video)
    args[args.index("--video-dir") + 1] = str(video_dir)
    assert run_cli(*args) == 0
    assert read_jsonl(tmp_path / "out" / "lessons.jsonl")[0]["video_ref"] == "local:ekim/ders-02.mp4"
    assert P.resolve_video_ref("local:ekim/ders-02.mp4", video_dir) == video
    assert P.video_ref_for("drive:1AbC", None) == "drive:1AbC"


def test_register_local_video_needs_video_dir_and_stays_inside(tmp_path, capsys, monkeypatch):
    rt = make_rt(tmp_path / "out")
    with pytest.raises(DersError, match="OGR-DERS-007 yerel video için --video-dir"):
        P.register(rt, student_ref=ELIF_REF, staff_id=AYSE, held_at="2026-10-20T18:00", duration=90, video=str(WAV))
    other = tmp_path / "baska"
    other.mkdir()
    with pytest.raises(DersError, match="OGR-DERS-007 video --video-dir dışında"):
        P.register(rt, student_ref=ELIF_REF, staff_id=AYSE, held_at="2026-10-20T18:00", duration=90, video=str(WAV),
                   video_dir=other)
    assert not rt.db.written("lessons")
    # $OGRENMEN_VIDEO_DIR ortak varsayılandır.
    monkeypatch.setenv("OGRENMEN_VIDEO_DIR", str(DERS))
    args = _register(tmp_path)
    i = args.index("--video-dir")
    del args[i:i + 2]
    assert run_cli(*args) == 0
    assert read_jsonl(tmp_path / "out" / "lessons.jsonl")[0]["video_ref"] == "local:lesson-01.wav"


def test_register_warns_when_path_contains_name(tmp_path, capsys):
    video_dir = tmp_path / "videolar"
    (video_dir / "Elif_Kaya").mkdir(parents=True)
    video = video_dir / "Elif_Kaya" / "ders.mp4"
    video.write_bytes(b"video")
    args = _register(tmp_path)
    args[args.index("--video") + 1] = str(video)
    args[args.index("--video-dir") + 1] = str(video_dir)
    assert run_cli(*args) == 0
    err = capsys.readouterr()
    assert "ad tokenı içeriyor" in err.err and "Elif" not in err.err
    assert len(err.out.strip().splitlines()) == 1                       # stdout yine yalnız uuid
    assert P.ref_name_leaks("local:2026-10-20-ders-01.mp4", [r["hash"] for r in json.loads(
        (DERS / "labels.json").read_text(encoding="utf-8"))]) == []


def test_register_explicit_offset_kept():
    assert P.parse_held_at("2026-10-20T18:00:00Z") == "2026-10-20T18:00:00Z"
    assert P.parse_held_at("2026-10-20T18:00+03:00") == "2026-10-20T15:00:00Z"
    with pytest.raises(DersError, match="OGR-DERS-007"):
        P.parse_held_at("dün akşam")


def test_register_rejects_uuid_student_ref(tmp_path, capsys):
    args = _register(tmp_path)
    args[args.index("--student-ref") + 1] = "c661b28c-81a8-5c11-9a5e-b919b5231034"
    with pytest.raises(SystemExit) as exc:
        run_cli(*args)
    assert exc.value.code == 2 and "public_ref" in capsys.readouterr().err


def test_register_unknown_staff_is_rpc_error(tmp_path, capsys):
    args = _register(tmp_path)
    args[args.index("--staff-id") + 1] = "00000000-0000-0000-0000-000000000000"
    assert run_cli(*args) == 1
    err = capsys.readouterr()
    assert "OGR-LESSON-002" in err.err and err.out == ""


def test_register_requires_existing_video_and_student_ref(tmp_path, capsys):
    args = _register(tmp_path)
    args[args.index("--video") + 1] = str(tmp_path / "yok.mp4")
    assert run_cli(*args) == 1
    assert "OGR-DERS-001" in capsys.readouterr().err
    rt = make_rt(tmp_path / "o2")
    with pytest.raises(DersError, match="OGR-DERS-007"):
        P.register(rt, student_ref=ELIF_REF, staff_id="ayse", held_at="2026-10-20T18:00", duration=90,
                   video=str(WAV))
    with pytest.raises(DersError, match="OGR-DERS-007"):
        P.register(rt, student_ref=ELIF_REF, staff_id=AYSE, held_at="2026-10-20T18:00", duration=0, video=str(WAV))
    no_ref = [a for a in _register(tmp_path) if a not in ("--student-ref", ELIF_REF)]
    assert run_cli(*no_ref) == 1
    assert "--student-ref" in capsys.readouterr().err
