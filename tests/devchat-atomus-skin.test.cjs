// Чистый вид чата с Клавой в духе ChatGPT: нейтральный, раскладка не едет.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const skinCss = css.slice(css.indexOf('/* ============ v2.46.092: Клава — просторный focus-режим'));
// Проверки правил ведём по «голому» CSS: слова вроде position: fixed живут и в
// комментариях-объяснениях, а речь про то, что реально попадает в браузер.
const skinRules = skinCss.replace(/\/\*[\s\S]*?\*\//g, '');

test('матричной шкуры не осталось ни в стилях, ни в коде', () => {
  assert.doesNotMatch(css, /dchat-mx/);
  assert.doesNotMatch(js, /_dcMx|dchat-mx|_DC_MX_GLYPHS/);
  assert.doesNotMatch(html, /dchat-skin-btn|devChatSkinToggle/);
});

test('вид один, поэтому выбора в localStorage больше нет', () => {
  assert.doesNotMatch(js, /atomus_dchat_skin/);
  const fn = js.slice(js.indexOf('function _devChatSkinApply'));
  assert.match(fn.slice(0, fn.indexOf('}')), /classList\.add\('dchat-ag'\)/);
});

test('палитра чата нейтральная, без старой сетки и тяжёлого градиента', () => {
  assert.match(skinCss, /--dchat-panel:\s*#fafafa/);
  assert.match(skinCss, /body\.dchat-ag \.dchat-feed \{[\s\S]*?background:\s*#fcfcfd/);
  assert.doesNotMatch(skinCss, /--ag-grid|linear-gradient\(var\(--ag-grid\)/);
});

// На телефоне экран чата прибит к вьюпорту (position: fixed). Селектор с
// `:is(..., #devchat-drawer)` весит как ID и перебивал бы это правило: лента
// распрямлялась во всю переписку, а композер уезжал под таб-бар.
test('новый визуальный слой не назначает position и не трогает высоту ленты', () => {
  assert.doesNotMatch(skinRules, /:is\([^)]*#devchat-drawer[^)]*\)\s*\{[^}]*position:/);
  assert.doesNotMatch(skinRules, /position:\s*(fixed|absolute|static)/);
  const feedRule = skinRules.match(/body\.dchat-ag \.dchat-feed \{([^}]*)\}/);
  assert.ok(feedRule, 'правило ленты найдено');
  assert.doesNotMatch(feedRule[1], /\b(height|min-height|max-height)\s*:/);
});

test('ответ Клавы плоский, пузырь остаётся только у пользователя', () => {
  assert.match(skinRules, /\.dchat-row:not\(\.is-mine\) \.dchat-bubble \{[^}]*background:\s*transparent;[^}]*border:\s*0;/s);
  assert.match(skinRules, /\.dchat-row\.is-mine \.dchat-bubble \{[^}]*background:\s*#f0f0f0;[^}]*border-radius:\s*22px;/s);
});

test('композер собран округлой плавающей панелью', () => {
  assert.match(skinRules, /\.dchat-box,[\s\S]*?border-radius:\s*28px;[\s\S]*?box-shadow:/);
  assert.match(skinRules, /\.dchat-mic,[\s\S]*?\.dchat-send \{[^}]*border-radius:\s*50%;/s);
});

test('на широком экране чат получает focus-раскладку без второго меню CRM', () => {
  assert.match(skinRules, /body\.dchat-screen \.app\.desktop-layout \{[^}]*max-width:\s*1920px;/s);
  assert.match(skinRules, /body\.dchat-screen \.app\.desktop-layout \.body-layout \{[^}]*grid-template-columns:\s*78px minmax\(0, 1fr\)/s);
  assert.match(skinRules, /\.sidebar\[data-visible="1"\] \{ display:\s*none;/);
});

test('историю можно свернуть кнопкой в шапке', () => {
  assert.match(html, /dchat-list-btn[^>]*aria-expanded="true"/);
  assert.match(js, /list\.classList\.toggle\('is-collapsed'\)/);
  assert.match(skinRules, /\.dchat-list\.is-collapsed \{[^}]*width:\s*0;[^}]*pointer-events:\s*none;/s);
});

// Узкий экран — основной: рамка и скругление листа там только съедают ширину.
test('на телефоне лента без рамки во всю ширину', () => {
  const mob = skinRules.slice(skinRules.indexOf('@media (max-width: 760px)'));
  const feedRule = mob.match(/body\.dchat-ag \.dchat-feed \{([^}]*)\}/);
  assert.ok(feedRule, 'мобильное правило ленты найдено');
  assert.match(feedRule[1], /border:\s*(?:0|none);[\s\S]*border-radius:\s*0/);
});
