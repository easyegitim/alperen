"""Şablonların ve içerik betiklerinin ortak yardımcıları (BLUEPRINT §10.4, §6.1).

Bu modül LLM çağırmaz; yalnız SymPy ve matplotlib kullanır.

* ``parse_math(text)`` — şık ya da ifade metnini (``"`7/8`"``, ``"3√3"``, ``"%25"``, ``"0,045"``,
  ``"-2x + 5 > -3"``) SymPy nesnesine çevirir.
* ``values_equal(a, b)`` — iki SymPy değerini karşılaştırır (sayı, ifade, eşitsizlik → çözüm kümesi).
* ``content_hash(stem, options)`` — ``questions.content_hash`` (fixtures/db ile aynı normalleştirme).
* ``FigureSpec`` — şablon şeklinin deterministik tanımı; ``render(path)`` PNG üretir.
* ``assemble(...)`` — ``QuestionItem`` + ``AnswerKey`` sözlüklerini kurar ve SymPy ile doğrular.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
import struct
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Any

import sympy
from sympy.parsing.sympy_parser import convert_xor, parse_expr, standard_transformations

CONTENT_DIR = Path(__file__).resolve().parent.parent
NAMESPACE_OGRENMEN = uuid.uuid5(uuid.NAMESPACE_DNS, "ogrenmen.easy")

# Tasarım sistemi şekil renkleri (paper zemin, navy çizgi, sabit #0030a2 vurgu).
PAPER = "#f6f8fc"
NAVY = "#051c60"
PRIMARY = "#0030a2"
TINT = "#c9d6f2"
MUTED = "#7a86a8"
FONT_SIZE = 15  # eksen yazısı ≥ 14 px (100 dpi'da 15 pt ≈ 21 px)
DPI = 100

X = sympy.Symbol("x", real=True)
_SYMBOLS = {name: sympy.Symbol(name, real=True) for name in ("x", "y", "a", "b", "t")}
_LOCALS: dict[str, Any] = {
    **_SYMBOLS,
    "Rational": sympy.Rational,
    "sqrt": sympy.sqrt,
    "Abs": sympy.Abs,
    "oo": sympy.oo,
    "Interval": sympy.Interval,
    "FiniteSet": sympy.FiniteSet,
    "Union": sympy.Union,
    "ilcm": sympy.ilcm,
    "igcd": sympy.igcd,
    "lcm": sympy.lcm,
    "gcd": sympy.gcd,
    "Mod": sympy.Mod,
    "floor": sympy.floor,
    "ceiling": sympy.ceiling,
}
_TRANSFORMS = standard_transformations + (convert_xor,)
_UNITS = re.compile(r"\s*(TL|km/sa|km|cm|m|dk|dakika|saat|gün|sayfa|işçi)\b", re.IGNORECASE)


class MathParseError(ValueError):
    """Metin SymPy ifadesine çevrilemedi."""


def curriculum() -> dict[str, Any]:
    return json.loads((CONTENT_DIR / "curriculum.json").read_text(encoding="utf-8"))


def curriculum_code(cur: dict[str, Any] | None = None) -> str:
    cur = cur or curriculum()
    return f"{cur['code']}@{cur['version']}"


def uid(kind: str, key: str) -> str:
    """Deterministik kimlik: uuid5(NAMESPACE_OGRENMEN, "tür:anahtar") (fixtures/README.md ile aynı)."""
    return str(uuid.uuid5(NAMESPACE_OGRENMEN, f"{kind}:{key}"))


def curriculum_uuid(code: str) -> str:
    """``curricula.id`` = uuid5(NAMESPACE_OGRENMEN, "<code>@<version>") (fixtures/db ile aynı)."""
    return str(uuid.uuid5(NAMESPACE_OGRENMEN, code))


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def content_hash(stem: str, options: Sequence[dict[str, Any]] | None) -> str:
    """Kök + şıklar, boşluk sadeleştirilmiş ve küçük harf; aynı soru iki kez üretilmez."""
    norm = " ".join(stem.split()).lower() + "|" + "|".join(
        f"{o['key']}:{' '.join(o['text'].split()).lower()}" for o in (options or [])
    )
    return sha256_hex(norm)


# --- Matematik ayrıştırma ------------------------------------------------------------------


def _replace_abs(s: str) -> str:
    pattern = re.compile(r"\|([^|]+)\|")
    while "|" in s:
        new = pattern.sub(r"Abs(\1)", s)
        if new == s:
            raise MathParseError(f"eşleşmeyen mutlak değer çizgisi: {s!r}")
        s = new
    return s


def normalize_math(text: str) -> str:
    """Telegram biçimli metni (tasarım sistemi telegram.md) Python/SymPy sözdizimine çevirir."""
    s = text.strip()
    if s.startswith("`") and s.endswith("`") and len(s) >= 2:
        s = s[1:-1]
    s = s.replace("`", "").strip()
    s = (
        s.replace("−", "-")
        .replace("–", "-")
        .replace("·", "*")
        .replace("×", "*")
        .replace("÷", "/")
        .replace("≤", "<=")
        .replace("≥", ">=")
        .replace("π", "pi")
    )
    s = _UNITS.sub("", s)
    s = re.sub(r"%\s*(\d+(?:[.,]\d+)?)", r"(\1)", s)
    s = re.sub(r"(\d),(\d)", r"\1.\2", s)
    s = _replace_abs(s)
    s = re.sub(r"√\s*\(", "sqrt(", s)
    s = re.sub(r"√\s*(\d+|[a-z])", r"sqrt(\1)", s)
    # örtük çarpma: 2x, 3sqrt(3), 2(x+1), )(, )x
    s = re.sub(r"(\d|\))\s*(?=(sqrt|Abs|[a-z]|\())", r"\1*", s)
    s = re.sub(r"(\d+\.\d+)", r"Rational('\1')", s)
    return s.strip()


def parse_math(text: str) -> Any:
    """Şık ya da ifade metnini SymPy nesnesine çevirir; ondalıklar kesir olarak tutulur."""
    s = normalize_math(text)
    if not s:
        raise MathParseError("boş ifade")
    try:
        return parse_expr(s, local_dict=dict(_LOCALS), transformations=_TRANSFORMS, evaluate=True)
    except Exception as exc:  # noqa: BLE001 — SymPy birçok tür fırlatır
        raise MathParseError(f"ayrıştırılamadı: {text!r} → {s!r}: {exc}") from exc


def sympify_expr(expr: str) -> Any:
    """Anahtardaki ``canonical_expr``/``numeric_value`` (SymPy sözdizimi)."""
    try:
        return sympy.sympify(expr, locals=dict(_LOCALS), rational=True)
    except Exception as exc:  # noqa: BLE001
        raise MathParseError(f"sympify edilemedi: {expr!r}: {exc}") from exc


def _as_set(value: Any) -> Any:
    if isinstance(value, sympy.Set):
        return value
    if isinstance(value, (sympy.core.relational.Relational, sympy.logic.boolalg.Boolean)):
        free = sorted(value.free_symbols, key=str)
        if len(free) != 1:
            raise MathParseError(f"tek değişkenli eşitsizlik bekleniyor: {value}")
        return sympy.solveset(value, free[0], domain=sympy.S.Reals)
    return None


def values_equal(a: Any, b: Any) -> bool:
    """Sayı/ifade için ``simplify(a - b) == 0``; eşitsizlik ve kümeler için çözüm kümesi eşitliği."""
    sa, sb = _as_set(a), _as_set(b)
    if sa is not None or sb is not None:
        if sa is None or sb is None:
            return False
        return bool(sympy.simplify(sa.symmetric_difference(sb)) == sympy.S.EmptySet)
    try:
        return bool(sympy.simplify(sympy.sympify(a) - sympy.sympify(b)) == 0)
    except (TypeError, sympy.SympifyError):
        return False


def match_options(value: Any, options: Sequence[dict[str, Any]]) -> list[str]:
    """``value``'ya eşit şıkların anahtarları."""
    return [o["key"] for o in options if values_equal(parse_math(o["text"]), value)]


# --- Biçimlendirme -------------------------------------------------------------------------


def fmt_num(v: Any) -> str:
    """Tam sayı → ``-11``; kesir → ``7/8`` (sadeleşmiş)."""
    q = Fraction(int(v.p), int(v.q)) if isinstance(v, sympy.Rational) else Fraction(v)
    return str(q.numerator) if q.denominator == 1 else f"{q.numerator}/{q.denominator}"


def code(s: str) -> str:
    """Telegram tek satır kod biçimi."""
    return f"`{s}`"


def signed(n: int) -> str:
    """Bir terimi işaretiyle yazar: ``+ 5`` / ``- 5``."""
    return f"+ {n}" if n >= 0 else f"- {-n}"


def paren(n: int) -> str:
    """Negatif sayıyı parantezler: ``(-3)``."""
    return f"({n})" if n < 0 else str(n)


# --- Şekil -----------------------------------------------------------------------------------


def png_size(path: Path) -> tuple[int, int]:
    with open(path, "rb") as fh:
        head = fh.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"PNG değil: {path}")
    width, height = struct.unpack(">II", head[16:24])
    return int(width), int(height)


@dataclass
class FigureSpec:
    """Şablon şeklinin deterministik tanımı. ``code`` şablon kimliği + kanonik parametrelerdir;
    aynı parametre aynı PNG'yi verir (vision gerekmez, ``figures.vision_status='not_applicable'``)."""

    template_id: str
    params: dict[str, Any]
    alt_text: str
    draw: Callable[[dict[str, Any]], Any] = field(repr=False)
    tool: str = "template"
    expected_px: dict[str, int] = field(default_factory=lambda: {"min_w": 200, "max_w": 1600, "min_h": 150, "max_h": 1600})

    @property
    def code(self) -> str:
        return f"{self.template_id}({json.dumps(self.params, sort_keys=True, ensure_ascii=False)})"

    @property
    def code_hash(self) -> str:
        return sha256_hex(self.code)

    def item_figure(self) -> dict[str, Any]:
        """``QuestionItem.figure`` alanı."""
        return {"tool": self.tool, "code": self.code, "alt_text": self.alt_text, "expected_px": dict(self.expected_px)}

    def render(self, path: str | Path) -> dict[str, Any]:
        """PNG yazar; ``{png_path, width_px, height_px, bytes}`` döner."""
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        fig = self.draw(self.params)
        try:
            fig.savefig(path, dpi=DPI, facecolor=PAPER, metadata={"Software": None})
        finally:
            plt.close(fig)
        width, height = png_size(path)
        return {"png_path": str(path), "width_px": width, "height_px": height, "bytes": path.stat().st_size}

    def rpc_payload(self, render_info: dict[str, Any], png_path: str | None = None) -> dict[str, Any]:
        """``register_template_question(p_item, p_key, p_figure)`` için ``p_figure``."""
        return {
            "code": self.code,
            "code_hash": self.code_hash,
            "alt_text": self.alt_text,
            "png_path": png_path or render_info["png_path"],
            "width_px": render_info["width_px"],
            "height_px": render_info["height_px"],
            "bytes": render_info["bytes"],
        }


def new_figure(width_in: float, height_in: float):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": FONT_SIZE, "svg.hashsalt": "ogrenmen"})
    fig = plt.figure(figsize=(width_in, height_in), dpi=DPI, facecolor=PAPER)
    return fig


def draw_number_line(params: dict[str, Any]):
    """Sayı doğrusu: ``lo..hi`` tam sayı çentikleri, dolu/boş uç noktaları, taralı aralık ya da ışın.

    params: ``lo, hi`` (çizim sınırı), ``left``/``right`` (aralık uçları; ışında biri null),
    ``left_closed``/``right_closed``, ``marks`` (etiketli dolu noktalar ``[{"x": 3, "label": "A"}]``).
    """
    fig = new_figure(8.0, 2.2)
    ax = fig.add_axes((0.03, 0.05, 0.94, 0.9))
    lo, hi = params["lo"], params["hi"]
    ax.set_xlim(lo - 0.8, hi + 0.8)
    ax.set_ylim(-1.2, 1.2)
    ax.axis("off")
    ax.annotate("", xy=(hi + 0.75, 0), xytext=(lo - 0.75, 0),
                arrowprops={"arrowstyle": "<|-|>", "color": NAVY, "lw": 2})
    for n in range(lo, hi + 1):
        ax.plot([n, n], [-0.12, 0.12], color=NAVY, lw=1.5)
        ax.text(n, -0.55, str(n).replace("-", "−"), ha="center", va="center", color=NAVY, fontsize=FONT_SIZE)
    left, right = params.get("left"), params.get("right")
    seg_lo = left if left is not None else lo - 0.4
    seg_hi = right if right is not None else hi + 0.4
    if left is not None or right is not None:
        ax.plot([seg_lo, seg_hi], [0, 0], color=PRIMARY, lw=7, solid_capstyle="butt", zorder=2)
        ray = {"arrowstyle": "-|>", "color": PRIMARY, "lw": 3, "mutation_scale": 28}
        if left is None:
            ax.annotate("", xy=(lo - 0.8, 0), xytext=(lo - 0.3, 0), arrowprops=ray, zorder=3)
        if right is None:
            ax.annotate("", xy=(hi + 0.8, 0), xytext=(hi + 0.3, 0), arrowprops=ray, zorder=3)
    for end, closed in ((left, params.get("left_closed", False)), (right, params.get("right_closed", False))):
        if end is None:
            continue
        ax.plot([end], [0], marker="o", markersize=15, markeredgewidth=2.5, markeredgecolor=PRIMARY,
                markerfacecolor=PRIMARY if closed else PAPER, zorder=4)
    for mark in params.get("marks", []):
        ax.plot([mark["x"]], [0], marker="o", markersize=11, color=NAVY, zorder=5)
        ax.text(mark["x"], 0.55, mark["label"], ha="center", va="center", color=NAVY, fontsize=FONT_SIZE + 1,
                fontweight="bold")
    return fig


def draw_fraction_models(params: dict[str, Any]):
    """İki kesir modeli: her biri ``payda`` eş parçaya bölünmüş, ``pay`` parçası boyalı dikdörtgen."""
    from matplotlib.patches import Rectangle

    fig = new_figure(8.0, 3.2)
    ax = fig.add_axes((0.02, 0.02, 0.96, 0.96))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 4)
    ax.axis("off")
    for idx, frac in enumerate(params["kesirler"]):
        x0, width, y0, height = 0.4 + idx * 5.0, 4.2, 1.0, 2.0
        part = width / frac["payda"]
        for i in range(frac["payda"]):
            ax.add_patch(Rectangle((x0 + i * part, y0), part, height, facecolor=PRIMARY if i < frac["pay"] else PAPER,
                                   edgecolor=NAVY, lw=2))
        ax.text(x0 + width / 2, 0.45, frac.get("label", ""), ha="center", va="center", color=NAVY,
                fontsize=FONT_SIZE)
    return fig


def draw_bar_chart(params: dict[str, Any]):
    """Çubuk grafik: ``bars = [{"label": "Başlangıç", "value": 200, "text": "200 TL"}, ...]``."""
    fig = new_figure(8.0, 5.0)
    ax = fig.add_axes((0.1, 0.16, 0.86, 0.76))
    ax.set_facecolor(PAPER)
    bars = params["bars"]
    labels = [b["label"] for b in bars]
    values = [b["value"] for b in bars]
    colors = [PRIMARY if i == 0 else TINT for i in range(len(bars))]
    rects = ax.bar(range(len(bars)), values, color=colors, edgecolor=NAVY, linewidth=2, width=0.6)
    for rect, b in zip(rects, bars, strict=True):
        ax.text(rect.get_x() + rect.get_width() / 2, rect.get_height() * 1.02, b["text"], ha="center", va="bottom",
                color=NAVY, fontsize=FONT_SIZE, fontweight="bold")
    ax.set_xticks(range(len(bars)), labels, color=NAVY, fontsize=FONT_SIZE)
    ax.set_ylim(0, max(values) * 1.25)
    ax.set_ylabel(params.get("ylabel", "Fiyat (TL)"), color=NAVY, fontsize=FONT_SIZE)
    ax.tick_params(axis="y", colors=NAVY, labelsize=FONT_SIZE - 1)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(NAVY)
    ax.grid(axis="y", color="#d3dbea", lw=1)
    ax.set_axisbelow(True)
    return fig


# --- Madde + anahtar -------------------------------------------------------------------------


@dataclass
class Choice:
    """Bir şık: metin (Telegram biçimi), SymPy değeri, yanılgı etiketi (doğru şık ve hesap hatası: None)."""

    text: str
    value: Any
    tag: str | None = None


class TemplateRetry(Exception):
    """Rastgele parametreler geçersiz bir varyant verdi (çakışan şık vb.); yeni parametre çekilir."""


def distinct(choices: Sequence[Choice]) -> bool:
    for i, a in enumerate(choices):
        for b in choices[i + 1:]:
            if a.text == b.text or values_equal(a.value, b.value):
                return False
    return True


def assemble(
    *,
    rng: random.Random,
    template_id: str,
    skill_ids: list[str],
    stem: str,
    correct: Choice,
    distractors: list[Choice],
    canonical_expr: str,
    numeric_value: str | None,
    solution: str,
    params: dict[str, Any],
    stem_values: dict[str, Any] | None = None,
    figure: FigureSpec | None = None,
    difficulty: float = 0.5,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Şıkları karıştırır, A–D anahtarlar, §10.3 şık kuralını ve SymPy doğrulamasını uygular.

    Kural ihlali (çakışan değer, eksik etiket) ``TemplateRetry`` fırlatır; şablon yeni parametre çeker.
    """
    if len(distractors) != 3:
        raise ValueError("tam üç çeldirici gerekir")
    if correct.tag is not None:
        raise ValueError("doğru şık etiketsizdir")
    tagged = sum(1 for d in distractors if d.tag)
    if tagged < 2 or tagged == 3:
        raise ValueError("çeldiricilerin en az 2'si etiketli, en az 1'i etiketsiz olmalı")
    allc = [correct, *distractors]
    if not distinct(allc):
        raise TemplateRetry("şık değerleri çakışıyor")
    order = list(range(4))
    rng.shuffle(order)
    options, correct_key = [], None
    for key, idx in zip("ABCD", order, strict=True):
        c = allc[idx]
        options.append({"key": key, "text": c.text, "misconception_tag": c.tag})
        if idx == 0:
            correct_key = key
    expr_value = sympify_expr(canonical_expr)
    matched = match_options(expr_value, options)
    if matched != [correct_key]:
        raise AssertionError(f"{template_id}: SymPy eşleşmesi {matched} ≠ {correct_key} ({canonical_expr})")
    if numeric_value is not None and not values_equal(sympify_expr(numeric_value), expr_value):
        raise AssertionError(f"{template_id}: numeric_value {numeric_value} ≠ {canonical_expr}")
    item = {
        "schema_version": "1.0",
        "curriculum_code": curriculum_code(),
        "kind": "mcq",
        "skill_ids": list(skill_ids),
        "stem": stem,
        "stem_values": dict(stem_values or {}),
        "figure": figure.item_figure() if figure else None,
        "options": options,
        "difficulty": difficulty,
        "source": "template",
        "template": {"id": template_id, "params": params},
        "verification": {
            "schema": True,
            "sympy": "verified",
            "render": "pending" if figure else "not_applicable",
            "vision": "not_applicable",
            "attempts": 0,
            "status": "draft",
        },
    }
    key = {
        "question_id": uid("question", "template:" + content_hash(stem, options)),
        "correct_option": correct_key,
        "canonical_expr": canonical_expr,
        "solution": solution,
        "sympy_status": "verified",
        "sympy_report": {"expr": canonical_expr, "value": str(expr_value), "matched_option": correct_key},
    }
    # answer-key şeması oneOf(correct_option | numeric_value) ister: mcq anahtarı yalnız correct_option taşır;
    # numeric_value yukarıda SymPy ile canonical_expr'e karşı denetlenir ve rapora yazılır.
    if numeric_value is not None:
        key["sympy_report"]["note"] = f"numeric_value={numeric_value}"
    return item, key


def run_generator(builder: Callable[[random.Random], tuple[dict, dict, FigureSpec | None]], rng: random.Random,
                  attempts: int = 200) -> tuple[dict, dict, FigureSpec | None]:
    """``builder``'ı geçerli bir varyant çıkana kadar çağırır (aynı rng → aynı sonuç)."""
    for _ in range(attempts):
        try:
            return builder(rng)
        except TemplateRetry:
            continue
    raise RuntimeError("şablon geçerli varyant üretemedi")
