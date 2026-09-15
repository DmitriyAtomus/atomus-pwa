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
