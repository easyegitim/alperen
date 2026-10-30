"""`packages/pii/cases.json` bulucu ve yükleyici (dump ve testler ortak kullanır)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def cases_path(explicit: str | os.PathLike[str] | None = None) -> Path:
    """Vaka dosyasının yolu: açık argüman > OGRENMEN_PII_CASES > depo içi varsayılan."""
    if explicit:
        return Path(explicit)
    env = os.environ.get("OGRENMEN_PII_CASES")
    if env:
        return Path(env)
    # packages/pii/py/ogrenmen_pii/cases.py → packages/pii/cases.json
    return Path(__file__).resolve().parents[2] / "cases.json"


def load_cases(explicit: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    path = cases_path(explicit)
    if not path.is_file():
        raise FileNotFoundError(f"vaka dosyası bulunamadı: {path}")
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)
