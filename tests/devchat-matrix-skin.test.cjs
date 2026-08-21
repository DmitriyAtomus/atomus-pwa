// Вид «Атомус × Матрица» в чате с Клавой: цвета наши, раскладка не едет.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const skinCss = css.slice(css.indexOf('/* ============ v2.46.029: вид «Атомус × Матрица»'));

test('кнопка вида есть и на экране чата, и в шторке', () => {
  assert.equal((html.match(/onclick="devChatSkinToggle\(\)"/g) || []).length, 2);
  assert.match(html, /class="dchat-skin-btn"/);
});

test('без выбора показываем матрицу, светлый вид включается явно', () => {
  const fn = js.slice(js.indexOf('function devChatSkinIsMatrix'),
                      js.indexOf('function _devChatSkinBtns'));
  assert.match(fn, /!==\s*'atomus'/);
  const toggle = js.slice(js.indexOf('function devChatSkinToggle'),
                          js.indexOf('function _devChatSkinApply'));
  assert.match(toggle, /'atomus'\s*:\s*'matrix'/);
});

test('зелёного неона в шкуре нет — только наши синий и фиолетовый', () => {
  assert.match(skinCss, /--mx-brand:\s*#5B8FC7/);
  assert.match(skinCss, /--mx-klava:\s*#8B7BF0/);
  assert.doesNotMatch(skinCss, /#22ff9c/i);
  assert.doesNotMatch(js.slice(js.indexOf('_DC_MX_GLYPHS')), /rgba\(34,\s*255,\s*156/);
});

// На телефоне экран чата прибит к вьюпорту (position: fixed). Селектор с
// `:is(..., #devchat-drawer)` весит как ID и перебивал бы это правило: лента
// распрямлялась во всю переписку, а композер уезжал под таб-бар.
test('шкура не назначает position экрану чата', () => {
  assert.doesNotMatch(skinCss, /:is\([^)]*#devchat-drawer[^)]*\)\s*\{[^}]*position:/);
  const screenRule = skinCss.slice(skinCss.indexOf('body.dchat-mx .screen[data-screen="devchat"],'));
  assert.doesNotMatch(screenRule.slice(0, screenRule.indexOf('}')), /position:/);
});

// Пока раскладка не устоялась, лента меряется во всю переписку — это десятки
// тысяч пикселей, полотно такого размера браузер не выделит.
test('полотно дождя режется по экрану', () => {
  const box = js.slice(js.indexOf('function _dcMxBox'), js.indexOf('function _dcMxDrop'));
  assert.match(box, /Math\.min\(Math\.round\(f\.width\), window\.innerWidth\)/);
  assert.match(box, /Math\.min\(Math\.round\(f\.height\), window\.innerHeight\)/);
});

// Кнопка «в конец переписки» висит в углу ленты на position: absolute —
// поднимать содержимое над дождём скопом нельзя, она уезжает в поток.
test('над фоном поднимаем поимённо, кнопку «вниз» не трогаем', () => {
  assert.doesNotMatch(skinCss, /\.dchat-mxhost > \*:not\(\.dchat-mxbg\)/);
  assert.match(skinCss, /\.dchat-mxhost > \.dchat-jump \{ z-index/);
});

test('дождь живёт только на видимом чате', () => {
  const sync = js.slice(js.indexOf('function _devChatSkinSync'), js.indexOf('function _dcMxRainAdd'));
  assert.match(sync, /drawer\.style\.display === 'flex'/);
  assert.match(sync, /cancelAnimationFrame/);
});
