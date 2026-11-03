"""LLM alıştırma sorusu anahtar doğrulayıcısı (practice.generate / practice.prewarm). Worker bunu ``python3 -I`` ile çağırır.

Girdi (stdin, JSON): ``{"repo": "<depo kökü>", "items": [{"id": "<sıra>", "kind": "mcq" | "numeric",
"canonical_expr": "<SymPy ifadesi>" | null, "numeric_value": "<sayı>" | null, "correct_option": "A".."E" | null,
"options": [{"key", "text"}]}]}``.
Çıktı (stdout, JSON): ``{"results": [{"id", "status", "detail"}]}``; ``status``:

* ``verified`` — ``canonical_expr`` SymPy ile ayrıştı ve sayısal soruda ``numeric_value``'ya, çoktan seçmelide yalnız
  doğru şıkkın metnine eşit (``_common.values_equal``).
* ``mismatch`` — anahtar ``canonical_expr`` ile çelişiyor (sayısal değer farklı, başka bir şık eşit ya da doğru şık
  ayrıştı ama eşit değil): worker maddeyi atar.
* ``ambiguous`` — birden çok şık ``canonical_expr``'e eşit: worker maddeyi atar.
* ``inferred`` — denetlenemedi (``canonical_expr`` boş/ayrıştırılamadı, doğru şık metni ayrıştırılamadı, zaman aşımı):
  madde bankaya ``inferred`` işaretiyle girer (answer_practice_item düşük ağırlık).

Ayrıştırma ``content/tyt-matematik/templates/_common.py`` ile (``sympify_expr``, ``parse_math``; beyaz liste
``check_safe_math``, ``eval`` yok). Madde başına ``ITEM_TIMEOUT_S`` saniye.
"""

from __future__ import annotations

import importlib.util
import json
import signal
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

ITEM_TIMEOUT_S = 4


class ItemTimeout(Exception):
    """Madde süresi doldu."""


def load_common(repo: Path) -> ModuleType:
    path = repo / "content" / "tyt-matematik" / "templates" / "_common.py"
    spec = importlib.util.spec_from_file_location("ogrenmen_worker_common", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"_common.py yüklenemedi: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def parse_any(common: ModuleType, text: Any) -> Any:
    """Önce SymPy sözdizimi (``canonical_expr``), olmazsa şık biçimi (ters tırnak, ``3,5``, ``2^3``, ``√``)."""
    s = str(text)
    try:
        return common.sympify_expr(s)
    except Exception:  # noqa: BLE001 — ikinci biçimi dene
        return common.parse_math(s)


def equal(common: ModuleType, a: Any, b: Any) -> bool:
    try:
        return bool(common.values_equal(a, b))
    except Exception:  # noqa: BLE001 — karşılaştırılamayan çift eşit değildir
        return False


def check(common: ModuleType, item: dict[str, Any]) -> tuple[str, str]:
    canon = item.get("canonical_expr")
    if canon is None or not str(canon).strip():
        return "inferred", "canonical_expr yok"
    try:
        target = parse_any(common, canon)
    except Exception as exc:  # noqa: BLE001
        return "inferred", f"canonical_expr ayrıştırılamadı: {exc}"[:200]
    if item.get("kind") == "numeric":
        raw = item.get("numeric_value")
        if raw in (None, ""):
            return "mismatch", "numeric_value yok"
        try:
            value = parse_any(common, raw)
        except Exception as exc:  # noqa: BLE001
            return "inferred", f"numeric_value ayrıştırılamadı: {exc}"[:200]
        if equal(common, value, target):
            return "verified", f"numeric_value = canonical_expr ({canon})"
        return "mismatch", f"numeric_value {raw} ≠ canonical_expr {canon}"
    correct = str(item.get("correct_option") or "").strip().upper()
    matches: list[str] = []
    correct_parsed = False
    for opt in item.get("options") or []:
        key = str(opt.get("key") or "").strip().upper()
        try:
            value = parse_any(common, opt.get("text") or "")
        except Exception:  # noqa: BLE001 — metin şık (sayı değil) karşılaştırılamaz
            continue
        if key == correct:
            correct_parsed = True
        if equal(common, value, target):
            matches.append(key)
    if len(matches) > 1:
        return "ambiguous", f"birden çok şık canonical_expr'e eşit: {','.join(matches)}"
    if matches == [correct]:
        return "verified", f"doğru şık {correct} = canonical_expr ({canon})"
    if matches:
        return "mismatch", f"canonical_expr {canon} şık {matches[0]}'ya eşit, anahtar {correct}"
    if not correct_parsed:
        return "inferred", f"doğru şık {correct} metni ayrıştırılamadı"
    return "mismatch", f"doğru şık {correct} canonical_expr {canon}'e eşit değil"


def _alarm(_signum: int, _frame: Any) -> None:
    raise ItemTimeout()


def main() -> int:
    req = json.loads(sys.stdin.read() or "{}")
    common = load_common(Path(req["repo"]).resolve())
    signal.signal(signal.SIGALRM, _alarm)
    results: list[dict[str, str]] = []
    for item in (req.get("items") or [])[:200]:
        signal.alarm(ITEM_TIMEOUT_S)
        try:
            status, detail = check(common, item)
        except ItemTimeout:
            status, detail = "inferred", "zaman aşımı"
        except Exception as exc:  # noqa: BLE001 — bir maddenin hatası ötekileri durdurmaz
            status, detail = "inferred", f"denetim hatası: {exc}"[:200]
        finally:
            signal.alarm(0)
        results.append({"id": str(item.get("id")), "status": status, "detail": detail})
    json.dump({"results": results}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
