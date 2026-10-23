const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('инвентаризация предупреждает о снятии недостачи из резерва', () => {
  assert.match(html, /Недостача<\/b> сначала убирает свободный остаток, затем резерв/);
  assert.match(html, /автоматически возвращает потребность договора в производство/);
  assert.match(html, /недостача; сначала свободные, затем резерв/);
});

test('результат показывает снятый резерв и возврат потребности в производство', () => {
  assert.match(html, /d\.reserved_removed && d\.reserved_removed > 0/);
  assert.match(html, /из резерва ' \+ d\.reserved_removed \+ ' шт, потребность возвращена в производство/);
});
