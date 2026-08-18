// Компоновка проекта (chiller/project.html): правая кнопка по детали открывает
// её меню прямо под курсором — первой строкой заводская карточка позиции.
// Проверяем, что панорама правым протягом жива, что по фону меню не лезет,
// что с телефона то же даёт долгое касание и что меню закрывается.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'chiller', 'project.html'), 'utf8');

test('ПКМ по детали выделяет её и открывает меню в точке курсора', () => {
  assert.match(page, /cv\.addEventListener\('contextmenu'/);
  assert.match(page, /const hit=pickItem\(e\);\s*\n\s*if\(!hit\)\{ctxClose\(\);return;\}/);
  assert.match(page, /select\(hit\);ctxOpen\(hit,e\.clientX,e\.clientY\);/);
});

test('правый протяг остаётся панорамой — меню на него не вешаем', () => {
  assert.match(page, /if\(e\.button===2\)\{mode='pan';rmb=\{x:e\.clientX,y:e\.clientY\};return;\}/);
  assert.match(page, /if\(rmb&&\(Math\.abs\(e\.clientX-rmb\.x\)>4\|\|Math\.abs\(e\.clientY-rmb\.y\)>4\)\)\{rmb=null;return;\}/);
});

test('первая строка меню — карточка позиции из базы', () => {
  const a = page.indexOf('function ctxItems(it)');
  const b = page.indexOf('function ctxOpen(it,x,y)');
  assert.ok(a > -1 && b > a, 'не нашёл блок меню');
  const menu = page.slice(a, b);
  assert.match(menu, /\{ic:'ⓘ',t:'Карточка позиции',pri:1,go:\(\)=>openDesc\(it\.d\)\}/);
  // остальные действия — те же, что в панели выделения
  ['togglePin', 'showMnt', 'rotSel', 'tiltSel', 'rollSel', 'toFloor', 'dupSel', 'delSel']
    .forEach((fn) => assert.ok(menu.includes(fn), 'в меню нет действия ' + fn));
});

test('дублирование вынесено в функцию — её зовут и кнопка, и меню', () => {
  assert.match(page, /async function dupSel\(\)\{if\(!sel\)return;/);
  assert.match(page, /\$\('#bDup'\)\.onclick=dupSel;/);
});

test('с телефона меню даёт долгое касание детали, а сдвиг его отменяет', () => {
  assert.match(page, /if\(e\.pointerType==='touch'&&hit\)\{lpOff\(\);/);
  assert.match(page, /lpT=setTimeout\(\(\)=>\{lpT=null;mode=null;/);
  assert.match(page, /if\(lpT&&\(Math\.abs\(dx\)>3\|\|Math\.abs\(dy\)>3\)\)lpOff\(\);/);
});

test('меню закрывается кликом мимо, колесом, Esc и сменой размера окна', () => {
  assert.match(page, /addEventListener\('pointerdown',e=>\{if\(ctxOn\(\)&&!e\.target\.closest\('#ctx'\)\)ctxClose\(\);\},true\);/);
  assert.match(page, /addEventListener\('wheel',\(\)=>ctxClose\(\),true\);/);
  assert.match(page, /if\(ctxOn\(\)\)\{ctxClose\(\);return;\}/);
  assert.match(page, /addEventListener\('resize',ctxClose\);/);
});

test('меню не вылезает за край окна', () => {
  assert.match(page, /box\.style\.left=Math\.max\(M,Math\.min\(x,innerWidth-w-M\)\)\+'px';/);
  assert.match(page, /box\.style\.top =Math\.max\(M,Math\.min\(y,innerHeight-h-M\)\)\+'px';/);
});

test('подсказка на сцене рассказывает про новое поведение ПКМ', () => {
  assert.match(page, /ПКМ по детали — меню · по фону — панорама/);
  assert.ok(!/ПКМ — панорама/.test(page), 'старая подсказка осталась');
});

test('погашенная деталь узла не перехватывает клик — луч идёт сквозь неё', () => {
  const a = page.indexOf('function pickItem(e)');
  const b = page.indexOf('function planePoint', a);
  const pick = page.slice(a, b);
  assert.match(pick, /const h=hits\.find\(x=>\{/);
  assert.match(pick, /const m=ms\[x\.face\?x\.face\.materialIndex:0\];/);
  assert.match(pick, /return !m\|\|m\.visible!==false;/);
});
