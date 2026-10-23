const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app4 = fs.readFileSync(path.join(root, 'app-4.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

// v2.46.253: нижняя панель — разделы CRM; «Ещё» открывает полный список + бывшие пункты.

test('нижняя навигация: Главная / Продажи / Задачи / Почта / Ещё; оверлей разделов на месте', () => {
  assert.match(html, /data-main-tab="home"/);
  assert.match(html, /data-main-tab="sales"/);
  assert.match(html, /data-main-tab="tasks"/);
  assert.match(html, /data-main-tab="mail"/);
  assert.match(html, /data-main-tab="more"[\s\S]{0,80}<span>Ещё<\/span>/);
  assert.match(html, /id="mobile-sections-overlay"[\s\S]{0,900}id="mobile-sections-grid"/);
  assert.match(app4, /name === 'more' \|\| name === 'sections'/);
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
  assert.match(open, /Быстрые действия/);
  assert.match(open, /mobilePlusAction/);
});

test('меню удобно для пальца и учитывает безопасную область телефона', () => {
  assert.match(css, /\.mobile-sections-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
  assert.match(css, /\.mobile-section-tile\s*\{[^}]*min-height:\s*94px/s);
  assert.match(css, /\.mobile-sections-sheet\s*\{[^}]*env\(safe-area-inset-bottom\)/s);
  // лента m-section-tabs на мобилке скрыта — разделы в нижней панели / Ещё
  assert.match(css, /\.app\.mobile-layout \.m-section-tabs-wrap\s*\{\s*display:\s*none/);
});

test('рабочий экран подсвечивает свою вкладку; поиск/уведомления/аккаунт доступны из Ещё', () => {
  const sync = app4.slice(app4.indexOf('function syncMainTabFromSection'), app4.indexOf('// ============ ACTION SHEET'));
  assert.match(sync, /sectionName === 'sales'/);
  assert.match(sync, /mainTab = 'more'/);
  assert.match(app4, /name === 'search'/);
  assert.match(app4, /name === 'notifications'/);
  assert.match(app4, /name === 'account'/);
  assert.match(app4, /function showMobileContent\(\)/);
  assert.match(app4, /function mobilePlusAction\(\)/);
});
