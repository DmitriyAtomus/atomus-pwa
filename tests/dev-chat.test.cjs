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
  // Не пиним конкретный номер (он растёт с каждым релизом) — проверяем,
  // что app-1.js, sw.js и version.json согласованы между собой.
  const appNum = (app.match(/const APP_VERSION = "v2\.45\.(\d+)"/) || [])[1];
  const swNum = (serviceWorker.match(/const CACHE_VERSION = 'atomus-v1\.8\.(\d+)'/) || [])[1];
  const verNum = (String(version.version).match(/v2\.45\.(\d+)/) || [])[1];
  assert.ok(appNum, 'APP_VERSION не найден в app-1.js');
  assert.equal(swNum, appNum, 'CACHE_VERSION в sw.js не совпадает с APP_VERSION');
  assert.equal(verNum, appNum, 'version.json не совпадает с APP_VERSION');
});

test('лента не рисует сообщение дважды при одновременных тиках', () => {
  // тик идёт и по таймеру, и сразу после отправки: без замка оба запроса уходят
  // с одинаковым since_id и дорисовывают одно сообщение вторым пузырём
  assert.match(app, /if \(_devChatTicking\) return;/);
  assert.match(app, /feed\.querySelector\('\[data-msg-id="' \+ m\.id \+ '"\]'\)/);
});

test('ответ показывается оформленным, но текст экранируется', () => {
  const fn = app.slice(app.indexOf('function _devChatFormat'), app.indexOf('function _devChatTime'));
  // разметку накладываем ТОЛЬКО на уже экранированный текст, иначе теги из
  // ответа доедут до ленты; блоки ``` вынимаются заранее и тоже экранируются
  assert.match(fn, /escapeHtml\(src \|\| ''\)/, 'экранирование должно идти первым');
  assert.match(fn, /escapeHtml\(blocks\[Number\(i\)\]\)/, 'блок кода тоже экранируется');
  assert.match(fn, /<code>\$1<\/code>/);
  assert.match(fn, /<b>\$1<\/b>/);
});

test('лента оформлена классами, а не инлайновыми стилями', () => {
  const render = app.slice(app.indexOf('function _devChatRender'), app.indexOf('function _devChatDayRow'));
  assert.match(render, /wrap\.className = 'dchat-row'/);
  assert.match(render, /bubble\.className = 'dchat-bubble'/);
  assert.match(render, /dchat-chip is-/, 'статус задачи рисуется чипом');
  assert.doesNotMatch(render, /cssText/, 'стили переехали в app.css');
});

test('разделители дней, «Клод работает» и пустая лента с подсказками', () => {
  assert.match(app, /function _devChatDay\(ts\)/);
  assert.match(app, /label = 'Сегодня'/);
  assert.match(app, /function _devChatTyping\(feed, on\)/);
  assert.match(app, /function _devChatEmptyHtml\(\)/);
  assert.match(app, /function devChatQuick\(btn\)/);
  assert.match(html, /class="dchat-feed"/, 'экран не переведён на новую ленту');
  assert.match(html, /id="devchat-status-text"/, 'нет строки статуса с индикатором');
});

test('поле ввода растёт под текст, а вложение можно убрать по одному', () => {
  assert.match(app, /function devChatGrow\(el\)/);
  assert.match(app, /function devChatDropFile\(i\)/);
  assert.match(html, /oninput="devChatGrow\(this\)"/);
  // кнопка отправки есть у обоих хостов — иначе блокировка на время отправки
  // работала бы только на экране
  assert.match(html, /id="devchat-send"/);
  assert.match(html, /id="devchat-drawer-send"/);
  assert.match(app, /const btn = _devChatEl\('send'\)/);
});

test('шторка гасит фон и закрывается по Esc', () => {
  assert.match(html, /id="devchat-backdrop"/);
  assert.match(app, /backdrop\.classList\.add\('show'\)/);
  assert.match(app, /if \(e\.key !== 'Escape'\) return;/);
});

test('фон шторки и пузырей задан переменными, которые объявлены', () => {
  // --bg-primary/--bg-secondary раньше нигде не объявлялись: шторка выходила
  // прозрачной поверх контента
  const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
  assert.match(css, /--bg-primary:\s*#/, '--bg-primary не объявлена');
  assert.match(css, /--bg-secondary:\s*#/, '--bg-secondary не объявлена');
});
