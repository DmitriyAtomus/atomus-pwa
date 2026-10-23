const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');

test('заказ изготовления можно удалить из архива с подтверждением', () => {
  assert.match(source, /function mfgDeleteOrder\(orderId\)/);
  assert.match(source, /Удалить заказ .* из архива изготовления/);
  assert.match(source, /Письмо поставщику и связанная закупка не отменятся/);
});

test('удаление использует серверное мягкое удаление и обновляет оба списка', () => {
  assert.ok(source.includes("method: 'DELETE'"));
  assert.ok(source.includes("'/api/mfg/orders/' + orderId"));
  assert.match(source, /state\._mfgJournal = .*\.filter/s);
  assert.match(source, /state\.mfgCurrentItem\.orders = .*\.filter/s);
});

test('корзина доступна и в карточке изделия, и в общем журнале', () => {
  const buttons = source.match(/title="Удалить заказ из архива"/g) || [];
  assert.equal(buttons.length, 2);
});
