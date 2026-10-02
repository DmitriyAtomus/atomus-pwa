const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app1 = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const app3 = fs.readFileSync(path.join(root, 'app-3.js'), 'utf8');

test('экран «Счета на оплату» показывает аванс рядом с загрузкой счёта', () => {
  const screen = html.slice(html.indexOf('data-screen="supply-pay"'), html.indexOf('data-screen="supply-order-detail"'));
  assert.match(screen, /Счета на оплату/);
  assert.match(screen, /Счета от поставщиков и ручные авансы без счёта/);
  assert.match(screen, /id="pay-list-upload-btn"/);
  assert.match(screen, /Загрузить счёт/);
  assert.match(screen, /id="pay-list-advance-btn"/);
  assert.match(screen, /Аванс поставщику/);
  assert.match(screen, /data-pay-tab="to_pay"/);
  assert.match(screen, /data-pay-tab="paid"/);
  assert.match(screen, /data-pay-tab="all"/);
  assert.match(screen, /Только авансы/);
  assert.match(screen, /Мои записи/);
  assert.match(screen, /Тип: аванс без счёта/);
  assert.match(screen, /Тип: счёт по заказу/);
});

test('кнопка аванса есть только у директора и коммерческого директора', () => {
  const fn = app3.slice(app3.indexOf('function canCreateSupplierAdvance'), app3.indexOf('function canMarkPayListPaid'));
  assert.match(fn, /director/);
  assert.match(fn, /zam/);
  assert.doesNotMatch(fn, /accountant/);
  const sync = app3.slice(app3.indexOf('function syncAdvanceCreateButton'), app3.indexOf('function _payListMoney'));
  assert.match(sync, /display = 'none'/);
});

test('без поставщика, суммы и назначения аванс не сохраняется', () => {
  const fn = app3.slice(app3.indexOf('async function saveSupplierAdvance'), app3.indexOf('function openSupplierAdvanceCard'));
  assert.match(fn, /Выберите поставщика/);
  assert.match(fn, /Укажите сумму/);
  assert.match(fn, /Укажите назначение платежа/);
  assert.match(fn, /\/api\/supplier-advances/);
});

test('аванс отмечается оплаченным тем же паролем, что и счёт', () => {
  assert.match(app3, /function payAdvanceMarkPaid/);
  assert.match(app3, /\/api\/supplier-advances\/' \+ id \+ '\/pay/);
  assert.match(app3, /password_required/);
  assert.match(app3, /function payListMarkPaid/);
  assert.match(app1, /selectSidebarItem\('supply-pay'\)/);
  assert.match(app1, /type=advance/);
});
