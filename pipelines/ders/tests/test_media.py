"""Ses ve kare çıkarımı (§6.3 adım 1–2): 16 kHz mono WAV, sahne kareleri 20–40, eşik kuralı, eşit aralık."""

from __future__ import annotations

import hashlib
import wave

import pytest

from conftest import WAV, needs_ffmpeg, run_cli
from ogrenmen_ders import media as M
from ogrenmen_ders.errors import DersError


@needs_ffmpeg
def test_frame_count_between_20_and_40(tmp_path, scene_video):
    sel = M.extract_frames(scene_video, tmp_path / "frames")
    assert sel.method == "scene>0.30"
    assert 20 <= len(sel.frames) <= 40
    assert all(f.path.suffix == ".jpg" and f.mime == "image/jpeg" and f.path.stat().st_size > 0 for f in sel.frames)
    times = [f.t_sec for f in sel.frames]
    assert times == sorted(times) and all(0 < t < 20 for t in times)
    assert all(f.score is not None and f.score > M.SCENE_THRESHOLD for f in sel.frames)
    digests = [hashlib.sha256(f.path.read_bytes()).hexdigest() for f in sel.frames]
    assert len(set(digests)) >= len(digests) // 2              # düz renk ↔ test deseni: kareler farklı sahneler
    again = M.extract_frames(scene_video, tmp_path / "again")
    assert [f.t_sec for f in again.frames] == times             # deterministik


@needs_ffmpeg
def test_frames_only_cli(tmp_path, scene_video):
    out = tmp_path / "out"
    assert run_cli("frames-only", "--video", str(scene_video), "--dry-run", "--out", str(out)) == 0
    jpgs = sorted((out / "frames").glob("*.jpg"))
    assert 20 <= len(jpgs) <= 40
    import json

    summary = json.loads((out / "frames.json").read_text(encoding="utf-8"))
    assert summary["count"] == len(jpgs) and summary["method"] == "scene>0.30"


@needs_ffmpeg
def test_frames_are_scaled_to_max_width(tmp_path):
    import subprocess

    big = tmp_path / "genis.mp4"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=5:d=3",
                    "-c:v", "libx264", "-preset", "veryfast", str(big)], check=True)
    sel = M.extract_frames(big, tmp_path / "f")
    assert sel.method == "uniform" and sel.frames               # sahne değişimi yok → eşit aralık
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width",
                          "-of", "csv=p=0", str(sel.frames[0].path)], capture_output=True, text=True, check=True)
    assert int(out.stdout.strip()) == M.MAX_WIDTH


@needs_ffmpeg
def test_extract_audio_16k_mono_pcm(tmp_path, scene_video):
    for src in (WAV, scene_video):
        dest = M.extract_audio(src, tmp_path / f"{src.stem}.wav")
        with wave.open(str(dest)) as w:
            assert (w.getnchannels(), w.getframerate(), w.getsampwidth()) == (1, 16000, 2)
            assert abs(w.getnframes() / w.getframerate() - 20) < 0.2


@needs_ffmpeg
def test_wav_has_no_frames_and_missing_file(tmp_path):
    sel = M.extract_frames(WAV, tmp_path / "f")
    assert sel.frames == [] and sel.method == "none" and abs(sel.duration_sec - 20) < 0.1
    with pytest.raises(DersError, match="OGR-DERS-001"):
        M.probe(tmp_path / "yok.mp4")


def _scores(values):
    return [(round(i * 0.5, 3), v) for i, v in enumerate(values)]


def test_threshold_rule_default_030():
    scores = _scores([0.35] * 25 + [0.1] * 50)
    chosen, method = M.choose_timestamps(scores, 600)
    assert method == "scene>0.30" and len(chosen) == 25


def test_threshold_rule_too_many_uses_045():
    scores = _scores([0.35] * 30 + [0.5] * 25 + [0.0] * 10)
    chosen, method = M.choose_timestamps(scores, 600)
    assert method == "scene>0.45" and len(chosen) == 25 and all(s > 0.45 for _, s in chosen)


def test_threshold_rule_still_too_many_keeps_top_40_in_order():
    scores = _scores([0.5 + i / 1000 for i in range(60)])
    chosen, method = M.choose_timestamps(scores, 600)
    assert method == "scene>0.45/top40" and len(chosen) == 40
    assert [t for t, _ in chosen] == sorted(t for t, _ in chosen)
    assert min(s for _, s in chosen) == pytest.approx(0.52)     # en yüksek 40 puan


def test_threshold_rule_045_too_few_falls_back_to_top_of_030():
    scores = _scores([0.35] * 45 + [0.5] * 5)
    chosen, method = M.choose_timestamps(scores, 600)
    assert method == "scene>0.30/top40" and len(chosen) == 40


def test_threshold_rule_too_few_uses_020_then_uniform():
    scores = _scores([0.35] * 5 + [0.25] * 20 + [0.0] * 10)
    chosen, method = M.choose_timestamps(scores, 600)
    assert method == "scene>0.20" and len(chosen) == 25
    chosen, method = M.choose_timestamps(_scores([0.35] * 5 + [0.0] * 10), 600)
    assert method == "uniform" and len(chosen) == M.UNIFORM_TARGET
    assert all(s is None for _, s in chosen)
    assert M.choose_timestamps([], 0) == ([], "none")


def test_uniform_times():
    times = M.uniform_times(5400)
    assert len(times) == 30 and times[0] == 90 and times[-1] == 5310
    assert M.uniform_times(8.5) == [0.53125 + i * 1.0625 for i in range(8)]   # saniyede en çok bir kare
    assert M.uniform_times(0) == []


def test_parse_scene_scores():
    text = ("frame:0    pts:0       pts_time:0\nlavfi.scene_score=0.000000\n"
            "frame:1    pts:1024    pts_time:0.0666667\nlavfi.scene_score=0.412000\n"
            "frame:2    pts:2048    pts_time:0.133333\n")
    assert M.parse_scene_scores(text) == [(0.0, 0.0), (0.0666667, 0.412), (0.133333, 0.0)]
    assert M.hms(3725.9) == "01:02:05"
