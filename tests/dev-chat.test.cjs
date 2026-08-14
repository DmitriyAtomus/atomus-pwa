// Чат с Клодом: раздел, шторка поверх любого экрана и правила доступа.
// Проверяем то, что легко потерять при правках: пункт и кнопка видны только
// директору, лента опрашивается лишь когда есть где её показывать, а вложения
// тянутся с токеном (иначе картинки молча не грузятся).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const version = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

test('раздел «Клод» и шторка есть в разметке', () => {
  assert.match(html, /id="sb-devchat"/, 'нет пункта меню');
  assert.match(html, /data-screen="devchat"/, 'нет экрана');
  assert.match(html, /id="devchat-feed"/, 'нет ленты экрана');
  assert.match(html, /id="devchat-fab"/, 'нет плавающей кнопки');
  assert.match(html, /id="devchat-drawer-feed"/, 'нет ленты шторки');
});

test('пункт меню и кнопка показываются только директору', () => {
  const start = app.indexOf("const navDev = document.getElementById('sb-devchat')");
  assert.ok(start > 0, 'не найден показ пункта меню');
  const block = app.slice(start - 200, start + 400);
  assert.match(block, /roles\.includes\('director'\)/);
  assert.match(block, /devchat-fab/);
});

test('экран подключён к навигации и не гасит открытую шторку', () => {
  assert.match(app, /if \(screenName === 'devchat'\) loadDevChat\('screen'\)/);
  assert.match(app, /drawerOpen/, 'уход с экрана обрывает шторку');
});

test('лента и ввод берутся из активного хоста — экрана или шторки', () => {
  assert.match(app, /function _devChatEl\(name\)/);
  assert.match(app, /_devChatHost === 'drawer' \? 'devchat-drawer-' : 'devchat-'/);
  const send = app.slice(app.indexOf('async function devChatSend'));
  assert.match(send.slice(0, 400), /_devChatEl\('input'\)/);
});

test('задача уходит вместе с тем, откуда её написали', () => {
  const send = app.slice(app.indexOf('async function devChatSend'));
  assert.match(send.slice(0, 1400), /screen: state\.currentScreen/);
  assert.match(send.slice(0, 1400), /form\.append\('context'/);
});

test('вложения запрашиваются с токеном (иначе 401 и пустая картинка)', () => {
  const loader = app.slice(app.indexOf('async function _devChatLoadImage'));
  assert.match(loader.slice(0, 600), /Authorization': 'Bearer '/);
  assert.match(loader.slice(0, 600), /URL\.createObjectURL/);
});

test('статусы дозапрашиваются только пока есть незакрытые задачи', () => {
  const fn = app.slice(app.indexOf('async function _devChatRefreshStatuses'));
  assert.match(fn.slice(0, 400), /if \(!_devChatPending\.size\)/);
});

test('версия и кэш подняты вместе', () => {
  assert.equal(version.version, 'v2.45.941');
  assert.match(app, /const APP_VERSION = "v2\.45\.941"/);
  assert.match(serviceWorker, /const CACHE_VERSION = 'atomus-v1\.8\.941'/);
});
