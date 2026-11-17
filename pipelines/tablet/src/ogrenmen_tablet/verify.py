"""LLM sorusu doğrulaması: zarf/şema, şık kuralı, anahtar sızıntısı ve SymPy anahtar denetimi (BLUEPRINT §6.1 (6)).

SymPy kuralı: ``key.canonical_expr`` ``stem_values`` ile yerine konur ve güvenli ayrıştırıcıyla (içerik
şablonlarının ``_common.sympify_expr``/``parse_math`` yardımcıları — karakter ve ad beyaz listesi, ``eval``'den
önce) SymPy nesnesine çevrilir:

* ``numeric``: ``simplify(expr - numeric_value) == 0`` ise ``verified``;
* ``mcq``: değer şık metinleriyle eşleştirilir; tam bir şık eşleşmeli ve ``matched_option == correct_option``
  olmalı; doğru şıkkın ``misconception_tag``'i ``null`` olmalı;
* ``canonical_expr`` ve ``numeric_value`` ikisi de yoksa: sözel ``mcq`` için ``not_applicable`` (anahtar
  ``register_answer_key``'de ``written_by='batch_worker:unverified'`` olur, eğitmen görmeden onaylanamaz),
  ``numeric`` için ``failed``;
* ``numeric_value`` verilip ``canonical_expr`` verilmezse ``failed``: değer SymPy ile hesaplanmadan doğrulanmış
  sayılmaz (§12 #8: ``not_applicable`` yalnız ifadesiz ve sayısız sözel ``mcq``).

LLM'in kendi yazdığı ``sympy_status``/``sympy_report`` hiçbir zaman kullanılmaz; ikisi de burada yeniden yazılır.

Güvenilmez girdi: ``canonical_expr``/``numeric_value`` LLM çıktısıdır. Önce ucuz bir AST ön denetimi (uzunluk, üs
literal ve ``|üs| ≤ 1000``, üs içinde üs yok), sonra SymPy denetimi **ayrı süreçte** koşar: süre sınırı
``SYMPY_TIMEOUT_S`` (10 sn) ve adres alanı ``mevcut + 512 MB`` (``RLIMIT_AS``). Aşım ``failed`` döner, iş durmaz.

``KeyCheck.note`` hesaplanan değeri ve şık harfini taşır (yalnız yeniden üretim istemi ve ``secure`` şemasına giden
``sympy_report`` için); herkese açık yerlere (``verification.review_note``, raporlar) ``public_note`` yazılır.
"""

from __future__ import annotations

import ast
import copy
import multiprocessing
import os
import re
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import ogrenmen_contracts as contracts

from . import templates as T

ENVELOPE_SCHEMA = "question-generation"
ITEM_SCHEMA = "question-item"
KEY_SCHEMA = "answer-key"
_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
SYMPY_TIMEOUT_S = 10.0
SYMPY_MEMORY_BYTES = 512 * 1024 * 1024
MAX_EXPR_CHARS = 2000
MAX_EXPONENT = 1000


class VerifyError(Exception):
    """Zarf doğrulamasında düşen kural (Türkçe açıklama ``str(exc)``)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class KeyCheck:
    """SymPy denetimi sonucu (``answer-key.sympy_report`` ile aynı alanlar)."""

    status: str
    """``verified`` | ``failed`` | ``not_applicable``"""
    expr: str | None = None
    value: str | None = None
    matched_option: str | None = None
    note: str = ""
    """Ayrıntılı neden (değer ve şık harfi olabilir): yalnız bellekte ve ``secure`` şemasındaki ``sympy_report``."""
    public_note: str = ""
    """Değersiz neden: ``verification.review_note``, ``generate_report.json`` ve ``out/`` için."""

    def __post_init__(self) -> None:
        if not self.public_note:
            self.public_note = self.note

    def report(self) -> dict[str, Any]:
        out: dict[str, Any] = {"matched_option": self.matched_option, "note": self.note}
        if self.expr is not None:
            out["expr"] = self.expr
        if self.value is not None:
            out["value"] = self.value
        return out


@dataclass
class EnvelopeCheck:
    """Bir LLM zarfının yerel denetimi: ``item`` (anahtarsız) ve ``key`` (SymPy durumu yeniden yazılmış)."""

    item: dict[str, Any]
    key: dict[str, Any]
    content_hash: str
    sympy: KeyCheck
    problems: list[str] = field(default_factory=list)


def _schema_problems(schema_id: str, data: Any, limit: int = 4) -> list[str]:
    return [f"{p.path or '/'}: {p.message}" for p in contracts.errors(schema_id, data)[:limit]]


def substitute_stem_values(expr: str, stem_values: dict[str, Any] | None) -> str:
    """``canonical_expr`` içindeki ``stem_values`` adlarını değerleriyle (parantezli) değiştirir.

    Yalnız sayı (ya da sayı biçimli dize) değerler yerine konur; ad beyaz listesi bu adımdan **sonra** uygulanır,
    yani yerine konmamış bilinmeyen ad yine reddedilir.
    """
    values = stem_values or {}

    def repl(m: re.Match[str]) -> str:
        name = m.group(0)
        if name in values:
            v = values[name]
            if isinstance(v, bool):
                return name
            if isinstance(v, int | float):
                return f"({v!r})" if isinstance(v, int) else f"(Rational('{v}'))"
            text = str(v).strip().replace(",", ".")
            if re.fullmatch(r"-?\d+(/\d+)?", text):
                return f"({text})"
            if re.fullmatch(r"-?\d+\.\d+", text):
                return f"(Rational('{text}'))"
        return name

    return _IDENT.sub(repl, expr)


def _parse_value(text: str) -> Any:
    """Anahtar ifadesi (``canonical_expr``/``numeric_value``) → SymPy; önce SymPy sözdizimi, olmazsa
    Telegram biçimli metin (``0,125``, ``√3``)."""
    common = T.common()
    if re.fullmatch(r"\s*-?\d+,\d+\s*", text):  # ondalık virgül: sympify bunu (0, 125) demeti sanar
        return common.parse_math(text)
    try:
        return common.sympify_expr(text)
    except common.MathParseError:
        return common.parse_math(text)


def _option_value(text: str) -> Any | None:
    common = T.common()
    try:
        return common.parse_math(text)
    except common.MathParseError:
        return None


def _fmt(value: Any) -> str:
    import sympy

    try:
        simplified = sympy.nsimplify(value) if getattr(value, "is_Float", False) else sympy.simplify(value)
    except (TypeError, ValueError, sympy.SympifyError):
        simplified = value
    return str(simplified)


class ExprTooHeavy(ValueError):
    """Anahtar ifadesi AST ön denetiminde reddedildi (SymPy'ye hiç verilmez)."""


def _small_constant(node: ast.AST) -> float | None:
    """Üs olarak izinli sabit: sayı, ``-sayı``, ``sayı/sayı``, ``Rational(int, int)``; değilse ``None``."""
    if isinstance(node, ast.Constant) and isinstance(node.value, int | float) and not isinstance(node.value, bool):
        return float(node.value)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub | ast.UAdd):
        inner = _small_constant(node.operand)
        return None if inner is None else -inner if isinstance(node.op, ast.USub) else inner
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
        a, b = _small_constant(node.left), _small_constant(node.right)
        return None if a is None or b is None or b == 0 else a / b
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "Rational"
            and len(node.args) == 2 and not node.keywords):
        a, b = _small_constant(node.args[0]), _small_constant(node.args[1])
        return None if a is None or b is None or b == 0 else a / b
    return None


def _power_weight(node: ast.AST) -> float:
    """İfadedeki en büyük toplam üs (iç içe üslerin çarpımı); izinsiz üste ``ExprTooHeavy``."""
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow):
        exp = _small_constant(node.right)
        if exp is None:
            raise ExprTooHeavy("üs yalnız küçük bir sayı olabilir (üs içinde değişken ya da üs yok)")
        if abs(exp) > MAX_EXPONENT:
            raise ExprTooHeavy(f"üs çok büyük (|üs| > {MAX_EXPONENT})")
        weight = max(1.0, abs(exp)) * max(1.0, _power_weight(node.left))
        if weight > MAX_EXPONENT:
            raise ExprTooHeavy(f"iç içe üslerin toplamı çok büyük (> {MAX_EXPONENT})")
        return weight
    return max((_power_weight(child) for child in ast.iter_child_nodes(node)), default=1.0)


def precheck_expr(text: str) -> None:
    """SymPy'den önce ucuz denetim: uzunluk ve üs sınırları (``^`` SymPy'de üstür, ``**`` gibi denetlenir).

    Python sözdizimine uymayan metin (``√3`` gibi Telegram biçimi) burada geçer; onu ayrı süreçteki SymPy
    denetimi ve süre/bellek sınırı karşılar."""
    if len(text) > MAX_EXPR_CHARS:
        raise ExprTooHeavy(f"ifade {MAX_EXPR_CHARS} karakteri aşıyor")
    try:
        tree = ast.parse(text.replace("^", "**"), mode="eval")
    except SyntaxError:
        return
    _power_weight(tree)


def _limited_child(conn: Any, fn: Callable[..., Any], args: tuple[Any, ...], memory: int) -> None:
    try:
        import resource

        with open("/proc/self/statm", encoding="ascii") as fh:
            current = int(fh.read().split()[0]) * os.sysconf("SC_PAGE_SIZE")
        limit = current + memory
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    except (ImportError, OSError, ValueError):  # Linux dışı: süre sınırı yine geçerli
        pass
    try:
        conn.send(("ok", fn(*args)))
    except MemoryError:
        conn.send(("memory", None))
    except BaseException as exc:  # noqa: BLE001 - çocuk süreçteki her hata çağırana iletilir
        conn.send(("error", f"{type(exc).__name__}: {exc}"))
    finally:
        conn.close()


def run_limited(fn: Callable[..., Any], *args: Any, timeout: float = SYMPY_TIMEOUT_S,
                memory: int = SYMPY_MEMORY_BYTES) -> tuple[str, Any]:
    """``fn(*args)``'ı ayrı süreçte süre ve bellek sınırıyla çalıştırır.

    Dönüş: ``("ok", sonuç)`` | ``("timeout", None)`` | ``("memory", None)`` | ``("error", metin)``. Tek iş parçacıklı
    süreçte ``fork`` (hızlı; içe alınmış SymPy paylaşılır), çok iş parçacıklıysa ``forkserver``."""
    method = "fork" if threading.active_count() == 1 and "fork" in multiprocessing.get_all_start_methods() \
        else "forkserver"
    ctx = multiprocessing.get_context(method)
    recv, send = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_limited_child, args=(send, fn, args, memory), daemon=True)
    proc.start()
    send.close()
    try:
        if recv.poll(timeout):
            try:
                return recv.recv()
            except EOFError:
                return "error", f"denetim süreci yanıtsız bitti (çıkış kodu {proc.exitcode})"
        return "timeout", None
    finally:
        if proc.is_alive():
            proc.kill()
        proc.join(5)
        recv.close()


def verify_key(item: dict[str, Any], key: dict[str, Any], *, timeout: float = SYMPY_TIMEOUT_S) -> KeyCheck:
    """SymPy anahtar denetimi (§6.1 (6)); ``KeyCheck.status`` ``verified`` | ``failed`` | ``not_applicable``.

    Ön denetimden sonra hesap ayrı süreçte, süre (``timeout``) ve bellek sınırıyla koşar."""
    expr_text = key.get("canonical_expr")
    numeric_text = key.get("numeric_value")
    shown = substitute_stem_values(str(expr_text), item.get("stem_values")) if expr_text is not None else None
    try:
        for text in (shown, None if numeric_text is None else str(numeric_text)):
            if text is not None:
                precheck_expr(text)
    except ExprTooHeavy as exc:
        return KeyCheck("failed", note=f"ifade ön denetimde reddedildi: {exc}",
                        public_note=f"anahtar ifadesi ön denetimde reddedildi: {exc}")
    status, payload = run_limited(verify_key_inline, item, key, timeout=timeout)
    if status == "ok":
        return payload
    if status == "timeout":
        return KeyCheck("failed", note="SymPy denetimi zaman sınırını aştı")
    if status == "memory":
        return KeyCheck("failed", note="SymPy denetimi bellek sınırını aştı")
    return KeyCheck("failed", note=f"SymPy denetimi düştü: {payload}", public_note="SymPy denetimi düştü")


def verify_key_inline(item: dict[str, Any], key: dict[str, Any]) -> KeyCheck:
    """``verify_key``'in sınırsız gövdesi (yalnız ``run_limited`` içinden çağrılır)."""
    import sympy

    common = T.common()
    kind = item.get("kind")
    expr_text = key.get("canonical_expr")
    numeric_text = key.get("numeric_value")
    if expr_text is None and numeric_text is None:
        if kind == "mcq":
            return KeyCheck("not_applicable", note="sözel soru: SymPy ifadesi yok; eğitmen anahtarı görerek onaylar")
        return KeyCheck("failed", note="sayısal soruda numeric_value zorunlu")
    if expr_text is None:
        return KeyCheck("failed", note="canonical_expr zorunlu: anahtar SymPy ile hesaplanmadan doğrulanamaz")
    shown = substitute_stem_values(str(expr_text), item.get("stem_values"))
    try:
        value = _parse_value(shown)
        numeric = _parse_value(str(numeric_text)) if numeric_text is not None else None
    except common.MathParseError as exc:
        return KeyCheck("failed", expr=str(expr_text), note=f"ifade ayrıştırılamadı: {exc}",
                        public_note="anahtar ifadesi ayrıştırılamadı")
    if isinstance(value, sympy.Basic) and value.free_symbols:
        return KeyCheck("failed", expr=shown, value=str(value),
                        note="ifadede çözülmemiş değişken var: " + ", ".join(sorted(map(str, value.free_symbols))))
    if isinstance(value, sympy.Basic) and (value.has(sympy.zoo, sympy.nan) or value.is_finite is False):
        return KeyCheck("failed", expr=shown, value=str(value), note="ifade sonlu bir değer vermiyor")
    value_text = _fmt(value)
    if numeric is not None and not common.values_equal(value, numeric):
        return KeyCheck("failed", expr=shown, value=value_text,
                        note=f"canonical_expr değeri {value_text}, numeric_value {numeric_text} ile eşit değil",
                        public_note="canonical_expr ile numeric_value eşit değil")
    if kind == "numeric":
        if numeric is None:
            return KeyCheck("failed", expr=shown, value=value_text, note="sayısal soruda numeric_value zorunlu")
        return KeyCheck("verified", expr=shown, value=value_text, note="simplify(expr - numeric_value) == 0")
    options = item.get("options") or []
    matched = []
    for opt in options:
        ov = _option_value(str(opt.get("text", "")))
        if ov is not None and common.values_equal(ov, value):
            matched.append(opt["key"])
    correct = key.get("correct_option")
    if not matched:
        return KeyCheck("failed", expr=shown, value=value_text,
                        note=f"hiçbir şık SymPy sonucu {value_text} ile eşleşmiyor",
                        public_note="hiçbir şık SymPy sonucuyla eşleşmiyor")
    if len(matched) > 1:
        return KeyCheck("failed", expr=shown, value=value_text, matched_option=None,
                        note=f"birden çok şık aynı değeri veriyor: {', '.join(matched)}",
                        public_note="birden çok şık aynı değeri veriyor")
    if matched[0] != correct:
        return KeyCheck("failed", expr=shown, value=value_text, matched_option=matched[0],
                        note=f"SymPy doğru şıkkı {matched[0]} buldu, anahtar {correct} diyor",
                        public_note="SymPy sonucu anahtardaki şıkla eşleşmedi")
    tag = next((o.get("misconception_tag") for o in options if o.get("key") == correct), None)
    if tag is not None:
        return KeyCheck("failed", expr=shown, value=value_text, matched_option=matched[0],
                        note=f"doğru şık bir yanılgı etiketi taşıyor ({tag})",
                        public_note="anahtardaki şık bir yanılgı etiketi taşıyor")
    return KeyCheck("verified", expr=shown, value=value_text, matched_option=matched[0],
                    note="matched_option == correct_option")


def check_envelope(envelope: Any, *, target_skill: str | None = None, curriculum_code: str | None = None,
                   question_kind: str | None = None) -> EnvelopeCheck:
    """Zarfın şema + yerel kurallarını denetler; düşen kuralda ``VerifyError`` (kod, açıklama).

    SymPy sonucu ``EnvelopeCheck.sympy``'dedir; ``failed`` olması burada hata sayılmaz (çağıran yeniden üretir)."""
    problems = _schema_problems(ENVELOPE_SCHEMA, envelope)
    if problems:
        raise VerifyError("schema", "question-generation şemasına uymuyor: " + "; ".join(problems))
    item = copy.deepcopy(envelope["item"])
    key = copy.deepcopy(envelope["key"])
    try:
        T.check_no_key_fields(item)
    except T.TemplateError as exc:
        raise VerifyError("key_leak", exc.message) from exc
    if item.get("source") != "llm":
        raise VerifyError("source", f"source 'llm' olmalı ({item.get('source')!r} geldi)")
    if curriculum_code and item.get("curriculum_code") != curriculum_code:
        raise VerifyError("curriculum",
                          f"curriculum_code {curriculum_code} olmalı ({item.get('curriculum_code')} geldi)")
    if target_skill and target_skill not in (item.get("skill_ids") or []):
        raise VerifyError("skill", f"soru hedef kazanımı ({target_skill}) taşımıyor: {item.get('skill_ids')}")
    if question_kind and item.get("kind") != question_kind:
        raise VerifyError("kind", f"soru türü {question_kind} olmalı ({item.get('kind')} geldi)")
    try:
        T.check_option_rule(item)
    except T.TemplateError as exc:
        raise VerifyError("options", exc.message) from exc
    if item.get("kind") == "mcq":
        keys = [o["key"] for o in item["options"]]
        if sorted(keys) != ["A", "B", "C", "D"]:
            raise VerifyError("options", f"şık anahtarları A, B, C, D olmalı ({keys})")
        if key.get("correct_option") is None:
            raise VerifyError("key", "çoktan seçmeli soruda correct_option zorunlu")
    elif key.get("numeric_value") is None:
        raise VerifyError("key", "sayısal soruda numeric_value zorunlu")
    sympy_check = verify_key(item, key)
    key["sympy_status"] = sympy_check.status
    key["sympy_report"] = sympy_check.report()
    return EnvelopeCheck(item=item, key=key, content_hash=T.content_hash(item["stem"], item.get("options")),
                         sympy=sympy_check)


def key_payload(key: dict[str, Any], question_id: str) -> dict[str, Any]:
    """``register_answer_key`` ``p_key``: ``answer-key`` şemasına karşı doğrulanır (``question_id`` dahil)."""
    payload = {k: copy.deepcopy(v) for k, v in key.items() if k != "question_id"}
    full = {"question_id": question_id, **payload}
    problems = _schema_problems(KEY_SCHEMA, full)
    if problems:
        raise VerifyError("key", "answer-key şemasına uymuyor: " + "; ".join(problems))
    return payload
