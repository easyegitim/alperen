"""Seed profili, analiz istemi, bağlam doğrulaması (BLUEPRINT §6.3 adım 4–5, §4.2).

* ``seed_profile``: ``profile_for_prompt(enrollment)`` RPC'si + açık yanılgılar (``id``, ``text_instructor``) +
  önceki dersin analizindeki ``next_step.for_instructor``. Her serbest metin ad hash'leriyle bir kez daha temizlenir.
* İstem: transkript (isimsiz, etiketli) + ≤ 40 kare + seed profili + müfredatın yaprak kazanımları (model yalnız bu
  id'leri kullanabilir) + yanılgı etiketi kataloğu.
* Doğrulama (``LessonContext.validator``): ``lesson-analysis`` şeması + her ``skill_id`` listede, her yanılgı etiketi
  katalogda ya da ``null``, ``previous_profile_check`` yalnız seed'deki açık yanılgılar; her alıntı (``quote``)
  transkriptte geçer ve her zaman damgası ders süresinin içindedir (kanıt yoksa iddia yok); serbest metinlerde
  yasak kelime (``tahmin/çıkacak/kesin/garanti``) ve ad tokenı yoktur. ``lesson_ref``, ``student_ref``,
  ``duration_min`` ve ``model_notes`` modelden alınmaz, boru hattı yazar (model kendi maliyetini bilemez; kimlik
  alanları ders kaydından gelir). Hata metinleri tek onarım turunda modele geri gider.
* ``previous_next_step`` yalnız onaylanmış (``approved``/``corrected``) analizden alınır: onaysız rapor bir sonraki
  isteme girmez.
"""

from __future__ import annotations

import copy
import json
import re
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import ogrenmen_contracts as contracts
from ogrenmen_common.adapters.base import LLMRequest, Media
from ogrenmen_common.clock import parse_ts
from ogrenmen_common.pii import name_leaks, role_hashes_from_labels, scrub_for_llm
from ogrenmen_common.purposes import output_errors
from ogrenmen_common.runtime import Runtime

from .errors import DersError
from .media import Frame

SCHEMA = "lesson-analysis"
PROMPT_VERSION = "lesson_analysis.v1"
MAX_TOKENS_OUT = 8192
FORBIDDEN_WORDS = ("tahmin", "çıkacak", "kesin", "garanti")
"""İlke 10: öğrenciye ya da veliye ulaşabilecek hiçbir çıktıda yer almaz."""
APPROVED_STATUSES = ("approved", "corrected")
VERBATIM_KEYS = frozenset({"evidence", "quote"})
"""Transkriptten aynen alınan alanlar: yasak kelime taraması dışında (öğrencinin sözü değiştirilemez), alıntı
denetimine tabi."""
NON_TEXT_KEYS = frozenset({"schema_version", "lesson_ref", "student_ref", "skill_id", "tag", "misconception_id",
                           "model_notes", "t", "t_end", "due", "speaker", "who", "kind", "status", "attention",
                           "morale"})
ELLIPSIS = re.compile(r"\s*(?:…|\.\.\.)\s*")

SYSTEM = (
    "Sen birebir matematik dersi kayıtlarını analiz eden bir eğitim uzmanısın. Girdi isimsizdir: konuşmacılar "
    "yalnız ÖĞRENCİ ve EĞİTMEN, adlar [ÖĞRENCİ], [EĞİTMEN] ya da [AD] olarak gizlenmiştir; ad tahmin etme, ad yazma. "
    "Yalnızca lesson-analysis JSON nesnesi döndür. Kurallar: (1) skill_id alanlarında yalnız verilen kazanım "
    "listesindeki kimlikleri kullan. (2) Her kazanım için transkriptten aynen alınmış en az bir kanıt alıntısı "
    "(konuşmacı, HH:MM:SS zaman) ver; kanıtın yoksa kazanımı yazma. (3) Yanılgı etiketi yalnız katalogdan seçilir, "
    "uymuyorsa tag null olur ve metin serbest yazılır; text_instructor üçüncü tekil, text_student sen diliyle. "
    "(4) Önceki profildeki her açık yanılgı için previous_profile_check satırı yaz (still_present, improved ya da "
    "not_observed) ve misconception_id değerini aynen kullan. (5) Ödev, söz ve teslim tarihlerini commitments "
    "içinde yaz. (6) talk alanında öğrencinin konuşma oranını, soru sayısını, dikkat ve moral göstergesini yaz; "
    "emin değilsen morale unknown olur. (7) next_step.for_student sen diliyle, kısa ve uygulanabilir olsun. "
    "(8) Yüzde, not ya da kesinlik iddiası yazma; gözlemine dayan."
)


@dataclass
class LessonContext:
    """Bir dersin analiz bağlamı (DB'den okunur; ``batch_worker`` görünümü)."""

    lesson: dict
    enrollment: dict
    student_ref: str
    skills: list[dict]
    tags: list[dict]
    open_misconceptions: list[dict] = field(default_factory=list)

    @property
    def lesson_id(self) -> str:
        return str(self.lesson["id"])

    @property
    def skill_ids(self) -> set[str]:
        return {s["id"] for s in self.skills}

    @property
    def tag_ids(self) -> set[str]:
        return {t["tag"] for t in self.tags}

    @property
    def open_ids(self) -> set[str]:
        return {str(m["id"]) for m in self.open_misconceptions}

    # --- doğrulama ------------------------------------------------------------------------------

    def normalize(self, data: Any, *, duration_min: int | None, frames: int, model_notes: Mapping[str, Any] | None
                  = None) -> Any:
        """Boru hattının sahibi olduğu alanları yazar (kimlik, süre, ``model_notes``)."""
        if not isinstance(data, Mapping):
            return data
        out = copy.deepcopy(dict(data))
        out["schema_version"] = "1.0"
        out["lesson_ref"] = self.lesson_id
        out["student_ref"] = self.student_ref
        out.pop("duration_min", None)
        if duration_min:
            out["duration_min"] = int(duration_min)
        out["model_notes"] = dict(model_notes) if model_notes is not None else {
            "model": "henüz-yok", "prompt_version": PROMPT_VERSION, "cost_usd": 0, "tokens_in": 0, "tokens_out": 0,
            "frames": frames}
        return out

    def domain_errors(self, data: Mapping[str, Any], *, transcript_text: str | None = None,
                      name_hashes: Sequence[str] = ()) -> list[str]:
        """Şemanın göremediği bağlam kuralları (``transcript_text`` verilirse alıntı denetimi de)."""
        errs: list[str] = []
        allowed = self.skill_ids

        def check_skill(path: str, value: Any, *, nullable: bool) -> None:
            if value is None and nullable:
                return
            if value not in allowed:
                errs.append(f"{path}: kazanım listede yok: {value}")

        for i, s in enumerate(data.get("skills") or []):
            check_skill(f"/skills/{i}/skill_id", s.get("skill_id"), nullable=False)
        for key in ("questions", "hesitations"):
            for i, item in enumerate(data.get(key) or []):
                check_skill(f"/{key}/{i}/skill_id", item.get("skill_id"), nullable=True)
        tags = self.tag_ids
        for i, mc in enumerate(data.get("misconceptions") or []):
            check_skill(f"/misconceptions/{i}/skill_id", mc.get("skill_id"), nullable=False)
            if mc.get("tag") is not None and mc["tag"] not in tags:
                errs.append(f"/misconceptions/{i}/tag: etiket katalogda yok: {mc['tag']}")
        open_ids = self.open_ids
        for i, f in enumerate(data.get("previous_profile_check") or []):
            if str(f.get("misconception_id")) not in open_ids:
                errs.append(f"/previous_profile_check/{i}/misconception_id: seed profilinde açık yanılgı değil")
        errs.extend(_time_errors(data, data.get("duration_min")))
        if transcript_text is not None:
            errs.extend(_quote_errors(data, transcript_text))
        for path, text in _free_texts(data):
            word = contracts.find_forbidden_word(text, list(FORBIDDEN_WORDS))
            if word is not None:
                errs.append(f"{path}: yasak kelime ({word}); gözleme dayalı, kesinlik iddiası taşımayan bir ifade yaz")
            if name_hashes and name_leaks(text, name_hashes):
                errs.append(f"{path}: ad içeriyor; ad yerine ÖĞRENCİ ya da EĞİTMEN yaz")
        return errs

    def validator(self, *, duration_min: int | None, frames: int, transcript_text: str | None = None,
                  name_hashes: Sequence[str] = ()):
        def check(data: Any) -> list[str]:
            norm = self.normalize(data, duration_min=duration_min, frames=frames)
            errs = output_errors(SCHEMA, norm)
            if not errs and isinstance(norm, Mapping):
                errs = self.domain_errors(norm, transcript_text=transcript_text, name_hashes=name_hashes)
            return errs

        return check

    def finalize(self, data: Any, *, duration_min: int | None, frames: int, model: str, cost_usd: float,
                 tokens_in: int, tokens_out: int, transcript_text: str | None = None,
                 name_hashes: Sequence[str] = ()) -> dict:
        notes = {"model": model, "prompt_version": PROMPT_VERSION, "cost_usd": round(float(cost_usd), 6),
                 "tokens_in": int(tokens_in), "tokens_out": int(tokens_out), "frames": int(frames)}
        final = self.normalize(data, duration_min=duration_min, frames=frames, model_notes=notes)
        contracts.validate(SCHEMA, final)
        errs = self.domain_errors(final, transcript_text=transcript_text, name_hashes=name_hashes)
        if errs:  # validator aynı kuralı uyguladı; buraya gelmek bir hata yolunu gösterir
            raise DersError(f"OGR-DERS-005 analiz bağlama uymuyor: {errs[0]}")
        return final


def _walk(value: Any, path: str = "", key: str | None = None) -> Iterator[tuple[str, str | None, Any]]:
    """``(yol, anahtar, değer)`` — iç içe nesne ve listelerdeki her yaprak (liste öğesi üst anahtarı taşır)."""
    if isinstance(value, Mapping):
        for k, v in value.items():
            yield from _walk(v, f"{path}/{k}", str(k))
    elif isinstance(value, list):
        for i, v in enumerate(value):
            yield from _walk(v, f"{path}/{i}", key)
    else:
        yield path, key, value


def _free_texts(data: Mapping[str, Any]) -> list[tuple[str, str]]:
    """Modelin kendi yazdığı serbest metinler (alıntılar, kimlikler ve sabit değerler hariç)."""
    out: list[tuple[str, str]] = []

    def visit(value: Any, path: str) -> None:
        if isinstance(value, str):
            out.append((path, value))
        elif isinstance(value, list):
            for i, v in enumerate(value):
                visit(v, f"{path}/{i}")
        elif isinstance(value, Mapping):
            for k, v in value.items():
                if k not in VERBATIM_KEYS and k not in NON_TEXT_KEYS:
                    visit(v, f"{path}/{k}")

    visit(data, "")
    return out


def _quotes(data: Mapping[str, Any]) -> list[tuple[str, str]]:
    """Transkriptten aynen alınmış olması gereken alıntılar: ``…/evidence/N/quote``, ``questions``/``hesitations``
    ``quote``."""
    out: list[tuple[str, str]] = []
    for path, key, value in _walk(data):
        if key == "quote" and isinstance(value, str):
            out.append((path, value))
    return out


def _fold(text: str) -> str:
    """Büyük/küçük harf ve boşluk farkı gözetmeyen karşılaştırma biçimi (Türkçe İ/ı dahil)."""
    return re.sub(r"\s+", "", contracts.normalize_tr(text))


def _quote_errors(data: Mapping[str, Any], transcript_text: str) -> list[str]:
    corpus = _fold(transcript_text)
    errs = []
    for path, quote in _quotes(data):
        parts = [_fold(p) for p in ELLIPSIS.split(quote)]
        if not any(parts) or any(p and p not in corpus for p in parts):
            errs.append(f"{path}: alıntı transkriptte yok; transkriptten aynen alıntı yap ya da iddiayı çıkar")
    return errs


def _seconds(ts: str) -> int | None:
    m = re.fullmatch(r"(\d{1,2}):(\d{2}):(\d{2})", str(ts))
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) if m else None


def _time_errors(data: Mapping[str, Any], duration_min: Any) -> list[str]:
    if not duration_min:
        return []
    limit = int(duration_min) * 60
    errs = []
    for path, key, value in _walk(data):
        if key in ("t", "t_end") and isinstance(value, str):
            sec = _seconds(value)
            if sec is not None and sec > limit:
                errs.append(f"{path}: zaman ders süresinin ({int(duration_min)} dk) dışında")
    return errs


def load_context(rt: Runtime, lesson: Mapping[str, Any]) -> LessonContext:
    db = rt.db
    enr = db.select("enrollments", where={"id": lesson["enrollment_id"]}, limit=1)
    if not enr:
        raise DersError("OGR-DERS-002 dersin kaydı (enrollment) bulunamadı")
    enrollment = enr[0]
    stu = db.select("students", where={"id": enrollment["student_id"]}, columns=("id", "public_ref", "status"),
                    limit=1)
    if not stu or stu[0].get("status") == "deleted":
        raise DersError("OGR-DERS-002 dersin öğrencisi yok ya da silinmiş")
    skills = [{"id": s["id"], "name": s["name"]} for s in db.select(
        "skills", where={"curriculum_id": enrollment["curriculum_id"], "is_leaf": True}, order="order_no")]
    tags = [{"tag": t["tag"], "skill_id": t.get("skill_id"), "text_instructor": t["text_instructor"]}
            for t in db.select("misconception_tags", order="tag")]
    open_mis = [{"id": str(m["id"]), "skill_id": m["skill_id"], "tag": m.get("tag"),
                 "text_instructor": m["text_instructor"]}
                for m in db.select("misconceptions", where={"enrollment_id": enrollment["id"], "status": "open"},
                                   order="first_seen")]
    return LessonContext(lesson=dict(lesson), enrollment=dict(enrollment), student_ref=str(stu[0]["public_ref"]),
                         skills=skills, tags=tags, open_misconceptions=open_mis)


def previous_next_step(rt: Runtime, ctx: LessonContext) -> str | None:
    """Aynı kayıttaki bir önceki dersin (bu dersten önce yapılmış) en son **onaylı** analizinden ``for_instructor``.

    Taslak (``draft``) ya da reddedilmiş analiz kullanılmaz: eğitmenin görmediği model metni bir sonraki isteme
    girmez. Zamanlar ``parse_ts`` ile karşılaştırılır (``Z`` ve ``+00:00`` biçimleri karışık olabilir)."""
    db = rt.db
    if not ctx.lesson.get("held_at"):
        return None
    held = parse_ts(str(ctx.lesson["held_at"]))
    earlier = [x for x in db.select("lessons", where={"enrollment_id": ctx.enrollment["id"]})
               if str(x["id"]) != ctx.lesson_id and x.get("held_at") and parse_ts(str(x["held_at"])) < held]
    earlier.sort(key=lambda x: parse_ts(str(x["held_at"])), reverse=True)
    for lesson in earlier:
        rows = [a for a in db.select("lesson_analyses", where={"lesson_id": lesson["id"]})
                if a.get("status") in APPROVED_STATUSES]
        rows.sort(key=lambda a: int(a.get("version") or 1), reverse=True)
        for row in rows:
            text = ((row.get("analysis") or {}).get("next_step") or {}).get("for_instructor")
            if text:
                return str(text)
    return None


def _scrub_tree(value: Any, name_hashes: Sequence[str], roles: Mapping[str, str]) -> Any:
    if isinstance(value, str):
        return scrub_for_llm(value, name_hashes, roles).text
    if isinstance(value, list):
        return [_scrub_tree(v, name_hashes, roles) for v in value]
    if isinstance(value, Mapping):
        return {k: (v if k in ("id", "skill_id", "tag", "band", "misconception_id") else
                    _scrub_tree(v, name_hashes, roles)) for k, v in value.items()}
    return value


def build_seed_profile(rt: Runtime, ctx: LessonContext, *, labels: Sequence[Mapping[str, Any]],
                       name_hashes: Sequence[str]) -> dict:
    profile = rt.db.rpc("profile_for_prompt", {"p_enrollment": ctx.enrollment["id"]}) or {}
    seed = {
        "profile": dict(profile),
        "open_misconceptions": [{"id": m["id"], "skill_id": m["skill_id"], "tag": m["tag"],
                                 "text_instructor": m["text_instructor"]} for m in ctx.open_misconceptions],
        "previous_next_step": previous_next_step(rt, ctx),
    }
    return _scrub_tree(seed, name_hashes, role_hashes_from_labels(labels))


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def build_request(ctx: LessonContext, *, transcript_text: str, seed_profile: Mapping[str, Any],
                  frames: Sequence[Frame], duration_min: int | None, fixture_hint: str | None = None) -> LLMRequest:
    frame_lines = [f"Kare {i + 1}: {f.hms}" if f.score is not None or f.t_sec else f"Kare {i + 1}"
                   for i, f in enumerate(frames)]
    lesson_meta = {"lesson_ref": ctx.lesson_id, "student_ref": ctx.student_ref, "duration_min": duration_min,
                   "frames": len(frames)}
    prompt = "\n\n".join([
        f"Ders bilgisi: {_json(lesson_meta)}",
        f"Önceki profil (seed_profile): {_json(seed_profile)}",
        f"Kazanım listesi (yalnız bu skill_id değerleri): {_json(ctx.skills)}",
        f"Yanılgı etiketi kataloğu: {_json(ctx.tags)}",
        "Slayt kareleri (ekler, sırayla):\n" + ("\n".join(frame_lines) if frame_lines else "kare yok"),
        "Transkript:\n" + transcript_text,
    ])
    media = tuple(Media(f.path.read_bytes(), f.mime, f"kare-{i + 1:02d}{f.path.suffix.lower()}")
                  for i, f in enumerate(frames))
    return LLMRequest(purpose="lesson_analysis", model="", system=SYSTEM, prompt=prompt, schema_id=SCHEMA,
                      media=media, max_tokens=MAX_TOKENS_OUT, temperature=0.2, timeout_s=600.0,
                      fixture_hint=fixture_hint)
