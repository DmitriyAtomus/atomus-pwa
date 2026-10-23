
## Выкатка фронта CRM (с v2.46.270)
- Боевой фронт — только Cloudflare Worker `atomus-crm` (crm.atomuscrm.ru). atomus-pwa.vercel.app лишь перенаправляет туда.
- Выкатывать только `tools/deploy-worker.sh` из свежего `main` с чистым деревом. Ручной `npx wrangler deploy` из папок-сборок (`/workspace/pwa-2xx`) запрещён.
- Любая правка — ветка → PR → merge в main → deploy-worker.sh. Номер версии берётся следующим за боевым (`curl https://crm.atomuscrm.ru/version.json`), один и тот же в version.json, app-1.js (APP_VERSION), sw.js (CACHE_VERSION) и журнале app-3.js.
- Скрипт откажет, если версия не новее боевой — значит, кто-то выкатил раньше: сначала подтяните main.
