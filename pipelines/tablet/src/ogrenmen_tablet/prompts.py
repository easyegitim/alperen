"""Soru üretimi ve şekil düzeltme istemleri (zincir ``question_gen``; BLUEPRINT §6.1 (3)).

İstemlere giren her metin ``ogrenmen_common.pii.scrub_for_llm``'den geçer (§9.1). İstem yalnız meta taşır:
kazanım kimliği/adı, zorluk bandı, soru türü, yanılgı etiketleri, ``exam_variant`` için küme **konusu** ve
**puanı**, ``regenerate`` için eğitmen notu, en çok 3 ders notu parçası (≤ 600 token) ve 1 onaylı açıklama.
Sınav arşivinin ham soru metni (``exam_items.ocr_text``) hiçbir yoldan okunmaz ve istemde bulunmaz.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from ogrenmen_common.pii import scrub_for_llm

PROMPT_VERSION = "question_gen.v1"

BAND_RANGES = {"easy": (0.15, 0.4), "mid": (0.4, 0.7), "hard": (0.7, 0.9)}

SYSTEM_PROMPT = "\n".join((
    "Sen Öğrenmen'in soru yazarı yardımcısısın. TYT Matematik için Türkçe, tek doğru cevaplı bir "
    'soru yaz.',
    'Yalnızca question-generation JSON nesnesi döndür: {"schema_version": "1.0", "item": '
    'QuestionItem, "key": AnswerKey}.',
    'Kurallar:',
    '- item.source "llm", item.schema_version "1.0", item.curriculum_code istemdeki müfredat kodu, '
    'item.skill_ids hedef kazanımı içerir.',
    '- Çoktan seçmeli soruda tam 4 şık (A, B, C, D). Doğru şıkkın misconception_tag değeri null; en '
    'az bir çeldirici de null; diğer çeldiriciler istemdeki yanılgı etiketlerinden birini taşır.',
    '- Doğru cevap item içinde hiçbir alanda geçmez; yalnız key.correct_option (çoktan seçmeli) ya '
    'da key.numeric_value (sayısal) taşır.',
    '- key.canonical_expr SymPy ile hesaplanabilir bir ifadedir (Rational(5,6) - Rational(1,4) '
    'gibi); stem_values adlarını kullanabilir.',
    '- Formüller düz metinde ve `kod` biçiminde yazılır: `3/4 + 1/8`. Ondalıkta virgül kullanılır. '
    'Emoji ve ünlem yok.',
    '- Kişi adı, okul adı, telefon ya da e-posta yazma; öğrenciye "sen" diye hitap et.',
    '- Şekil gerekiyorsa item.figure.tool "matplotlib" olsun; kod yalnız matplotlib, numpy ve math '
    'içe alır, dosya okumaz, ağa çıkmaz ve şekli çalışma dizinine fig.savefig("figure.png") ile '
    'kaydeder. Zemin #f6f8fc, çizgi #051c60, vurgu #0030a2; boyut 800x400 piksel civarı. alt_text '
    'şekli kelimelerle anlatır, stem_values şekildeki sayıları taşır.',
    '- key.solution adım adım ve kısa çözümdür.',
))

FIX_SYSTEM_PROMPT = "\n".join((
    "Sen Öğrenmen'in şekil düzeltme yardımcısısın. Verilen sorunun şekil kodu soru kökündeki "
    'değerlerle uyuşmuyor.',
    'Aynı soruyu, yalnız item.figure.code düzeltilmiş olarak question-generation JSON nesnesi '
    'biçiminde döndür.',
    'Kod yalnız matplotlib, numpy ve math içe alır, dosya okumaz, ağa çıkmaz ve '
    'fig.savefig("figure.png") ile kaydeder.',
))


def scrub(text: str) -> str:
    """İsteme giden metin: PII temizliği (ad hash'i yok; kalıplar: e-posta, telefon, TCKN, URL, okul, sınıf…)."""
    return scrub_for_llm(text, []).text


def _clip(text: str, limit: int) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def generation_prompt(*, curriculum_code: str, skill: Mapping[str, Any], band: str, question_kind: str | None,
                      tags: Sequence[Mapping[str, Any]], topic: str | None = None, points: float | None = None,
                      review_notes: Iterable[str] = (), library: Sequence[Mapping[str, Any]] = (),
                      pool_example: str | None = None, avoid_stems: Sequence[str] = (), slot: int = 1,
                      slots: int = 1, feedback: str | None = None) -> str:
    """Tek hedef için üretim istemi (temizlenmiş)."""
    lo, hi = BAND_RANGES.get(band, BAND_RANGES["mid"])
    lines = [
        f"Müfredat kodu: {curriculum_code}",
        f"Hedef kazanım: {skill['id']} — {skill.get('name', '')}",
    ]
    if skill.get("description"):
        lines.append(f"Kazanım açıklaması: {_clip(skill['description'], 300)}")
    lines.append(f"Zorluk bandı: {band} (difficulty {lo:.2f}–{hi:.2f})")
    lines.append("Soru türü: " + {"mcq": "çoktan seçmeli (mcq)", "numeric": "sayısal cevaplı (numeric)"}.get(
        question_kind or "", "çoktan seçmeli (mcq) tercih edilir; gerekirse sayısal (numeric)"))
    if tags:
        lines.append("Kullanılabilir yanılgı etiketleri (çeldiriciler için):")
        lines.extend(f"- {t['tag']}: {_clip(t.get('text_instructor', ''), 160)}" for t in tags)
    if topic:
        meta = f"Sınav sıklık analizindeki konu: {_clip(topic, 80)}"
        if points is not None:
            meta += f"; ortalama puan: {points:g}"
        lines.append(meta + " (yalnız konu ve puan bilgisi; özgün bir soru yaz)")
    for note in review_notes:
        lines.append(f"Eğitmenin önceki soru için notu (yeniden üretim): {_clip(note, 300)}")
    for chunk in library:
        page = f" (sayfa {chunk['page']})" if chunk.get("page") else ""
        lines.append(f"Ders notu örneği{page}: {chunk['text']}")
    if pool_example:
        lines.append(f"Onaylı açıklama örneği: {_clip(pool_example, 400)}")
    if avoid_stems:
        lines.append("Bu kazanımda zaten olan soru kökleri (aynısını yazma):")
        lines.extend(f"- {_clip(s, 140)}" for s in avoid_stems)
    lines.append(f"Üretim sırası: {slot}/{slots}")
    if feedback:
        lines.append(f"Önceki deneme reddedildi, düzelt: {_clip(feedback, 600)}")
    return scrub("\n".join(lines))


def figure_fix_prompt(*, curriculum_code: str, item: Mapping[str, Any], code: str,
                      mismatches: Sequence[Any]) -> str:
    """Vision uyuşmazlığında "kodu düzelt" istemi (temizlenmiş)."""
    lines = [
        f"Müfredat kodu: {curriculum_code}",
        f"Soru kökü: {item.get('stem', '')}",
        f"Kök değerleri: {json.dumps(item.get('stem_values') or {}, ensure_ascii=False, sort_keys=True)}",
        "Uyuşmazlıklar: " + json.dumps(list(mismatches), ensure_ascii=False),
        "Şu anki şekil kodu:",
        code,
    ]
    return scrub("\n".join(lines))
