const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');
const start = source.indexOf('function _parseShipmentQr(');
const end = source.indexOf('// v2.45.137: скан', start);
assert.ok(start >= 0 && end > start, 'функция разбора QR найдена');
const factory = new Function(
  'window', `${source.slice(start, end)}; return _parseShipmentQr;`);
const parseQr = factory({location: {origin: 'https://atomus-pwa.vercel.app'}});

test('полная ссылка позиции сохраняет токен договора и item', () => {
  assert.deepEqual(
    parseQr('https://atomus-pwa.vercel.app/c/nWT6lq2pOLI?item=73'),
    {token: 'nWT6lq2pOLI', itemId: 73},
  );
});

test('относительная ссылка с этикетки разбирается так же', () => {
  assert.deepEqual(
    parseQr('/c/nWT6lq2pOLI?item=73'),
    {token: 'nWT6lq2pOLI', itemId: 73},
  );
});

test('QR коробки и обычный токен не теряются', () => {
  assert.deepEqual(parseQr('/b/SMEQHW1JB_0'), {
    token: 'SMEQHW1JB_0', itemId: null,
  });
  assert.deepEqual(parseQr('USJomSeTXVQ'), {
    token: 'USJomSeTXVQ', itemId: null,
  });
});

test('повторный скан отгруженного QR не запускает бесконечную переотгрузку', () => {
  const handlerStart = source.indexOf('async function handleContinuousShipmentScan(');
  const handlerEnd = source.indexOf('function _showShipConfirm(', handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  assert.match(handler, /showShipLast\('error', 'Уже отгружено'/);
  assert.doesNotMatch(handler, /_showShipConfirm\(d\.item \|\| \{\}, true\)/);
});
