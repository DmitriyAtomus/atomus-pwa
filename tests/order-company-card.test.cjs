const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'app-3.js'),
  'utf8'
);

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

test('форма заказа загружает карточки и показывает кнопку выбора', () => {
  const wizard = section(
    'async function openNewSupplyOrder()',
    'function _owzSupplierHint()'
  );

  assert.match(wizard, /apiGet\('\/api\/company-cards'\)/);
  assert.match(wizard, /id="owz-company-card"/);
  assert.match(source, /Прикрепить карточку предприятия/);
  assert.match(source, /function _owzSelectCompanyCard\(id\)/);
});

test('выбранная карточка сохраняется в браузерном черновике и заказе', () => {
  const snapshot = section(
    'function _owzSnapshot()',
    'function _owzHasContent'
  );
  const submit = section(
    'async function submitOrderWizard(send)',
    '// ========== КАРТОЧКА ЗАКАЗА'
  );

  assert.match(snapshot, /companyCardId:\s*_owz\.companyCardId/);
  assert.match(submit, /company_card_id:\s*_owz\.companyCardId\s*\|\|\s*null/);
});

test('в превью письма видна выбранная карточка предприятия', () => {
  const preview = section(
    'function _renderOrderPreviewModal(draft)',
    'async function _opFillAliasDatalist'
  );

  assert.match(preview, /const companyCard = draft\.company_card/);
  assert.match(preview, /Карточка предприятия:/);
  assert.match(preview, /op-company-card/);
});
