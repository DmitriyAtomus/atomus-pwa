const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');
const match = source.match(/function _fmtSupOrdTs\(s\) \{[\s\S]*?\n\}/);
assert.ok(match, '_fmtSupOrdTs must exist in app-3.js');

const context = { Intl, Date, isNaN };
vm.createContext(context);
vm.runInContext(`${match[0]}; this._fmtSupOrdTs = _fmtSupOrdTs;`, context);

test('SQLite UTC timestamp is shown in Yekaterinburg time', () => {
  assert.equal(context._fmtSupOrdTs('2026-07-27 12:09:00'), '2026-07-27 17:09');
});

test('explicit UTC timestamp is shown in Yekaterinburg time', () => {
  assert.equal(context._fmtSupOrdTs('2026-07-27T12:09:00Z'), '2026-07-27 17:09');
});

test('timestamp with an explicit offset is not shifted twice', () => {
  assert.equal(context._fmtSupOrdTs('2026-07-27T17:09:00+05:00'), '2026-07-27 17:09');
});

test('empty and malformed values remain safe', () => {
  assert.equal(context._fmtSupOrdTs(''), '');
  assert.equal(context._fmtSupOrdTs('неизвестно'), 'неизвестно');
});
