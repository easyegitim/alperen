"""check-all.sh: keşif, bayraklar, çıkış kodları ve check.sh sözleşmesi (sahte depo üzerinde; gerçek modül koşmaz)."""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
from pathlib import Path

import pytest
from conftest import REPO, SCRIPTS, write

CHECK_ALL = SCRIPTS / "check-all.sh"
LIB = SCRIPTS / "lib.sh"

# Gerçek depoda check.sh'i olması gereken (korunan) modüller.
EXPECTED_MODULES = [
    "apps/web",
    "apps/worker",
    "content/tyt-matematik",
    "packages/contracts",
    "packages/design-system",
    "packages/doc-render",
    "packages/llm",
    "packages/mastery-math",
    "packages/pii",
    "packages/prompts",
    "pipelines/common",
    "pipelines/ders",
    "pipelines/kalem",
    "pipelines/tablet",
    "supabase",
]


def run(root: Path, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    full_env = {**os.environ, "TMPDIR": str(root / "tmp")}
    (root / "tmp").mkdir(exist_ok=True)
    full_env.update(env or {})
    return subprocess.run(["bash", str(root / "scripts/check-all.sh"), *args], capture_output=True, text=True,
                          check=False, env=full_env)


def make_repo(tmp_path: Path, checks: dict[str, str]) -> Path:
    """Küçük sahte depo: gerçek check-all.sh + lib.sh, kök adımları geçen taklitler, verilen check.sh gövdeleri."""
    root = tmp_path / "repo"
    (root / "scripts").mkdir(parents=True)
    shutil.copy(CHECK_ALL, root / "scripts/check-all.sh")
    shutil.copy(LIB, root / "scripts/lib.sh")
    for name in ("secret-scan.sh",):
        write(root / "scripts" / name, "#!/usr/bin/env bash\necho ok\n")
    for name in ("check-drift.py", "check-fixtures.py", "check-rpc-parity.py"):
        write(root / "scripts" / name, "print('ok')\n")
    write(root / "Makefile", "check check-quick db-test:\n\t@true\n")
    write(root / ".github/workflows/ci.yml", 'name: x\n"on": push\njobs: {}\n')
    for module, body in checks.items():
        path = write(root / module / "check.sh", "#!/usr/bin/env bash\nset -euo pipefail\n" + body)
        path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return root


def only_modules(root: Path, *patterns: str, flags: tuple[str, ...] = ()) -> subprocess.CompletedProcess[str]:
    return run(root, "--only", ",".join(patterns), *flags)


def test_discovers_check_sh_in_sorted_order(tmp_path):
    root = make_repo(tmp_path, {"packages/b": "echo b", "apps/web": "echo web", "pipelines/z": "echo z",
                                "supabase": "echo s", "content/c": "echo c"})
    out = run(root, "--list")
    assert out.returncode == 0, out.stderr
    names = [line.split()[0] for line in out.stdout.splitlines()]
    modules = [n for n in names if not n.startswith("root:")]
    assert modules == ["apps/web", "content/c", "packages/b", "pipelines/z", "supabase"]
    assert any(n.startswith("root:") for n in names)


def test_directory_without_check_sh_is_ignored_with_warning(tmp_path):
    root = make_repo(tmp_path, {"packages/a": "echo a"})
    write(root / "packages/newpkg/package.json", "{}")
    out = only_modules(root, "packages/")
    assert out.returncode == 0, out.stdout + out.stderr
    assert "UYARI: packages/newpkg içinde check.sh yok" in out.stdout
    assert "PASS" in out.stdout and "1 PASS, 0 FAIL, 0 SKIP" in out.stdout


def test_any_fail_exits_1_and_shows_log_tail(tmp_path):
    root = make_repo(tmp_path, {"packages/ok": "echo fine", "packages/bad": "echo yanlis-cikti; exit 3"})
    out = only_modules(root, "packages/")
    assert out.returncode == 1
    assert "FAIL" in out.stdout and "yanlis-cikti" in out.stdout and "1 PASS, 1 FAIL" in out.stdout


def test_exit_77_is_module_skip_and_skip_lines_annotate_pass(tmp_path):
    skip_all = 'source "$(dirname "$0")/../../scripts/lib.sh"; ogr_skip_all "anahtar yok"'
    root = make_repo(tmp_path, {"packages/all": skip_all,
                                "packages/part": 'echo "SKIP: canlı adım (OGRENMEN_LIVE=1 değil)"'})
    out = only_modules(root, "packages/")
    assert out.returncode == 0, out.stdout
    result_lines = out.stdout.splitlines()
    assert any(ln.startswith("SKIP") and "packages/all" in ln and "[SKIP: anahtar yok]" in ln for ln in result_lines)
    assert any(ln.startswith("PASS") and "packages/part" in ln and "[SKIP: canlı adım" in ln for ln in result_lines)
    assert "1 PASS, 0 FAIL, 1 SKIP" in out.stdout


def test_quick_and_live_flags_set_environment(tmp_path):
    body = 'echo "LIVE=$OGRENMEN_LIVE QUICK=$OGRENMEN_QUICK"; test "$OGRENMEN_LIVE-$OGRENMEN_QUICK" = "$EXPECT"'
    root = make_repo(tmp_path, {"packages/env": body})
    for flags, expect in ((("--quick",), "0-1"), (("--live",), "1-0"), ((), "0-0")):
        out = run(root, "--only", "packages/env", *flags, env={"EXPECT": expect, "OGRENMEN_LIVE": "0"})
        assert out.returncode == 0, (flags, out.stdout)
    wrong = run(root, "--only", "packages/env", "--quick", env={"EXPECT": "1-0"})
    assert wrong.returncode == 1  # beklenti tutmazsa FAIL (testin kendisini doğrular)


def test_quick_and_live_conflict_and_unknown_option(tmp_path):
    root = make_repo(tmp_path, {"packages/a": "true"})
    assert run(root, "--quick", "--live").returncode == 2
    assert run(root, "--yok").returncode == 2


def test_empty_selection_is_not_green(tmp_path):
    root = make_repo(tmp_path, {"packages/a": "true"})
    out = run(root, "--only", "yok-boyle-bir-modul")
    assert out.returncode == 1 and "boş koşu yeşil sayılmaz" in out.stdout


def test_modules_run_from_neutral_directory(tmp_path):
    root = make_repo(tmp_path, {"packages/cwd": 'test "$(pwd)" != "$ROOT_UNDER_TEST"'})
    out = run(root, "--only", "packages/cwd", env={"ROOT_UNDER_TEST": str(root)})
    assert out.returncode == 0, out.stdout


def test_real_repo_lists_all_expected_modules():
    out = subprocess.run(["bash", str(CHECK_ALL), "--list"], capture_output=True, text=True, check=False)
    assert out.returncode == 0, out.stderr
    names = {line.split()[0] for line in out.stdout.splitlines()}
    for module in EXPECTED_MODULES:
        assert module in names, f"{module}/check.sh keşfedilmedi"
    assert {"root:secret-scan", "root:drift", "root:fixtures", "root:rpc-parity"} <= names


@pytest.mark.parametrize("module", EXPECTED_MODULES)
def test_real_check_sh_follows_contract(module):
    path = REPO / module / "check.sh"
    text = path.read_text(encoding="utf-8")
    assert os.access(path, os.X_OK), f"{module}/check.sh çalıştırılabilir değil"
    assert text.startswith("#!/usr/bin/env bash\n")
    assert "set -euo pipefail" in text
    assert "scripts/lib.sh" in text
    # `! komut` set -e altında çıkışı tetiklemez; olumsuz denetim ogr_absent / ogr_no_file ile yazılmalı.
    # Girintili (if/for/işlev içi) çıplak olumsuzlama da aynı şekilde etkisizdir; `if ! ...` / `while ! ...` serbesttir.
    bare_negations = [ln for ln in text.splitlines() if re.match(r"^\s*!\s", ln)]
    assert not bare_negations, f"{module}/check.sh: çıplak '! komut' (set -e altında etkisiz): {bare_negations}"


def test_lib_negative_helpers_fail_when_they_should(tmp_path):
    target = write(tmp_path / "f.txt", "merhaba correct_option dünya\n")
    script = f'set -euo pipefail; source "{LIB}"; '
    assert subprocess.run(["bash", "-c", script + f'ogr_absent correct_option "{target}"'], check=False).returncode != 0
    assert subprocess.run(["bash", "-c", script + f'ogr_absent yok_boyle "{target}"'], check=False).returncode == 0
    assert subprocess.run(["bash", "-c", script + f'ogr_absent x "{tmp_path}/yok.txt"'], check=False).returncode != 0
    assert subprocess.run(["bash", "-c", script + f'ogr_no_file "{target}"'], check=False).returncode != 0
    assert subprocess.run(["bash", "-c", script + f'ogr_no_file "{tmp_path}/yok.txt"'], check=False).returncode == 0
