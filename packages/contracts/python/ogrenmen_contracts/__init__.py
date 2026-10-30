"""Öğrenmen sözleşmeleri — Python doğrulayıcı (BLUEPRINT §4).

* ``validate(schema_id, data)`` — uymazsa ``ContractValidationError`` (tüm hatalarla) fırlatır,
  veriyi olduğu gibi döner.
* ``errors(schema_id, data)`` — hata listesi (geçerliyse boş).
* ``is_valid(schema_id, data)``.
* ``gemini_schema(schema_id)`` — TS ``toGeminiSchema`` ile aynı düzleştirme.
* ``load_models()`` — ``models.json`` (şemaya karşı doğrulanmış).

``schema_id`` kısa ad (``"question-item"``), ``$id``
(``"https://ogrenmen.easy/schemas/question-item.json"``) ya da tek tanıma parçalı başvuru
(``"transcript#/$defs/segment"``, ``"…/curriculum.json#/$defs/skill"``) olabilir. Doğrulama
``jsonschema.Draft202012Validator`` + ``FormatChecker`` ile yapılır; ``x-forbidden-words``
``validators.extend`` ile eklenir; biçimler ve ``pattern`` Ajv (TS) ile aynı kararı verir
(``_core``). Pipelines çıktıyı DB'ye yazmadan önce mutlaka ``validate`` eder.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import cache, lru_cache
from importlib import resources
from pathlib import Path
from typing import Any

from . import _core
from .gemini import GeminiSchemaError, flatten

__all__ = [
    "SCHEMA_BASE",
    "SCHEMA_NAMES",
    "ContractIssue",
    "ContractValidationError",
    "GeminiSchemaError",
    "errors",
    "find_forbidden_word",
    "gemini_schema",
    "is_valid",
    "load_models",
    "normalize_tr",
    "schema",
    "schema_id",
    "schema_name",
    "validate",
]

SCHEMA_BASE = "https://ogrenmen.easy/schemas/"
_PACKAGE_ROOT = Path(__file__).resolve().parent
_REPO_ROOT = _PACKAGE_ROOT.parent.parent

normalize_tr = _core.normalize_tr
find_forbidden_word = _core.find_forbidden_word


def _resource_dir(name: str) -> Path:
    """Paket içindeki kaynak (``importlib.resources``); düzenlenebilir kurulumda sembolik bağ,
    bağ yoksa (ör. bağ desteklemeyen dosya sistemi) depo kökündeki asıl dosya."""
    candidate = Path(str(resources.files(__name__).joinpath(name)))
    if candidate.exists():
        return candidate
    return _REPO_ROOT / name


@lru_cache(maxsize=1)
def _documents() -> dict[str, dict]:
    schema_dir = _resource_dir("schemas")
    docs = {}
    for path in sorted(schema_dir.glob("*.schema.json")):
        docs[path.name[: -len(".schema.json")]] = json.loads(path.read_text(encoding="utf-8"))
    if not docs:
        raise FileNotFoundError(f"OGR-SCHEMA-001 şema bulunamadı: {schema_dir}")
    return docs


SCHEMA_NAMES: tuple[str, ...] = tuple(_documents().keys())


_DEF_FRAGMENT = re.compile(r"/\$defs/([A-Za-z][A-Za-z0-9_-]*)\Z")


def _parse_ref(name_or_ref: str) -> tuple[str, str | None]:
    """``(kısa ad, $defs tanımı | None)``; TS ``parseSchemaRef`` ile aynı kural:
    kısa ad, ``$id`` ya da ``<ad|$id>#/$defs/<tanım>``; başka parça ``KeyError``."""
    base, sep, fragment = name_or_ref.partition("#")
    name = base
    if name.startswith(SCHEMA_BASE):
        name = name[len(SCHEMA_BASE) :]
    if name.endswith(".schema.json"):
        name = name[: -len(".schema.json")]
    elif name.endswith(".json"):
        name = name[: -len(".json")]
    if name not in _documents():
        raise KeyError(f"OGR-SCHEMA-001 bilinmeyen sözleşme: {name_or_ref}")
    if not sep or fragment == "":
        return name, None
    m = _DEF_FRAGMENT.match(fragment)
    if m is None:
        raise KeyError(f"OGR-SCHEMA-001 desteklenmeyen parça (yalnız #/$defs/<tanım>): {name_or_ref}")
    defs = _documents()[name].get("$defs", {})
    if m.group(1) not in defs:
        raise KeyError(f"OGR-SCHEMA-001 çözülemeyen başvuru: {name_or_ref}")
    return name, m.group(1)


def schema_name(name_or_id: str) -> str:
    """Kısa adı, ``$id``'yi ya da parçalı başvuruyu kısa ada çevirir; bilinmiyorsa ``KeyError``."""
    return _parse_ref(name_or_id)[0]


def schema_id(name_or_id: str) -> str:
    """Tam ``$id`` (parçalı başvuruda ``…/<ad>.json#/$defs/<tanım>``)."""
    name, definition = _parse_ref(name_or_id)
    base = f"{SCHEMA_BASE}{name}.json"
    return base if definition is None else f"{base}#/$defs/{definition}"


def schema(name_or_id: str) -> dict:
    """Şema belgesinin derin kopyası."""
    return json.loads(json.dumps(_documents()[schema_name(name_or_id)]))


@dataclass(frozen=True)
class ContractIssue:
    """Tek doğrulama hatası (TS ``ContractIssue`` ile aynı alanlar)."""

    path: str
    keyword: str
    message: str
    params: dict[str, Any] = field(default_factory=dict)


class ContractValidationError(ValueError):
    """Sözleşmeye uymayan veri; ``issues`` tüm hataları taşır."""

    def __init__(self, schema_ref: str, issues: list[ContractIssue]):
        head = "; ".join(f"{i.path or '/'} {i.message}" for i in issues[:5])
        super().__init__(f"OGR-CONTRACT-001 {schema_ref} doğrulaması düştü ({len(issues)} hata): {head}")
        self.schema_id = schema_ref
        self.issues = issues


def _forbidden_words(validator, words, instance, _schema):
    from jsonschema import ValidationError

    hit = _core.find_forbidden_word(instance, words)
    if hit is not None:
        yield ValidationError(f"yasaklı kelime içeriyor: {hit}", validator="x-forbidden-words")


def _pattern(validator, pattern, instance, _schema):
    from jsonschema import ValidationError

    if validator.is_type(instance, "string") and not _core.js_pattern_search(pattern, instance):
        yield ValidationError(f"{instance!r} does not match {pattern!r}")


def _pattern_properties(validator, pattern_properties, instance, _schema):
    """``patternProperties`` — anahtarlar ``pattern`` gibi ECMAScript anlamıyla eşleşir
    (Python ``re.search`` ``$``'ı sondaki satır sonundan önce de eşler; Ajv eşlemez)."""
    if not validator.is_type(instance, "object"):
        return
    for pattern, subschema in pattern_properties.items():
        for key, value in instance.items():
            if _core.js_pattern_search(pattern, key):
                yield from validator.descend(value, subschema, path=key, schema_path=pattern)


def _additional_keys(instance, schema) -> list[str]:
    properties = schema.get("properties", {})
    patterns = list(schema.get("patternProperties", {}))
    return [
        key for key in instance if key not in properties and not any(_core.js_pattern_search(p, key) for p in patterns)
    ]


def _additional_properties(validator, additional, instance, schema):
    """``additionalProperties`` — ``patternProperties`` ile aynı (ECMAScript) eşleşme kuralı."""
    from jsonschema import ValidationError

    if not validator.is_type(instance, "object"):
        return
    extras = _additional_keys(instance, schema)
    if validator.is_type(additional, "object"):
        for extra in extras:
            yield from validator.descend(instance[extra], additional, path=extra)
    elif not additional and extras:
        joined = ", ".join(repr(e) for e in sorted(extras, key=str))
        yield ValidationError(f"Additional properties are not allowed ({joined} unexpected)")


@lru_cache(maxsize=1)
def _validator_class():
    from jsonschema import Draft202012Validator, validators

    return validators.extend(
        Draft202012Validator,
        {
            "x-forbidden-words": _forbidden_words,
            "pattern": _pattern,
            "patternProperties": _pattern_properties,
            "additionalProperties": _additional_properties,
        },
    )


def _used_formats(node: Any) -> set[str]:
    """Şemalarda kullanılan tüm ``format`` değerleri (şema düğümlerinde metin değerli ``format``)."""
    found: set[str] = set()
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "format" and isinstance(value, str):
                found.add(value)
            else:
                found |= _used_formats(value)
    elif isinstance(node, list):
        for item in node:
            found |= _used_formats(item)
    return found


@lru_cache(maxsize=1)
def _format_checker():
    from jsonschema import FormatChecker

    # jsonschema bilinmeyen biçimi sessizce geçer; Ajv strict ise derlemede düşer. Aynı kararı
    # vermek için şemalardaki her biçimin _core.FORMATS'ta tanımlı olması zorunludur.
    unknown = sorted(_used_formats(list(_documents().values())) - set(_core.FORMATS))
    if unknown:
        raise RuntimeError(f"OGR-SCHEMA-006 tanımsız biçim(ler): {', '.join(unknown)}")
    checker = FormatChecker(formats=())
    for fmt, fn in _core.FORMATS.items():

        def check(instance: Any, _fn=fn) -> bool:
            return not isinstance(instance, str) or _fn(instance)

        checker.checks(fmt)(check)
    return checker


@lru_cache(maxsize=1)
def _registry():
    from referencing import Registry, Resource
    from referencing.jsonschema import DRAFT202012

    resources_ = [
        (doc["$id"], Resource.from_contents(doc, default_specification=DRAFT202012)) for doc in _documents().values()
    ]
    return Registry().with_resources(resources_)


@cache
def _validator(ref_id: str):
    """``ref_id``: tam ``$id`` ya da ``$id#/$defs/<tanım>`` (``schema_id`` çıktısı). Parçalı
    başvuruda yalnız o tanım uygulanır (kökteki ``x-forbidden-words`` dahil değildir; Ajv ile aynı)."""
    cls = _validator_class()
    name = schema_name(ref_id)
    doc = _documents()[name]
    cls.check_schema(doc)
    target = doc if "#" not in ref_id else {"$ref": ref_id}
    return cls(target, registry=_registry(), format_checker=_format_checker())


def _pointer(parts) -> str:
    return "".join("/" + str(p).replace("~", "~0").replace("/", "~1") for p in parts)


def _flatten_errors(errs) -> list[ContractIssue]:
    out: list[ContractIssue] = []
    for err in errs:
        params: dict[str, Any] = {}
        if err.validator == "x-forbidden-words":
            params["word"] = _core.find_forbidden_word(err.instance, err.validator_value)
        out.append(
            ContractIssue(
                path=_pointer(err.absolute_path),
                keyword=str(err.validator),
                message=err.message,
                params=params,
            )
        )
        if err.context:
            out.extend(_flatten_errors(sorted(err.context, key=lambda e: list(e.absolute_schema_path))))
    return out


def errors(name_or_id: str, data: Any) -> list[ContractIssue]:
    """Hata listesi (iç içe ``oneOf``/``anyOf`` dal hataları dahil); geçerliyse boş."""
    validator = _validator(schema_id(name_or_id))
    found = sorted(validator.iter_errors(data), key=lambda e: (list(map(str, e.absolute_path)), e.validator))
    return _flatten_errors(found)


def is_valid(name_or_id: str, data: Any) -> bool:
    return _validator(schema_id(name_or_id)).is_valid(data)


def validate(name_or_id: str, data: Any) -> Any:
    """Doğrular ve veriyi döner; uymazsa ``ContractValidationError``."""
    issues = errors(name_or_id, data)
    if issues:
        raise ContractValidationError(schema_id(name_or_id), issues)
    return data


def gemini_schema(name_or_id: str) -> dict:
    """Gemini ``responseSchema`` (TS ``toGeminiSchema`` ve ``schemas/gemini/<ad>.json`` ile aynı)."""
    name, definition = _parse_ref(name_or_id)
    if definition is not None:
        raise KeyError(f"OGR-SCHEMA-001 Gemini şeması yalnız tam sözleşme için üretilir: {name_or_id}")
    docs = _documents()
    return flatten(docs[name], list(docs.values()))


@lru_cache(maxsize=1)
def _models_cached() -> str:
    path = _resource_dir("models.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    validate("models", data)
    return json.dumps(data)


def load_models() -> dict:
    """``models.json`` (sağlayıcı/model/fiyat/limit/zincir tablosu); şemaya karşı doğrulanmış kopya."""
    return json.loads(_models_cached())
