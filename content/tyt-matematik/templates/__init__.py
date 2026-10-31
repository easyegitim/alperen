"""TYT Matematik parametrik soru şablonları (BLUEPRINT §10.4; sıfır LLM).

Her modül şu sabitleri ve işlevi taşır:

* ``TEMPLATE_ID`` (``question_templates.id``), ``SKILL_ID`` (``question_templates.skill_id``),
  ``ENGINE``, ``HAS_FIGURE``, ``TAGS`` (çeldirici etiketleri), ``PARAMS_SCHEMA`` (JSON Schema);
* ``generate(rng: random.Random) -> (QuestionItem, AnswerKey, FigureSpec | None)``.

``module_path`` biçimi ``content/tyt-matematik/templates/<modül>.py:generate``; ``resolve()`` bunu
dosya yolundan yükler (paket kurulumu gerekmez).
"""

from __future__ import annotations

import importlib.util
import sys
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

TEMPLATES_DIR = Path(__file__).resolve().parent

# şablon kimliği → modül dosyası (sıra §10.4 tablosu)
TEMPLATE_FILES: dict[str, str] = {
    "sayi-dogrusu-esitsizlik": "sayi_dogrusu_esitsizlik.py",
    "kesir-modeli-toplama": "kesir_modeli_toplama.py",
    "yuzde-grafik": "yuzde_grafik.py",
    "islem-onceligi": "islem_onceligi.py",
    "uslu-sadelestirme": "uslu_sadelestirme.py",
    "denklem-birinci-derece": "denklem_birinci_derece.py",
}


def module_path(template_id: str) -> str:
    """``question_templates.module_path`` değeri (depo köküne göre)."""
    return f"content/tyt-matematik/templates/{TEMPLATE_FILES[template_id]}:generate"


def load_file(path: str | Path) -> ModuleType:
    path = Path(path).resolve()
    name = f"ogrenmen_tyt_templates_{path.stem}"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"şablon yüklenemedi: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def load(template_id: str) -> ModuleType:
    """Şablon modülünü kimliğiyle yükler."""
    if template_id not in TEMPLATE_FILES:
        raise KeyError(f"OGR-TPL-002 bilinmeyen şablon: {template_id}")
    return load_file(TEMPLATES_DIR / TEMPLATE_FILES[template_id])


def resolve(module_path_value: str, repo_root: str | Path | None = None) -> Callable:
    """``'content/tyt-matematik/templates/x.py:generate'`` → ``generate`` işlevi."""
    file_part, _, attr = module_path_value.partition(":")
    root = Path(repo_root) if repo_root else TEMPLATES_DIR.parents[2]
    return getattr(load_file(root / file_part), attr or "generate")


def all_templates() -> list[ModuleType]:
    return [load(tid) for tid in TEMPLATE_FILES]
