const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app4 = fs.readFileSync(path.join(root, 'app-4.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('нижняя навигация и верхняя лента открывают все разделы', () => {
  assert.match(html, /data-main-tab="sections" onclick="switchMainTab\('sections'\)"[\s\S]{0,120}<span>Разделы<\/span>/);
  assert.match(html, /id="m-section-tabs-all" onclick="openMobileSections\(\)"/);
  assert.match(html, /id="mobile-sections-overlay"[\s\S]{0,900}id="mobile-sections-grid"/);
});

test('меню строится из разрешённых разделов и отмечает текущий', () => {
  const list = app4.slice(app4.indexOf('const DRW_SECTIONS'), app4.indexOf('function _drwGoSection'));
  assert.match(list, /code: 'logistics'/);
  assert.match(list, /code: 'mail'/);
  assert.match(list, /function _mobileAvailableSections\(\)/);
  assert.match(list, /hasAnyPermission\('hr\.view_vacations'/);
  assert.match(list, /hasPermission\('installation\.view'\)/);
  const open = app4.slice(app4.indexOf('function openMobileSections'), app4.indexOf('function switchMainTab'));
  assert.match(open, /s\.code === state\.currentSection \? ' active' : ''/);
  assert.match(open, /aria-current="page"/);
  assert.match(open, /function mobileGoSection\(code\)[\s\S]*selectSection\(code\)/);
});

test('меню удобно для пальца и учитывает безопасную область телефона', () => {
  assert.match(css, /\.mobile-sections-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
  assert.match(css, /\.mobile-section-tile\s*\{[^}]*min-height:\s*94px/s);
  assert.match(css, /\.mobile-sections-sheet\s*\{[^}]*env\(safe-area-inset-bottom\)/s);
  assert.match(css, /\.app\.mobile-layout \.m-section-tabs-all\s*\{\s*display:\s*flex/);
});

test('любой рабочий экран подсвечивает «Разделы», отдельные вкладки сохранены', () => {
  const sync = app4.slice(app4.indexOf('function syncMainTabFromSection'), app4.indexOf('// ============ ACTION SHEET'));
  assert.match(sync, /screenName === 'account' \? 'account' : 'sections'/);
  assert.match(app4, /name === 'search'/);
  assert.match(app4, /name === 'notifications'/);
  assert.match(html, /class="tab25 plus-tab25" onclick="mobilePlusAction\(\)"/);
  assert.match(app4, /function showMobileContent\(\)/);
  assert.doesNotMatch(app4, /switchMainTab\('home'\)/);
});
