#!/usr/bin/env bash
# Единственный способ выкатить фронт CRM на crm.atomuscrm.ru (Cloudflare Worker).
# Правила: деплой только из свежего main с чистым деревом; номер версии один во всех
# файлах и строго больше того, что сейчас на боевом. Иначе — отказ.
#   tools/deploy-worker.sh            проверить и выкатить
#   tools/deploy-worker.sh --check    только проверки
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
LIVE="${LIVE_URL:-https://crm.atomuscrm.ru}"
die() { echo "ОТКАЗ: $*" >&2; exit 1; }

[ "$(git branch --show-current)" = "main" ] || die "деплой только из main (сейчас $(git branch --show-current))"
git fetch -q origin main
git pull -q --ff-only origin main || die "main не обновляется fast-forward"
[ -z "$(git status --porcelain)" ] || die "дерево не чистое — закоммитьте через PR"
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "HEAD не совпадает с origin/main"

V=$(node -e "console.log(require('./version.json').version)")
grep -q "const APP_VERSION = \"$V\"" app-1.js || die "APP_VERSION в app-1.js не $V"
grep -q "atomus-$V'" sw.js || die "CACHE_VERSION в sw.js не atomus-$V"
grep -q "{version:'$V'" app-3.js || die "нет записи $V в журнале (app-3.js)"

LV=$(curl -fsS "$LIVE/version.json?_=$(date +%s)" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))") || die "не прочитать боевой version.json"
num() { echo "$1" | sed 's/^v//' | awk -F. '{printf "%d%04d%04d\n",$1,$2,$3}'; }
[ "$(num "$V")" -gt "$(num "$LV")" ] || die "собираемая $V не новее боевой $LV — возьмите следующий номер и влейте боевые правки"
echo "OK: $V > боевая $LV, коммит $(git rev-parse --short HEAD)"
[ "${1:-}" = "--check" ] && exit 0

npx wrangler deploy --message "$V $(git rev-parse --short HEAD)"
sleep 3
NV=$(curl -fsS "$LIVE/version.json?_=$(date +%s)" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))")
[ "$NV" = "$V" ] && echo "Выкачено: $NV" || die "после деплоя боевой отдаёт $NV"
