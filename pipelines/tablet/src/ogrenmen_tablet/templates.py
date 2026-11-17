"""Parametrik şablonların yüklenmesi ve varyant üretimi (BLUEPRINT §6.1, §10.4; sıfır LLM).

Şablonlar ``content/tyt-matematik/templates/*.py`` dosyalarıdır (M03'ün malı; burada yalnız okunur).
İçerik dizini bir Python paketi olarak kurulmaz: ``templates/__init__.py`` dosya yolundan yüklenir ve
şablon kimliği → modül eşlemesi (``TEMPLATE_FILES``) oradan gelir. Veritabanındaki ``module_path`` değeri
yalnız karşılaştırılır; kod, kayıt dışı bir yoldan yüklenmez.

Her varyant:

* ``item`` — ``question-item`` şemasına karşı doğrulanmış soru maddesi; cevap anahtarı alanı **taşımaz**;
* ``key`` — ``answer-key`` şemasına karşı doğrulanmış anahtar (SymPy ile hesaplanmış, ``sympy_status='verified'``);
  dosyaya yalnız ``--dump-keys`` ile (test) yazılır, RPC'ye ``p_key`` olarak gider;
* ``figure`` — şekilli şablonlarda ``FigureSpec`` (deterministik: aynı parametre → aynı PNG).
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import math
import random
import sys
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Any

import ogrenmen_contracts as contracts
from ogrenmen_common.errors import OgrError
from ogrenmen_common.paths import repo_root

KEY_FIELDS = ("correct_option", "numeric_value", "numeric_tolerance", "canonical_expr", "solution", "sympy_status",
              "sympy_report")
"""Cevap anahtarına ait alan adları: soru maddesinde (ve ``questions.jsonl``'de) hiçbiri bulunmaz."""

FIGURE_BUCKET = "figures"
"""Supabase Storage kovası (0017_storage.sql: herkese açık okuma, yalnız batch_worker yazar)."""

ATTEMPTS_PER_VARIANT = 25
"""Farklı varyant ararken istenen her varyant için en çok bu kadar ``generate`` çağrısı yapılır (``fill`` de
aynı sabiti kullanır)."""

FIGURE_PX_BOUNDS = {"min_w": 200, "max_w": 1600, "min_h": 150, "max_h": 1600}
"""§6.1 boyut denetimi (``expected_px`` alanı eksikse bu sınırlar kullanılır)."""

TEMPLATE_FIGURE_MIN_BYTES = 2 * 1024
"""Şablon şekli bayt tabanı. §6.1'in 5 KB tabanı LLM'in yazdığı şekil kodunun boş/bozuk çıktısını yakalamak içindir;
şablon şekilleri düz renkli, deterministik çizimlerdir ve PNG olarak çok iyi sıkışır (``kesir-modeli-toplama``
≈ 4,6 KB). Boş görüntüyü bayt tabanı değil piksel varyansı denetimi (``FIGURE_MIN_PIXEL_STD``) yakalar."""

FIGURE_MAX_BYTES = 2 * 1024 * 1024
"""§6.1 bayt tavanı (2 MB)."""

FIGURE_MIN_PIXEL_STD = 0.01
"""Piksel değerlerinin (0–1 ölçeğinde) standart sapması bunun altındaysa görüntü boş sayılır (§6.1)."""

ANSWER_PARAM_NAMES = frozenset({"cozum", "cevap", "sonuc", "yanit", "dogru", "dogru_cevap"})
"""Adından cevap/çözüm değeri taşıdığı anlaşılan şablon parametreleri: ``template.params``'tan çıkarılır
(``questions.template_params`` herkese açık şemadadır; değer yalnız ``secure.answer_keys``'te durur)."""


class TemplateError(OgrError):
    """Şablon yüklenemedi, varyant şemaya uymadı ya da yeterli farklı varyant çıkmadı."""


def templates_dir() -> Path:
    """Şablon dizini: ``<depo>/content/tyt-matematik/templates`` (kayıt dışı yoldan kod yüklenmez)."""
    return repo_root() / "content" / "tyt-matematik" / "templates"


@lru_cache(maxsize=4)
def _registry_for(path: str) -> ModuleType:
    folder = Path(path)
    init = folder / "__init__.py"
    if not init.is_file():
        raise TemplateError(f"OGR-TPL-002 şablon dizini bulunamadı: {folder}")
    # modül adı dizinden türetilir: aynı süreçte iki farklı dizin birbirinin kaydını ezmez
    name = "ogrenmen_tablet_content_templates_" + hashlib.sha256(str(folder.resolve()).encode()).hexdigest()[:12]
    spec = importlib.util.spec_from_file_location(name, init, submodule_search_locations=[str(folder)])
    if spec is None or spec.loader is None:
        raise TemplateError(f"OGR-TPL-002 şablon kaydı yüklenemedi: {init}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def registry() -> ModuleType:
    """İçerik şablon kaydı (``content/tyt-matematik/templates/__init__.py``)."""
    return _registry_for(str(templates_dir()))


@lru_cache(maxsize=4)
def _common_for(path: str) -> ModuleType:
    return registry().load_file(Path(path) / "_common.py")


def common() -> ModuleType:
    """Şablonların ortak yardımcıları (``_common.py``: ``content_hash``, ``FigureSpec``)."""
    return _common_for(str(templates_dir()))


def template_ids() -> list[str]:
    return list(registry().TEMPLATE_FILES)


def load_template(template_id: str) -> ModuleType:
    reg = registry()
    if template_id not in reg.TEMPLATE_FILES:
        known = ", ".join(reg.TEMPLATE_FILES)
        raise TemplateError(f"OGR-TPL-002 bilinmeyen şablon: {template_id} (bilinenler: {known})")
    return reg.load(template_id)


def module_path(template_id: str) -> str:
    """``question_templates.module_path`` için beklenen değer."""
    return registry().module_path(template_id)


def content_hash(stem: str, options: list[dict[str, Any]] | None) -> str:
    """``questions.content_hash`` (fixtures/db ve teşhis seed'iyle aynı normalleştirme)."""
    return common().content_hash(stem, options)


def check_option_rule(item: dict[str, Any]) -> None:
    """§10.3 şık kuralı (JSON Schema ile ifade edilemez): mcq'da tam 4 şık, en az 2 etiketsiz şık."""
    if item.get("kind") != "mcq":
        return
    options = item.get("options") or []
    nulls = sum(1 for o in options if o.get("misconception_tag") is None)
    if len(options) != 4 or nulls < 2:
        raise TemplateError(f"OGR-Q-002 şık kuralı: 4 şık ve en az 2 etiketsiz şık gerekir ({len(options)} şık, "
                            f"{nulls} etiketsiz)")


def check_no_key_fields(item: dict[str, Any]) -> None:
    """Soru maddesi cevap anahtarı alanı taşımaz (§4.1; ilke 7)."""
    text = json.dumps(item, ensure_ascii=False)
    leaked = [k for k in KEY_FIELDS if f'"{k}"' in text]
    if leaked:
        raise TemplateError(f"OGR-CONTRACT-001 soru maddesinde cevap anahtarı alanı var: {', '.join(leaked)}")


def answer_value(key: dict[str, Any]) -> Any | None:
    """Anahtarın sayısal değeri (``canonical_expr`` ya da ``numeric_value``); sayı değilse (ör. aralık) ``None``."""
    import sympy

    candidates: list[Any] = []
    if key.get("canonical_expr"):
        try:
            candidates.append(common().sympify_expr(key["canonical_expr"]))
        except Exception:  # noqa: BLE001 - ayrıştırılamayan ifade sızıntı denetimini atlatmaz, yalnız değer yok
            pass
    if key.get("numeric_value") is not None:
        try:
            candidates.append(sympy.sympify(str(key["numeric_value"]).replace(",", ".")))
        except (sympy.SympifyError, TypeError, ValueError):
            pass
    for value in candidates:
        if getattr(value, "is_number", False) and value.is_real and value.is_finite:
            return value
    return None


def _equals_answer(value: Any, answer: Any | None) -> bool:
    if answer is None or isinstance(value, bool) or not isinstance(value, int | float):
        return False
    return math.isclose(float(value), float(answer), rel_tol=0.0, abs_tol=1e-9)


def _contains_answer(value: Any, answer: Any | None) -> bool:
    if isinstance(value, list | tuple):
        return any(_contains_answer(v, answer) for v in value)
    if isinstance(value, dict):
        return any(_contains_answer(v, answer) for v in value.values())
    return _equals_answer(value, answer)


def _strip_params(params: dict[str, Any], answer: Any | None, prefix: str, dropped: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name, value in params.items():
        path = f"{prefix}{name}"
        if name in ANSWER_PARAM_NAMES or _equals_answer(value, answer):
            dropped.append(path)
        elif isinstance(value, dict):
            out[name] = _strip_params(value, answer, f"{path}.", dropped)
        elif isinstance(value, list | tuple) and _contains_answer(value, answer):
            dropped.append(path)  # listeden eleman silmek anlamı bozar; listenin tamamı çıkarılır
        else:
            out[name] = value
    return out


def strip_answer_params(item: dict[str, Any], key: dict[str, Any]) -> list[str]:
    """``item.template.params``'tan cevap değerini taşıyan parametreleri çıkarır; çıkarılan yolları döner.

    ``questions.template_params`` herkese açık şemadadır (``bot_runtime``/``batch_worker`` okur): cevap değeri ya da
    adı çözüm olan parametre (``ANSWER_PARAM_NAMES``) orada durmaz. ``content_hash`` gövde + şıklardan hesaplandığı
    için değişmez; ``template_params`` yalnız izlenebilirlik içindir.
    """
    template = item.get("template") or {}
    params = template.get("params")
    if not isinstance(params, dict):
        return []
    dropped: list[str] = []
    template["params"] = _strip_params(params, answer_value(key), "", dropped)
    return dropped


def check_no_answer_params(item: dict[str, Any], key: dict[str, Any]) -> None:
    """Son denetim: ``template.params``'ta cevap değeri ya da çözüm adlı parametre kalmamış olmalı."""
    params = (item.get("template") or {}).get("params") or {}
    answer = answer_value(key)

    def walk(node: Any, path: str) -> None:
        if isinstance(node, dict):
            for name, value in node.items():
                if name in ANSWER_PARAM_NAMES:
                    raise TemplateError(f"OGR-CONTRACT-001 template.params cevap parametresi taşıyor: {path}{name}")
                walk(value, f"{path}{name}.")
        elif isinstance(node, list | tuple):
            for i, value in enumerate(node):
                walk(value, f"{path}{i}.")
        elif _equals_answer(node, answer):
            raise TemplateError(f"OGR-CONTRACT-001 template.params cevap değerini taşıyor: {path.rstrip('.')}")

    walk(params, "")


def check_figure_render(info: dict[str, Any], expected_px: dict[str, int] | None, png: Path) -> str | None:
    """§6.1 boyut denetimi; sorun yoksa ``None``, varsa Türkçe açıklama.

    Genişlik/yükseklik ``figure.expected_px`` (yoksa ``FIGURE_PX_BOUNDS``) içinde, bayt
    ``TEMPLATE_FIGURE_MIN_BYTES``–``FIGURE_MAX_BYTES`` arasında olmalı; piksel varyansı ≈ 0 olan (boş) görüntü
    reddedilir.
    """
    bounds = {**FIGURE_PX_BOUNDS, **(expected_px or {})}
    w, h, size = info["width_px"], info["height_px"], info["bytes"]
    if not (bounds["min_w"] <= w <= bounds["max_w"] and bounds["min_h"] <= h <= bounds["max_h"]):
        return (f"boyut {w}x{h} px beklenen aralıkta değil (genişlik {bounds['min_w']}–{bounds['max_w']}, "
                f"yükseklik {bounds['min_h']}–{bounds['max_h']})")
    if not (TEMPLATE_FIGURE_MIN_BYTES <= size <= FIGURE_MAX_BYTES):
        return f"dosya {size} bayt; {TEMPLATE_FIGURE_MIN_BYTES}–{FIGURE_MAX_BYTES} bayt arasında olmalı"
    import numpy as np
    from matplotlib import image as mpimg

    pixels = np.asarray(mpimg.imread(png), dtype=float)
    channels = pixels.reshape(-1, pixels.shape[2]) if pixels.ndim == 3 else pixels.reshape(-1, 1)
    # kanal başına uzamsal sapma: sabit alfa kanalı ile sabit renk farkı "varyans" sayılmaz
    if float(channels.std(axis=0).max()) < FIGURE_MIN_PIXEL_STD:
        return "görüntü boş (piksel varyansı ≈ 0)"
    return None


def _validate(schema_id: str, data: dict[str, Any], label: str) -> None:
    problems = contracts.errors(schema_id, data)
    if problems:
        first = "; ".join(f"{p.path or '/'}: {p.message}" for p in problems[:3])
        raise TemplateError(f"OGR-CONTRACT-001 {label} {schema_id} şemasına uymuyor: {first}")


@dataclass
class Variant:
    """Bir şablon varyantı: anahtarsız madde, SymPy anahtarı, isteğe bağlı şekil."""

    template_id: str
    skill_id: str
    index: int
    item: dict[str, Any]
    key: dict[str, Any]
    figure: Any | None = None
    content_hash: str = ""
    render_info: dict[str, Any] | None = field(default=None, repr=False)
    dropped_params: list[str] = field(default_factory=list)
    """``template.params``'tan cevap değeri taşıdığı için çıkarılan parametre yolları (``strip_answer_params``)."""

    @property
    def png_name(self) -> str | None:
        return f"{self.figure.code_hash}.png" if self.figure is not None else None

    @property
    def storage_path(self) -> str | None:
        """``figures.png_path`` değeri: ``figures/<code_hash>.png`` (panel ``figures/`` önekini soyar).

        Sapma: §3.4 sütun yorumu ``figures/<id>.png`` der; ``figures.id`` yalnız ``register_template_question``
        içinde doğar ve RPC şekli ``on conflict (code_hash)`` ile tekilleştirir. Bu yüzden nesne adı içerik
        adreslidir (aynı kod → aynı bayt → tek nesne; bkz. README "Sapma notu").
        """
        return f"{FIGURE_BUCKET}/{self.png_name}" if self.figure is not None else None

    def render(self, figures_dir: Path) -> dict[str, Any] | None:
        """Şekli ``figures_dir/<code_hash>.png``'ye çizer, §6.1 boyut denetimini yapar, maddeye ``figure.render``
        bilgisini işler. Boyut/bayt dışı ya da boş görüntü → ``verification.render='size_mismatch'`` ve
        ``OGR-TPL-005``."""
        if self.figure is None:
            return None
        png = Path(figures_dir) / self.png_name
        info = self.figure.render(png)
        problem = check_figure_render(info, (self.item.get("figure") or {}).get("expected_px"), png)
        if problem is not None:
            self.item["verification"]["render"] = "size_mismatch"
            raise TemplateError(f"OGR-TPL-005 {self.template_id}: şekil denetimi geçmedi ({self.png_name}): {problem}")
        self.render_info = info
        self.item["figure"]["render"] = {
            "status": "rendered",
            "png_path": self.storage_path,
            "width_px": info["width_px"],
            "height_px": info["height_px"],
            "bytes": info["bytes"],
            "vision": "not_applicable",
            "attempts": 0,
        }
        self.item["verification"]["render"] = "ok"
        _validate("question-item", self.item, f"{self.template_id} varyantı (çizim sonrası)")
        return info

    def p_item(self) -> dict[str, Any]:
        """``register_template_question`` ``p_item``: madde + ``content_hash`` (anahtar alanı yok)."""
        payload = copy.deepcopy(self.item)
        payload["content_hash"] = self.content_hash
        return payload

    def p_key(self) -> dict[str, Any]:
        """``p_key``: SymPy anahtarı; ``question_id`` RPC'de üretilir, gönderilmez."""
        return {k: copy.deepcopy(v) for k, v in self.key.items() if k != "question_id"}

    def p_figure(self) -> dict[str, Any] | None:
        """``p_figure``: şekil kodu, ``code_hash``, alt metin, PNG yolu ve boyutları (önce ``render``)."""
        if self.figure is None:
            return None
        if self.render_info is None:
            raise TemplateError(f"OGR-TPL-005 {self.template_id}: şekil çizilmeden p_figure kurulamaz")
        return self.figure.rpc_payload(self.render_info, png_path=self.storage_path)

    def rpc_params(self) -> dict[str, Any]:
        return {"p_item": self.p_item(), "p_key": self.p_key(), "p_figure": self.p_figure()}

    def key_record(self) -> dict[str, Any]:
        """``--dump-keys`` satırı (yalnız test/dry-run)."""
        return {"template_id": self.template_id, "content_hash": self.content_hash, **copy.deepcopy(self.key)}


def make_variant(module: ModuleType, rng: random.Random, index: int) -> Variant:
    """Şablonun ``generate(rng)`` çağrısını doğrulanmış bir ``Variant``'a çevirir."""
    item, key, figure = module.generate(rng)
    tid = module.TEMPLATE_ID
    if item.get("source") != "template" or (item.get("template") or {}).get("id") != tid:
        raise TemplateError(f"OGR-TPL-001 {tid}: madde source=template ve template.id={tid} taşımalı")
    if key.get("sympy_status") != "verified":
        raise TemplateError(f"OGR-TPL-003 {tid}: şablon anahtarı SymPy ile doğrulanmış olmalı")
    if (figure is None) == bool(getattr(module, "HAS_FIGURE", False)):
        raise TemplateError(f"OGR-TPL-005 {tid}: şekil beklentisi (HAS_FIGURE) ile üretim uyuşmuyor")
    dropped = strip_answer_params(item, key)
    _validate("question-item", item, f"{tid} varyantı")
    _validate("answer-key", key, f"{tid} anahtarı")
    check_option_rule(item)
    check_no_key_fields(item)
    check_no_answer_params(item, key)
    return Variant(template_id=tid, skill_id=module.SKILL_ID, index=index, item=item, key=key, figure=figure,
                   content_hash=content_hash(item["stem"], item.get("options")), dropped_params=dropped)


@lru_cache(maxsize=16)
def covered_skills(template_id: str, sample: int = 40) -> frozenset[str]:
    """Şablonun ürettiği maddelerin taşıdığı kazanımlar (``SKILL_ID`` + deterministik örneklemdeki ``skill_ids``).

    §10.4 bazı şablonları iki kazanıma bağlar (ör. ``sayi-dogrusu-esitsizlik``: ``cebir.esitsizlik`` /
    ``mutlak-deger``); ``question_templates.skill_id`` bu kümedeyse tutarlıdır.
    """
    module = load_template(template_id)
    skills = {module.SKILL_ID}
    rng = random.Random(f"covered-skills:{template_id}")
    for _ in range(sample):
        item, _key, _figure = module.generate(rng)
        skills.update(item.get("skill_ids") or ())
    return frozenset(skills)


def iter_variants(template_id: str, rng: random.Random, *, max_attempts: int):
    """Aynı ``rng``'den ardışık varyantlar (en çok ``max_attempts`` tane; tekrarlar çağırana bırakılır)."""
    module = load_template(template_id)
    for index in range(max_attempts):
        yield make_variant(module, rng, index)


def generate_variants(template_id: str, count: int, seed: int, *, skip_hashes: set[str] | None = None) -> list[Variant]:
    """``count`` farklı varyant (``content_hash``'e göre tekrarsız); aynı ``seed`` → aynı liste.

    ``skip_hashes`` içindeki hash'ler (ör. veritabanında zaten olanlar) atlanır. Yeterli farklı varyant
    çıkmazsa ``TemplateError``.
    """
    if count < 1:
        raise TemplateError("OGR-TPL-006 --count en az 1 olmalı")
    seen = set(skip_hashes or ())
    out: list[Variant] = []
    rng = random.Random(seed)
    for variant in iter_variants(template_id, rng, max_attempts=max(50, count * ATTEMPTS_PER_VARIANT)):
        if variant.content_hash in seen:
            continue
        seen.add(variant.content_hash)
        out.append(variant)
        if len(out) == count:
            return out
    raise TemplateError(f"OGR-TPL-006 {template_id}: {count} farklı varyant üretilemedi ({len(out)} bulundu)")
