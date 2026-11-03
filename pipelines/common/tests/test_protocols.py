"""Adaptör sözleşme testleri: her Fake* ve gerçek adaptör kendi Protocol'ünü karşılar ve davranışı tutar."""

from __future__ import annotations

import pytest

from ogrenmen_common.adapters import base
from ogrenmen_common.adapters.base import LLMRequest
from ogrenmen_common.fakes import (
    FakeEmbedding,
    FakeNotifier,
    FakeOCR,
    FakeTranscriber,
    FakeVision,
    LocalDirStorage,
    cosine,
    hash_vector,
    to_halfvec,
)
from ogrenmen_common.selftest import fake_instances, protocol_conformance, real_classes


def test_all_fakes_satisfy_their_protocol(tmp_path):
    instances = fake_instances(tmp_path)
    assert set(instances) == set(base.PROTOCOLS)
    for name, objs in instances.items():
        for obj in objs:
            assert protocol_conformance(obj, base.PROTOCOLS[name]) == [], (name, type(obj).__name__)
            assert isinstance(obj, base.PROTOCOLS[name])


def test_all_real_adapters_satisfy_their_protocol():
    classes = real_classes()
    assert set(classes) == set(base.PROTOCOLS)
    for name, items in classes.items():
        for cls in items:
            assert protocol_conformance(cls, base.PROTOCOLS[name]) == [], (name, cls.__name__)


def test_conformance_detects_missing_member_and_signature():
    class NoEmbed:
        dims = 768

    class WrongSig:
        dims = 768

        def embed(self, items):  # parametre adı 'texts' değil
            return []

    assert protocol_conformance(NoEmbed(), base.Embedding)
    assert any("texts" in p for p in protocol_conformance(WrongSig(), base.Embedding))
    assert not isinstance(NoEmbed(), base.Embedding)


def test_fake_embedding_contract():
    emb = FakeEmbedding()
    a, b, a2 = emb.embed(["paydalar", "kesirler", "paydalar"])
    assert len(a) == 768 and emb.dims == 768 and emb.calls == [3]
    assert a == a2 and a != b
    assert cosine(a, a) == pytest.approx(1.0) and sum(x * x for x in a) == pytest.approx(1.0)
    assert -0.3 < cosine(a, b) < 0.3
    assert hash_vector("paydalar") == a
    assert to_halfvec([0.5, -0.25]) == "[0.5,-0.25]"
    with pytest.raises(TypeError):
        emb.embed("tek metin")


def test_fake_vision_contract():
    v = FakeVision(verdicts=["mismatch", "mismatch"])
    first = v.check_figure(b"png", stem="5/6 ve 1/4", stem_values={"a": 5})
    assert first["status"] == "mismatch" and first["matches_stem"] is False
    v.check_figure(b"png", stem="5/6 ve 1/4", stem_values={"a": 5})
    third = v.check_figure(b"png", stem="5/6 ve 1/4", stem_values={"a": 5})
    assert third["status"] in ("match", "mismatch") and len(v.calls) == 3 and v.calls[2]["fixture"].endswith(".json")


def test_fake_ocr_applies_source_meta():
    items = FakeOCR().extract_items([b"p1", b"p2"], meta={"fixture_hint": "exam-2022", "year": 2022, "term": "final",
                                                          "instructor_alias": "hoca-A",
                                                          "source_id": "11111111-1111-4111-8111-111111111111"})
    assert items and all(i["instructor_alias"] == "hoca-A" and i["year"] == 2022 for i in items)
    assert all(i["source_id"] == "11111111-1111-4111-8111-111111111111" for i in items)


def test_fake_transcriber_by_audio_name(tmp_path):
    t = FakeTranscriber().transcribe(tmp_path / "lesson-01.wav")
    assert t["segments"][0]["speaker"] in ("ÖĞRENCİ", "EĞİTMEN")
    forced = FakeTranscriber(transcript={"segments": [{"t": "00:00:00", "speaker": "EĞİTMEN", "text": "x"}]})
    assert forced.transcribe(tmp_path / "a.wav")["segments"][0]["text"] == "x"


def test_local_storage_contract(tmp_path):
    from conftest import FIXTURES
    from ogrenmen_common.errors import StorageError

    st = LocalDirStorage(tmp_path / "s", read_roots=[FIXTURES / "kalem"],
                         aliases={"exams/abc.pdf": FIXTURES / "kalem" / "exam-2022.pdf"})
    assert st.download("exams", "abc.pdf")[:4] == b"%PDF"
    assert st.download("exams", "exam-2022.pdf")[:4] == b"%PDF"  # read_roots/<path>
    st.upload("figures", "q/1.png", b"png-bytes", content_type="image/png")
    assert (tmp_path / "s" / "figures" / "q" / "1.png").read_bytes() == b"png-bytes"
    assert st.exists("figures", "q/1.png") and st.public_url("figures", "q/1.png") == (
        "http://fake-storage/figures/q/1.png")
    st.remove("figures", "q/1.png")
    assert not st.exists("figures", "q/1.png") and st.removed == ["figures/q/1.png"]
    with pytest.raises(StorageError):
        st.download("figures", "q/1.png")
    with pytest.raises(StorageError):
        st.upload("figures", "../kacis.png", b"x")


def test_fake_notifier_follows_voice_rules():
    n = FakeNotifier(echo=False)
    n.notify("Tavan aşıldı! 😀\nİkinci satır", level="warning")
    assert n.sent == [{"level": "warning", "text": "Dikkat · Tavan aşıldı.\nİkinci satır"}]
    with pytest.raises(ValueError):
        n.notify("x", level="panik")


def test_llm_request_helpers():
    r = LLMRequest(purpose="ocr", model="", prompt="p")
    assert r.with_model("m").model == "m" and r.with_prompt("q").prompt == "q" and r.prompt == "p"
    with pytest.raises(ValueError):
        base.LLMResult.failure("panik")
