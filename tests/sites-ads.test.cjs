const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app-4.js'), 'utf8');
const app1 = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function grab(name) {
  const start = app.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' не найдена');
  let i = app.indexOf('{', start), depth = 0;
  for (; i < app.length; i++) { if (app[i] === '{') depth++; else if (app[i] === '}' && --depth === 0) break; }
  return app.slice(start, i + 1);
}

function leadAdsHtml(utm) {
  const ctx = { escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
  vm.createContext(ctx);
  vm.runInContext(grab('_adsDate') + '\n' + grab('_sAdsLeadHtml'), ctx);
  return ctx._sAdsLeadHtml(utm);
}

test('вкладка «Реклама» подключена как соседний экран «Сайтов»', () => {
  assert.match(html, /data-nav="sites-ads"/);
  assert.match(html, /data-screen="sites-ads" data-section="sites"/);
  assert.match(app1, /screenName === 'sites-ads'\)\s+loadSitesAds\(\)/);
  assert.match(app1, /sb-sites-ads[\s\S]{0,200}'director'\) \|\| r\.includes\('zam'\)/);
});

test('блок рекламы в заявке: последняя и первая метка, без ym_client_id', () => {
  const h = leadAdsHtml({
    utm_source: 'yandex', utm_medium: 'cpc', utm_campaign: 'Камеры <b>', utm_term: 'камера созревания', utm_content: '123',
    yclid: '999', ym_client_id: '1757000000123',
    first_utm_source: 'yandex', first_utm_campaign: 'Бренд', first_at: '2026-09-01',
  });
  assert.match(h, /Последняя реклама перед заявкой/);
  assert.match(h, /клик Директа ✓/);
  assert.match(h, /связан с Метрикой ✓/);
  assert.match(h, /Камеры &lt;b&gt;/);
  assert.match(h, /Первая реклама/);
  assert.match(h, /впервые: 01\.09\.2026/);
  assert.doesNotMatch(h, /1757000000123/);
});

test('первая реклама не дублируется, если совпадает с последней; без меток блока нет', () => {
  const h = leadAdsHtml({ utm_source: 'yandex', utm_campaign: 'A', first_utm_source: 'yandex', first_utm_campaign: 'A', first_at: '2026-09-01' });
  assert.doesNotMatch(h, /Первая реклама/);
  assert.equal(leadAdsHtml(undefined), '');
  assert.equal(leadAdsHtml({}), '');
});

test('utm по-прежнему скрыт из общего списка параметров', () => {
  assert.match(grab('_sParamsHtml'), /'landing_page', 'utm'\]/);
});

test('журнал «Что сделано»: отмена применённого и обратная галка auto_apply', () => {
  assert.match(app, /\/api\/ads\/proposals\?status=all/);
  const card = grab('_adsProposalHtml');
  assert.match(card, /p\.status === 'applied'\) btns = [^\n]*revert/);
  assert.match(card, /p\.result/);
  const act = grab('adsProposalAct');
  assert.match(act, /confirm\(/);
  assert.match(act, /'\/api\/ads\/proposals\/' \+ id \+ '\/' \+ action/);
  assert.match(app, /body\.auto_apply = !g\('ads-ask'\)\.checked/);
  assert.match(app, /st\.auto_apply === false \? ' checked'/);
  assert.doesNotMatch(app, /auto_negatives/);
});

test('на телефоне период и синхронизация доступны в теле экрана', () => {
  const tools = grab('_adsToolsHtml');
  assert.match(tools, /onchange="adsDays\(this\.value\)"/);
  assert.match(tools, /class="btn btn-secondary ads-sync" onclick="adsSync\(\)"/);
  assert.match(grab('_adsRender'), /_adsToolsHtml\(\) \+ _adsMetaHtml/);
  assert.match(grab('_adsSyncBtn'), /querySelectorAll\('\.ads-sync'\)/);
  assert.match(html, /class="btn btn-secondary ads-sync" id="ads-sync-btn"/);
  const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
  assert.match(css, /\.ads-mtools \{ display: none; \}/);
  assert.match(css, /\.app\.mobile-layout \.ads-mtools \{ display: flex;/);
});

test('ответ 404/403 от /api/ads не ломает экран', () => {
  const f = grab('_adsForbidden');
  assert.match(f, /403/);
  assert.match(f, /404/);
  assert.match(grab('_adsPost'), /catch/);
});
