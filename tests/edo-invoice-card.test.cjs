// Счёт на оплату из ЭДО в списке «Поступления по ЭДО».
// Раньше раздел знал только УПД и на каждой карточке предлагал «Оприходовать».
// Счёт на склад не приходуется: у него своя кнопка — «На согласование» (или
// «Открыть счёт», если он уже заведён), а тип и источник видны чипами.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

function render(doc) {
  const code = section('function _edoIsInvoice(u)', 'function toggleEdoV2()');
  const context = {
    escapeHtml(value) {
      return String(value === null || value === undefined ? '' : value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    },
    _edoDateRu(iso) {
      const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
    },
  };
  vm.runInNewContext(`${code}\nthis.card = _edoCard;`, context);
  return context.card(doc, false);
}

test('счёт из ЭДО: свой заголовок, чип типа и кнопка согласования', () => {
  const html = render({
    id: 7, doc_kind: 'invoice', source: 'edo_auto', number: '512',
    doc_date: '2026-08-20', seller_name: 'ООО «Лидер»', seller_inn: '7451111111',
    total_with_vat: 124500.5, payment_order_id: null,
  });
  assert.match(html, /Счёт № 512/);
  assert.match(html, /счёт на оплату/);
  assert.match(html, /ЭДО, авто/);
  assert.match(html, /edoDocToApproval\(7\)/);
  assert.ok(!html.includes('edoUpdToIntake'), 'счёт на склад не приходуется');
});

test('заведённый счёт показывает свой ORD и статус согласования', () => {
  const html = render({
    id: 8, doc_kind: 'invoice', source: 'edo_manual', number: '77',
    seller_name: 'ООО Интех', payment_order_id: 314,
    payment_order_label: 'ORD-314', payment_order_status: 'approval',
  });
  assert.match(html, /ORD-314/);
  assert.match(html, /ждёт директора/);
  assert.match(html, /ЭДО, вручную/);
  assert.match(html, /openSupplyOrderFromEdo\(314\)/);
});

test('УПД остаётся прежней: оприходование на месте, плюс перевод в счёт', () => {
  const html = render({
    id: 9, doc_kind: 'upd', source: 'edo_auto', number: '847',
    seller_name: 'ООО СПТ', function: 'СЧФДОП', total_with_vat: 6000,
    matched_order_id: 12, order_label: 'ORD-12',
  });
  assert.match(html, /УПД № 847/);
  assert.match(html, /edoUpdToIntake\(9\)/);
  assert.match(html, /edoDocToApproval\(9\)/, 'если это на самом деле счёт — можно увести');
  assert.match(html, /ORD-12/);
});

test('документ без doc_kind (старые записи) читается как УПД', () => {
  const html = render({ id: 10, number: '5', seller_name: 'Поставщик' });
  assert.match(html, /УПД № 5/);
  assert.match(html, /edoUpdToIntake\(10\)/);
});
