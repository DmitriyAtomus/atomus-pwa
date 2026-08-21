// Фирменный вид чата с Клавой: стилистика только наша, раскладка не едет.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const skinCss = css.slice(css.indexOf('/* ============ v2.46.033: фирменный вид чата с Клавой'));
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

test('палитра фирменная: бренд-синий и фиолетовый Клавы', () => {
  assert.match(skinCss, /--ag-klava:\s*#8B7BF0/);
  assert.match(skinCss, /#2D5F8B/);
  assert.doesNotMatch(skinCss, /#22ff9c/i);
});

// На телефоне экран чата прибит к вьюпорту (position: fixed). Селектор с
// `:is(..., #devchat-drawer)` весит как ID и перебивал бы это правило: лента
// распрямлялась во всю переписку, а композер уезжал под таб-бар.
test('фирменный слой не назначает position и не трогает размеры ленты', () => {
  assert.doesNotMatch(skinRules, /:is\([^)]*#devchat-drawer[^)]*\)\s*\{[^}]*position:/);
  assert.doesNotMatch(skinRules, /position:\s*(fixed|absolute|static)/);
  assert.doesNotMatch(skinRules, /\b(height|min-height|max-height)\s*:/);
});

// Узкий экран — основной: рамка и скругление листа там только съедают ширину.
test('на телефоне лента без рамки во всю ширину', () => {
  const mob = skinRules.slice(skinRules.indexOf('@media (max-width: 760px)'));
  assert.match(mob.slice(0, mob.indexOf('\n}')), /border:\s*none;\s*border-radius:\s*0/);
});
