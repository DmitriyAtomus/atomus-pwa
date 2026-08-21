// Чат с Клавой: раздел, шторка поверх любого экрана и правила доступа.
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
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('раздел «Клава» и шторка есть в разметке', () => {
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
  assert.match(loader.slice(0, 1100), /Authorization': 'Bearer '/);
  assert.match(loader.slice(0, 1100), /URL\.createObjectURL/);
});

test('статусы дозапрашиваются только пока есть незакрытые задачи', () => {
  const fn = app.slice(app.indexOf('async function _devChatRefreshStatuses'));
  assert.match(fn.slice(0, 400), /if \(!_devChatPending\.size\)/);
});

test('версия и кэш подняты вместе', () => {
  // Не пиним конкретный номер (он растёт с каждым релизом) — проверяем,
  // что app-1.js, sw.js и version.json согласованы между собой.
  const appVersion = (app.match(/const APP_VERSION = "v(\d+\.\d+\.\d+)"/) || [])[1];
  const swNum = (serviceWorker.match(/const CACHE_VERSION = 'atomus-v1\.8\.(\d+)'/) || [])[1];
  assert.ok(appVersion, 'APP_VERSION не найден в app-1.js');
  assert.equal(swNum, appVersion.split('.').pop(),
    'CACHE_VERSION в sw.js не совпадает с APP_VERSION');
  assert.equal(String(version.version), 'v' + appVersion,
    'version.json не совпадает с APP_VERSION');
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

test('разделители дней, «Клава работает» и пустая лента с подсказками', () => {
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

test('скриншот из буфера прикрепляется по Ctrl+V', () => {
  // оба поля ввода ловят вставку, картинка докладывается к уже выбранным
  // файлам (а не затирает их), обычный текст вставляется как обычно
  assert.match(html, /id="devchat-input"[\s\S]{0,300}onpaste="devChatPaste\(event\)"/);
  assert.match(html, /id="devchat-drawer-input"[\s\S]{0,300}onpaste="devChatPaste\(event\)"/);
  const fn = app.slice(app.indexOf('function devChatPaste'), app.indexOf('let _devChatPasteBound'));
  assert.match(fn, /it\.kind !== 'file'/);
  assert.match(fn, /if \(!picked\.length\) return;/, 'текстовая вставка должна проходить насквозь');
  assert.match(fn, /devChatAddFiles\(picked\)/);
  assert.match(app, /_devChatFiles\.push\(_devChatNamed\(f\)\)/, 'вставка затирает уже выбранные файлы');
  assert.match(app, /_devChatBindPaste\(\);/, 'вставка мимо поля ввода не ловится');
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

test('чат разворачивается на всё окно и сворачивается при уходе с экрана', () => {
  const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
  assert.match(html, /id="devchat-full-btn"[\s\S]{0,80}onclick="devChatToggleFull\(\)"/,
    'нет кнопки разворота в шапке');
  // класс висит на body: скрыть надо и то, что снаружи экрана
  assert.match(app, /document\.body\.classList\.toggle\('dchat-fullscreen', on\)/);
  assert.match(css, /body\.dchat-fullscreen \[data-screen="devchat"\] \{[\s\S]{0,200}position: fixed/,
    'экран не становится overlay на весь viewport');
  // ушли в другой раздел — режим снимается, иначе следующий экран без шапки
  assert.match(app, /devChatExitFull\(\); if \(!drawerOpen\) stopDevChat\(\);/);
  assert.match(app, /function devChatExitFull[\s\S]{0,160}classList\.remove\('dchat-fullscreen'\)/);
  // Esc: сначала шторка, и только потом выход из полноэкранного режима
  // окно чуть шире исходного: перед шторкой Esc теперь отменяет запись голоса
  const esc = app.slice(app.indexOf("if (e.key !== 'Escape') return;"));
  assert.match(esc.slice(0, 600), /devChatToggleDrawer\(\); return; \}[\s\S]{0,160}devChatToggleFull\(\)/);
  // плавающая кнопка шторки в этом режиме висела бы поверх ленты
  assert.match(css, /body\.dchat-fullscreen #devchat-fab \{ display: none/);
});

test('на телефоне текст чата не разъезжается от авто-увеличения Android', () => {
  // Chrome на Android сам увеличивает кегль в длинных текстовых блоках,
  // и ответы Клода становились нечитаемо крупными
  assert.match(css, /\.dchat-feed, \.dchat-bubble, \.dchat-text \{[^}]*text-size-adjust: 100%/s);
});

test('на телефоне поле ввода не уезжает под нижнюю панель', () => {
  // высота считается от 100dvh с учётом безопасной зоны — иначе композер
  // прячется под таб-баром и жестовой полосой
  assert.match(css, /\.app\.mobile-layout \[data-screen="devchat"\] \.dchat \{[^}]*height: calc\(100dvh - \d+px - env\(safe-area-inset-bottom\)\)/s);
});

test('на экране чата круглая кнопка прячется', () => {
  assert.match(app, /screenName === 'devchat' \|\| !isDir/);
});
