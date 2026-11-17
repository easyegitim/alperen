#!/usr/bin/env python3
"""Müfredat seed'ini SQL olarak üretir (BLUEPRINT §3.11 adım 3; DB'ye bağlanmaz).

Yazılan tablolar: ``curricula`` (``status`` curriculum.json'dan aynen), ``skills``, ``skill_prerequisites``,
``misconception_tags`` (``on conflict (tag) do nothing``), ``question_templates``, ``figures`` (teşhis şekilleri,
``review_status='verified'``), ``questions`` (teşhis maddeleri, **``status='draft'``**, ``source='diagnostic'``),
``diagnostic_tests``, ``legal_texts`` (docs/hukuk gövdeleri; ``{{RETENTION_*}}`` yer tutucuları gün sayısına
çevrilmiş, ``ogrenmen:*`` işaretleri korunmuş).

Tekrar uygulama kuralları:

* Şekil kimliği içerikten türer: ``uid('figure', code_hash)``. Şekil kaynağı değişirse yeni satır yazılır (eski
  satır kalır), taslak soru yeni şekle bağlanır; ``on conflict do nothing`` hem birincil anahtarı hem
  ``code_hash`` tekilliğini kapsar.
* Teşhis sorusu yalnız ``draft``/``pending_review`` iken güncellenir. Onaylı (``approved``) bir teşhis sorusunun
  kökü/şıkları (``content_hash``) ya da şekli ``items.json``'dan farklıysa SQL ``OGR-SEED-003`` ile durur:
  onaylı soru yerinde düzenlenmez; değişiklik emekliye ayırma + yeni kod + yeniden inceleme ister.

Cevap anahtarı üretmez: anahtarları ``seed-keys.py`` yazar ve teşhis sorularını ``approved``'a o çeker.

``--as-version 2027.1``: aynı kazanım kimliklerini ikinci bir ``curricula`` satırı altında yazar (yalnız
müfredat tabloları; teşhis, şablon ve hukuk metinleri ilk sürümde kalır). Değer ``YYYY.N`` biçiminde ve
``curriculum.json`` sürümünden büyük olmalıdır (aynı ya da eski sürüm etkin müfredatı ``draft``'a düşürürdü).
Kimlikler deterministiktir: ``uuid5(NAMESPACE_OGRENMEN, "<code>@<version>")``.

``--schema v2`` (supabase/migrations v2 tabanı; ``supabase/scripts/db-test.sh`` bunu kullanır): ``curricula.origin =
'seed'``; teşhis testi ``diagnostic_tests`` yerine ``exams`` (``kind='diagnostic'``, ``source='instructor'``,
``status='published'``) + ``exam_questions`` (``question_id`` soru bankasına bağlı, aynı sıra) olarak yazılır; şekilleri
inceleyen ``staff`` koordinatörü yerine ilk ``admin`` profilidir (yoksa boş); hukuk metinleri (``legal_texts``) ve
saklama süreleri yoktur. Varsayılan ``--schema v1`` eski tabanın çıktısıdır (içerik testleri bunu sınar); v1 saklama
kaynakları (``04_retention_policies.sql``, ``tg_chats`` migration'ı) depoda yoksa BLUEPRINT yedeğine uyarıyla düşer.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _contentlib as lib  # noqa: E402
from _contentlib import C, jsonb, num, q, text_array, uuid_array  # noqa: E402

import templates  # noqa: E402

AS_VERSION = re.compile(r"\d{4}\.\d+")
SEED_COORDINATOR = ("(select s.id from public.staff s where s.role = 'coordinator' and s.active "
                    "order by s.created_at limit 1)")
SEED_ADMIN_V2 = "(select p.id from public.profiles p where p.role = 'admin' order by p.created_at limit 1)"
SCHEMAS = ("v1", "v2")


def curriculum_row(cur: dict, as_version: str | None, status: str | None) -> dict:
    row = dict(cur)
    if as_version:
        year = int(as_version.split(".")[0])
        row["version"] = as_version
        row["year"] = year
        row["label"] = cur["label"].replace(str(cur["year"]), str(year)) if str(cur["year"]) in cur["label"] \
            else f"{cur['label']} ({as_version})"
        row["status"] = status or "draft"
    elif status:
        row["status"] = status
    return row


def drift_guard_sql(expected: list[tuple[str, str, str, str | None]]) -> str:
    """Onaylı teşhis sorusunun ``content_hash``'i ya da şeklinin ``code_hash``'i beklenenden farklıysa
    ``OGR-SEED-003``. ``expected``: (question_id, kod, content_hash, şekil code_hash | None)."""
    values = ",\n      ".join(f"({q(qid)}::uuid, {q(code)}::text, {q(chash)}::text, {q(fhash)}::text)"
                              for qid, code, chash, fhash in expected)
    return (
        "do $$\n"
        "declare\n"
        "  v_drift text;\n"
        "begin\n"
        "  select string_agg(v.code, ', ' order by v.code) into v_drift\n"
        f"  from (values\n      {values}\n  ) as v(id, code, content_hash, figure_code_hash)\n"
        "  join public.questions qq on qq.id = v.id\n"
        "  left join public.figures ff on ff.id = qq.figure_id\n"
        "  where qq.status = 'approved'\n"
        "    and (qq.content_hash is distinct from v.content_hash or ff.code_hash is distinct from v.figure_code_hash);\n"
        "  if v_drift is not null then\n"
        "    raise exception 'OGR-SEED-003 onaylı teşhis sorusunun içeriği items.json ile uyuşmuyor: %', v_drift\n"
        "      using hint = 'Onaylı soru yerinde düzenlenmez: soruyu emekliye ayır, yeni kodla ekle, '\n"
        "        'yeniden incelemeye gönder.';\n"
        "  end if;\n"
        "end $$;"
    )


def build_sql(content: lib.Content, *, as_version: str | None = None, status: str | None = None,
              retention: lib.RetentionSource | None = None, placeholders: dict | None = None,
              legal_docs: list[lib.LegalDoc] | None = None, warnings: list[str] | None = None,
              schema: str = "v1") -> str:
    if schema not in SCHEMAS:
        raise lib.ContentError(f"bilinmeyen şema {schema!r} (v1 | v2)")
    v2 = schema == "v2"
    warnings = warnings if warnings is not None else []
    cur = curriculum_row(content.curriculum, as_version, status)
    code = f"{cur['code']}@{cur['version']}"
    cur_id = C.curriculum_uuid(code)
    out: list[str] = [
        f"-- Öğrenmen müfredat seed'i: {code} (content/tyt-matematik/scripts/export-sql.py üretir; elle düzenlenmez)",
        "-- Cevap anahtarı içermez; anahtarları seed-keys.py yazar ve teşhis sorularını onaylı duruma o çeker.",
        "-- Tekrar çalıştırılabilir: kimlikler deterministik uuid5, çakışmada güncelle ya da atla.",
        "begin;",
        "",
        "-- müfredat sürümü",
        ("insert into public.curricula (id, code, authority, year, version, label, status, origin) values "
         f"({q(cur_id)}, {q(cur['code'])}, {q(cur['authority'])}, {num(cur['year'])}, {q(cur['version'])}, "
         f"{q(cur['label'])}, {q(cur['status'])}, 'seed')") if v2 else
        ("insert into public.curricula (id, code, authority, year, version, label, status) values "
         f"({q(cur_id)}, {q(cur['code'])}, {q(cur['authority'])}, {num(cur['year'])}, {q(cur['version'])}, "
         f"{q(cur['label'])}, {q(cur['status'])})"),
        "  on conflict (id) do update set label = excluded.label, status = excluded.status;",
        "",
        "-- kazanımlar (önce düğümler, sonra yapraklar; bileşik anahtar (curriculum_id, id))",
    ]
    for s in sorted(content.skills, key=lambda s: (s["is_leaf"], s.get("order_no", 0))):
        out.append(
            "insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, "
            "p_init, p_learn, p_guess, p_slip) values "
            f"({q(cur_id)}, {q(s['id'])}, {q(s.get('parent_id'))}, {q(s['name'])}, {q(s.get('description'))}, "
            f"{num(s['is_leaf'])}, {num(s.get('order_no', 0))}, {num(s.get('p_init', 0.3))}, "
            f"{num(s.get('p_learn', 0.1))}, {num(s.get('p_guess', 0.25))}, {num(s.get('p_slip', 0.1))})\n"
            "  on conflict (curriculum_id, id) do update set parent_id = excluded.parent_id, name = excluded.name, "
            "description = excluded.description, is_leaf = excluded.is_leaf, order_no = excluded.order_no, "
            "p_init = excluded.p_init, p_learn = excluded.p_learn, p_guess = excluded.p_guess, p_slip = excluded.p_slip;"
        )
    out += ["", "-- ön koşul kenarları"]
    for e in content.prerequisites:
        out.append(
            "insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values "
            f"({q(cur_id)}, {q(e['skill_id'])}, {q(e['prereq_id'])}, {num(e['strength'])}, "
            f"{q(e.get('source', 'curriculum'))})\n"
            "  on conflict (curriculum_id, skill_id, prereq_id) do update set strength = excluded.strength, "
            "source = excluded.source;"
        )
    out += ["", "-- yanılgı etiketleri (tag küresel anahtar; ikinci sürüm aynı etiketi geçer)"]
    for t in content.tags:
        out.append(
            "insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, "
            f"text_student) values ({q(t['tag'])}, {q(cur_id)}, {q(t.get('skill_id'))}, "
            f"{q(t.get('prereq_skill_id'))}, {q(t['text_instructor'])}, {q(t['text_student'])})\n"
            "  on conflict (tag) do nothing;"
        )
    if as_version:
        out += ["", "commit;", ""]
        return "\n".join(out)

    out += ["", "-- parametrik şablonlar (§10.4)"]
    for mod in templates.all_templates():
        out.append(
            "insert into public.question_templates (id, curriculum_id, skill_id, module_path, engine, params_schema, "
            f"enabled, has_figure) values ({q(mod.TEMPLATE_ID)}, {q(cur_id)}, {q(mod.SKILL_ID)}, "
            f"{q(templates.module_path(mod.TEMPLATE_ID))}, {q(mod.ENGINE)}, {jsonb(mod.PARAMS_SCHEMA)}, true, "
            f"{num(mod.HAS_FIGURE)})\n"
            "  on conflict (id) do update set skill_id = excluded.skill_id, module_path = excluded.module_path, "
            "engine = excluded.engine, params_schema = excluded.params_schema, has_figure = excluded.has_figure;"
        )

    out += ["", "-- teşhis şekilleri (önceden render; deterministik kod, vision gerekmez)"]
    figure_hash: dict[str, str] = {}
    for item in content.items:
        fig = item.get("figure")
        if not fig:
            continue
        src = lib.figure_path(content, fig["source_path"]).read_text(encoding="utf-8")
        png = lib.figure_path(content, fig["png_path"])
        width, height = C.png_size(png)
        code_hash = C.sha256_hex(src)
        figure_hash[item["code"]] = code_hash
        out.append(
            "insert into public.figures (id, tool, code, code_hash, alt_text, png_path, width_px, height_px, bytes, "
            "render_status, vision_status, review_status, reviewed_by, reviewed_at) values "
            f"({q(C.uid('figure', code_hash))}, {q(fig['tool'])}, {q(src)}, {q(code_hash)}, {q(fig['alt_text'])}, "
            f"{q(fig['png_path'])}, {width}, {height}, {png.stat().st_size}, 'rendered', 'not_applicable', 'verified', "
            f"{SEED_ADMIN_V2 if v2 else SEED_COORDINATOR}, now())\n"
            "  on conflict do nothing;"
        )

    out += ["", "-- teşhis maddeleri: status='draft' (onaylı duruma seed-keys.py çeker); yalnız taslak/incelemedeki "
            "satır güncellenir"]
    item_ids = []
    expected: list[tuple[str, str, str, str | None]] = []
    for item in content.items:
        qid = C.uid("question", item["code"])
        item_ids.append(qid)
        fig_sql = (f"(select f.id from public.figures f where f.code_hash = {q(figure_hash[item['code']])})"
                   if item["code"] in figure_hash else "null")
        chash = C.content_hash(item["stem"], item["options"])
        expected.append((qid, item["code"], chash, figure_hash.get(item["code"])))
        verification = {"schema": True, "sympy": "verified", "render": "ok" if item.get("figure") else "not_applicable",
                        "vision": "not_applicable", "attempts": 0}
        out.append(
            "insert into public.questions (id, curriculum_id, skill_ids, kind, stem, stem_values, figure_id, options, "
            "difficulty, source, content_hash, verification, status) values "
            f"({q(qid)}, {q(cur_id)}, {text_array(item['skill_ids'])}, {q(item['kind'])}, {q(item['stem'])}, "
            f"{jsonb(item.get('stem_values', {}))}, {fig_sql}, {jsonb(item['options'])}, {num(item['difficulty'])}, "
            f"'diagnostic', {q(chash)}, {jsonb(verification)}, 'draft')\n"
            "  on conflict (id) do update set skill_ids = excluded.skill_ids, stem = excluded.stem, "
            "stem_values = excluded.stem_values, figure_id = excluded.figure_id, options = excluded.options, "
            "difficulty = excluded.difficulty, content_hash = excluded.content_hash\n"
            "  where public.questions.status in ('draft', 'pending_review');"
        )
    out += ["", "-- onaylı teşhis sorusu items.json'dan sapmışsa dur (yerinde düzenleme yok: emekliye ayır, yeni kod, "
            "yeniden inceleme)"]
    out.append(drift_guard_sql(expected))
    version = content.curriculum["version"]
    if v2:
        exam_id = C.uid("diagnostic_test", code)
        out += [
            "",
            "-- teşhis testi v2: exams(kind='diagnostic') + exam_questions (sabit sıra; soru bankasına bağlı)",
            "insert into public.exams (id, curriculum_id, kind, source, title, question_count, status) values "
            f"({q(exam_id)}, {q(cur_id)}, 'diagnostic', 'instructor', {q(cur['label'] + ' teşhis testi')}, "
            f"{len(content.items)}, 'published')",
            "  on conflict (id) do update set title = excluded.title, question_count = excluded.question_count;",
        ]
        for no, (item, qid) in enumerate(zip(content.items, item_ids, strict=True), start=1):
            options = [{"key": o["key"], "text": o["text"]} for o in item["options"]]
            out.append(
                "insert into public.exam_questions (id, exam_id, no, kind, stem_text, options, skill_ids, difficulty, "
                f"question_id) values ({q(C.uid('exam_question', f'{code}#{no}'))}, {q(exam_id)}, {no}, "
                f"{q(item['kind'])}, {q(item['stem'])}, {jsonb(options)}, {text_array(item['skill_ids'])}, "
                f"{num(item['difficulty'])}, {q(qid)})\n"
                "  on conflict (exam_id, no) do update set kind = excluded.kind, stem_text = excluded.stem_text, "
                "options = excluded.options, skill_ids = excluded.skill_ids, difficulty = excluded.difficulty, "
                "question_id = excluded.question_id;"
            )
        out += ["", "commit;", ""]
        return "\n".join(out)
    out += [
        "",
        "-- teşhis testi (sabit sıra)",
        "insert into public.diagnostic_tests (id, curriculum_id, version, item_ids) values "
        f"({q(C.uid('diagnostic_test', code))}, {q(cur_id)}, {q(version)}, {uuid_array(item_ids)})",
        "  on conflict (curriculum_id, version) do update set item_ids = excluded.item_ids;",
    ]

    if legal_docs:
        out += ["", "-- hukuk metinleri (docs/hukuk; yer tutucular saklama seed'inden çözüldü)"]
        for doc in legal_docs:
            body, warns = lib.resolve_placeholders(doc.body_md, placeholders or {}, retention, doc.path.name)
            warnings.extend(warns)
            out.append(
                "insert into public.legal_texts (id, kind, version, body_md, effective_from) values "
                f"({q(C.uid('legal_text', f'{doc.kind}:{doc.version}'))}, {q(doc.kind)}, {q(doc.version)}, {q(body)}, "
                f"{q(doc.effective_from)})\n"
                "  on conflict (kind, version) do update set body_md = excluded.body_md, "
                "effective_from = excluded.effective_from;"
            )
    out += ["", "commit;", ""]
    return "\n".join(out)


def _has_v1_retention_source(repo_root: Path) -> bool:
    """v1 tabanının ``tg_chats`` migration'ı depoda mı (v2 tabanında yoktur)."""
    mig = repo_root / "supabase" / "migrations"
    return mig.is_dir() and any("tg_chats" in p.read_text(encoding="utf-8") for p in mig.glob("*.sql"))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="TYT Matematik müfredat seed'ini SQL olarak üretir")
    ap.add_argument("--out", type=Path, required=True, help="yazılacak .sql dosyası")
    ap.add_argument("--as-version", default=None, help="aynı kazanımları yeni sürüm altında yaz (ör. 2027.1)")
    ap.add_argument("--status", choices=("draft", "active", "retired"), default=None,
                    help="curricula.status üzerine yaz (varsayılan: curriculum.json; --as-version ile draft)")
    ap.add_argument("--content", type=Path, default=lib.CONTENT_DIR)
    ap.add_argument("--hukuk", type=Path, default=lib.REPO_ROOT / "docs" / "hukuk", help="docs/hukuk dizini")
    ap.add_argument("--retention-seed", type=Path, default=None,
                    help="varsayılan supabase/seed/04_retention_policies.sql")
    ap.add_argument("--migrations", type=Path, default=None, help="varsayılan supabase/migrations")
    ap.add_argument("--strict-sources", action="store_true",
                    help="M02 seed/migration yoksa BLUEPRINT yedeğine düşme, hata ver")
    ap.add_argument("--schema", choices=SCHEMAS, default="v1",
                    help="hedef veritabanı tabanı: v1 (eski, varsayılan) | v2 (supabase/migrations v2; exams, hukuk metni yok)")
    args = ap.parse_args(argv)

    try:
        content = lib.load_content(args.content, with_keys=False)
        if args.as_version is not None:
            if not AS_VERSION.fullmatch(args.as_version):
                print(f"HATA: --as-version sürüm biçimi YYYY.N olmalı (ör. 2027.1): {args.as_version}", file=sys.stderr)
                return 1
            current = content.curriculum["version"]
            if lib.version_tuple(args.as_version) <= lib.version_tuple(current):
                print(f"HATA: --as-version {args.as_version}, curriculum.json sürümü {current}'den büyük olmalı; "
                      "aynı ya da eski sürüm etkin müfredatı taslağa düşürür", file=sys.stderr)
                return 1
        report = lib.validate_content(content)
        if not report.ok:
            print(report.render(), file=sys.stderr)
            print("export-sql: içerik geçersiz; önce validate.py hatalarını düzelt", file=sys.stderr)
            return 1
        warnings: list[str] = []
        retention = placeholders = legal_docs = None
        if args.as_version is None and args.schema == "v1":
            migrations = args.migrations
            if migrations is None and not args.strict_sources and not _has_v1_retention_source(lib.REPO_ROOT):
                # v2 tabanında tg_chats yok: v1 çıktısı saklama sürelerini BLUEPRINT yedeğinden (uyarıyla) okur
                migrations = lib.REPO_ROOT / "supabase" / "migrations-v1-yok"
            legal_docs = lib.load_legal_docs(args.hukuk)
            placeholders = lib.read_json(args.hukuk / "placeholders.json")
            retention = lib.load_retention(lib.REPO_ROOT, args.retention_seed, migrations,
                                           allow_fallback=not args.strict_sources)
            if retention.fallback:
                warnings.append("supabase/seed/04_retention_policies.sql ya da tg_chats migration'ı yok; gün sayıları "
                                f"yedek kaynaktan okundu: {', '.join(retention.origin)}")
        sql = build_sql(content, as_version=args.as_version, status=args.status, retention=retention,
                        placeholders=placeholders, legal_docs=legal_docs, warnings=warnings, schema=args.schema)
    except lib.ContentError as exc:
        print(f"HATA: {exc}", file=sys.stderr)
        return 1
    import pglast

    try:
        pglast.parse_sql(sql)
    except pglast.parser.ParseError as exc:
        print(f"HATA: üretilen SQL ayrıştırılamadı: {exc}", file=sys.stderr)
        return 1
    lowered = sql.lower()
    if "answer_keys" in lowered or "correct_option" in lowered:
        print("HATA: seed SQL'i cevap anahtarı içeremez", file=sys.stderr)
        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(sql, encoding="utf-8")
    for w in warnings:
        print(f"UYARI: {w}", file=sys.stderr)
    print(f"export-sql: {args.out} yazıldı ({sql.count('insert into')} insert)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
