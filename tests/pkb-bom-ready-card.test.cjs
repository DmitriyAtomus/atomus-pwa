// Карточка работы: блок «дефицита нет» (v2.45.1016).
// 20.08.2026: цех читал «Готового изделия на складе нет — нужно изготовить» как
// «на складе пусто, работать нечем». Блок обязан разделять четыре ситуации и
// называть цифру склада, а не общие слова.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-1.js'), 'utf8');

function readyContext() {
  const start = source.indexOf('// v2.45.1016: блок «дефицита нет»');
  const end = source.indexOf('function renderPkbBomBlock(w) {');
  const code = source.slice(start, end);
  assert.ok(code.length > 100, 'блок renderPkbBomReadyBlock не найден в app-1.js');
  const context = {
    escapeHtml(value) {
      return String(value == null ? '' : value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    },
    plural(n, one, few, many) {
      const n10 = n % 10, n100 = n % 100;
      if (n10 === 1 && n100 !== 11) return one;
      if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
      return many;
    },
  };
  vm.runInNewContext(`${code}\nthis.render = renderPkbBomReadyBlock;`, context);
  return context.render;
}

const BASE = {
  qty: 1,
  model_name: 'УДФ-1 AISI',
  contract_number: '17АГ/08.26',
  bom_total: 14,
  work_type: 'assembly',
  assembly_built: false,
  finished_stock: { total: 0, free: 0, reserved: 0 },
};

test('готовых нет — сказано, что нет именно готового изделия, а детали есть', () => {
  const html = readyContext()({ ...BASE });
  assert.match(html, /работа на изготовление: собираем 1 шт\./);
  assert.match(html, /Готовых УДФ-1 AISI на складе нет: 0 шт\./);
  assert.match(html, /все 14 позиций в наличии/);
  assert.match(html, /«Изделия нет» — это про готовое изделие на складе, а не про детали/);
  assert.match(html, /под договор 17АГ\/08\.26/);
});

test('готовые есть, но все в резерве — это отдельная формулировка', () => {
  const html = readyContext()({ ...BASE, finished_stock: { total: 3, free: 0, reserved: 3 } });
  assert.match(html, /Готовые УДФ-1 AISI на складе есть \(3 шт\.\), но все они в резерве/);
  assert.doesNotMatch(html, /на складе нет: 0 шт/);
});

test('свободные готовые на складе — карточка отговаривает собирать', () => {
  const html = readyContext()({ ...BASE, finished_stock: { total: 5, free: 2, reserved: 3 } });
  assert.match(html, /На складе уже есть готовые УДФ-1 AISI — 2 шт\. свободных/);
  assert.match(html, /ещё 3 шт\. в резерве под другие договоры/);
  assert.match(html, /не проще ли закрыть потребность складом/);
  assert.match(html, /have-stock/);
});

test('сборка уже сделана — детали списаны, а не «лежат на складе»', () => {
  const html = readyContext()({ ...BASE, assembly_built: true });
  assert.match(html, /Изделие по этой работе уже собрано/);
  assert.match(html, /уже списаны на эту сборку/);
  assert.doesNotMatch(html, /Комплектующие по техкарте на складе есть/);
});

test('перекомплектация не называется изготовлением', () => {
  const html = readyContext()({ ...BASE, work_type: 'reconfiguration' });
  assert.match(html, /Перекомплектация — изделие уже есть, меняем комплектацию/);
  assert.match(html, /Новый корпус не изготавливается/);
  assert.doesNotMatch(html, /работа на изготовление/);
});

test('без данных склада и без договора текст не ломается', () => {
  const html = readyContext()({ qty: 2, model_name: 'Щит <b>ЩУ</b>', bom_total: 0 });
  assert.match(html, /собираем 2 шт\./);
  assert.match(html, /Щит &lt;b&gt;ЩУ&lt;\/b&gt;/);
  assert.match(html, /без договора, на склад/);
  assert.match(html, /дефицита нет/);
});
