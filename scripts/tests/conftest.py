"""scripts/ denetim betiklerinin testleri için ortak yardımcılar.

Betik adları tire içerdiği için (``check-rpc-parity.py``) modüller dosya yolundan yüklenir.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent
REPO = SCRIPTS.parent


def load_script(filename: str, module_name: str):
    if module_name in sys.modules:
        return sys.modules[module_name]
    spec = importlib.util.spec_from_file_location(module_name, SCRIPTS / filename)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module  # dataclass çözümlemesi modülü sys.modules'te arar
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def parity():
    return load_script("check-rpc-parity.py", "check_rpc_parity")


@pytest.fixture(scope="session")
def drift():
    return load_script("check-drift.py", "check_drift")


@pytest.fixture(scope="session")
def fixtures_check():
    return load_script("check-fixtures.py", "check_fixtures")


@pytest.fixture
def repo() -> Path:
    return REPO


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path
