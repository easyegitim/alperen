"""``template --fill --min-stock`` ve ``--auto-approve``: yalnız ``register_template_question`` RPC'si (§6.1, #53)."""

from __future__ import annotations

import copy
import json
import random
import uuid

import httpx
import pytest
from ogrenmen_common.errors import OgrError
from ogrenmen_common.fakes import JsonlDb

from conftest import TABLET_FIXTURES, read_jsonl
from ogrenmen_tablet import cli
from ogrenmen_tablet import fill as F
from ogrenmen_tablet import templates as T

RPC = "rpc:register_template_question"


def run(argv, **kw) -> int:
    return cli.main([str(a) for a in argv], **kw)


def _approved(db: JsonlDb, tid: str) -> int:
    return F.approved_stock(db, tid)


def _as_admin(db: JsonlDb):
    class _Ctx:
        def __enter__(self):
            self.prev, db.role = db.role, "postgres"

        def __exit__(self, *exc):
            db.role = self.prev

    return _Ctx()


def _only_enabled(db: JsonlDb, keep: set[str]) -> None:
    with _as_admin(db):
        for row in db.select("question_templates"):
            if row["id"] not in keep:
                db.update("question_templates", {"enabled": False}, where={"id": row["id"]})


def _clone_approved(db: JsonlDb, tid: str, n: int) -> None:
    """Şablonun onaylı stokunu ``n``'ye çıkarır (test kurulumu; farklı content_hash'li kopyalar)."""
    base = next(q for q in db.tables["questions"] if q.get("template_id") == tid and q["status"] == "approved")
    have = _approved(db, tid)
    rows = []
    for i in range(n - have):
        row = copy.deepcopy(base)
        row["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, f"clone:{tid}:{i}"))
        row["content_hash"] = f"clone-{tid}-{i}"
        rows.append(row)
    db.seed("questions", rows)


@pytest.fixture(scope="module")
def acceptance_fill(tmp_path_factory):
    """Kabul komutunun aynısı: ``template --fill --min-stock 30 --dry-run --fixtures fixtures/tablet``."""
    out = tmp_path_factory.mktemp("fill") / "out"
    code = cli.main(["template", "--fill", "--min-stock", "30", "--dry-run", "--fixtures", str(TABLET_FIXTURES),
                     "--out", str(out)])
    assert code == 0
    return out


def test_template_fill_uses_rpc_only(acceptance_fill, db, storage, tmp_path):
    out = acceptance_fill
    calls = read_jsonl(out / "rpc_calls.jsonl")
    assert calls and {c["rpc"] for c in calls} == {"register_template_question"}
    assert all(c["params"]["p_key"] == {"redacted": True, "sympy_status": "verified"} for c in calls)
    questions = read_jsonl(out / "questions.jsonl")
    assert len(questions) == sum(1 for c in calls if c.get("ok"))
    assert all(q["source"] == "template" and q["status"] == "approved" for q in questions)
    assert all(q["review_note"] == "şablon: otomatik onay" for q in questions)
    assert '"source": "llm"' not in (out / "questions.jsonl").read_text(encoding="utf-8")
    assert "correct_option" not in (out / "questions.jsonl").read_text(encoding="utf-8")
    figures = read_jsonl(out / "figures.jsonl")
    assert figures and all(f["review_status"] == "verified" and f["vision_status"] == "not_applicable"
                           and f["tool"] == "template" for f in figures)
    for f in figures:  # PNG hem out/figures'ta hem sahte depoda
        name = f["png_path"].removeprefix("figures/")
        assert (out / "figures" / name).is_file() and (out / "storage" / "figures" / name).is_file()
    summary = json.loads((out / "template_fill.json").read_text(encoding="utf-8"))
    assert summary["llm_calls"] == 0 and summary["min_stock"] == 30 and summary["dry_run"] is True
    assert summary["totals"]["registered"] == len(questions)
    assert {t["template_id"]: t["stock_after"] for t in summary["templates"]} == {
        t: 30 for t in T.template_ids()}

    # aynı iş JsonlDb üzerinde: questions/figures yazımlarının hepsi RPC içinden
    results = F.fill_stock(db, storage, min_stock=30, seed=7, figures_dir=tmp_path / "figures")
    assert all(r.status == "filled" for r in results)
    touched = [w for w in db.write_log if w["table"] in ("questions", "figures", "secure.answer_keys")]
    assert touched and all(w["via"] == RPC for w in touched)
    assert {e["rpc"] for e in db.rpc_log} == {"register_template_question"}
    new_ids = [q for r in results for q in r.question_ids]
    with _as_admin(db):
        keys = {k["question_id"]: k for k in db.select("secure.answer_keys", where={"question_id": new_ids})}
    assert len(keys) == len(new_ids)
    assert all(k["sympy_status"] == "verified" and k["written_by"] == "batch_worker:template" for k in keys.values())


def test_direct_table_write_is_refused_by_batch_worker(db):
    """Sahte dünya da gerçek yetkiyi taklit eder: batch_worker onaylı soruyu doğrudan yazamaz."""
    v = T.generate_variants("islem-onceligi", 1, 1)[0]
    row = {"curriculum_id": "7a988b84-8937-5242-8c35-ddbc4ea9216d", "skill_ids": v.item["skill_ids"],
           "kind": "mcq", "stem": v.item["stem"], "options": v.item["options"], "source": "template",
           "template_id": "islem-onceligi", "content_hash": v.content_hash, "status": "approved"}
    with pytest.raises(Exception, match="OGR-"):
        db.insert("questions", row)


def test_fill_skips_full_stock(db, storage, tmp_path):
    _only_enabled(db, {"kesir-modeli-toplama", "islem-onceligi"})
    _clone_approved(db, "kesir-modeli-toplama", 30)
    assert _approved(db, "kesir-modeli-toplama") == 30
    results = {r.template_id: r for r in F.fill_stock(db, storage, min_stock=30, seed=7,
                                                      figures_dir=tmp_path / "figures")}
    assert set(results) == {"kesir-modeli-toplama", "islem-onceligi"}
    full = results["kesir-modeli-toplama"]
    assert full.status == "full" and full.registered == 0 and full.deficit == 0 and full.attempts == 0
    assert not any((c["params"]["p_item"]["template"]["id"] == "kesir-modeli-toplama") for c in db.rpc_log)
    assert not list((tmp_path / "figures").glob("*.png")), "dolu şablon şekil üretmez"
    filled = results["islem-onceligi"]
    assert filled.status == "filled" and filled.stock_before == 2 and filled.registered == 28
    assert _approved(db, "islem-onceligi") == 30
    # ikinci çalışma: her şey dolu, RPC çağrısı yok
    before = len(db.rpc_log)
    again = F.fill_stock(db, storage, min_stock=30, seed=7, figures_dir=tmp_path / "figures")
    assert all(r.status == "full" for r in again) and len(db.rpc_log) == before


def test_hash_collision_skipped(db, storage, tmp_path):
    tid = "islem-onceligi"
    _only_enabled(db, {tid})
    stream = list(T.iter_variants(tid, random.Random(f"7:{tid}"), max_attempts=3))
    first, second = stream[0], stream[1]
    base = next(q for q in db.tables["questions"] if q.get("template_id") == tid)
    # (a) aynı şablonun aynı hash'li sorusu zaten var (pending_review): RPC'ye hiç gitmez
    same_tpl = {**copy.deepcopy(base), "id": str(uuid.uuid4()), "content_hash": first.content_hash,
                "status": "pending_review"}
    # (b) başka kaynaktan aynı hash: ön denetim görmez, RPC null döner (on conflict do nothing)
    other = {**copy.deepcopy(base), "id": str(uuid.uuid4()), "content_hash": second.content_hash,
             "source": "instructor", "template_id": None, "template_params": None}
    db.seed("questions", [same_tpl, other])
    stock = _approved(db, tid)
    results = F.fill_stock(db, storage, min_stock=stock + 3, seed=7, figures_dir=tmp_path / "f")
    r = results[0]
    assert r.status == "filled" and r.registered == 3 and r.skipped_hash_collision == 2
    sent = [c["params"]["p_item"]["content_hash"] for c in db.rpc_log]
    assert first.content_hash not in sent, "önceden bilinen çakışma RPC'ye gönderilmez"
    assert sent.count(second.content_hash) == 1
    null_calls = [c for c in db.rpc_log if c["params"]["p_item"]["content_hash"] == second.content_hash]
    assert null_calls[0].get("ok") and len(db._find("questions", content_hash=second.content_hash)) == 1
    assert len(sent) == 4 and _approved(db, tid) == stock + 3


def test_fill_is_deterministic(tmp_path):
    def hashes(out):
        assert run(["template", "--fill", "--min-stock", 5, "--seed", 9, "--dry-run", "--fixtures", TABLET_FIXTURES,
                    "--out", out]) == 0
        return [q["content_hash"] for q in read_jsonl(out / "questions.jsonl")]

    a, b = hashes(tmp_path / "a"), hashes(tmp_path / "b")
    assert a == b and len(a) == len(set(a)) == sum(5 - n for n in (2, 2, 2, 2, 2, 1))
    assert (tmp_path / "a" / "template_fill.json").read_text(encoding="utf-8").count('"filled"') >= 6
    # özet de bayt bayt aynı: generated_at Runtime'ın sabit saatinden (OGRENMEN_NOW / fixture 'şimdi'si)
    for name in ("template_fill.json", "cost_estimate.json", "questions.jsonl"):
        assert (tmp_path / "a" / name).read_bytes() == (tmp_path / "b" / name).read_bytes(), name
    summary = json.loads((tmp_path / "a" / "template_fill.json").read_text(encoding="utf-8"))
    assert summary["generated_at"] == "2026-10-20T09:00:00Z"


def test_fill_single_template_and_unknown(db, storage, tmp_path):
    res = F.fill_stock(db, storage, min_stock=4, seed=7, figures_dir=tmp_path, only="uslu-sadelestirme")
    assert [r.template_id for r in res] == ["uslu-sadelestirme"] and res[0].registered == 2
    with pytest.raises(T.TemplateError, match="OGR-TPL-002"):
        F.fill_stock(db, storage, min_stock=4, seed=7, figures_dir=tmp_path, only="yok-boyle")
    with _as_admin(db):
        db.insert("question_templates", {**db.select("question_templates", where={"id": "islem-onceligi"})[0],
                                         "id": "kayitsiz-sablon"})
    res = {r.template_id: r for r in F.fill_stock(db, storage, min_stock=4, seed=7, figures_dir=tmp_path)}
    assert res["kayitsiz-sablon"].status == "unknown_template" and res["kayitsiz-sablon"].registered == 0


def test_fill_reports_rpc_rejection(db, storage, tmp_path):
    """Müfredatı uyuşmayan şablon RPC'de OGR-TPL-004 ile reddedilir; özet hatayı yazar, diğerleri sürer."""
    _only_enabled(db, {"islem-onceligi", "uslu-sadelestirme"})
    with _as_admin(db):
        db.insert("curricula", {"id": "00000000-0000-5000-8000-000000000001", "code": "TYT-MAT", "year": 2027,
                                "version": "2027.1", "label": "TYT Matematik 2027", "status": "draft",
                                "authority": "ÖSYM"})
        db.update("question_templates", {"curriculum_id": "00000000-0000-5000-8000-000000000001"},
                  where={"id": "islem-onceligi"})
    res = {r.template_id: r for r in F.fill_stock(db, storage, min_stock=3, seed=7, figures_dir=tmp_path)}
    assert res["islem-onceligi"].status == "error" and "OGR-TPL-004" in res["islem-onceligi"].error
    assert res["uslu-sadelestirme"].status == "filled"


def test_auto_approve_dry_run(tmp_path):
    out = tmp_path / "out"
    assert run(["template", "--id", "sayi-dogrusu-esitsizlik", "--count", 4, "--seed", 7, "--auto-approve",
                "--dry-run", "--fixtures", TABLET_FIXTURES, "--out", out]) == 0
    questions = read_jsonl(out / "questions.jsonl")
    assert len(questions) == 4 and all(q["status"] == "approved" and q["template_id"] == "sayi-dogrusu-esitsizlik"
                                       for q in questions)
    assert all(q["figure_id"] for q in questions)
    summary = json.loads((out / "template_auto_approve.json").read_text(encoding="utf-8"))
    assert summary["totals"]["registered"] == 4 and summary["llm_calls"] == 0
    assert {c["rpc"] for c in read_jsonl(out / "rpc_calls.jsonl")} == {"register_template_question"}


# --- gerçek kip: PostgrestDb + SupabaseStorage (sahte HTTP, ağ yok) ----------------------------------------


FIG_PREFIX = "/storage/v1/object/figures/"


class FakePostgrest:
    """PostgREST + Storage uçlarının küçük bir taklidi; tüm istekleri kaydeder.

    Depo, gerçek kova politikası gibi davranır (0017_storage.sql: ``batch_worker`` için yalnız INSERT): var olan
    nesneye ikinci POST ``409 Duplicate`` alır (``x-upsert`` UPDATE yetkisi ister, o da yok); HEAD var olan nesneye
    200, olmayana 400 döner. ``storage_down`` → depo uçları ``httpx.ConnectError`` fırlatır; ``fail_stock_for`` →
    o şablonun onaylı stok okuması 503 döner; ``fail_templates`` → ``question_templates`` okuması 500 döner.
    """

    def __init__(self, templates, approved=0, *, objects=(), storage_down=False, fail_stock_for=None,
                 fail_templates=False):
        self.templates = templates
        self.approved = approved
        self.objects: set[str] = set(objects)
        self.storage_down = storage_down
        self.fail_stock_for = fail_stock_for
        self.fail_templates = fail_templates
        self.requests: list[httpx.Request] = []
        self.rpc_bodies: list[dict] = []
        self.storage_posts: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        assert request.headers["authorization"] == "Bearer test-batch-jwt"
        if request.method == "GET" and path == "/rest/v1/question_templates":
            assert request.url.params["enabled"] == "eq.true"
            if self.fail_templates:
                return httpx.Response(500, json={"message": "iç hata"})
            return httpx.Response(200, json=self.templates)
        if request.method == "GET" and path == "/rest/v1/questions":
            if self.fail_stock_for and request.url.params.get("template_id") == f"eq.{self.fail_stock_for}":
                return httpx.Response(503, json={"message": "geçici olarak kullanılamıyor"})
            if request.url.params.get("status") == "eq.approved":
                return httpx.Response(200, json=[{"id": str(uuid.uuid4())} for _ in range(self.approved)])
            return httpx.Response(200, json=[])
        if request.method == "POST" and path == "/rest/v1/rpc/register_template_question":
            body = json.loads(request.content)
            self.rpc_bodies.append(body)
            return httpx.Response(200, json=str(uuid.uuid5(uuid.NAMESPACE_URL, body["p_item"]["content_hash"])))
        if path.startswith(FIG_PREFIX) and request.method in ("POST", "HEAD"):
            if self.storage_down:
                raise httpx.ConnectError("bağlantı reddedildi", request=request)
            name = path.removeprefix(FIG_PREFIX)
            if request.method == "HEAD":
                return httpx.Response(200 if name in self.objects else 400)
            self.storage_posts.append(name)
            if name in self.objects:
                return httpx.Response(409, json={"statusCode": "409", "error": "Duplicate",
                                                 "message": "The resource already exists"})
            self.objects.add(name)
            return httpx.Response(200, json={"Key": path.removeprefix("/storage/v1/object/")})
        return httpx.Response(404, json={"message": f"beklenmeyen istek {request.method} {path}"})


ENV = {"SUPABASE_URL": "https://example.invalid", "SUPABASE_BATCH_JWT": "test-batch-jwt"}


def test_fill_uses_postgrest_when_configured(tmp_path):
    tpl = {"id": "kesir-modeli-toplama", "skill_id": "tyt.mat.temel.rasyonel-sayilar", "has_figure": True,
           "enabled": True, "module_path": "content/tyt-matematik/templates/kesir_modeli_toplama.py:generate"}
    fake = FakePostgrest([tpl], approved=1)
    out = tmp_path / "out"
    code = run(["template", "--fill", "--min-stock", 3, "--out", out], env=ENV, transport=httpx.MockTransport(fake))
    assert code == 0
    writes = [(r.method, r.url.path) for r in fake.requests if r.method not in ("GET", "HEAD")]
    rpc_writes = [w for w in writes if w[1] == "/rest/v1/rpc/register_template_question"]
    uploads = [w for w in writes if w[1].startswith("/storage/v1/object/figures/")]
    assert len(rpc_writes) == 2 and len(uploads) == 2 and len(writes) == 4, writes
    assert not any(p in ("/rest/v1/questions", "/rest/v1/figures") for _m, p in writes)
    for body in fake.rpc_bodies:
        assert set(body) == {"p_item", "p_key", "p_figure"}
        assert body["p_key"]["sympy_status"] == "verified" and body["p_figure"]["png_path"].startswith("figures/")
        T.check_no_key_fields(body["p_item"])
    assert not (out / "rpc_calls.jsonl").exists()
    rows = read_jsonl(out / "questions.jsonl")
    assert len(rows) == 2 and all("id" in r and "correct_option" not in r for r in rows)
    summary = json.loads((out / "template_fill.json").read_text(encoding="utf-8"))
    assert summary["dry_run"] is False and summary["templates"][0]["registered"] == 2
    assert json.loads((out / "cost_estimate.json").read_text(encoding="utf-8"))["attempts"] == 0


def test_dump_keys_refused_with_real_database(tmp_path):
    fake = FakePostgrest([])
    with pytest.raises(T.TemplateError, match="dry-run"):
        run(["template", "--id", "islem-onceligi", "--count", 1, "--auto-approve", "--dump-keys", "--out", tmp_path],
            env=ENV, transport=httpx.MockTransport(fake))
    assert not (tmp_path / "keys.jsonl").exists()


def test_missing_database_env_falls_back_to_dry_run(tmp_path, capsys):
    out = tmp_path / "out"
    assert run(["template", "--id", "islem-onceligi", "--count", 2, "--auto-approve", "--fixtures", TABLET_FIXTURES,
                "--out", out], env={}) == 0
    assert "--dry-run" in capsys.readouterr().err
    assert len(read_jsonl(out / "rpc_calls.jsonl")) == 2


# --- şekil nesneleri: içerik adresli, en çok bir yükleme; hata yalıtımı ------------------------------------------

KESIR_ROW = {"id": "kesir-modeli-toplama", "skill_id": "tyt.mat.temel.rasyonel-sayilar", "has_figure": True,
             "enabled": True, "module_path": "content/tyt-matematik/templates/kesir_modeli_toplama.py:generate"}
ISLEM_ROW = {"id": "islem-onceligi", "skill_id": "tyt.mat.temel.sayilar", "has_figure": False, "enabled": True,
             "module_path": "content/tyt-matematik/templates/islem_onceligi.py:generate"}


def test_figure_uploaded_once_per_code_hash(tmp_path):
    """Aynı code_hash'li şekil bir kez yüklenir; önceki geceden kalan nesne yeniden yüklenmez (409 olmaz)."""
    first = next(T.iter_variants("kesir-modeli-toplama", random.Random("7:kesir-modeli-toplama"), max_attempts=1))
    earlier_night = first.png_name
    fake = FakePostgrest([KESIR_ROW], objects={earlier_night})
    out = tmp_path / "out"
    code = run(["template", "--fill", "--min-stock", 30, "--out", out], env=ENV, transport=httpx.MockTransport(fake))
    summary = json.loads((out / "template_fill.json").read_text(encoding="utf-8"))
    assert code == 0, summary
    tpl = summary["templates"][0]
    assert tpl["status"] == "filled" and tpl["registered"] == 30 and tpl["error"] is None
    names = [b["p_figure"]["png_path"].removeprefix("figures/") for b in fake.rpc_bodies]
    assert len(names) == 30 and len(set(names)) < len(names), "kurulum: en az bir şekil iki soruda paylaşılmalı"
    assert earlier_night in names
    assert len(fake.storage_posts) == len(set(fake.storage_posts)), "aynı nesneye ikinci POST yok"
    assert set(fake.storage_posts) == set(names) - {earlier_night}
    assert tpl["figures_uploaded"] == len(set(names)) - 1
    assert tpl["figures_uploaded"] + tpl["figures_reused"] == 30
    heads = [r for r in fake.requests if r.method == "HEAD"]
    assert len(heads) == len(set(names)), "her ad için en çok bir HEAD (çalışma içi önbellek)"


def test_figure_uploader_skips_existing_object(storage, tmp_path):
    png = tmp_path / "a.png"
    png.write_bytes(b"\x89PNG fake")
    storage.upload(T.FIGURE_BUCKET, "a.png", b"eski")
    up = F.FigureUploader(storage)
    assert up.ensure("a.png", png) is False and up.ensure("b.png", png) is True and up.ensure("b.png", png) is False
    assert storage.download(T.FIGURE_BUCKET, "a.png") == b"eski", "var olan nesnenin üstüne yazılmaz"
    assert up.uploaded == ["b.png"] and up.reused == ["a.png", "b.png"]


def test_storage_network_error_is_isolated_per_template(tmp_path, capsys):
    """Depo ağ hatası (httpx.ConnectError) yalnız o şablonu error yapar; diğerleri dolar, özet yazılır, çıkış 1."""
    fake = FakePostgrest([KESIR_ROW, ISLEM_ROW], storage_down=True)
    out = tmp_path / "out"
    code = run(["template", "--fill", "--min-stock", 3, "--out", out], env=ENV, transport=httpx.MockTransport(fake))
    assert code == 1
    summary = json.loads((out / "template_fill.json").read_text(encoding="utf-8"))
    by = {t["template_id"]: t for t in summary["templates"]}
    assert by["kesir-modeli-toplama"]["status"] == "error"
    assert by["kesir-modeli-toplama"]["error"].startswith("OGR-STO-001")
    assert by["kesir-modeli-toplama"]["registered"] == 0
    assert by["islem-onceligi"]["status"] == "filled" and by["islem-onceligi"]["registered"] == 3
    assert summary["totals"]["errors"] == 1 and summary["totals"]["registered"] == 3
    assert not any(b["p_item"]["template"]["id"] == "kesir-modeli-toplama" for b in fake.rpc_bodies)
    assert "OGR-STO-001" in capsys.readouterr().err
    assert len(read_jsonl(out / "questions.jsonl")) == 3


def test_stock_read_error_is_isolated_per_template(tmp_path):
    """Onaylı stok okuması (PostgREST 503) düşerse o şablon error olur; diğerleri sürer."""
    fake = FakePostgrest([KESIR_ROW, ISLEM_ROW], fail_stock_for="kesir-modeli-toplama")
    out = tmp_path / "out"
    code = run(["template", "--fill", "--min-stock", 2, "--out", out], env=ENV, transport=httpx.MockTransport(fake))
    assert code == 1
    summary = json.loads((out / "template_fill.json").read_text(encoding="utf-8"))
    by = {t["template_id"]: t for t in summary["templates"]}
    assert by["kesir-modeli-toplama"]["status"] == "error" and "OGR-DB-003" in by["kesir-modeli-toplama"]["error"]
    assert any("son stok okunamadı" in w for w in by["kesir-modeli-toplama"]["warnings"])
    assert by["islem-onceligi"]["status"] == "filled"


def test_template_list_error_still_writes_summary(tmp_path):
    fake = FakePostgrest([KESIR_ROW], fail_templates=True)
    out = tmp_path / "out"
    with pytest.raises(OgrError, match="OGR-DB-003"):
        run(["template", "--fill", "--out", out], env=ENV, transport=httpx.MockTransport(fake))
    summary = json.loads((out / "template_fill.json").read_text(encoding="utf-8"))
    assert summary["templates"] == [] and summary["aborted"].startswith("OGR-DB-003")


def test_template_row_mismatch_is_skipped(db, storage, tmp_path):
    """question_templates satırı modülle uyuşmazsa (skill_id / has_figure) şablon error olur ve RPC'ye gitmez."""
    _only_enabled(db, {"islem-onceligi", "kesir-modeli-toplama", "uslu-sadelestirme", "sayi-dogrusu-esitsizlik"})
    with _as_admin(db):
        db.update("question_templates", {"skill_id": "tyt.mat.temel.uslu"}, where={"id": "islem-onceligi"})
        db.update("question_templates", {"has_figure": False}, where={"id": "kesir-modeli-toplama"})
    res = {r.template_id: r for r in F.fill_stock(db, storage, min_stock=3, seed=7, figures_dir=tmp_path)}
    assert res["islem-onceligi"].status == "error" and res["islem-onceligi"].error.startswith("OGR-TPL-004")
    assert res["kesir-modeli-toplama"].status == "error" and res["kesir-modeli-toplama"].error.startswith("OGR-TPL-005")
    sent = {c["params"]["p_item"]["template"]["id"] for c in db.rpc_log}
    assert "islem-onceligi" not in sent and "kesir-modeli-toplama" not in sent
    assert res["uslu-sadelestirme"].status == "filled"
    # dev seed'de sayi-dogrusu-esitsizlik ikincil kazanım (cebir.mutlak-deger) altında: §10.4 iki kazanımı da
    # sayar → uyarı, hata değil
    sd = res["sayi-dogrusu-esitsizlik"]
    assert sd.skill_id == "tyt.mat.cebir.mutlak-deger" and sd.status == "filled"
    assert any("ikincil kazanım" in w for w in sd.warnings)


def test_auto_approve_storage_error_writes_summary(tmp_path):
    fake = FakePostgrest([KESIR_ROW], storage_down=True)
    out = tmp_path / "out"
    code = run(["template", "--id", "kesir-modeli-toplama", "--count", 2, "--auto-approve", "--out", out], env=ENV,
               transport=httpx.MockTransport(fake))
    assert code == 1
    summary = json.loads((out / "template_auto_approve.json").read_text(encoding="utf-8"))
    assert summary["templates"][0]["status"] == "error" and summary["templates"][0]["error"].startswith("OGR-STO-001")


def test_summary_counts_partial(db, storage, tmp_path):
    variants = T.generate_variants("islem-onceligi", 3, 7)
    first = F.auto_approve(db, storage, variants[:1], figures_dir=tmp_path)
    assert first.status == "filled"
    again = F.auto_approve(db, storage, variants, figures_dir=tmp_path)
    assert again.status == "partial" and again.registered == 2 and again.skipped_hash_collision == 1
    totals = F.summarize([first, again])["totals"]
    assert totals["partial"] == 1 and totals["filled"] == 1 and totals["registered"] == 3
