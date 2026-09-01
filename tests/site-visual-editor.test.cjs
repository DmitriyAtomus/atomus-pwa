const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
const version = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));

test('визуальный редактор доступен только в рабочем чате сайта', () => {
  assert.match(app, /const visual = _devChatEmployeeMode\(\)/);
  assert.match(app, /data-art-pick[^>]*aria-pressed="false"/);
  assert.match(app, /ВИЗУАЛЬНАЯ ПРАВКА САЙТА/);
  assert.match(app, /screen: 'site_visual_editor'/);
});

test('выбранный блок передаётся Клаве с точным контекстом', () => {
  assert.match(app, /Страница:.*selection\.page/);
  assert.match(app, /Элемент:.*selection\.selector/);
  assert.match(app, /Текущий текст:.*selection\.text/);
  assert.match(app, /Внеси правку в рабочие исходники сайта, проверь компьютер и телефон/);
});

test('мост выбора не получает origin и токен CRM', () => {
  assert.match(app, /function _devChatArtifactBridge\(token\)/);
  assert.match(app, /parent\.postMessage/);
  assert.match(app, /sandbox="allow-scripts allow-popups allow-forms allow-modals"/);
  assert.doesNotMatch(app, /sandbox="[^"]*allow-same-origin/);
  assert.match(app, /function _devChatArtifactSafeSelection/);
});

test('предпросмотр переключается между компьютером, планшетом и телефоном', () => {
  for (const mode of ['desktop', 'tablet', 'mobile']) {
    assert.match(app, new RegExp(`data-art-viewport="${mode}"`));
  }
  assert.match(css, /data-viewport="tablet"/);
  assert.match(css, /data-viewport="mobile"/);
  assert.match(css, /\.dchat-artedit-compose/);
});

test('версия содержит визуальные правки сайта', () => {
  assert.equal(version.version, 'v2.46.118');
  assert.match(version.label, /Визуальные правки сайта/);
  assert.match(app, /const APP_VERSION = "v2\.46\.118"/);
});
