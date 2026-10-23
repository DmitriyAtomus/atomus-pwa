const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('в шапке есть кнопка прямого эфира с одним обработчиком', () => {
  const html = read('index.html');
  assert.match(html, /id="tv-cast-top-btn"/);
  assert.match(html, /onclick="toggleTvScreenCast\(\)"/);
  assert.match(html, />Экран на ТВ</);
});

test('кнопка доступна только директору и не отображается в TV-режиме', () => {
  const app1 = read('app-1.js');
  const app4 = read('app-4.js');
  assert.match(app1, /roles\.includes\('director'\) && !window\._tvMode/);
  assert.match(app4, /roles\.includes\('director'\) && !window\._tvMode/);
});

test('кнопка запускает и останавливает эфир через backend', () => {
  const app4 = read('app-4.js');
  assert.match(app4, /apiGet\('\/api\/tv\/screen'\)/);
  assert.match(app4, /apiPost\('\/api\/tv\/screen', \{ action: action \}\)/);
  assert.match(app4, /st\.status === 'active' \|\| st\.status === 'starting'/);
  assert.match(app4, /st\.action === 'stop' \? 'stop' : 'start'/);
});
