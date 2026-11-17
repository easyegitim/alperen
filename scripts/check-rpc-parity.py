#!/usr/bin/env python3
"""RPC adı + parametre adı paritesi (v2: tek kaynak supabase/migrations).

Denetimler (her biri tabloda bir satır; herhangi bir FAIL → çıkış 1):

(a) Ad paritesi
    * ``pipelines/common/src/ogrenmen_common/fakes/rpc-names.json`` içindeki her ad, migration'larda
      (``supabase/migrations/*.sql``, pglast ile) gövdesi olan bir ``create function public.<ad>`` olmalı.
    * ``fakes/rpc-names-legacy-v1.json``: v2 migration'larında karşılığı olmayan, P3 (tablet doğrulama servisi) ve
      P5 (ders HTTP servisi) gelene dek duran v1 RPC'leri. Bu adlar, çağrı yerleri ve JsonlDb eşlenikleri **WARN**
      satırı olarak raporlanır (imza denetlenmez); bir ad v2'de doğarsa FAIL (v2 listesine taşınmalı). Çağrı
      satırında ya da hemen üstünde ``# rpc-parity: legacy-v1`` işareti, listede olmayan bir v1 çağrısını da WARN yapar.
    * Çağrı yerlerinde görülen her ad ``rpc-names.json`` listesinde olmalı (liste dondurulmuş sözleşmedir:
      JsonlDb'de eşleniği olmayan bir RPC ``--dry-run``'da patlardı). Listede olup hiç çağrılmayan ad uyarı değildir
      (liste ertelenmiş modüllerin eşleniklerini de taşır).

(b) Parametre paritesi — gönderilen gövde anahtarları SQL imzasının giriş parametreleriyle karşılaştırılır:
    * Pipelines: ``pipelines/*/src/**/*.py`` içindeki ``<db>.rpc("<ad>", {…})`` çağrıları (``PostgrestDb.rpc`` ve
      ``JsonlDb.rpc`` aynı imzayı paylaşır); ad sabiti ve ``dict`` döndüren yardımcı (ör. ``rpc_params()``) çözülür.
      ``# rpc-parity: staff`` işaretli çağrı eğitmen oturumuyla yapılır: yalnız SQL imzasına karşı denetlenir,
      ``rpc-names.json`` (worker eşlenikleri) listesinde aranmaz.
    * JsonlDb eşlenikleri: ``fakes/jsonl_rpc.py``'deki ``@rpc`` fonksiyonlarının parametre adları ve
      zorunluluk durumu SQL imzasıyla birebir; ``fakes/rpc-names.json`` kayıtlı eşleniklerle aynı küme.
    Bilinmeyen anahtar ya da eksik zorunlu parametre (SQL'de ``default`` yok) → FAIL. Çözümlenemeyen ad ya da
    gövde (değişken, yayma) → FAIL: parite kanıtlanamıyorsa geçmiş sayılmaz.

TypeScript tarafı (apps/web, apps/worker, packages/llm) bu betikte henüz denetlenmez: ``ts_rpc_calls`` ayrıştırıcısı
(``.rpc('<ad>', { … })``) ileride o paketler Supabase RPC çağırdığında kullanılmak üzere durur.

Kullanım: ``python scripts/check-rpc-parity.py [--root <depo>] [--only-problems] [--json]``
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pglast
from pglast import ast as pg

ROOT_DEFAULT = Path(__file__).resolve().parent.parent

COMMON_NAMES = "pipelines/common/src/ogrenmen_common/fakes/rpc-names.json"
LEGACY_NAMES = "pipelines/common/src/ogrenmen_common/fakes/rpc-names-legacy-v1.json"
JSONL_RPC = "pipelines/common/src/ogrenmen_common/fakes/jsonl_rpc.py"
MIGRATIONS = "supabase/migrations"

IN_MODES = {"i", "b", "v", "d"}  # in, inout, variadic, varsayılan (in)
PASS, WARN, FAIL = "PASS", "WARN", "FAIL"


class ParityError(Exception):
    """Girdi okunamadı (dosya yok, SQL ayrıştırılamadı) — denetim yapılamaz."""


# --------------------------------------------------------------------------------------------- SQL kataloğu


@dataclass(frozen=True)
class Param:
    name: str
    has_default: bool


@dataclass
class SqlFunction:
    schema: str
    name: str
    params: tuple[Param, ...]
    file: str
    has_body: bool

    @property
    def inputs(self) -> dict[str, bool]:
        """Giriş parametresi adı → varsayılanı var mı."""
        return {p.name: p.has_default for p in self.params}

    @property
    def required(self) -> set[str]:
        return {p.name for p in self.params if not p.has_default}


@dataclass
class Catalog:
    functions: dict[tuple[str, str], list[SqlFunction]] = field(default_factory=dict)
    views: dict[tuple[str, str], str] = field(default_factory=dict)

    def function(self, qualified: str) -> list[SqlFunction]:
        return self.functions.get(split_name(qualified), [])

    def view(self, qualified: str) -> str | None:
        return self.views.get(split_name(qualified))


def split_name(qualified: str) -> tuple[str, str]:
    if "." in qualified:
        schema, name = qualified.split(".", 1)
        return schema, name
    return "public", qualified


def _mode(param: pg.FunctionParameter) -> str:
    mode = param.mode
    return str(getattr(mode, "value", mode))


def _has_body(stmt: pg.CreateFunctionStmt) -> bool:
    if getattr(stmt, "sql_body", None) is not None:
        return True
    for opt in stmt.options or ():
        if isinstance(opt, pg.DefElem) and opt.defname == "as":
            parts = opt.arg if isinstance(opt.arg, (list, tuple)) else (opt.arg,)
            for part in parts:
                text = getattr(part, "sval", None)
                if isinstance(text, str) and text.strip():
                    return True
    return False


def load_catalog(migrations_dir: Path) -> Catalog:
    files = sorted(migrations_dir.glob("*.sql"))
    if not files:
        raise ParityError(f"migration bulunamadı: {migrations_dir}")
    cat = Catalog()
    for path in files:
        try:
            tree = pglast.parse_sql(path.read_text(encoding="utf-8"))
        except pglast.parser.ParseError as exc:
            raise ParityError(f"{path.name}: SQL ayrıştırılamadı: {exc}") from exc
        for raw in tree:
            stmt = raw.stmt
            if isinstance(stmt, pg.CreateFunctionStmt):
                parts = [n.sval for n in stmt.funcname]
                schema, name = (parts[-2], parts[-1]) if len(parts) > 1 else ("public", parts[0])
                params = tuple(
                    Param(p.name, p.defexpr is not None)
                    for p in stmt.parameters or ()
                    if _mode(p) in IN_MODES and p.name
                )
                fn = SqlFunction(schema, name, params, path.name, _has_body(stmt))
                cat.functions.setdefault((schema, name), []).append(fn)
            elif isinstance(stmt, pg.ViewStmt):
                rel = stmt.view
                cat.views[(rel.schemaname or "public", rel.relname)] = path.name
    return cat


# --------------------------------------------------------------------------------------------- satırlar


@dataclass
class Row:
    status: str
    source: str
    rpc: str
    where: str
    detail: str


STAFF_MARK = "rpc-parity: staff"
LEGACY_MARK = "rpc-parity: legacy-v1"


def _staff_marked(call: CallSite) -> bool:
    """Çağrı satırında ya da hemen üstünde ``# rpc-parity: staff`` işareti var mı."""
    return _marked(call, STAFF_MARK)


def _legacy_marked(call: CallSite) -> bool:
    """Çağrı satırında ya da hemen üstünde ``# rpc-parity: legacy-v1`` işareti var mı."""
    return _marked(call, LEGACY_MARK)


def _marked(call: CallSite, mark: str) -> bool:
    try:
        lines = Path(call.file).read_text(encoding="utf-8").splitlines()
    except OSError:
        return False
    idx = call.line - 1
    window = lines[max(0, idx - 1): idx + 1]
    return any(mark in ln for ln in window)


def compare_keys(fns: list[SqlFunction], keys: frozenset[str]) -> tuple[str, str]:
    """Gönderilen anahtarlar ↔ SQL giriş parametreleri. Aşırı yükleme varsa herhangi biri uyarsa geçer."""
    problems: list[str] = []
    for fn in fns:
        unknown = sorted(keys - set(fn.inputs))
        missing = sorted(fn.required - keys)
        if not unknown and not missing:
            return PASS, f"{fn.file}: {', '.join(sorted(keys)) or '(parametresiz)'}"
        msg = []
        if unknown:
            msg.append(f"bilinmeyen anahtar: {', '.join(unknown)}")
        if missing:
            msg.append(f"eksik zorunlu parametre: {', '.join(missing)}")
        msg.append(f"SQL imzası ({fn.file}): {signature_text(fn)}")
        problems.append("; ".join(msg))
    return FAIL, " | ".join(problems)


def signature_text(fn: SqlFunction) -> str:
    inner = ", ".join(f"{p.name}{'?' if p.has_default else ''}" for p in fn.params)
    return f"{fn.schema}.{fn.name}({inner})"


# --------------------------------------------------------------------------------------------- TypeScript


@dataclass
class CallSite:
    file: Path
    line: int
    rpc: str | None
    keys: frozenset[str] | None
    note: str = ""


_REGEX_PREV = set("(,=:[!&|?{};+-*%<>~^")
_REGEX_KEYWORDS = ("return", "typeof", "case", "do", "else", "in", "of", "void", "yield", "await")


def mask_ts(text: str) -> str:
    """Yorum, dize, şablon dizesi ve düzenli ifade içeriklerini boşlukla örter (uzunluk ve satırlar korunur).

    Tırnak karakterleri yerinde kalır; böylece dize değişmezinin sınırları maskelenmiş metinde de görülür."""
    out = list(text)
    i, n = 0, len(text)

    def blank(a: int, b: int) -> None:
        for k in range(a, b):
            if out[k] != "\n":
                out[k] = " "

    def regex_allowed(pos: int) -> bool:
        j = pos - 1
        while j >= 0 and text[j] in " \t\r\n":
            j -= 1
        if j < 0:
            return True
        if text[j] in _REGEX_PREV:
            return True
        m = re.search(r"([A-Za-z_$][\w$]*)$", text[: j + 1])
        return bool(m and m.group(1) in _REGEX_KEYWORDS)

    while i < n:
        c = text[i]
        if text.startswith("//", i):
            end = text.find("\n", i)
            end = n if end < 0 else end
            blank(i, end)
            i = end
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = n if end < 0 else end + 2
            blank(i, end)
            i = end
        elif c in "'\"`":
            j = i + 1
            while j < n and text[j] != c:
                if text[j] == "\\":
                    j += 1
                elif c != "`" and text[j] == "\n":
                    break
                j += 1
            blank(i + 1, min(j, n))
            i = j + 1
        elif c == "/" and regex_allowed(i):
            j, in_class = i + 1, False
            while j < n and text[j] != "\n":
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == "[":
                    in_class = True
                elif text[j] == "]":
                    in_class = False
                elif text[j] == "/" and not in_class:
                    break
                j += 1
            if j < n and text[j] == "/":
                blank(i + 1, j)
                i = j + 1
            else:  # bölme işleci
                i += 1
        else:
            i += 1
    return "".join(out)


_OPEN, _CLOSE = "([{", ")]}"


def _match_close(masked: str, start: int) -> int:
    """``masked[start]`` açılış parantezinin kapanış konumu."""
    depth = 0
    for k in range(start, len(masked)):
        ch = masked[k]
        if ch in _OPEN:
            depth += 1
        elif ch in _CLOSE:
            depth -= 1
            if depth == 0:
                return k
    raise ParityError(f"kapanmayan parantez (konum {start})")


def _split_top(masked: str, a: int, b: int) -> list[tuple[int, int]]:
    """``masked[a:b]`` aralığını üst düzey virgüllerden böler; (başlangıç, bitiş) çiftleri."""
    parts, depth, cur = [], 0, a
    for k in range(a, b):
        ch = masked[k]
        if ch in _OPEN:
            depth += 1
        elif ch in _CLOSE:
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append((cur, k))
            cur = k + 1
    parts.append((cur, b))
    return parts


def _skip_ws(masked: str, k: int) -> int:
    while k < len(masked) and masked[k] in " \t\r\n":
        k += 1
    return k


def _skip_generic(masked: str, k: int) -> int:
    """``<…>`` tip argümanlarını atlar (``=>`` içindeki ``>`` derinliği değiştirmez)."""
    depth = 0
    while k < len(masked):
        ch = masked[k]
        if ch == "<":
            depth += 1
        elif ch == ">" and masked[k - 1] != "=":
            depth -= 1
            if depth == 0:
                return k + 1
        k += 1
    raise ParityError("kapanmayan tip argümanı")


_STRING_LIT = re.compile(r"""^(['"`])([A-Za-z_][A-Za-z0-9_]*)\1$""")
_IDENT = re.compile(r"^[A-Za-z_$][\w$]*$")


def _trimmed(masked: str, a: int, b: int) -> tuple[int, int]:
    """Maskelenmiş metinde boşluk ve yorum dışı ilk/son karakter sınırları (yorumlar maskede boşluktur)."""
    while a < b and masked[a] in " \t\r\n":
        a += 1
    while b > a and masked[b - 1] in " \t\r\n":
        b -= 1
    return a, b


def _object_keys(text: str, masked: str, a: int, b: int) -> tuple[frozenset[str] | None, str]:
    """``{ … }`` nesne değişmezinin (``text[a:b]``) üst düzey anahtarları."""
    keys: set[str] = set()
    for s, e in _split_top(masked, a + 1, b - 1):
        s, e = _trimmed(masked, s, e)
        if s >= e:
            continue  # sondaki virgül ya da yalnız yorum
        prop = text[s:e]
        if prop.startswith("..."):
            return None, f"yayma ({prop[:40]}) çözümlenemez"
        depth, colon = 0, e
        for k in range(s, e):
            ch = masked[k]
            if ch in _OPEN:
                depth += 1
            elif ch in _CLOSE:
                depth -= 1
            elif ch == ":" and depth == 0:
                colon = k
                break
        ks, ke = _trimmed(masked, s, colon)
        key_text = text[ks:ke]
        if key_text.startswith("["):
            return None, f"hesaplanan anahtar ({key_text[:40]}) çözümlenemez"
        lit = _STRING_LIT.match(key_text)
        if lit:
            keys.add(lit.group(2))
        elif _IDENT.match(key_text):
            keys.add(key_text)
        else:
            return None, f"anahtar okunamadı ({key_text[:40]})"
    return frozenset(keys), ""


def ts_rpc_calls(text: str, path: Path) -> list[CallSite]:
    masked = mask_ts(text)
    calls: list[CallSite] = []
    for m in re.finditer(r"\.\s*rpc\b", masked):
        line = text.count("\n", 0, m.start()) + 1
        k = _skip_ws(masked, m.end())
        if k < len(masked) and masked[k] == "<":
            k = _skip_ws(masked, _skip_generic(masked, k))
        if k >= len(masked) or masked[k] != "(":
            continue  # çağrı değil (ör. özellik erişimi)
        close = _match_close(masked, k)
        args = [(s, e) for s, e in _split_top(masked, k + 1, close) if masked[s:e].strip()]
        if not args:
            calls.append(CallSite(path, line, None, None, "argümansız rpc çağrısı"))
            continue
        name_text = text[slice(*_trimmed(masked, *args[0]))]
        lit = _STRING_LIT.match(name_text)
        if not lit:
            calls.append(CallSite(path, line, None, None, f"RPC adı sabit dize değil ({name_text[:40]})"))
            continue
        name = lit.group(2)
        if len(args) < 2:
            calls.append(CallSite(path, line, name, frozenset()))
            continue
        start, end = _trimmed(masked, *args[1])
        body = text[start:end]
        if body.startswith("{") and body.endswith("}") and _match_close(masked, start) == end - 1:
            keys, note = _object_keys(text, masked, start, end)
            calls.append(CallSite(path, line, name, keys, note))
        else:
            calls.append(CallSite(path, line, name, None, f"gövde nesne değişmezi değil ({body[:40]})"))
    return calls


# --------------------------------------------------------------------------------------------- Python


def _py_constants(trees: dict[Path, ast.Module]) -> dict[str, str | None]:
    """Modül düzeyi dize sabitleri; aynı ad farklı değerle birden çok yerdeyse None (belirsiz)."""
    out: dict[str, str | None] = {}
    for tree in trees.values():
        for node in tree.body:
            targets: list[ast.expr] = []
            value = None
            if isinstance(node, ast.Assign):
                targets, value = node.targets, node.value
            elif isinstance(node, ast.AnnAssign) and node.value is not None:
                targets, value = [node.target], node.value
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                for t in targets:
                    if isinstance(t, ast.Name):
                        prev = out.get(t.id, value.value)
                        out[t.id] = value.value if prev == value.value else None
    return out


def _dict_keys(node: ast.expr) -> frozenset[str] | None:
    if isinstance(node, ast.Dict):
        keys = set()
        for k in node.keys:
            if k is None or not (isinstance(k, ast.Constant) and isinstance(k.value, str)):
                return None
            keys.add(k.value)
        return frozenset(keys)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "dict" and not node.args:
        if any(kw.arg is None for kw in node.keywords):
            return None
        return frozenset(kw.arg for kw in node.keywords if kw.arg)
    if isinstance(node, ast.Constant) and node.value is None:
        return frozenset()
    return None


def _returns(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> list[ast.Return]:
    found: list[ast.Return] = []

    def walk(node: ast.AST) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
                continue
            if isinstance(child, ast.Return):
                found.append(child)
            walk(child)

    walk(fn)
    return found


def _py_dict_builders(trees: dict[Path, ast.Module]) -> dict[str, frozenset[str] | None]:
    """Her ``return`` ifadesi aynı anahtarlı dict değişmezi olan fonksiyon/metotlar: ad → anahtarlar."""
    out: dict[str, frozenset[str] | None] = {}
    for tree in trees.values():
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            rets = _returns(node)
            if not rets:
                continue
            keysets = {_dict_keys(r.value) if r.value is not None else None for r in rets}
            if len(keysets) != 1 or None in keysets:
                continue
            keys = keysets.pop()
            if node.name in out and out[node.name] != keys:
                out[node.name] = None
            else:
                out[node.name] = keys
    return out


def _local_dict_keys(fn: ast.FunctionDef | ast.AsyncFunctionDef | None, name: str) -> frozenset[str] | None:
    """``params = {...}; db.rpc("x", params)``: ad fonksiyonda bir kez dict değişmezine bağlanıp hiç
    değiştirilmiyorsa o değişmezin anahtarları; ikinci atama, ``params[...] = …``, ``params.update(…)``, ``|=``
    gibi değişiklik → ``None``."""
    if fn is None:
        return None
    values: list[ast.expr | None] = []
    for node in ast.walk(fn):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == name:
                    values.append(node.value)
                elif isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name) and t.value.id == name:
                    return None
                elif not isinstance(t, (ast.Name, ast.Subscript, ast.Attribute)) and any(
                        isinstance(n, ast.Name) and n.id == name for n in ast.walk(t)):
                    return None  # demet açma vb.
        elif isinstance(node, (ast.AnnAssign, ast.AugAssign, ast.NamedExpr)):
            target = node.target
            if isinstance(target, ast.Name) and target.id == name:
                values.append(node.value if isinstance(node, (ast.AnnAssign, ast.NamedExpr)) else None)
            elif isinstance(target, ast.Subscript) and isinstance(target.value, ast.Name) and target.value.id == name:
                return None
        elif isinstance(node, ast.Delete):
            if any(isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name) and t.value.id == name
                   for t in node.targets):
                return None
        elif (isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == name
              and node.attr in {"update", "setdefault", "pop", "popitem", "clear", "__setitem__", "__delitem__"}):
            return None
        elif isinstance(node, (ast.For, ast.AsyncFor, ast.With, ast.AsyncWith, ast.comprehension)):
            targets = [node.target] if isinstance(node, (ast.For, ast.AsyncFor, ast.comprehension)) \
                else [i.optional_vars for i in node.items if i.optional_vars is not None]
            if any(isinstance(n, ast.Name) and n.id == name for t in targets for n in ast.walk(t)):
                return None
    args = fn.args
    if any(a.arg == name for a in args.posonlyargs + args.args + args.kwonlyargs) \
            or (args.vararg and args.vararg.arg == name) or (args.kwarg and args.kwarg.arg == name):
        return None
    if len(values) != 1 or values[0] is None:
        return None
    return _dict_keys(values[0])


def _enclosing_functions(tree: ast.Module) -> dict[int, ast.FunctionDef | ast.AsyncFunctionDef]:
    """Düğüm kimliği → onu içeren en içteki fonksiyon (ast.walk dıştan içe gezer; iç fonksiyon üzerine yazar)."""
    out: dict[int, ast.FunctionDef | ast.AsyncFunctionDef] = {}
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for node in ast.walk(fn):
                if node is not fn:
                    out[id(node)] = fn
    return out


def _callee_name(node: ast.expr) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def py_rpc_calls(files: list[Path]) -> list[CallSite]:
    trees: dict[Path, ast.Module] = {}
    for path in files:
        try:
            trees[path] = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError as exc:
            raise ParityError(f"{path}: Python ayrıştırılamadı: {exc}") from exc
    consts = _py_constants(trees)
    builders = _py_dict_builders(trees)
    calls: list[CallSite] = []
    for path, tree in trees.items():
        enclosing = _enclosing_functions(tree)
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "rpc"):
                continue
            kw = {k.arg: k.value for k in node.keywords if k.arg}
            name_node = node.args[0] if node.args else kw.get("name")
            params_node = node.args[1] if len(node.args) > 1 else kw.get("params")
            name: str | None = None
            note = ""
            if isinstance(name_node, ast.Constant) and isinstance(name_node.value, str):
                name = name_node.value
            elif isinstance(name_node, (ast.Name, ast.Attribute)):
                ident = _callee_name(name_node)
                name = consts.get(ident or "")
                if name is None:
                    note = f"RPC adı sabiti çözümlenemedi ({ident})"
            else:
                note = "RPC adı sabit dize değil"
            if name is None:
                calls.append(CallSite(path, node.lineno, None, None, note))
                continue
            if params_node is None:
                calls.append(CallSite(path, node.lineno, name, frozenset()))
                continue
            keys = _dict_keys(params_node)
            if keys is None and isinstance(params_node, ast.Name):
                keys = _local_dict_keys(enclosing.get(id(node)), params_node.id)
                if keys is None:
                    note = f"parametreler dict değişmezi değil ({params_node.id}: tek atamalı, değişmeyen dict değil)"
            elif (keys is None and isinstance(params_node, ast.Call)
                  and not params_node.args and not params_node.keywords):
                callee = _callee_name(params_node.func)
                keys = builders.get(callee or "")
                if keys is None:
                    note = f"parametre üreticisi çözümlenemedi ({callee})"
            elif keys is None:
                note = f"parametreler dict değişmezi değil ({ast.unparse(params_node)[:40]})"
            calls.append(CallSite(path, node.lineno, name, keys, note))
    return calls


@dataclass
class FakeSignature:
    name: str
    line: int
    params: dict[str, bool]  # ad → varsayılanı var mı
    variadic: str | None = None  # ``*args`` / ``**kwargs`` kullanıyorsa açıklama (imza denetlenemez)


def jsonl_fake_signatures(path: Path) -> list[FakeSignature]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    out: list[FakeSignature] = []
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        if not any(isinstance(d, ast.Name) and d.id == "rpc" for d in node.decorator_list):
            continue
        a = node.args
        positional = a.posonlyargs + a.args
        defaults = [False] * (len(positional) - len(a.defaults)) + [True] * len(a.defaults)
        params = {arg.arg: d for arg, d in zip(positional, defaults, strict=True)}
        params.update({arg.arg: d is not None for arg, d in zip(a.kwonlyargs, a.kw_defaults, strict=True)})
        if positional:
            params.pop(positional[0].arg, None)  # ilk parametre JsonlDb örneği
        star = [f"*{a.vararg.arg}"] if a.vararg else []
        star += [f"**{a.kwarg.arg}"] if a.kwarg else []
        out.append(FakeSignature(node.name, node.lineno, params, ", ".join(star) or None))
    return out


# --------------------------------------------------------------------------------------------- ana akış


def _rel(root: Path, path: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def _load_names(path: Path) -> list[str]:
    if not path.exists():
        raise ParityError(f"ad listesi yok: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    names = data.get("rpc") if isinstance(data, dict) else data
    if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
        raise ParityError(f"{path}: dize listesi (ya da {{\"rpc\": [...]}}) bekleniyordu")
    return names


def check(root: Path, required_objects: tuple[str, ...] = ()) -> list[Row]:
    """Tüm denetimler. Gerekli çağrılabilir nesneler yalnız migration'lardan okunur; ``required_objects`` ek olarak
    var olması beklenen görünüm/fonksiyon adlarıdır (v2'de varsayılan boş: tek kaynak migration'lardır)."""
    cat = load_catalog(root / MIGRATIONS)
    rows: list[Row] = []

    # (a) ad listeleri ⊆ create function
    lists = {"pipelines": COMMON_NAMES}
    names_by_source: dict[str, list[str]] = {}
    for source, rel in lists.items():
        names = _load_names(root / rel)
        names_by_source[source] = names
        for dup in sorted({n for n in names if names.count(n) > 1}):
            rows.append(Row(FAIL, f"ad:{source}", dup, rel, "listede birden çok kez"))
        for name in sorted(set(names)):
            fns = cat.function(name)
            if not fns:
                rows.append(Row(FAIL, f"ad:{source}", name, rel, "migration'larda create function yok"))
            elif not all(f.has_body for f in fns):
                rows.append(Row(FAIL, f"ad:{source}", name, rel, "fonksiyonun gövdesi yok"))
            else:
                rows.append(Row(PASS, f"ad:{source}", name, rel, f"{fns[0].file}"))

    # (a) legacy-v1 adlar: v2'de karşılığı yok → WARN; v2'de doğmuşsa FAIL (v2 listesine taşınmalı)
    legacy_path = root / LEGACY_NAMES
    legacy = _load_names(legacy_path) if legacy_path.exists() else []
    for name in sorted(set(legacy)):
        if name in names_by_source["pipelines"]:
            rows.append(Row(FAIL, "ad:legacy-v1", name, LEGACY_NAMES, "hem v2 hem legacy-v1 listesinde"))
        elif cat.function(name):
            rows.append(Row(FAIL, "ad:legacy-v1", name, LEGACY_NAMES,
                            f"artık v2'de var ({cat.function(name)[0].file}): rpc-names.json'a taşıyın"))
        else:
            rows.append(Row(WARN, "ad:legacy-v1", name, LEGACY_NAMES,
                            "v2 migration'larında yok (P3/P5 servisleri gelene dek duran v1 RPC'si)"))

    # (a) ek gerekli nesneler (görünüm ya da fonksiyon)
    for obj in required_objects:
        view = cat.view(obj)
        fns = cat.function(obj)
        if view:
            rows.append(Row(PASS, "nesne", obj, view, "görünüm"))
        elif fns and all(f.has_body for f in fns):
            rows.append(Row(PASS, "nesne", obj, fns[0].file, "fonksiyon"))
        elif fns:
            rows.append(Row(FAIL, "nesne", obj, fns[0].file, "gövdesi yok"))
        else:
            rows.append(Row(FAIL, "nesne", obj, MIGRATIONS, "migration'larda yok"))

    # (b) çağrı yerleri
    py_files = sorted(p for p in (root / "pipelines").glob("*/src/**/*.py"))
    py_calls = py_rpc_calls(py_files)

    for source, calls, listed in (("pipelines", py_calls, names_by_source["pipelines"]),):
        for c in calls:
            where = f"{_rel(root, c.file)}:{c.line}"
            if c.rpc is None:
                rows.append(Row(FAIL, f"çağrı:{source}", "?", where, c.note))
                continue
            fns = cat.function(c.rpc)
            if not fns and (c.rpc in legacy or _legacy_marked(c)):
                rows.append(Row(WARN, f"çağrı:{source}", c.rpc, where,
                                "legacy-v1: v2'de karşılığı yok (P3/P5 servisleri gelene dek)"))
                continue
            if not fns:
                rows.append(Row(FAIL, f"çağrı:{source}", c.rpc, where, "migration'larda create function yok"))
                continue
            if c.keys is None:
                rows.append(Row(FAIL, f"çağrı:{source}", c.rpc, where, c.note or "gövde çözümlenemedi"))
                continue
            status, detail = compare_keys(fns, c.keys)
            if _staff_marked(c):
                # Eğitmen oturumuyla (OGRENMEN_STAFF_JWT) yapılan çağrı: batch_worker eşlenik listesinde aranmaz,
                # yalnız SQL imzasına karşı denetlenir. İşaret: aynı ya da üst satırda "# rpc-parity: staff".
                detail = f"eğitmen oturumu; {detail}"
            elif c.rpc not in listed:
                status, detail = FAIL, f"rpc-names.json listesinde yok; {detail}"
            rows.append(Row(status, f"çağrı:{source}", c.rpc, where, detail))

    # (b) JsonlDb eşlenikleri ↔ SQL imzası
    fake_path = root / JSONL_RPC
    if not fake_path.exists():
        raise ParityError(f"JsonlDb eşlenik dosyası yok: {fake_path}")
    fakes = jsonl_fake_signatures(fake_path)
    fake_names = {f.name for f in fakes}
    for name in sorted((set(names_by_source["pipelines"]) | set(legacy)) ^ fake_names):
        side = "rpc-names*.json'da var, @rpc eşleniği yok" if name in names_by_source["pipelines"] or name in legacy \
            else "@rpc eşleniği var, rpc-names*.json'da yok"
        rows.append(Row(FAIL, "jsonl", name, _rel(root, fake_path), side))
    for fake in fakes:
        where = f"{_rel(root, fake_path)}:{fake.line}"
        fns = cat.function(fake.name)
        if not fns and fake.name in legacy:
            rows.append(Row(WARN, "jsonl", fake.name, where,
                            "legacy-v1 eşlenik; imza denetlenmez (v2'de karşılığı yok)"))
            continue
        if not fns:
            rows.append(Row(FAIL, "jsonl", fake.name, where, "migration'larda create function yok"))
            continue
        if fake.variadic:
            rows.append(Row(FAIL, "jsonl", fake.name, where,
                            f"eşlenik {fake.variadic} kullanıyor; imza denetlenemez (SQL {signature_text(fns[0])})"))
            continue
        match = next((f for f in fns if f.inputs == fake.params), None)
        if match:
            rows.append(Row(PASS, "jsonl", fake.name, where, f"imza aynı ({match.file})"))
        else:
            fn = fns[0]
            diff = []
            if set(fake.params) != set(fn.inputs):
                extra = sorted(set(fake.params) - set(fn.inputs))
                missing = sorted(set(fn.inputs) - set(fake.params))
                if extra:
                    diff.append(f"SQL'de olmayan: {', '.join(extra)}")
                if missing:
                    diff.append(f"eşlenikte eksik: {', '.join(missing)}")
            flips = sorted(k for k in set(fake.params) & set(fn.inputs) if fake.params[k] != fn.inputs[k])
            if diff:
                rows.append(Row(FAIL, "jsonl", fake.name, where, f"{'; '.join(diff)}; SQL {signature_text(fn)}"))
            else:
                # Ad kümesi aynı, yalnız varsayılan farklı: çağrı yerleri zaten SQL'in zorunlu listesine karşı
                # denetlenir (yukarıda), bu yüzden fark uyarıdır — eşlenik SQL'den gevşek ya da sıkı.
                rows.append(Row(WARN, "jsonl", fake.name, where,
                                f"zorunluluk farklı: {', '.join(flips)} (eşlenikte "
                                f"{'varsayılanlı' if fake.params[flips[0]] else 'zorunlu'}); SQL {signature_text(fn)}"))
    return rows


def render_table(rows: list[Row]) -> str:
    headers = ("Durum", "Kaynak", "RPC / nesne", "Konum", "Ayrıntı")
    data = [(r.status, r.source, r.rpc, r.where, r.detail) for r in rows]
    widths = [max(len(h), *(len(d[i]) for d in data)) if data else len(h) for i, h in enumerate(headers[:-1])]
    out = [" | ".join(h.ljust(w) for h, w in zip(headers[:-1], widths, strict=True)) + " | " + headers[-1]]
    out.append("-+-".join("-" * w for w in widths) + "-+-" + "-" * 20)
    for d in data:
        out.append(" | ".join(v.ljust(w) for v, w in zip(d[:-1], widths, strict=True)) + " | " + d[-1])
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="RPC adı + parametre adı paritesi (pipelines ↔ SQL).")
    ap.add_argument("--root", type=Path, default=ROOT_DEFAULT, help="depo kökü (varsayılan: betiğin üst dizini)")
    ap.add_argument("--only-problems", action="store_true", help="yalnız FAIL ve WARN satırlarını yaz")
    ap.add_argument("--json", action="store_true", help="tablo yerine JSON yaz")
    args = ap.parse_args(argv)
    try:
        rows = check(args.root.resolve())
    except ParityError as exc:
        print(f"HATA: {exc}", file=sys.stderr)
        return 2
    shown = [r for r in rows if r.status != PASS] if args.only_problems else rows
    counts = {s: sum(1 for r in rows if r.status == s) for s in (PASS, WARN, FAIL)}
    if args.json:
        print(json.dumps({"counts": counts, "rows": [r.__dict__ for r in shown]}, ensure_ascii=False, indent=2))
    else:
        if shown:
            print(render_table(shown))
        print(f"\nÖzet: {counts[PASS]} PASS, {counts[WARN]} WARN, {counts[FAIL]} FAIL")
    return 1 if counts[FAIL] else 0


if __name__ == "__main__":
    sys.exit(main())
