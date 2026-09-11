const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app-3.js'), 'utf8');
const start = source.indexOf('var _pl = null;');
const end = source.indexOf('function _plFmtDay', start);
const loader = source.slice(start, end);

test('Планёрка не ждёт список сотрудников перед загрузкой повестки', () => {
  assert.match(loader, /const employeesLoad =/);
  assert.match(loader, /apiGet\('\/api\/planerka'\)\.then/);
  assert.doesNotMatch(loader, /await\s+ensureEmployeesLoaded/);
});

test('повторные открытия используют один запрос и ошибка предлагает повторить', () => {
  assert.match(loader, /if \(_plLoadPromise\) return _plLoadPromise/);
  assert.match(loader, /onclick="loadPlanerka\(\)"[^>]*>Повторить</);
  assert.match(loader, /escapeHtml\(reason\)/);
});
