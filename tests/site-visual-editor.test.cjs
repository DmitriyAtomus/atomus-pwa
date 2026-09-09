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
  assert.match(app, /function _devChatArtifactBridge\(token, kpSrc\)/);   // v2.46.176: + исходник модуля меток
  assert.match(app, /kind === 'marks'/);
  assert.match(app, /function _devChatArtifactSafeMark/);
  assert.match(app, /_devChatArtifactShotFile/);
  assert.match(app, /top\.postMessage/);
  assert.match(app, /sandbox="allow-scripts allow-popups allow-forms allow-modals"/);
  assert.doesNotMatch(app, /sandbox="[^"]*allow-same-origin/);
  assert.match(app, /function _devChatArtifactSafeSelection/);
  assert.match(app, /data-atomus-visual-bridge/);
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
  assert.ok(Number(version.version.split('.').pop()) >= 119);
  assert.match(app, /function _devChatArtifactPick/);
});

// v2.46.176: метки на макете как в CRM (klava-pick в remote-режиме)
test('метки на макете: модуль подкладывается в страницу, оболочка только ретранслирует', () => {
  const bridge = app.slice(app.indexOf('function _devChatArtifactBridge(token, kpSrc)'), app.indexOf('let _kpSrcCache'));
  assert.match(bridge, /function ensureKlava\(\)/);
  assert.match(bridge, /remote: true/);
  assert.match(bridge, /onDone: function \(ctx, shot\) \{ post\('marks'/);
  assert.match(bridge, /function isLeaf\(\)/);                          // вложенная страница — метки, оболочка — нет
  assert.match(bridge, /if \(isLeaf\(\) && ensureKlava\(\)\)/);
  assert.match(bridge, /if \(!enabled \|\| window\.KlavaPick\) return;/);  // старый одиночный выбор уступает модулю
  assert.match(bridge, /replace\(\/<\\\/\/g, '<\\\\\/'\)/);                 // </ в исходнике не рвёт script
  assert.match(app, /fetch\('\/klava-pick\.js'/);
  const send = app.slice(app.indexOf('async function _devChatArtifactSend()'), app.indexOf('async function devChatOpenArtifact'));
  assert.match(send, /Метки на макете \(скриншот с рамками приложен\)/);
  assert.match(send, /_devChatFiles\.push\(shot\)/);
  assert.match(send, /marks: state\.marks \|\| \[\]/);
  assert.match(app, /Отметить на макете/);
  const mod = fs.readFileSync(path.join(__dirname, '..', 'klava-pick.js'), 'utf8');
  assert.match(mod, /if \(KP\.cfg\.remote\) fab\.classList\.add\('hidden'\)/);
  assert.match(mod, /KP\._remoteDone = async function/);
});
