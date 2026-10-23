const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app1 = fs.readFileSync(path.join(__dirname, '..', 'app-1.js'), 'utf8');
const app3 = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');

test('плашка обновляется существующим poll уведомлений', () => {
  assert.match(app1, /apiGet\('\/api\/notifications\/unread'\)/);
  assert.match(app1, /renderSupplyInvoiceAuthorAlerts\(\(notifs && notifs\.invoice_alerts\) \|\| \[\]\)/);
  assert.match(app1, /setInterval\([\s\S]*refreshNotifBadge\(\)[\s\S]*30000/);
});

test('плашка глобальная, яркая и без кнопки закрытия', () => {
  assert.match(app1, /document\.body\.appendChild\(root\)/);
  assert.match(app1, /Новый входящий счёт/);
  assert.doesNotMatch(app1, /supply-author-alert[^\n]*ti-x/);
  assert.match(css, /\.supply-author-alerts\s*\{[\s\S]*position:\s*fixed/);
  assert.match(css, /background:\s*linear-gradient\([^;]*#fff7d6/);
});

test('клик открывает конкретный счёт во Входящих', () => {
  assert.match(app1, /openSupplyInvoiceAuthorAlert\(inboxId\)/);
  assert.match(app1, /selectSection\('supply'\)/);
  assert.match(app1, /selectSidebarItem\('supply-inbox'\)/);
  assert.match(app1, /openInboxInvoice\(id\)/);
});

test('в плашке нет суммы', () => {
  const start = app1.indexOf('function renderSupplyInvoiceAuthorAlerts');
  const end = app1.indexOf('function removeSupplyInvoiceAuthorAlertByInbox', start);
  const block = app1.slice(start, end);
  assert.doesNotMatch(block, /amount|total|₽|руб/i);
});

test('все способы отправки в оплату гасят плашку сразу', () => {
  const calls = app3.match(/removeSupplyInvoiceAuthorAlertByInbox\(inboxId\)/g) || [];
  assert.equal(calls.length, 4);
  assert.match(app1, /_supplyInvoiceAuthorAlerts\.filter/);
});
