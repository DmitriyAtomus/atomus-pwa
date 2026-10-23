// v2.46.184: QR у работы — сообщение сервера доходит до человека
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const app1 = fs.readFileSync(path.join(__dirname, '..', 'app-1.js'), 'utf8');

test('showProductionWorkQr читает ответ apiPost из data и показывает причину отказа', () => {
  const fn = app1.slice(app1.indexOf('async function showProductionWorkQr'), app1.indexOf('async function editWorkLabel'));
  assert.match(fn, /const d = \(r && r\.data\) \|\| \{\}/);
  assert.match(fn, /if \(!r\.ok\) throw new Error\(d\.message \|\|/);
  assert.match(fn, /aid = d\.assembly_id/);
  assert.doesNotMatch(fn, /ensure-assembly не вернул id/);
});
