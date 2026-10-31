"""Canlı Postgres sözleşme testi (``OGRENMEN_DATABASE_URL`` yoksa SKIP; ağ değil, yerel sunucu).

Geçici bir veritabanına (``ogrenmen_m08_<rastgele>_dev``) ``supabase/scripts/db-test.sh --dev`` ile stub + tüm
migration'lar + seed + ``seed/dev`` yüklenir; ``batch_worker`` rolüyle boru hattının yaptığı her çağrı GERÇEK SQL'e
karşı koşar: ``register_lesson``, ``resolve_lesson_labels``, ``lessons`` sütun güncellemeleri, ``profile_for_prompt``,
okumalar, ``write_lesson_analysis`` (boru hattının ürettiği analizle), ops alarmı, ``confirm_video_deleted``.
Her şey tek işlemde yapılır ve geri alınır; sonunda veritabanı silinir.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest
from ogrenmen_common.paths import repo_root

from conftest import AYSE, DERS, ELIF_REF, LESSON, WAV, make_rt, needs_ffmpeg
from ogrenmen_ders import pipeline as P

URL = os.environ.get("OGRENMEN_DATABASE_URL")
pytestmark = [pytest.mark.skipif(not URL or not shutil.which("psql"), reason="SKIP: no database"), needs_ffmpeg]
REPO = repo_root()


def _db_url(name: str) -> str:
    from urllib.parse import urlsplit, urlunsplit

    p = urlsplit(URL)
    return urlunsplit((p.scheme, p.netloc, "/" + name, p.query, p.fragment))


@pytest.fixture(scope="module")
def live_url():
    base = f"ogrenmen_m08_{uuid.uuid4().hex[:8]}"
    env = {**os.environ, "OGRENMEN_TEST_DB": base}
    proc = subprocess.run(["bash", str(REPO / "supabase" / "scripts" / "db-test.sh"), "--dev"], env=env,
                          capture_output=True, text=True, timeout=600)
    name = f"{base}_dev"
    try:
        assert proc.returncode == 0, proc.stdout[-2000:] + proc.stderr[-2000:]
        yield _db_url(name)
    finally:
        subprocess.run(["psql", "-X", "-q", "-d", URL, "-c", f'drop database if exists "{name}" with (force)'],
                       capture_output=True, text=True)


SQL = Path(__file__).with_name("live_lesson.sql")


def test_pipeline_calls_match_live_sql(tmp_path, live_url):
    rt = make_rt(tmp_path / "out")
    result = P.analyze(rt, lesson_id=LESSON, video=WAV, fixtures=DERS, out=tmp_path / "out")
    (row,) = rt.db.written("lesson_analyses")
    script = SQL
    proc = subprocess.run(
        ["psql", "-X", "-q", "-At", "-d", live_url, "-v", f"student_ref={ELIF_REF}", "-v", f"staff={AYSE}",
         "-v", f"held_at={P.parse_held_at('2026-10-20T18:00')}", "-v", f"fixture_lesson={LESSON}",
         "-v", f"seed={json.dumps(row['seed_profile'], ensure_ascii=False)}",
         "-v", f"analysis={json.dumps(row['analysis'], ensure_ascii=False)}", "-v", f"model={row['model']}",
         "-f", str(script)], capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr
    got = dict(line.split("=", 1) for line in proc.stdout.splitlines() if "=" in line)
    status, held = got["registered"].split("|")
    assert status == "uploaded" and held.startswith("2026-10-20 15:00:00")
    labels = json.loads(got["labels"])
    expected = json.loads((Path(DERS) / "labels.json").read_text(encoding="utf-8"))
    assert sorted((x["hash"], x["label"]) for x in labels) == sorted((x["hash"], x["label"]) for x in expected)
    assert got["profile_keys"] == "explanation_notes,misconceptions,prereq_hint,weak,weekly_line"
    assert all(int(n) > 0 for n in got["reads"].split(",")[:3])
    claims = json.loads(got["claims"])
    fake_claims = {}
    for c in rt.db.written("lesson_claims"):
        fake_claims[c["kind"]] = fake_claims.get(c["kind"], 0) + 1
    assert claims == fake_claims and claims["talk"] == 1          # JsonlDb eşleniği SQL ile aynı iddiaları yazar
    assert json.loads(got["talk"]) == {k: row["analysis"]["talk"][k]
                                       for k in ("student_ratio", "student_questions", "attention", "morale")}
    assert got["analysis"].startswith("draft|1|0.0123")
    assert got["obs_delta"] == "0" and got["lesson_status"] == "analyzed" and got["alerts"] == "1"
    state, day_usd, lesson_spent = got["spend"].split("|")
    assert state == "normal" and float(day_usd) == 0 and lesson_spent == "true"
    assert got["notices"] == "guardian,student"
    assert result.status == "analyzed"
