const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app-4.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('карточка заявки показывает закрытые вложения из ответа API', () => {
  assert.match(app, /function _sLeadFilesHtml\(files\)/);
  assert.match(app, /escapeHtml\(f\.url \|\| '#'\)/);
  assert.match(app, /_sLeadFilesHtml\(l\.files\)/);
  assert.match(css, /\.st-lead-files a \{[^}]*min-height: 44px/);
});

test('новые нормализованные параметры заявки подписаны по-русски', () => {
  for (const field of ['cheeses', 'walls', 'panel_thickness_mm', 'cheese_load_kg', 'temperature_c', 'humidity_percent']) {
    assert.match(app, new RegExp(field));
  }
  assert.match(app, /ответственные уведомлены/);
  assert.match(app, /согласие:/);
});

test('сегмент клиента, статья и место формы показаны в заявке', () => {
  const start = app.indexOf('const _S_AUDIENCES');
  const end = app.indexOf('function _sLeadFilesHtml');
  const escapeHtml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fn = new Function('escapeHtml', app.slice(start, end) + '; return { _sParamsHtml, _sAudienceLabel };')(escapeHtml);
  const html = fn._sParamsHtml({ audience: 'craft', audience_label: 'Для крафтовых сыроварен', article: 'kak-vybrat', article_title: 'Как <выбрать>', form_place: 'после статьи' });
  assert.match(html, /<td>Сегмент<\/td><td>Для крафтовых сыроварен<\/td>/);
  assert.match(html, /<td>Статья<\/td><td>Как &lt;выбрать&gt; \(kak-vybrat\)<\/td>/);
  assert.match(html, /<td>Место формы<\/td><td>после статьи<\/td>/);
  assert.doesNotMatch(html, /audience|form_place|article_title/);
  assert.equal(fn._sAudienceLabel({ audience: 'home' }), 'Для домашних сыроварен');
  assert.equal(fn._sAudienceLabel({ audience: 'undecided' }, true), '');
  assert.match(fn._sParamsHtml({ article: 'slug-only' }), /<td>Статья<\/td><td>slug-only<\/td>/);
  assert.match(app, /_sAudienceLabel\(l\.params, true\)/);
});
