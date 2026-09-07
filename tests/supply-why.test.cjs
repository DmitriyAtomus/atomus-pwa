// «Что закупить» (v2.46.143): вместо сухого «остаток / мин: 14 / 15» карточка
// объясняет по-человечески — сколько есть и из чего, сколько не хватает,
// почему именно столько к заказу и что будет после прихода.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');

function slice(from, to) {
  const i = app.indexOf(from);
  assert.ok(i >= 0, 'не найдено: ' + from);
  const j = app.indexOf(to, i);
  assert.ok(j > i, 'не найден конец: ' + to);
  return app.slice(i, j);
}

const code = slice('function sv2WhyHtml(it)', '// v2.45.442 (редизайн Снабжения')
  + 'return sv2WhyHtml;';
const why = new Function('escapeHtml', code)((v) => String(v));

test('низкий остаток: разбивка, дефицит и итог после прихода', () => {
  const h = why({ qty_on_stock: 7, assm_stock: 7, effective_stock: 14, min_stock: 15,
                  recommended_qty: 15, reorder_qty: 15, unit: 'шт' });
  assert.match(h, /На складе <b>14 шт<\/b>/);
  assert.match(h, /свои 7 \+ в готовых сборках 7/);
  assert.match(h, /минимум — <b>15<\/b>: не хватает <b>1<\/b>/);
  assert.match(h, /к заказу <b>15 шт<\/b> — фиксированная партия/);
  assert.match(h, /После прихода: <b>29<\/b> — запас восстановлен ✓/);
  assert.match(h, /sv2-bar warn/);                       // остаток близок к минимуму
});

test('ровно дефицит до минимума и критичная полоса', () => {
  const h = why({ qty_on_stock: 1, effective_stock: 1, min_stock: 4,
                  recommended_qty: 3, unit: 'шт' });
  assert.match(h, /не хватает <b>3<\/b>/);
  assert.match(h, /ровно дефицит до минимума/);
  assert.match(h, /sv2-bar crit/);                       // 1 из 4 — меньше половины
});

test('дефицит под план с договорами', () => {
  const h = why({ qty_on_stock: 2, effective_stock: 2, min_stock: 0,
                  shortage_plan: 4, recommended_qty: 4,
                  plan_contracts: ['17АГ/08.26'], unit: 'шт' });
  assert.match(h, /Под договоры №17АГ\/08\.26 не хватает ещё <b>4<\/b>/);
  assert.match(h, /закрывает дефицит под план/);
  assert.ok(!h.includes('sv2-bar'));                     // без минимума полосы нет
});

test('упаковка объясняет округление', () => {
  const h = why({ qty_on_stock: 20, effective_stock: 20, min_stock: 50,
                  recommended_qty: 100, purchase_pack: 100, unit: 'шт' });
  assert.match(h, /округлён до упаковки по 100/);
});

test('карточка использует объяснение вместо сухой строки', () => {
  assert.match(app, /sv2WhyHtml\(it\) \+/);
  assert.ok(!/sv2-item-stock">остаток \/ мин/.test(app));
});
