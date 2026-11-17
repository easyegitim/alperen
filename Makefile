# Öğrenmen 2.0 kök Makefile — hesapsız yerel denetimler ve geliştirme kısayolları.
# Kod dizinleri bağımsızdır (bun çalışma alanı: apps/*, packages/*; Python boru hatları: pipelines/*; supabase/).
# Her hedef ilgili betiği depo kökünün mutlak yoluyla çağırır; denetimlerin tek kapısı scripts/check-all.sh'tir.
SHELL := /bin/bash
ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
PYTHON ?= python3
FILL_OUT ?= /tmp/ogrenmen-fill-dry

.PHONY: help check check-quick check-live db-test db-migrate rpc-parity fixtures-valid drift fill-dry dev-web dev-worker local local-reset local-db doctor

help:
	@echo "Öğrenmen hedefleri:"
	@echo "  make check         tüm denetimler: kök betikleri + her modülün check.sh'i (OGRENMEN_LIVE kabuktaki değerde)"
	@echo "  make check-quick   aynısı, canlı servis ve ağır derleme olmadan (CI quick işi)"
	@echo "  make check-live    aynısı, OGRENMEN_LIVE=1 ile (canlı Postgres dahil; OGRENMEN_DATABASE_URL ya da yerel varsayılan)"
	@echo "  make db-test       yalnız veritabanına bağlı modüller canlı kipte (supabase, apps/worker pg-boss; CI live-db işi)"
	@echo "  make db-migrate    barındırılan projeye ilk kurulum (v2): migration'lar + seed/01…02 + müfredat seed'i"
	@echo "                     (DB_URL gerekir; yalnız yeni bir migration: MIGRATION=supabase/migrations/00NN_ad.sql)"
	@echo "  make rpc-parity    RPC adı + parametre paritesi (pipelines ↔ migration'lar)"
	@echo "  make fixtures-valid  fixtures/llm sözleşmeleri + dev-seed denetimi"
	@echo "  make drift         BKT ve PII SQL kopyalarının migration'larla birebirliği"
	@echo "  make fill-dry      tablet template --fill dry-run (çıktı: FILL_OUT=$(FILL_OUT))"
	@echo "  make dev-web       apps/web geliştirme sunucusu (bun run --cwd apps/web dev)"
	@echo "  make dev-worker    apps/worker geliştirme süreci (bun run --cwd apps/worker dev)"
	@echo "  make local         yerel deneme: tüm uygulama tek komutla (veritabanı ogrenmen_dev + köprü + worker + web;"
	@echo "                     http://localhost:3000, giriş kodu 246810; anahtar .env.local'dan)"
	@echo "  make local-db      yerel veritabanını Docker ile aç (docker compose up -d db; pgvector hazır gelir)"
	@echo "  make doctor        yerel deneme için eksik var mı? Türkçe rapor (bun run doctor)"
	@echo "  make local-reset   aynısı, yerel veritabanını ve yüklenen dosyaları silip baştan kurarak"

check:
	bash "$(ROOT)/scripts/check-all.sh"

check-quick:
	bash "$(ROOT)/scripts/check-all.sh" --quick

check-live:
	bash "$(ROOT)/scripts/check-all.sh" --live

# Canlı Postgres gerektiren modüller; atlanan canlı test FAIL sayılır (scripts/lib.sh ogr_live_pytest).
# pipelines/{tablet,kalem,ders} canlı testleri v1 şemasına yazılıydı: v2 tabanında devre dışı (kendi check.sh'lerinde SKIP).
db-test:
	bash "$(ROOT)/scripts/check-all.sh" --live --only supabase,apps/worker

# docs/runbook/kurucu.md §1.2 ve supabase/README.md "kök make db-migrate". DB_URL kurucunun kabuğundan gelir
# (parola komut satırına yazılmaz; kurucu.md "Kabuk ortamı"). İlk kurulumda tüm migration'lar sırayla, her biri tek
# işlemde; ardından seed/[0-9][0-9]_*.sql (00_people yalnız yerel/test: db-test.sh ile aynı kural, atlanır) ve
# çalışma anında üretilen v2 müfredat seed'i (commit edilmez; export-sql.py --schema v2).
# Cevap anahtarı yükleme yolu (seed-keys.py) v1 tabanına yazar; v2'de karşılığı yoktur, bu hedef onu çalıştırmaz.
# MIGRATION verilirse yalnız o dosya uygulanır.
db-migrate:
	@: "$${DB_URL:?DB_URL tanımlı değil (bkz. docs/runbook/kurucu.md, Kabuk ortamı)}"
	@set -euo pipefail; \
	if [ -n "$(MIGRATION)" ]; then \
	  echo "→ $(MIGRATION)"; psql "$$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$(MIGRATION)"; exit 0; \
	fi; \
	for f in "$(ROOT)"/supabase/migrations/*.sql; do \
	  echo "→ migration $$(basename "$$f")"; psql "$$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$$f" || exit 1; \
	done; \
	for f in "$(ROOT)"/supabase/seed/[0-9][0-9]_*.sql; do \
	  case "$$(basename "$$f")" in 00_people.sql) continue ;; esac; \
	  echo "→ seed $$(basename "$$f")"; psql "$$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$$f" || exit 1; \
	done; \
	seed="$$(mktemp)"; \
	echo "→ müfredat seed'i (export-sql.py --schema v2 --strict-sources)"; \
	$(PYTHON) "$(ROOT)/content/tyt-matematik/scripts/export-sql.py" --schema v2 --strict-sources --out "$$seed"; \
	psql "$$DB_URL" -X -q -v ON_ERROR_STOP=1 -o /dev/null -f "$$seed"; \
	unlink "$$seed"; \
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

dev-web:
	bun run --cwd "$(ROOT)/apps/web" dev

dev-worker:
	bun run --cwd "$(ROOT)/apps/worker" dev

# Kurucunun yerel denemesi (scripts/dev-local/up.ts): Ctrl+C kapatır, veritabanı silinmez.
local:
	cd "$(ROOT)" && bun scripts/dev-local/up.ts

local-db:
	cd "$(ROOT)" && docker compose up -d --wait db

doctor:
	cd "$(ROOT)" && bun scripts/dev-local/doctor.ts

local-reset:
	cd "$(ROOT)" && bun scripts/dev-local/up.ts --reset
