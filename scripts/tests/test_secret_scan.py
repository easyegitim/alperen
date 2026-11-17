"""secret-scan.sh: geçici git depolarında gerçek görünümlü anahtarlar bulunur; ad geçişleri ve yok sayılanlar değil.

Sahte değerler çalışma anında parçalardan kurulur; bu dosyanın kendisi taramada bulgu üretmez.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from conftest import SCRIPTS, write

SCAN = SCRIPTS / "secret-scan.sh"


def git_repo(root: Path) -> Path:
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    return root


def scan(root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["bash", str(SCAN), "--root", str(root)], capture_output=True, text=True, check=False)


SAMPLES = {
    "google-api-key": "AIza" + "Sy" + "B" * 33,
    "groq-key": "gsk_" + "a1B2c3D4" * 4,
    "openrouter-key": "sk-or-v1-" + "0f" * 32,
    "jwt": "eyJhbGciOiJIUzI1NiJ9" + "." + "eyJyb2xlIjoiYm90In0" + "." + "c2lnbmF0dXJlLWRlZ2VyaQ",
    "supabase-secret-key": "sb_secret_" + "Zx9" * 6,
    "telegram-bot-token": "1234567890" + ":AA" + "h" * 33,
    "private-key": "-----BEGIN " + "RSA PRIVATE KEY-----",
    "resend-key": "re_" + "Ab12Cd34" + "_" + "Xy9Z" * 6,
    "voyage-key": "pa-" + "Qw3rTy9" * 6,
    "fly-token": "FlyV1 fm2_" + "lJPECAAAAAAAB" * 3,
    "vapid-private-key": "VAPID_PRIVATE_KEY=" + "dGhpc2lzYXZhcGlkcHJpdmF0ZWtleTEyMzQ1Njc4OTA",
}

# Yanlış pozitif olmaması gereken v2 benzeri metinler (kısa değer, önek başka sözcüğün içinde, yer tutucu).
NEGATIVES = [
    "RESEND_API_KEY=re_...",
    "const retry_after_seconds_total = 3",                # 're_' başka sözcüğün içinde
    "pre_ab12cd34_" + "x" * 20,                           # önek sözcük ortasında
    "key: pa-kisa",                                       # 40 karakterden kısa
    "slug: spa-" + "k" * 45,                              # 'pa-' sözcüğün içinde
    "FLY_API_TOKEN=FlyV1 fm2_...",                        # yer tutucu
    "VAPID_PRIVATE_KEY=",                                 # boş
    "VAPID_PRIVATE_KEY=<fly secrets set>",                # yer tutucu
]


def test_clean_repository_passes(tmp_path):
    root = git_repo(tmp_path)
    # ad geçişleri, düzenli ifadeler ve kısa önekler bulgu değildir
    write(root / "README.md", 'Anahtar yok: ! grep -rlE "AIza|gsk_|sk-or-|service_role" out/\nGEMINI_PAID_KEY=\n')
    write(root / ".dev.vars.example", "GROQ_KEY=gsk_...\nSUPABASE_BOT_JWT=eyJ...\n")
    res = scan(root)
    assert res.returncode == 0, res.stdout + res.stderr
    assert "bulgu yok" in res.stdout


@pytest.mark.parametrize("text", NEGATIVES)
def test_v2_lookalikes_are_not_findings(tmp_path, text):
    root = git_repo(tmp_path)
    write(root / "docs/notlar.md", text + "\n")
    res = scan(root)
    assert res.returncode == 0, res.stdout + res.stderr


@pytest.mark.parametrize("name", sorted(SAMPLES))
def test_each_pattern_is_found_without_printing_the_value(tmp_path, name):
    root = git_repo(tmp_path)
    write(root / "src/config.ts", f"// yapılandırma\nconst k = '{SAMPLES[name]}';\n")
    res = scan(root)
    assert res.returncode == 1, res.stdout + res.stderr
    assert f"BULGU  {name}  src/config.ts:2" in res.stdout
    assert SAMPLES[name] not in res.stdout + res.stderr


def test_tracked_and_untracked_files_are_scanned_ignored_are_not(tmp_path):
    root = git_repo(tmp_path)
    write(root / ".gitignore", ".dev.vars\nnode_modules/\n")
    write(root / ".dev.vars", f"GEMINI_PAID_KEY={SAMPLES['google-api-key']}\n")
    write(root / "node_modules/x/index.js", f"k='{SAMPLES['groq-key']}'\n")
    assert scan(root).returncode == 0
    write(root / "notes.txt", f"{SAMPLES['groq-key']}\n")  # izlenmeyen ama yok sayılmayan
    subprocess.run(["git", "-C", str(root), "add", ".gitignore"], check=True)
    res = scan(root)
    assert res.returncode == 1 and "BULGU  groq-key  notes.txt:1" in res.stdout


def test_not_a_git_repository_is_an_error(tmp_path):
    res = scan(tmp_path)
    assert res.returncode == 2 and "git çalışma ağacı değil" in res.stderr


def test_real_repository_is_clean():
    res = subprocess.run(["bash", str(SCAN)], capture_output=True, text=True, check=False)
    assert res.returncode == 0, res.stdout + res.stderr
