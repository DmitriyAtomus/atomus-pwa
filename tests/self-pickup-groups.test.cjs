const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const src = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');

// вытаскиваем из app-3.js только нужные функции (модулей в проекте нет)
function load() {
  const from = src.indexOf('function _spKey');
  const to = src.indexOf('// Сколько дней прошло с оплаты');
  const sandbox = {};
  // _spDaysSince нужен группировщику — берём и его
  const days = src.slice(src.indexOf('function _spDaysSince'),
                         src.indexOf('function _spPaidTxt'));
  new Function('exports', src.slice(from, to) + days +
    'exports._spKey = _spKey; exports._selfPickupGroups = _selfPickupGroups;')(sandbox);
  return sandbox;
}

test('дубли поставщика в справочнике дают одну карточку', () => {
  const { _selfPickupGroups } = load();
  const today = new Date().toISOString().slice(0, 10);
  const groups = _selfPickupGroups([
    { supplier_id: 1,  supplier_name: 'ООО ТД Электрика',    paid_at: today },
    { supplier_id: 91, supplier_name: 'ООО "ТД Электрика"',  paid_at: today },
    { supplier_id: 85, supplier_name: 'ООО «ТД Электрика»',  paid_at: '2026-06-30' },
    { supplier_id: 7,  supplier_name: 'ООО Электрика',       paid_at: today },
  ]);
  assert.equal(groups.length, 2);
  const el = groups.find(g => g.items.length === 3);
  assert.ok(el, 'три записи «ТД Электрика» должны склеиться');
  assert.equal(el.fresh.length, 2);
  assert.equal(el.stale.length, 1);  // счёт старше месяца уезжает под «оплачены давно»
});

test('ключ склейки убирает правовую форму и кавычки', () => {
  const { _spKey } = load();
  assert.equal(_spKey('ООО "ТД Электрика"'), _spKey('ТД Электрика'));
  assert.notEqual(_spKey('ООО ТД Электрика'), _spKey('ООО Электрика'));
  assert.equal(_spKey(''), '');
});

test('бэкенд-ключ supplier_key важнее имени', () => {
  const { _selfPickupGroups } = load();
  const groups = _selfPickupGroups([
    { supplier_id: 1,  supplier_key: 'тдэлектрика', supplier_name: 'ООО ТД Электрика' },
    { supplier_id: 64, supplier_key: 'тдэлектрика', supplier_name: 'ТД Электрика (старый)' },
  ]);
  assert.equal(groups.length, 1);
});
