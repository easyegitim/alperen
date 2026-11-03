"""Gemini ``responseSchema`` düzleştirmesi — yalnız ``pipelines/common`` Gemini bağdaştırıcıları için anında yapılır.

TS karşılığı ve commit edilen ``schemas/gemini/*.json`` kopyaları yoktur; ``tests/test_gemini.py`` kuralları sınar.
"""

from __future__ import annotations

import copy
from typing import Any
from urllib.parse import unquote, urljoin

COPY_KEYS = frozenset(
    {
        "type",
        "title",
        "description",
        "enum",
        "minimum",
        "maximum",
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "minProperties",
        "maxProperties",
        "pattern",
        "required",
    }
)
KEPT_FORMATS = frozenset({"enum", "date-time"})
SHAPE_KEYS = ("type", "enum", "properties", "items", "anyOf", "nullable")


class GeminiSchemaError(ValueError):
    """Düzleştirilemeyen şema (çözülemeyen ya da döngüsel $ref)."""


def _decode_pointer(fragment: str) -> list[str]:
    if fragment == "":
        return []
    if not fragment.startswith("/"):
        raise GeminiSchemaError(f"OGR-SCHEMA-002 desteklenmeyen $ref parçası: #{fragment}")
    return [unquote(p).replace("~1", "/").replace("~0", "~") for p in fragment[1:].split("/")]


def _resolve_ref(ref: str, base: str, docs: dict[str, dict]) -> tuple[Any, str, str]:
    absolute = urljoin(base, ref)
    doc_url, _, fragment = absolute.partition("#")
    doc = docs.get(doc_url)
    if doc is None:
        raise GeminiSchemaError(f"OGR-SCHEMA-002 çözülemeyen $ref: {ref} (taban {base})")
    node: Any = doc
    for part in _decode_pointer(fragment):
        if isinstance(node, list):
            node = node[int(part)]
        elif isinstance(node, dict) and part in node:
            node = node[part]
        else:
            raise GeminiSchemaError(f"OGR-SCHEMA-002 çözülemeyen $ref: {ref}")
    return node, doc_url, f"{doc_url}#{fragment}"


def _infer_enum_type(values: list) -> str | None:
    if not values:
        return None
    if all(isinstance(v, str) for v in values):
        return "string"
    if all(isinstance(v, bool) for v in values):
        return "boolean"
    if all(isinstance(v, int) and not isinstance(v, bool) for v in values):
        return "integer"
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values):
        return "number"
    return None


def _is_shape(node: dict) -> bool:
    return any(k in node for k in SHAPE_KEYS)


def _clean(node: Any, base: str, stack: list[str], docs: dict[str, dict]) -> Any:
    if isinstance(node, list):
        return [_clean(x, base, stack, docs) for x in node]
    if not isinstance(node, dict):
        return node

    if isinstance(node.get("$ref"), str):
        target, target_base, key = _resolve_ref(node["$ref"], base, docs)
        if key in stack:
            raise GeminiSchemaError("OGR-SCHEMA-003 döngüsel $ref: " + " → ".join([*stack, key]))
        resolved = _clean(target, target_base, [*stack, key], docs)
        siblings = {k: v for k, v in node.items() if k != "$ref"}
        cleaned_siblings = _clean(siblings, base, stack, docs)
        return {**resolved, **cleaned_siblings}

    out: dict[str, Any] = {}
    nullable = False
    branches: list | None = None

    for key, value in node.items():
        if key == "const":
            out["enum"] = [value]
        elif key == "format":
            if isinstance(value, str) and value in KEPT_FORMATS:
                out["format"] = value
        elif key == "properties" and isinstance(value, dict):
            out["properties"] = {pk: _clean(pv, base, stack, docs) for pk, pv in value.items()}
            out["propertyOrdering"] = list(value.keys())
        elif key == "items":
            out["items"] = _clean(value, base, stack, docs)
        elif key in ("oneOf", "anyOf"):
            branches = [*(branches or []), *[_clean(b, base, stack, docs) for b in value]]
        elif key in COPY_KEYS:
            out[key] = copy.deepcopy(value)
        # Diğer anahtarlar (x-*, $id, $schema, $defs, examples, additionalProperties, allOf,
        # if/then/else, not, contains, exclusiveMinimum, …) bilerek atılır.

    if isinstance(out.get("type"), list):
        types = [t for t in out["type"] if t != "null"]
        if len(types) != len(out["type"]):
            nullable = True
        if len(types) == 1:
            out["type"] = types[0]
        else:
            del out["type"]
            branches = [*({"type": t} for t in types), *(branches or [])]
    elif out.get("type") == "null":
        del out["type"]
        nullable = True

    if isinstance(out.get("enum"), list):
        values = [v for v in out["enum"] if v is not None]
        if len(values) != len(out["enum"]):
            nullable = True
        out["enum"] = values
        if "type" not in out:
            inferred = _infer_enum_type(values)
            if inferred is not None:
                out["type"] = inferred

    if branches is not None:
        kept: list[dict] = []
        for b in branches:
            if not isinstance(b, dict):
                continue
            if len(b) == 1 and b.get("nullable") is True:
                nullable = True
                continue
            if not _is_shape(b):
                continue
            if b.get("nullable") is True:
                nullable = True
                kept.append({k: v for k, v in b.items() if k != "nullable"})
            else:
                kept.append(b)
        if len(kept) == 1:
            merged = dict(kept[0])
            for k, v in out.items():
                merged[k] = v
            out = merged
        elif len(kept) > 1:
            out["anyOf"] = kept

    if nullable:
        out["nullable"] = True
    return out


def flatten(schema: dict, all_docs: list[dict]) -> dict:
    """Tek bir sözleşme belgesini (``all_docs`` içindeki başvurularla) Gemini biçimine çevirir."""
    if "type" not in schema:
        raise GeminiSchemaError(f"OGR-SCHEMA-004 {schema.get('$id')} yalnız ortak tanım taşır; Gemini şeması üretilmez")
    docs = {str(d["$id"]): d for d in all_docs}
    return _clean(schema, str(schema["$id"]), [], docs)
