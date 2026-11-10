const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const sc = require('../supply-chain.js');
const version = JSON.parse(read('version.json'));

test('v2.46.296: версия согласована', () => {
  const app1 = read('app-1.js');
  const sw = read('sw.js');
  assert.equal(version.version, 'v2.46.296');
  assert.match(app1, /const APP_VERSION = "v2\.46\.296"/);
  assert.match(app1, /const APP_VERSION_DATE = "10\.11\.2026"/);
  assert.match(sw, /const CACHE_VERSION = 'atomus-v2\.46\.296'/);
  assert.match(read('app-3.js'), /version:'v2\.46\.296'/);
});

test('v2.46.296: по умолчанию подставляется товар, уже указанный тип не подменяется', () => {
  assert.equal(sc.SC_PAYMENT_DEFAULT_KIND, 'goods');
  assert.equal(sc.scPaymentKind({kind: null}), 'goods');
  assert.equal(sc.scPaymentKind({kind: ''}), 'goods');
  assert.equal(sc.scPaymentKind({kind: 'unknown'}), 'goods');
  assert.equal(sc.scPaymentKind({kind: 'mfg'}), 'mfg');
  assert.equal(sc.scPaymentKind({kind: 'service'}), 'service');
  assert.equal(sc.scPaymentKind({kind: 'goods'}), 'goods');
});

test('v2.46.296: в окне оплаты нет выбора типа закупки', () => {
  const src = read('supply-chain.js');
  const start = src.indexOf('async function scCompletePaymentDetails');
  const end = src.indexOf('function scKindSegHtml', start);
  assert.ok(start >= 0 && end > start);
  const fn = src.slice(start, end);
  assert.doesNotMatch(fn, /sc-payment-kind|Тип закупки|Выберите тип закупки/);
  assert.match(fn, /Куда закупаем/);
  assert.match(fn, /scPaymentKind\(order\)/);
});

test('v2.46.296: «Куда» нужно только товару/изготовлению без назначения', () => {
  assert.equal(sc.scPaymentNeedsDest({chain_new: true, items: [], dest_type: null}, 'goods'), true);
  assert.equal(sc.scPaymentNeedsDest({chain_new: true, items: [], dest_type: 'stock'}, 'goods'), false);
  assert.equal(sc.scPaymentNeedsDest({chain_new: true, items: [], dest_type: null}, 'service'), false);
  assert.equal(sc.scPaymentNeedsDest({chain_new: false, items: [], dest_type: null}, 'goods'), false);
  assert.equal(sc.scPaymentNeedsDest({chain_new: true, items: [{dest_type: 'shop'}]}, 'mfg'), false);
  assert.equal(sc.scPaymentNeedsDest({chain_new: true, items: [{dest_type: null}]}, 'mfg'), true);
});
