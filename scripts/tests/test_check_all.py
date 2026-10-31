"""check-all.sh: biten her modülün kabul komutları gerçekten adım olarak koşuyor mu.

M07 (`pipelines/kulaklik_batch`) bitmişti ama `check-all.sh` beş kabul komutunun hiçbirini çalıştırmıyordu
(M13 entegrasyon bulgusu). Bu testler üç yoldan yakalar: README "Nerede kaldık" tablosundaki bitmiş modüller
`--list`'te olmalı; modül README'sinin "Kurulum ve kabul" bloğundaki her komut, `/tmp` → `$W` ve depo kökü →
`$ROOT` dönüşümüyle o modülün adım gövdelerinde geçmeli; adım gövdelerinde sabit `/tmp/` yolu kalmamalı.
"""

from __future__ import annotations

import re
import subprocess

import pytest
from conftest import REPO, SCRIPTS

CHECK_ALL = SCRIPTS / "check-all.sh"
SCRIPT = CHECK_ALL.read_text(encoding="utf-8")

# Modül README'si → check-all'daki modül adı (kabul komutları README'de kod bloğu olarak yazılı olanlar).
MODULE_READMES = {
    "M06": "pipelines/tablet/README.md",
    "M07": "pipelines/kulaklik_batch/README.md",
    "M08": "pipelines/ders/README.md",
    "M09": "pipelines/kalem/README.md",
    "M10": "pipelines/kitap/README.md",
}


def run_check_all(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["bash", str(CHECK_ALL), *args], capture_output=True, text=True, check=False)


def listed_steps() -> list[tuple[str, str]]:
    out = run_check_all("--list")
    assert out.returncode == 0, out.stderr
    rows = []
    for line in out.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 3:
            rows.append((parts[0], parts[2]))  # (modül, fonksiyon)
    return rows


def function_body(name: str) -> str:
    m = re.search(rf"^{re.escape(name)}\(\) \{{\n(.*?)^\}}", SCRIPT, re.S | re.M)
    assert m, f"{name} fonksiyonu check-all.sh'ta yok"
    return m.group(1)


def normalize(text: str) -> str:
    """Satır devamlarını birleştirir, yorumları ve tırnakları atar, boşlukları sadeleştirir."""
    text = text.replace("\\\n", " ")
    text = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    text = text.replace('"', "").replace("'", "")
    return re.sub(r"\s+", " ", text).strip()


def readme_acceptance_commands(readme: str) -> list[str]:
    text = (REPO / readme).read_text(encoding="utf-8")
    m = re.search(r"^## Kurulum ve kabul\n.*?^```\n(.*?)^```", text, re.S | re.M)
    assert m, f"{readme}: 'Kurulum ve kabul' kod bloğu yok"
    return [line for line in m.group(1).splitlines() if line.strip()]


def to_check_all_form(command: str) -> str:
    # check-all komutları kök yolunu $ROOT'tan, /tmp çıktılarını çalışmaya özel $W'den alır.
    return normalize(command.replace("/home/user/alperen", "$ROOT").replace("/tmp/", "$W/"))


def test_only_m07_is_a_known_module():
    out = run_check_all("--only", "M07", "--list")
    assert out.returncode == 0, out.stderr


@pytest.mark.parametrize("alias", ["M06T", "M06R", "m06t"])
def test_old_tablet_slice_names_select_m06(alias):
    out = run_check_all("--only", alias, "--list")
    assert out.returncode == 0, out.stderr
    assert {line.split()[0] for line in out.stdout.splitlines() if line.strip()} == {"M06"}


def test_live_steps_for_tablet_and_ders():
    out = run_check_all("--list")
    rows = [line.split() for line in out.stdout.splitlines()]
    live = {(parts[0], parts[2]) for parts in rows if parts[1:2] == ["live"]}
    assert {("M06", "m06_live"), ("M08", "m08_live")} <= live, live
    for fn, pkg in (("m06_live", "tablet"), ("m08_live", "ders")):
        body = normalize(function_body(fn))
        assert f"live_only_passes python -m pytest $ROOT/pipelines/{pkg} -q -k live -rs" in body, body


def test_finished_modules_in_readme_are_all_run():
    text = (REPO / "README.md").read_text(encoding="utf-8")
    m = re.search(r"\*\*Bitmiş[^\n]*\n(.*?)\n\*\*Ertelenmiş", text, re.S)
    assert m, "README 'Nerede kaldık' bitmiş tablosu bulunamadı"
    finished = set(re.findall(r"^\| (M\d+[A-Z]*) ", m.group(1), re.M))
    finished = {"M13" if mod == "M13L" else mod for mod in finished}
    assert "M07" in finished
    listed = {mod for mod, _ in listed_steps()}
    assert finished <= listed, f"README'de bitmiş ama check-all'da adımı olmayan modüller: {sorted(finished - listed)}"


@pytest.mark.parametrize("module", sorted(MODULE_READMES))
def test_module_readme_acceptance_commands_are_steps(module):
    bodies = normalize("\n".join(function_body(fn) for mod, fn in listed_steps() if mod == module))
    assert bodies, f"{module} için check-all adımı yok"
    missing = []
    for command in readme_acceptance_commands(MODULE_READMES[module]):
        for segment in to_check_all_form(command).split(" && "):
            segment = re.sub(r"^(\w+=\S+ )+", "", segment)  # ortam önekleri (OGRENMEN_DATABASE_URL=…) adımda ayrı
            if segment.startswith("python -m pip install "):
                # Kurulum adımı ortak tabanı da kurabilir; README'deki her paket yolu kurulmalı.
                paths = [tok for tok in segment.split()[4:] if tok != "-e"]
                missing += [f"pip install -e {p}" for p in paths if f"-e {p}" not in bodies]
            elif segment not in bodies:
                missing.append(segment)
    assert not missing, f"{module} README kabul komutları check-all'da koşmuyor: {missing}"


def test_m07_steps_keep_blueprint_assertions():
    steps = {fn for mod, fn in listed_steps() if mod == "M07"}
    assert len(steps) == 5, steps
    body = "\n".join(function_body(fn) for fn in sorted(steps))
    for needle in (
        "len(r['source_message_ids'])>=1",
        'grep -niE "depresif|tembel" "$W/kk-out/instructor_alerts.jsonl"',
        'test -f "$W/kk-out/instructor_alerts.jsonl"',
        'grep -E "Kapı: (AÇIK|KAPALI)" "$W/kk-gate/pilot_gate.md"',
        'test -f "$W/kk-out/cost-report.md"',
    ):
        assert needle in body, needle


def test_step_bodies_use_per_run_dir_not_fixed_tmp():
    m = re.search(r"^# -+ adımlar$(.*?)^STEPS=\(", SCRIPT, re.S | re.M)
    assert m, "check-all.sh adım bölgesi bulunamadı"
    hits = [line.strip() for line in m.group(1).splitlines() if "/tmp/" in line and not line.lstrip().startswith("#")]
    assert not hits, f"adım gövdesinde sabit /tmp yolu: {hits}"
