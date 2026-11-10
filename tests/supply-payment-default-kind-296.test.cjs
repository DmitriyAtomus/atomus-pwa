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

test('v2.46.296: флаг скрытия включён и обратим, по умолчанию товар и склад', () => {
  assert.equal(sc.SC_PAYMENT_DEFAULT_KIND, 'goods');
  assert.equal(sc.SC_PAYMENT_DEFAULT_DEST, 'stock');
  assert.equal(sc.SC_FLAGS.hidePurchaseKind, true);
  assert.equal(sc.scHidePurchaseKind(), true);
  assert.equal(sc.scPaymentKind({kind: null}), 'goods');
  assert.equal(sc.scPaymentKind({kind: ''}), 'goods');
  assert.equal(sc.scPaymentKind({kind: 'unknown'}), 'goods');
  assert.equal(sc.scPaymentKind({kind: 'mfg'}), 'mfg');
  assert.equal(sc.scPaymentKind({kind: 'service'}), 'service');
  assert.equal(sc.scPaymentKind({kind: 'goods'}), 'goods');
  const htmlOffDefault = sc.scKindSegHtml('payinv', null);
  assert.match(htmlOffDefault, /hidden/);
  assert.doesNotMatch(htmlOffDefault, /<button/);
  assert.match(htmlOffDefault, /data-value="goods"/);
  sc.SC_FLAGS.hidePurchaseKind = false;
  try {
    assert.equal(sc.scHidePurchaseKind(), false);
    const htmlOn = sc.scKindSegHtml('payinv', null);
    assert.doesNotMatch(htmlOn, /hidden/);
    assert.match(htmlOn, /Товар/);
    assert.match(htmlOn, /Изготовление/);
    assert.match(htmlOn, /Услуга/);
  } finally {
    sc.SC_FLAGS.hidePurchaseKind = true;
  }
  assert.equal(sc.scHidePurchaseKind(), true);
});

test('v2.46.296: в оплате / загрузке счёта / мастере / карточке выбор типа скрыт за флагом', () => {
  const src = read('supply-chain.js');
  assert.match(src, /SC_FLAGS\.hidePurchaseKind/);
  assert.match(src, /scHidePurchaseKind\(\)/);
  const pay = src.slice(src.indexOf('async function scCompletePaymentDetails'), src.indexOf('function scKindSegHtml'));
  assert.match(pay, /if \(scHidePurchaseKind\(\)\)/);
  assert.match(pay, /scFillPaymentDefaults/);
  const wiz = src.slice(src.indexOf('// ---------- «Оформить заказ»'), src.indexOf('// ---------- превью письма'));
  assert.match(wiz, /scHidePurchaseKind\(\) \? '' : '.*Тип · обязательно/);
  const up = src.slice(src.indexOf("root.openUploadInvoiceToPay"), src.indexOf('root._payInvSubmit'));
  assert.match(up, /scHidePurchaseKind\(\) \? '' : '.*Тип · обязательно/);
  const card = src.slice(src.indexOf('const kindChips ='), src.indexOf('if (st === \'paid\')'));
  assert.match(card, /if \(!root\.scHidePurchaseKind\(\)\)/);
});

test('v2.46.296: «Куда» нужно только товару/изготовлению без назначения у новых заказов', () => {
  assert.equal(sc.scPaymentNeedsDest({chain_new: true, items: [], dest_type: null}, 'goods'), true);
  assert.equal(sc.scPaymentNeedsDest({chain_new: true, items: [], dest_type: 'stock'}, 'goods'), false);
  assert.equal(sc.scPaymentNeedsDest({chain_new: true, items: [], dest_type: null}, 'service'), false);
  assert.equal(sc.scPaymentNeedsDest({chain_new: false, items: [], dest_type: null}, 'goods'), false);
  assert.equal(sc.scPaymentNeedsDest({chain_new: true, items: [{dest_type: 'shop'}]}, 'mfg'), false);
  assert.equal(sc.scPaymentNeedsDest({chain_new: true, items: [{dest_type: null}]}, 'mfg'), true);
});
