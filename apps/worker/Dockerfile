# Öğrenmen işçisi. Bağlam depo kökü olmalıdır (çalışma alanı paketleri @ogrenmen/contracts, @ogrenmen/llm):
#   docker build -f apps/worker/Dockerfile -t ogrenmen-worker .
# Tek imaj iki süreç türünü çalıştırır (fly.toml processes): worker (genel işler + zamanlayıcı) ve pdf (Playwright Chromium).
FROM node:22-bookworm

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    HEALTH_PORT=8080

COPY --from=oven/bun:1.4.2 /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# Önce yalnız manifestolar (bağımlılık katmanı önbelleğe girsin).
COPY package.json bun.lock ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/llm/package.json packages/llm/package.json
COPY packages/prompts/package.json packages/prompts/package.json
COPY packages/doc-render/package.json packages/doc-render/package.json
# Çalışma alanındaki öteki paketlerin manifestoları kilit dosyası uyumu için gerekir.
COPY apps/web/package.json apps/web/package.json
COPY packages/design-system/package.json packages/design-system/package.json
COPY packages/mastery-math/package.json packages/mastery-math/package.json
COPY packages/pii/package.json packages/pii/package.json
RUN bun install --frozen-lockfile --production --filter @ogrenmen/worker

# Chromium ve sistem bağımlılıkları (yalnız pdf süreci kullanır; imaj tek). Şablon doldurucu (practice.generate:
# py/template_fill.py, `python3 -I`), anahtar doğrulayıcı (py/key_verify.py) ve belge figürleri (document.generate:
# py/figure_render.py; sahte LLM ya da açıkça OGRENMEN_FIGURES=local) için SymPy + matplotlib + NumPy (Debian paketleri;
# yoksa şablon yolu LLM'e, figür yeniden üretime/figürsüz belgeye düşer). Yerel figür kodu OS yalıtımında çalışır
# (src/documents/sandbox.ts: util-linux setpriv + unshare, kullanıcı ad alanı); Fly makinesinde (Firecracker VM) açıktır,
# Docker'ın varsayılan seccomp profili kapatır: o zaman model kodu yerelde çalışmaz (varsayılan code_execution etkilenmez).
RUN node apps/worker/node_modules/playwright-core/cli.js install --with-deps chromium \
    && apt-get update && apt-get install -y --no-install-recommends python3-sympy python3-matplotlib python3-numpy \
    && rm -rf /var/lib/apt/lists/*

# Yalnız gereken dosyalar (yerel .env* / node_modules imaja girmesin; kökteki .dockerignore da bunları dışlamalı).
COPY apps/worker/tsconfig.json apps/worker/tsconfig.json
COPY apps/worker/src apps/worker/src
COPY packages/contracts/package.json packages/contracts/tsconfig.json packages/contracts/
COPY packages/contracts/src packages/contracts/src
COPY packages/llm/package.json packages/llm/tsconfig.json packages/llm/
COPY packages/llm/src packages/llm/src
# Prompt paketi (route/*.md, kilit, paketlenmiş metin) ve belge oluşturucu (deneme raporu PDF: React → HTML → Chromium;
# gömülü fontlar, design-system tokens.css)
COPY packages/prompts packages/prompts
COPY packages/doc-render/package.json packages/doc-render/tsconfig.json packages/doc-render/
COPY packages/doc-render/src packages/doc-render/src
COPY packages/doc-render/fonts packages/doc-render/fonts
COPY packages/design-system packages/design-system
# Parametrik soru şablonları (sıfır LLM) ve doldurucu
COPY apps/worker/py apps/worker/py
COPY content/tyt-matematik/curriculum.json content/tyt-matematik/
COPY content/tyt-matematik/templates content/tyt-matematik/templates

WORKDIR /app/apps/worker
USER node
EXPOSE 8080
# Varsayılan süreç: worker. Fly processes bölümü `--process=pdf` ile ikinciyi çalıştırır.
CMD ["node", "--import", "tsx", "src/index.ts", "--process=worker"]
