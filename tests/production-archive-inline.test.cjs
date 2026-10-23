const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

test('архив загружается вместе с доской и показывается под канбаном', () => {
  const fetchCode = section('async function fetchProductionKanban()', '// v2.45.627: фильтры доски');
  const renderCode = section('function renderProductionDashboard(d)', '// ============ v2.45.634:');

  assert.match(fetchCode, /\/api\/production\/archive\?limit=200&days=30/);
  assert.match(fetchCode, /archive:\s*archiveRes/);
  assert.match(renderCode, /renderProdArchiveInline\(d\.archive \|\| \{\}\)/);
  assert.match(css, /\.pkb-archive-inline\s*\{/);
  assert.match(css, /\.pkb-archive-list\s*\{/);
});

test('видимый архив показывает фактические часы и вклад сотрудников', () => {
  const context = {
    escapeHtml(value) { return String(value == null ? '' : value); },
    formatHours(value) { return String(Number(value)); },
    _fmtWorkTime(value, withDate) {
      if (!value) return '';
      return withDate ? String(value) : String(value).slice(-5);
    },
  };
  const code = section('// ---------- v2.45.902: архив собранного', 'async function openProductionWorkDetail');
  vm.runInNewContext(`${code}\nthis.renderArchive = renderProdArchiveInline;`, context);

  const html = context.renderArchive({
    items: [{
      id: 42,
      model_name: 'ЩУ-004.008',
      qty: 1,
      finished_at: '11.08 09:27',
      actual_started_at: '10.08 15:41',
      actual_finished_at: '11.08 09:20',
      total_hours: 31.4,
      people: [
        { name: 'Иванов А.А.', hours: 20.2 },
        { name: 'Шевелев М.И.', hours: 11.2 },
      ],
    }],
    summary: { works_count: 1, total_hours: 31.4, people_count: 2 },
  });

  assert.match(html, /Архив собранного/);
  assert.match(html, /31\.4/);
  assert.match(html, /часов потрачено/);
  assert.match(html, /Иванов А\.А\.[\s\S]*20\.2 ч/);
  assert.match(html, /Шевелев М\.И\.[\s\S]*11\.2 ч/);
  assert.match(html, /10\.08 15:41 → 11\.08 09:20/);
  assert.match(html, /openProductionWorkDetail\(42\)/);
});

test('полный архив ищет также по сотруднику и выводит сводку', () => {
  const archiveCode = section('async function openProdArchive(q)', 'async function openProductionWorkDetail');

  assert.match(archiveCode, /заказчик или сотрудник/);
  assert.match(archiveCode, /id="prod-arch-summary"/);
  assert.match(archiveCode, /formatHours\(totalHours\)[\s\S]*фактически/);
});
