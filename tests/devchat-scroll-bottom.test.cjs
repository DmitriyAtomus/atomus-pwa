// v2.45.978: чат Клавы открывается на последнем сообщении, а не в середине.
// Ловушек было две: CSS scroll-behavior: smooth превращал прыжок в долгую
// анимацию (её обрывало первое касание), и лента росла уже после скролла —
// картинки едут отдельным запросом под токеном.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');

test('прыжок в конец идёт мимо CSS smooth — behavior задан явно', () => {
  const fn = app.slice(app.indexOf('function _devChatToBottom'));
  assert.match(fn.slice(0, 600), /behavior: smooth \? 'smooth' : 'auto'/,
    'без явного behavior прокрутка подчинится scroll-behavior: smooth и оборвётся на полпути');
  assert.match(fn.slice(0, 600), /feed\.scrollTop = feed\.scrollHeight/,
    'нет запасного пути для старых движков');
});

test('липучка низа: держит конец, пока лента дорисовывается, и снимается жестом', () => {
  const fn = app.slice(app.indexOf('function _devChatStickBottom'));
  assert.match(fn.slice(0, 1200), /_devChatStickUntil = Date\.now\(\)/, 'нет окна удержания');
  assert.match(fn.slice(0, 1200), /setInterval\(/, 'низ не додавливается, пока растёт высота');
  assert.match(fn.slice(0, 1200), /'wheel', 'touchstart', 'pointerdown', 'keydown'/,
    'жест пользователя должен выключать липучку — иначе не отмотать историю');
  assert.match(app, /function _devChatStickStop\(\)/);
  // уходим с экрана — таймер липучки не должен жить дальше
  const stop = app.slice(app.indexOf('function stopDevChat'));
  assert.match(stop.slice(0, 600), /_devChatStickStop\(\);/);
});

test('первая отрисовка переписки прыгает в конец с удержанием', () => {
  const fn = app.slice(app.indexOf('async function _devChatTickInner'));
  assert.match(fn.slice(0, 2000), /const first = _devChatSince === 0;/,
    'не отличаем «открыли чат» от «пришло новое сообщение»');
  assert.match(fn.slice(0, 2000), /if \(msgs\.length && first\) _devChatStickBottom\(2500\);/);
  assert.match(fn.slice(0, 2000), /else if \(msgs\.length && nearBottom\) _devChatStickBottom\(900\);/);
});

test('картинка догружается — лента доводится до конца, если стояли внизу', () => {
  const fn = app.slice(app.indexOf('async function _devChatLoadImage'));
  assert.match(fn.slice(0, 1200), /_devChatAtBottom\(220\) \|\| Date\.now\(\) < _devChatStickUntil/,
    'решение доскроллить надо принимать ДО подстановки src — потом высота уже другая');
  assert.match(fn.slice(0, 1200), /addEventListener\('load'/,
    'скролл до onload бессмыслен: высоты картинки ещё нет');
});

test('кнопка «вниз» прыгает мгновенно', () => {
  const fn = app.slice(app.indexOf('function devChatJump'));
  assert.match(fn.slice(0, 500), /_devChatStickBottom\(700\)/);
});
