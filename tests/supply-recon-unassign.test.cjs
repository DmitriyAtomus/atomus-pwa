// «Вернуть разнос» в карточке сверки (v2.46.325).
// 27.11.2026: внутренний блок по ошибке разнесли в «Наружный блок 24» (ORD-509),
// а отменить можно было только удалением всей УПД. Кнопка снимает связь одной строки.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');

function reconContext(extra = {}) {
  const code = source.slice(
    source.indexOf('// ==== СВЕРКА ПРИЁМКИ С ЗАКАЗАМИ'),
    source.indexOf('function renderSiDestTiles(items) {')
  );
  const context = {
    escapeHtml(value) {
      return String(value == null ? '' : value)
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    },
    siState: {},
    document: { getElementById: () => null },
    ...extra,
  };
  vm.runInNewContext(`${code}\nthis.render = renderSiRecon;`, context);
  return context;
}

const target = { order_id: 509, order_label: 'ORD-509', order_item_id: 766, si_name: 'Наружный блок 24', qty: 1, receipt_item_id: 210, manual: false };
const RECON = {
  ok: false,
  counts: { accepted_lines: 3, matched: 2, partial: 1, unmatched: 1, short: 0, orders: 1 },
  orders: [{ order_id: 509, order_label: 'ORD-509' }],
  matched: [
    { invoice_item_id: 1050, name: 'MD-SNC24AI-IDU', qty: 1, unit: 'шт', allocated: 1, remaining: 0, targets: [target], can_unassign: true },
    { invoice_item_id: 1052, name: 'Ручная связь', qty: 2, unit: 'шт', allocated: 1, remaining: 1, partial: true,
      targets: [{ ...target, manual: true }], can_unassign: false, candidates: [] },
  ],
  unmatched: [
    { invoice_item_id: 1051, name: 'MD-SNC24AI-ODU', qty: 1, unit: 'шт', allocated: 0, remaining: 1, targets: [],
      candidates: [{ order_id: 509, order_label: 'ORD-509', order_item_id: 766, si_name: 'Наружный блок 24', remaining: 0, likely: true }] },
  ],
  short: [],
};

test('у разнесённой строки есть «Вернуть разнос», у нераснесённой и ручной — нет', () => {
  const html = reconContext().render(RECON, 184);
  assert.ok(html.includes('siReconUnassign(184,1050,this)'));
  assert.ok(html.includes('Вернуть разнос'));
  assert.ok(!html.includes('siReconUnassign(184,1051,'));
  assert.ok(!html.includes('siReconUnassign(184,1052,'));
});

test('кнопка шлёт unassign и перерисовывает сверку; отказ — без перерисовки', async () => {
  const calls = [];
  const toasts = [];
  const after = { ...RECON, matched: [], unmatched: RECON.unmatched.concat([{ ...RECON.matched[0], allocated: 0, remaining: 1, targets: [], candidates: [] }]) };
  const ctx = reconContext({
    confirm: () => true,
    showToast: (m, k) => toasts.push([m, k]),
    apiPost: async (url, body) => { calls.push([url, body]); return { ok: true, status: 200, data: { unassigned: { order_labels: ['ORD-509'] }, reconciliation: after } }; },
    loadSupplyInvoiceDetail: () => {},
  });
  ctx.siState.currentInvoiceId = 184;
  ctx.siState.currentData = {};
  const button = { disabled: false };
  await ctx.siReconUnassign(184, 1050, button);
  assert.equal(JSON.stringify(calls), JSON.stringify([['/api/supply/invoices/184/reconcile/unassign', { invoice_item_id: 1050 }]]));
  assert.equal(ctx.siState.currentData.reconciliation, after);
  assert.equal(button.disabled, false);
  assert.match(toasts[0][0], /Разнос отменён · ORD-509/);

  const ctx2 = reconContext({ confirm: () => false, apiPost: async () => { throw new Error('не должно вызываться'); } });
  await ctx2.siReconUnassign(184, 1050, null);
});

test('повтор (409) показывает причину и перечитывает сверку', async () => {
  const toasts = [];
  const gets = [];
  const ctx = reconContext({
    confirm: () => true,
    showToast: (m, k) => toasts.push([m, k]),
    apiPost: async () => ({ ok: false, status: 409, data: { error: 'not_assigned', message: 'Строка УПД не разнесена по заказам — отменять нечего' } }),
    apiGet: async (url) => { gets.push(url); return { reconciliation: null }; },
  });
  await ctx.siReconUnassign(184, 1050, { disabled: false });
  assert.equal(toasts[0][1], 'error');
  assert.match(toasts[0][0], /отменять нечего/);
  assert.equal(JSON.stringify(gets), JSON.stringify(['/api/supply/invoices/184/reconciliation']));
});
