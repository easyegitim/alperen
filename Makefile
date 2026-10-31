# Öğrenmen kök Makefile (M13L) — hesapsız yerel denetimler ve geliştirme kısayolları.
# Modüller bağımsız kalır (workspaces yok); her hedef ilgili betiği depo kökünün mutlak yoluyla çağırır.
SHELL := /bin/bash
ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
PYTHON ?= python3
FILL_OUT ?= /tmp/ogrenmen-fill-dry

.PHONY: help check check-quick db-test db-migrate rpc-parity fixtures-valid drift fill-dry ders dev dev-worker dev-panel

help:
	@echo "Öğrenmen hedefleri:"
	@echo "  make check         tüm modül kabul komutları (scripts/check-all.sh)"
	@echo "  make check-quick   aynısı, ağır build adımları olmadan (wrangler build, panel üretim derlemesi)"
	@echo "  make db-test       canlı Postgres testleri (OGRENMEN_DATABASE_URL gerekir; yoksa SKIP)"
	@echo "  make db-migrate    barındırılan projeye ilk kurulum: migration'lar + seed 01-04 + müfredat + cevap anahtarları"
	@echo "                     (DB_URL gerekir; yalnız yeni bir migration: MIGRATION=supabase/migrations/00NN_ad.sql)"
	@echo "  make rpc-parity    RPC adı + parametre paritesi (Worker, panel, pipelines ↔ migration'lar)"
	@echo "  make fixtures-valid  fixtures/llm sözleşmeleri + dev-seed denetimi"
	@echo "  make drift         BKT ve PII SQL kopyalarının migration'larla birebirliği"
	@echo "  make fill-dry      tablet template --fill dry-run (çıktı: FILL_OUT=$(FILL_OUT))"
	@echo "  make ders          ders kaydı → analiz zinciri (register → analyze --lesson); kurucu makinesinde:"
	@echo "                     make ders STUDENT=s_… STAFF=<staff uuid> HELD_AT=2026-10-20T18:00 VIDEO=<yol> [DURATION=90]"
	@echo "                     (OGRENMEN_VIDEO_DIR gerekir; video o dizinin içinde, adı yalnız tarih + ders no)"
	@echo "  make dev           yerel sahte bot + panel nasıl açılır"

check:
	bash "$(ROOT)/scripts/check-all.sh"

check-quick:
	bash "$(ROOT)/scripts/check-all.sh" --quick

db-test:
	bash "$(ROOT)/scripts/check-all.sh" --live-only

# docs/runbook/kurucu.md §1.2 ve supabase/README.md "kök make db-migrate". DB_URL kurucunun kabuğundan gelir
# (parola komut satırına yazılmaz; kurucu.md "Kabuk ortamı"). İlk kurulumda tüm migration'lar sırayla, her biri tek
# işlemde; ardından seed/01…04 (00_roles ve seed/dev yalnız yerel/test), çalışma anında üretilen müfredat seed'i
# (BLUEPRINT §3.11: commit edilmez) ve teşhis cevap anahtarları. MIGRATION verilirse yalnız o dosya uygulanır.
db-migrate:
	@: "$${DB_URL:?DB_URL tanımlı değil (bkz. docs/runbook/kurucu.md, Kabuk ortamı)}"
	@set -euo pipefail; \
	if [ -n "$(MIGRATION)" ]; then \
	  echo "→ $(MIGRATION)"; psql "$$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$(MIGRATION)"; exit 0; \
	fi; \
	for f in "$(ROOT)"/supabase/migrations/*.sql; do \
	  echo "→ migration $$(basename "$$f")"; psql "$$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$$f" || exit 1; \
	done; \
	for f in 01_settings 02_quota 03_runtime_flags 04_retention_policies; do \
	  echo "→ seed $$f"; psql "$$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$(ROOT)/supabase/seed/$$f.sql" || exit 1; \
	done; \
	tmp="$$(mktemp -d)"; trap 'rm -rf "$$tmp"' EXIT; \
	echo "→ müfredat seed'i (export-sql.py --strict-sources)"; \
	$(PYTHON) "$(ROOT)/content/tyt-matematik/scripts/export-sql.py" --strict-sources --out "$$tmp/seed.sql"; \
	psql "$$DB_URL" -X -q -v ON_ERROR_STOP=1 -o /dev/null -f "$$tmp/seed.sql"; \
	echo "→ teşhis cevap anahtarları (seed-keys.py)"; \
	$(PYTHON) "$(ROOT)/content/tyt-matematik/scripts/seed-keys.py" --database-url "$$DB_URL"; \
	echo "Tamam. Depolama bütçesi: psql \"\$$DB_URL\" -X -f $(ROOT)/supabase/scripts/size-report.sql"

rpc-parity:
	$(PYTHON) "$(ROOT)/scripts/check-rpc-parity.py"

fixtures-valid:
	$(PYTHON) "$(ROOT)/scripts/check-fixtures.py"

drift:
	$(PYTHON) "$(ROOT)/scripts/check-drift.py"

fill-dry:
	$(PYTHON) -m ogrenmen_tablet template --fill --min-stock 30 --dry-run \
		--fixtures "$(ROOT)/fixtures/tablet" --out "$(FILL_OUT)"
	@echo "Özet: $(FILL_OUT)/template_fill.json · RPC kayıtları: $(FILL_OUT)/rpc_calls.jsonl"

# pipelines/ders/README.md "register": yeni dersin uuid'si register'ın stdout'una tek satır yazılır (gerisi stderr),
# analyze --lesson'a zincirlenir. Video yüklenmez; yerel dosya $OGRENMEN_VIDEO_DIR içinde olmalı (yalnız göreli yol
# kaydedilir, OGR-DERS-007). İsteğe bağlı: DURATION (dakika), TRANSCRIBER (chain | whispercpp), DERS_ARGS (ortak
# bayraklar, ör. --out <dizin>). SUPABASE_URL/SUPABASE_BATCH_JWT yoksa iki komut da --dry-run'a düşer; dry-run'da
# sahte veritabanı süreçler arasında paylaşılmadığı için analyze yeni dersi bulamaz (OGR-DERS-002): zincir canlıdır.
ders:
	$(if $(STUDENT),,$(error STUDENT=s_… gerekli (öğrencinin public_ref'i)))
	$(if $(STAFF),,$(error STAFF=<uuid> gerekli (eğitmenin public.staff.id değeri)))
	$(if $(HELD_AT),,$(error HELD_AT=2026-10-20T18:00 gerekli (saat dilimsizse Europe/Istanbul)))
	$(if $(VIDEO),,$(error VIDEO=<yol> gerekli (OGRENMEN_VIDEO_DIR içindeki ders kaydı)))
	@: "$${OGRENMEN_VIDEO_DIR:?OGRENMEN_VIDEO_DIR tanımlı değil (ham video dizini; pipelines/ders/README.md register)}"
	@set -euo pipefail; \
	lesson="$$($(PYTHON) -m ogrenmen_ders register --student-ref "$(STUDENT)" --staff-id "$(STAFF)" \
	  --held-at "$(HELD_AT)" $(if $(DURATION),--duration "$(DURATION)") --video "$(VIDEO)" $(DERS_ARGS))"; \
	case "$$lesson" in \
	  ????????-????-????-????-????????????) ;; \
	  *) echo "HATA: register ders uuid'si yazmadı: '$$lesson'" >&2; exit 1 ;; \
	esac; \
	echo "→ ders $$lesson kaydedildi; analyze başlıyor" >&2; \
	$(PYTHON) -m ogrenmen_ders analyze --lesson "$$lesson" --video "$(VIDEO)" \
	  $(if $(TRANSCRIBER),--transcriber "$(TRANSCRIBER)") $(DERS_ARGS)

dev:
	@echo "Yerel geliştirme (hesap ve anahtar gerekmez; iki ayrı terminal):"
	@echo ""
	@echo "  1) Sahte Telegram + Worker:  make dev-worker"
	@echo "     (bun run --cwd $(ROOT)/apps/worker dev:fake — Worker :8787, sahte Bot API :8788)"
	@echo "     Mesaj gönder: curl -X POST localhost:8788/sendUpdate -H 'content-type: application/json' \\"
	@echo "                     -d @$(ROOT)/fixtures/telegram/private_text.json"
	@echo "     Botun cevabı:  curl localhost:8788/outbox"
	@echo ""
	@echo "  2) Eğitmen paneli (mock veri):  make dev-panel"
	@echo "     (bun run --cwd $(ROOT)/apps/panel dev:mock — http://localhost:3000 ; rol: ?role=coordinator|instructor|observer)"
	@echo ""
	@echo "  İlk kez: bun install --cwd $(ROOT)/apps/worker && bun install --cwd $(ROOT)/apps/panel"

dev-worker:
	bun run --cwd "$(ROOT)/apps/worker" dev:fake

dev-panel:
	bun run --cwd "$(ROOT)/apps/panel" dev:mock
