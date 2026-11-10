'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app3 = fs.readFileSync(path.join(root, 'app-3.js'), 'utf8');
const app1 = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));

test('версия v2.46.298 согласована', () => {
  assert.equal(ver.version, 'v2.46.298');
  assert.match(app1, /const APP_VERSION = "v2\.46\.298"/);
  assert.match(sw, /const CACHE_VERSION = 'atomus-v2\.46\.298'/);
  assert.match(app3, /version:'v2\.46\.298'/);
});

test('пустая карточка УТМ упоминает «Заказ готов» и УПД', () => {
  assert.match(app3, /Готовых заказов нет\.<br>Появятся сами, когда УТМ пришлёт «Заказ готов» или УПД\./);
  assert.doesNotMatch(app3, /когда УТМ пришлёт «Заказ готов»\.<\/div>/);
});
