const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');
const start = app.indexOf('function renderPublicItemCard');
const end = app.indexOf('\nfunction renderPublicContractCard', start);

assert.ok(start >= 0 && end > start, 'renderPublicItemCard не найден');

const context = {
  encodeURIComponent,
  escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  },
};
vm.runInNewContext(
  app.slice(start, end) + '\nthis.renderPublicItemCard = renderPublicItemCard;',
  context,
);

test('QR-карточка отделяет одну единицу от количества по договору и резерва', () => {
  const html = context.renderPublicItemCard(
    {
      name: 'Комплект к УДФ-1',
      qty: 2,
      qty_reserved: 2,
      unit: 'шт.',
      status_label: 'Готово / в резерве',
    },
    {
      number: 'Договор № 17АГ/08.26',
      contractor_name: 'ВС-ХОЛОД ООО',
    },
    'public-token',
  );

  assert.match(html, /Это изделие<\/span><span class="public-row-value">1 шт\./);
  assert.match(html, /По договору<\/span><span class="public-row-value">2 шт\./);
  assert.match(html, /В резерве под объект<\/span><span class="public-row-value">2 шт\./);
  assert.doesNotMatch(html, />Количество<\/span>/);
  assert.match(html, /QR-код изделия · Договор № 17АГ\/08\.26/);
  assert.doesNotMatch(html, /№ Договор №/);
});
