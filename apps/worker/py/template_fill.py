"""Şablon doldurucu (practice.generate / practice.prewarm; sıfır LLM). Worker bunu ``python3 -I`` ile çağırır.

Girdi (stdin, JSON): ``{"repo": "<depo kökü>", "out": "<şekil dizini>", "seed": <int>,
"templates": [{"id": "<question_templates.id>", "count": <int>}], "exclude_hashes": ["<content_hash>", ...]}``.
Çıktı (stdout, JSON): ``{"variants": [...], "errors": [{"template_id", "error"}]}``; her varyant
``{template_id, skill_ids, kind, stem, stem_values, options, difficulty, template_params, content_hash,
key: {correct_option, numeric_value, canonical_expr, solution, sympy_status, sympy_report}, figure: null | {code,
code_hash, alt_text, file, width_px, height_px, bytes}}``.

Kurallar (pipelines/tablet ``template`` komutuyla aynı):
* Şablon kodu yalnız ``content/tyt-matematik/templates/__init__.py`` kaydından (``TEMPLATE_FILES``) yüklenir;
  veritabanındaki ``module_path`` kullanılmaz.
* Varyantlar ``content_hash``'e göre tekrarsızdır (``exclude_hashes`` bankada olanlar); şablon başına istenen sayının
  25 katı deneme.
* Cevap taşıyan parametre (adı ``cozum``/``cevap``/… ya da değeri anahtarın sayısal değerine eşit)
  ``template_params``'tan çıkarılır: değer yalnız gizli anahtarda durur.
* Şekil (§6.1 otomatik kapısı): boyut ``expected_px`` içinde, 2 KB – 2 MB, boş olmayan görüntü (piksel std ≥ 0,01);
  geçmeyen varyant atılır.
"""

from __future__ import annotations

import importlib.util
import json
import random
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

ATTEMPTS_PER_VARIANT = 25
ANSWER_PARAM_NAMES = frozenset({"cozum", "cevap", "sonuc", "yanit", "dogru", "dogru_cevap"})
FIGURE_MIN_BYTES = 2 * 1024
FIGURE_MAX_BYTES = 2 * 1024 * 1024
FIGURE_MIN_PIXEL_STD = 0.01
DEFAULT_PX = {"min_w": 200, "max_w": 1600, "min_h": 150, "max_h": 1600}


def load_registry(repo: Path) -> ModuleType:
    init = repo / "content" / "tyt-matematik" / "templates" / "__init__.py"
    spec = importlib.util.spec_from_file_location("ogrenmen_worker_templates", init,
                                                  submodule_search_locations=[str(init.parent)])
    if spec is None or spec.loader is None:
        raise RuntimeError(f"şablon kaydı yüklenemedi: {init}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def strip_answer_params(params: dict[str, Any], key: dict[str, Any], common: ModuleType) -> dict[str, Any]:
    answers = []
    for field in ("canonical_expr", "numeric_value"):
        raw = key.get(field)
        if raw in (None, ""):
            continue
        try:
            answers.append(common.sympify_expr(str(raw)))
        except Exception:  # noqa: BLE001 — ayrıştırılamayan anahtar karşılaştırmaya girmez
            continue
    out: dict[str, Any] = {}
    for name, value in params.items():
        if name.lower() in ANSWER_PARAM_NAMES:
            continue
        if isinstance(value, (int, float)) and not isinstance(value, bool) and answers:
            try:
                if any(common.values_equal(common.sympify_expr(str(value)), a) for a in answers):
                    continue
            except Exception:  # noqa: BLE001
                pass
        out[name] = value
    return out


def figure_ok(info: dict[str, Any], expected: dict[str, int] | None) -> bool:
    px = {**DEFAULT_PX, **(expected or {})}
    if not (px["min_w"] <= info["width_px"] <= px["max_w"] and px["min_h"] <= info["height_px"] <= px["max_h"]):
        return False
    if not (FIGURE_MIN_BYTES <= info["bytes"] <= FIGURE_MAX_BYTES):
        return False
    import matplotlib.image as mpimg

    img = mpimg.imread(info["png_path"])
    channels = img.reshape(-1, img.shape[-1]) if img.ndim == 3 else img.reshape(-1, 1)
    return float(channels.std(axis=0).max()) >= FIGURE_MIN_PIXEL_STD


def variant(module: ModuleType, rng: random.Random, out: Path, common: ModuleType) -> dict[str, Any] | None:
    item, key, fig = module.generate(rng)
    if key.get("sympy_status") != "verified":
        return None
    options = item.get("options") or []
    figure = None
    if fig is not None:
        info = fig.render(out / f"{fig.code_hash}.png")
        if not figure_ok(info, getattr(fig, "expected_px", None)):
            return None
        figure = {"code": fig.code, "code_hash": fig.code_hash, "alt_text": fig.alt_text, "file": info["png_path"],
                  "width_px": info["width_px"], "height_px": info["height_px"], "bytes": info["bytes"]}
    params = (item.get("template") or {}).get("params") or {}
    numeric = key.get("numeric_value")
    return {
        "template_id": module.TEMPLATE_ID,
        "skill_ids": list(item["skill_ids"]),
        "kind": item["kind"],
        "stem": item["stem"],
        "stem_values": item.get("stem_values") or {},
        "options": [{"key": o["key"], "text": o["text"], "misconception_tag": o.get("misconception_tag")}
                    for o in options],
        "difficulty": item.get("difficulty"),
        "template_params": strip_answer_params(params, key, common),
        "content_hash": common.content_hash(item["stem"], options),
        "key": {
            "correct_option": key.get("correct_option"),
            "numeric_value": None if numeric in (None, "") else str(numeric),
            "canonical_expr": key.get("canonical_expr"),
            "solution": key["solution"],
            "sympy_status": "verified",
            "sympy_report": key.get("sympy_report"),
        },
        "figure": figure,
    }


def main() -> int:
    req = json.loads(sys.stdin.read() or "{}")
    repo = Path(req["repo"]).resolve()
    out = Path(req["out"]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    registry = load_registry(repo)
    common = registry.load_file(Path(registry.TEMPLATES_DIR) / "_common.py")
    seen = set(req.get("exclude_hashes") or [])
    rng = random.Random(int(req.get("seed", 7)))
    variants: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for spec in req.get("templates") or []:
        tid = str(spec.get("id"))
        want = max(0, min(int(spec.get("count", 0)), 40))
        if tid not in registry.TEMPLATE_FILES:
            errors.append({"template_id": tid, "error": "OGR-TPL-002 bilinmeyen şablon"})
            continue
        try:
            module = registry.load(tid)
        except Exception as exc:  # noqa: BLE001 — bir şablonun hatası ötekileri durdurmaz
            errors.append({"template_id": tid, "error": f"yüklenemedi: {exc}"[:300]})
            continue
        got = 0
        for _ in range(want * ATTEMPTS_PER_VARIANT):
            if got >= want:
                break
            try:
                v = variant(module, rng, out, common)
            except Exception as exc:  # noqa: BLE001
                errors.append({"template_id": tid, "error": f"üretim: {exc}"[:300]})
                break
            if v is None or v["content_hash"] in seen:
                continue
            seen.add(v["content_hash"])
            variants.append(v)
            got += 1
    json.dump({"variants": variants, "errors": errors}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
