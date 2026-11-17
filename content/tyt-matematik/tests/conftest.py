"""Ortak test yardımcıları: içerik dizini, betik modülleri, geçici içerik kopyası."""

from __future__ import annotations

import importlib.util
import shutil
import sys
from pathlib import Path

import pytest

CONTENT_DIR = Path(__file__).resolve().parent.parent
SCRIPTS = CONTENT_DIR / "scripts"
REPO_ROOT = CONTENT_DIR.parents[1]
for p in (str(SCRIPTS), str(CONTENT_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)


def load_script(name: str):
    """Tireli betik adını (export-sql.py) modül olarak yükler."""
    path = SCRIPTS / name
    mod_name = "m03_" + path.stem.replace("-", "_")
    if mod_name in sys.modules:
        return sys.modules[mod_name]
    spec = importlib.util.spec_from_file_location(mod_name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def lib():
    import _contentlib

    return _contentlib


@pytest.fixture(scope="session")
def export_sql():
    return load_script("export-sql.py")


@pytest.fixture(scope="session")
def seed_keys():
    return load_script("seed-keys.py")


@pytest.fixture()
def content_copy(tmp_path) -> Path:
    """İçeriğin geçici kopyası: <tmp>/content/tyt-matematik (kardeş curriculum.json taraması için aynı derinlik)."""
    dst = tmp_path / "content" / "tyt-matematik"
    dst.mkdir(parents=True)
    for name in ("curriculum.json", "skills.json", "prerequisites.json", "misconception-tags.json"):
        shutil.copy(CONTENT_DIR / name, dst / name)
    shutil.copytree(CONTENT_DIR / "diagnostic", dst / "diagnostic")
    shutil.copytree(CONTENT_DIR / "versions", dst / "versions")
    return dst
