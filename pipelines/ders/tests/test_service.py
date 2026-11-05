"""Ders medya servisi (service.py): kare eşiği kuralı, /prepare (WAV + ≤ 30 kare), /stt (sahte, Groq, 25 MB
parçalama), Storage kipi, yol ve yetki denetimleri, tek dosya olarak ``python3 -I`` ile açılış."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

import pytest

from conftest import DERS, LESSON, WAV, needs_ffmpeg, place
from ogrenmen_ders import cli
from ogrenmen_ders import service as S


def post(url: str, path: str, body: dict, token: str | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(url + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def get(url: str, path: str) -> dict:
    with urllib.request.urlopen(url + path, timeout=10) as res:
        return json.loads(res.read())


# --- saf kurallar -----------------------------------------------------------------------------------------------------


def _scores(values):
    return [(round(i * 0.5, 3), v) for i, v in enumerate(values)]


def test_threshold_rule_default_030():
    chosen, method = S.choose_timestamps(_scores([0.35] * 25 + [0.1] * 50), 600)
    assert method == "scene>0.30" and len(chosen) == 25


def test_threshold_rule_too_many_uses_045_then_top30():
    chosen, method = S.choose_timestamps(_scores([0.35] * 30 + [0.5] * 25 + [0.0] * 10), 600)
    assert method == "scene>0.45" and len(chosen) == 25 and all(s > 0.45 for _, s in chosen)
    chosen, method = S.choose_timestamps(_scores([0.5 + i / 1000 for i in range(60)]), 600)
    assert method == "scene>0.45/top" and len(chosen) == S.MAX_FRAMES == 30
    assert [t for t, _ in chosen] == sorted(t for t, _ in chosen)
    assert min(s for _, s in chosen) == pytest.approx(0.53)


def test_threshold_rule_too_few_uses_020_then_uniform():
    chosen, method = S.choose_timestamps(_scores([0.35] * 5 + [0.25] * 20 + [0.0] * 10), 600)
    assert method == "scene>0.20" and len(chosen) == 25
    chosen, method = S.choose_timestamps(_scores([0.35] * 5 + [0.0] * 10), 600)
    assert method == "uniform" and len(chosen) == 30 and all(s is None for _, s in chosen)
    assert S.choose_timestamps([], 0) == ([], "none")


def test_uniform_times_and_hms():
    times = S.uniform_times(5400)
    assert len(times) == 30 and times[0] == 90 and times[-1] == 5310
    assert len(S.uniform_times(8.5)) == 8                     # saniyede en çok bir kare
    assert S.uniform_times(0) == []
    assert S.hms(3725.9) == "01:02:05"


def test_parse_scene_scores():
    text = ("frame:0    pts:0       pts_time:0\nlavfi.scene_score=0.000000\n"
            "frame:1    pts:1024    pts_time:0.0666667\nlavfi.scene_score=0.412000\n"
            "frame:2    pts:2048    pts_time:0.133333\n")
    assert S.parse_scene_scores(text) == [(0.0, 0.0), (0.0666667, 0.412), (0.133333, 0.0)]


def test_stt_mode_and_chunk_limits(monkeypatch):
    assert S.stt_mode() == "none"
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
    assert S.stt_mode() == "groq"
    monkeypatch.setenv("OGRENMEN_STT", "fake")
    assert S.stt_mode() == "fake"                               # açık sahte anahtarı ezer
    monkeypatch.setenv("OGRENMEN_STT", "elevenlabs")
    assert S.stt_mode() == "none"                               # bilinmeyen sağlayıcıya sessizce düşülmez
    assert S.chunk_seconds() == 600
    monkeypatch.setenv("OGRENMEN_STT_CHUNK_SEC", "5000")
    assert S.chunk_seconds() * 32000 < 25 * 1024 * 1024         # her parça 25 MB'nin altında


# --- /prepare ---------------------------------------------------------------------------------------------------------


@needs_ffmpeg
def test_prepare_silent_video_wav_and_uniform_frames(service, silent_video):
    rel = place(silent_video)
    code, res = post(service, "/prepare", {"lesson_id": LESSON, "local_path": rel})
    assert code == 200, res
    assert res["has_video"] and res["stored"] is False and abs(res["duration_sec"] - 10) < 0.2
    assert res["method"] == "uniform" and 1 <= len(res["frames"]) <= 30
    wav = S.work_root() / res["audio"]["path"]
    with wave.open(str(wav)) as w:
        assert (w.getnchannels(), w.getframerate(), w.getsampwidth()) == (1, 16000, 2)
        assert abs(w.getnframes() / w.getframerate() - 10) < 0.2
    for fr in res["frames"]:
        p = S.work_root() / fr["path"]
        assert p.is_file() and p.read_bytes()[:2] == b"\xff\xd8" and fr["mime"] == "image/jpeg"
        assert fr["path"].startswith(f"{LESSON}/frames/") and fr["t"] == S.hms(fr["t_sec"])
    assert [f["t_sec"] for f in res["frames"]] == sorted(f["t_sec"] for f in res["frames"])


@needs_ffmpeg
def test_prepare_scene_video_frames_capped_and_scaled(service, scene_video, tmp_path):
    rel = place(scene_video)
    code, res = post(service, "/prepare", {"lesson_id": LESSON, "local_path": rel, "max_frames": 99})
    assert code == 200, res
    assert res["method"].startswith("scene>") and 20 <= len(res["frames"]) <= 30
    again = post(service, "/prepare", {"lesson_id": LESSON, "local_path": rel})[1]
    assert [f["t_sec"] for f in again["frames"]] == [f["t_sec"] for f in res["frames"]]   # deterministik
    big = tmp_path / "genis.mp4"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=5:d=3",
                    "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "3", "-c:v", "libx264", "-preset",
                    "veryfast", "-c:a", "aac", str(big)], check=True)
    res = S.handle_prepare({"lesson_id": LESSON, "local_path": place(big, name="genis.mp4")})
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width",
                          "-of", "csv=p=0", str(S.work_root() / res["frames"][0]["path"])],
                         capture_output=True, text=True, check=True)
    assert int(out.stdout.strip()) == S.MAX_WIDTH
    # dikey 4K telefon kaydı: iki kenar da ≤ 1280 (Claude API çok görselli istekte kenar ≤ 2000 px)
    tall = tmp_path / "dikey.mp4"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=2160x3840:r=2:d=2",
                    "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "2", "-c:v", "libx264", "-preset",
                    "ultrafast", "-c:a", "aac", str(tall)], check=True)
    res = S.handle_prepare({"lesson_id": LESSON, "local_path": place(tall, name="dikey.mp4"), "max_frames": 1})
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", str(S.work_root() / res["frames"][0]["path"])],
                         capture_output=True, text=True, check=True)
    w, h = (int(x) for x in out.stdout.strip().split(","))
    assert h == S.MAX_WIDTH and w <= S.MAX_WIDTH and abs(w / h - 2160 / 3840) < 0.01


@needs_ffmpeg
def test_prepare_audio_only_has_no_frames():
    res = S.handle_prepare({"lesson_id": LESSON, "local_path": place(WAV)})
    assert res["frames"] == [] and res["method"] == "none" and res["has_video"] is False
    assert abs(res["duration_sec"] - 20) < 0.2


def test_prepare_rejects_bad_paths_and_ids(service, tmp_path):
    outside = tmp_path / "disari.mp4"
    outside.write_bytes(b"x")
    for body, status, code in (
        ({"lesson_id": "yok", "local_path": "a/b.mp4"}, 400, "OGR-DERS-007"),
        ({"lesson_id": LESSON, "local_path": "../disari.mp4"}, 400, "OGR-DERS-007"),
        ({"lesson_id": LESSON, "local_path": str(outside)}, 400, "OGR-DERS-007"),
        ({"lesson_id": LESSON, "local_path": f"{LESSON}/yok.mp4"}, 404, "OGR-DERS-001"),
        ({"lesson_id": LESSON}, 400, "OGR-DERS-001"),
        ({"lesson_id": LESSON, "storage_path": "egitmen/ders.mp4"}, 400, "OGR-DERS-001"),   # Storage erişimi yok
    ):
        got = post(service, "/prepare", body)
        assert got == (status, got[1]) and got[1]["error"] == code, (body, got)
    assert post(service, "/nope", {"a": 1})[0] == 404


@needs_ffmpeg
def test_prepare_storage_mode_downloads_and_uploads(service, storage, silent_video, monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", storage["url"])
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    storage["objects"]["lessons/egitmen-1/ders 1.mp4"] = {"body": silent_video.read_bytes()}
    code, res = post(service, "/prepare", {"lesson_id": LESSON, "storage_path": "egitmen-1/ders 1.mp4",
                                           "dest_prefix": f"egitmen-1/{LESSON}"})
    assert code == 200, res
    assert res["stored"] is True and res["audio"]["storage_path"] == f"egitmen-1/{LESSON}/audio.wav"
    assert storage["objects"][f"lessons/egitmen-1/{LESSON}/audio.wav"]["body"][:4] == b"RIFF"
    assert all(f"lessons/{f['storage_path']}" in storage["objects"] for f in res["frames"])
    assert set(storage["auth"]) == {"Bearer service-key"}
    assert get(service, "/healthz")["storage"] is True
    code, res = post(service, "/prepare", {"lesson_id": LESSON, "storage_path": "egitmen-1/yok.mp4"})
    assert (code, res["error"]) == (424, "OGR-DERS-009")


def test_bucket_is_fixed_to_lessons(service):
    for path, body in (("/prepare", {"lesson_id": LESSON, "storage_path": "egitmen/ders.mp4", "bucket": "figures"}),
                       ("/stt", {"lesson_id": LESSON, "storage_path": "egitmen/ses.wav", "bucket": "uploads"})):
        code, res = post(service, path, body)
        assert (code, res["error"]) == (400, "OGR-DERS-007"), (path, res)
        assert "lessons" in res["message"]


def test_non_loopback_host_requires_token(monkeypatch, capsys):
    monkeypatch.delenv("OGRENMEN_DERS_TOKEN", raising=False)
    monkeypatch.delenv("LESSON_SERVICE_TOKEN", raising=False)
    assert S.main(["--host", "::", "--port", "0"]) == S.EX_CONFIG
    assert S.main(["--host", "0.0.0.0", "--port", "0"]) == S.EX_CONFIG
    assert "LESSON_SERVICE_TOKEN" in capsys.readouterr().err
    assert S.is_loopback("127.0.0.1") and S.is_loopback("::1") and not S.is_loopback("::")


def test_token_required_when_configured(service, monkeypatch):
    monkeypatch.setenv("OGRENMEN_DERS_TOKEN", "gizli")
    assert post(service, "/cleanup", {"lesson_id": LESSON})[0] == 401
    assert post(service, "/cleanup", {"lesson_id": LESSON}, token="gizli")[0] == 200
    assert get(service, "/healthz")["ok"] is True               # sağlık açık (Fly denetimi)


# --- /stt -------------------------------------------------------------------------------------------------------------


def test_stt_not_configured_is_explicit(service):
    code, res = post(service, "/stt", {"lesson_id": LESSON})
    assert (code, res["error"]) == (503, "OGR-DERS-008")


def test_stt_fake_is_deterministic_unlabeled_fixture(service, monkeypatch):
    monkeypatch.setenv("OGRENMEN_STT", "fake")
    code, res = post(service, "/stt", {"lesson_id": LESSON})
    assert code == 200, res
    fx = json.loads((DERS / "lesson-01.transcript.json").read_text(encoding="utf-8"))["segments"]
    assert res["provider"] == "fake" and res["language"] == "tr" and len(res["segments"]) == len(fx)
    assert [s["text"] for s in res["segments"]] == [s["text"] for s in fx]
    assert res["segments"][3] == {"t0": 6.0, "t1": 8.0, "text": fx[3]["text"]}
    assert all(set(s) == {"t0", "t1", "text"} for s in res["segments"])      # konuşmacı yok (Whisper gibi)
    assert post(service, "/stt", {"lesson_id": LESSON})[1] == res
    assert post(service, "/stt", {"lesson_id": LESSON, "fixture": "../x.json"})[0] == 400


@needs_ffmpeg
def test_stt_groq_single_request(service, groq, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
    monkeypatch.setenv("GROQ_BASE_URL", groq["url"])
    groq["fail"] = [429]
    rel = place(WAV, name="audio.wav")
    code, res = post(service, "/stt", {"lesson_id": LESSON, "wav_path": rel})
    assert code == 200, res
    assert res["provider"] == "groq" and res["chunks"] == 1
    assert res["segments"] == [{"t0": 0.0, "t1": 1.5, "text": "parça 2 bir"},
                               {"t0": 1.5, "t1": 3.9, "text": "parça 2 iki"}]
    assert len(groq["requests"]) == 2                            # 429 → bir yeniden deneme
    r = groq["requests"][-1]
    assert r["auth"] == "Bearer gsk_test" and r["ctype"].startswith("multipart/form-data")
    for field in (b'name="model"\r\n\r\nwhisper-large-v3-turbo', b'name="response_format"\r\n\r\nverbose_json',
                  b'name="language"\r\n\r\ntr', b'filename="ders.wav"'):
        assert field in r["body"]
    assert b"lesson-01" not in r["body"]                         # dosya adı sağlayıcıya nötr gider


@needs_ffmpeg
def test_stt_groq_chunks_large_audio_and_offsets(service, groq, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
    monkeypatch.setenv("GROQ_BASE_URL", groq["url"])
    monkeypatch.setenv("OGRENMEN_STT_CHUNK_SEC", "8")
    monkeypatch.setattr(S, "GROQ_MAX_BYTES", 1024 * 1024 + 270_000)   # 20 sn WAV (280 KB) "büyük" sayılsın
    rel = place(WAV, name="audio.wav")
    res = S.handle_stt({"lesson_id": LESSON, "wav_path": rel})
    assert res["chunks"] == 3 and len(groq["requests"]) == 3
    # sahte yanıt her parçada duration=4: kaydırma yanıtın süresiyle (8 sn'lik gerçek parça yerine) yapılır
    assert [s["t0"] for s in res["segments"]] == [0.0, 1.5, 4.0, 5.5, 8.0, 9.5]
    assert [s["text"] for s in res["segments"]][::2] == ["parça 1 bir", "parça 2 bir", "parça 3 bir"]


def test_stt_groq_permanent_error(service, groq, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
    monkeypatch.setenv("GROQ_BASE_URL", groq["url"])
    groq["fail"] = [401]
    rel = place(WAV, name="audio.wav")
    code, res = post(service, "/stt", {"lesson_id": LESSON, "wav_path": rel})
    assert (code, res["error"]) == (502, "OGR-DERS-008") and len(groq["requests"]) == 1
    code, res = post(service, "/stt", {"lesson_id": LESSON, "wav_path": f"{LESSON}/yok.wav"})
    assert (code, res["error"]) == (404, "OGR-DERS-001")


def test_cleanup_and_sweep(service):
    place(WAV, name="audio.wav")
    assert post(service, "/cleanup", {"lesson_id": LESSON}) == (200, {"lesson_id": LESSON, "removed": True})
    assert not (S.work_root() / LESSON).exists()
    old = S.work_root() / "00000000-0000-4000-8000-0000000000aa"
    old.mkdir()
    os.utime(old, (time.time() - 2 * S.STALE_DIR_S, time.time() - 2 * S.STALE_DIR_S))
    keep = S.work_root() / "baska-dizin"
    keep.mkdir()
    assert S.sweep_stale() == 1 and not old.exists() and keep.exists()


# --- komut satırı ve yalıtılmış açılış --------------------------------------------------------------------------------


@needs_ffmpeg
def test_cli_frames_only_and_stt(tmp_path, silent_video, monkeypatch, capsys):
    out = tmp_path / "out"
    assert cli.main(["frames-only", "--video", str(silent_video), "--out", str(out)]) == 0
    summary = json.loads((out / "prepare.json").read_text(encoding="utf-8"))
    assert len(list((out / "frames").glob("*.jpg"))) == len(summary["frames"]) > 0
    assert (out / "audio.wav").is_file()
    assert list(S.work_root().iterdir()) == []                   # çalışma dizini temizlendi
    monkeypatch.setenv("OGRENMEN_STT", "fake")
    assert cli.main(["stt", "--wav", str(WAV)]) == 0
    assert json.loads(capsys.readouterr().out)["provider"] == "fake"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_runs_isolated_as_single_file(tmp_path):
    """Docker/Fly komutu: ``python3 -I service.py`` (PYTHONPATH yok, paket kurulu olmak zorunda değil)."""
    port = _free_port()
    env = {"PATH": os.environ.get("PATH", ""), "OGRENMEN_DERS_WORK_DIR": str(tmp_path / "w"), "OGRENMEN_STT": "fake",
           "OGRENMEN_STT_FIXTURES": str(DERS)}
    proc = subprocess.Popen([sys.executable, "-I", str(Path(S.__file__)), "--port", str(port)], env=env,
                            stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.time() + 15
        while True:
            try:
                h = get(f"http://127.0.0.1:{port}", "/healthz")
                break
            except OSError:
                if time.time() > deadline or proc.poll() is not None:
                    raise
                time.sleep(0.1)
        assert h["ok"] and h["stt"] == "fake"
        code, res = post(f"http://127.0.0.1:{port}", "/stt", {"lesson_id": LESSON})
        assert code == 200 and res["segments"]
    finally:
        proc.terminate()
        proc.wait(timeout=10)
