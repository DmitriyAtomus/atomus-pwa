const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

function tileHtml(it) {
  const context = {
    escapeHtml: (v) => String(v || ''),
    _paintMatName: (x) => x.material || '',
    _paintManualTag: () => '',
    _paintStatusChip: () => '',
  };
  const code = section('function _paintTileHtml(it, isSel)', '// ============ v2.45.878');
  vm.runInNewContext(`${code}\nthis.tile = _paintTileHtml;`, context);
  return context.tile(it, false);
}

const ITEM = {
  id: 42, calc_id: 7, designation: 'AG-20.000.003', name: 'Крышка',
  qty: 1, thickness_mm: 1, material: 'Сталь', paint_total_m2: 1.66, svg: '<svg/>',
};

test('у детали с чертежом на плитке есть кнопка PDF', () => {
  const html = tileHtml({ ...ITEM, drawing_file_id: 11 });

  assert.match(html, /paintOpenDrawing\(42\)/);
  assert.match(html, /pdx-pdf/);
  // лупа развёртки уезжает левее, чтобы кнопки не наехали друг на друга
  assert.match(html, /class="pdx-zoom shift"/);
});

test('без найденного чертежа кнопки PDF нет', () => {
  const html = tileHtml(ITEM);

  assert.doesNotMatch(html, /paintOpenDrawing/);
  assert.match(html, /class="pdx-zoom"/);
});

test('кнопка PDF не выбирает деталь в партию', () => {
  const html = tileHtml({ ...ITEM, drawing_file_id: 11 });
  const btn = html.slice(html.indexOf('pdx-pdf'), html.indexOf('pdx-draw'));

  assert.match(btn, /event\.stopPropagation\(\);paintOpenDrawing/);
});

function viewerContext(extra) {
  const context = {
    state: Object.assign({
      currentPaintCalc: {
        id: 7,
        files: [
          { id: 11, file_name: 'AG-20.000.003 Крышка.pdf', kind: 'pdf', size_bytes: 100 },
          { id: 14, file_name: 'cut.dxf', kind: 'dxf', size_bytes: 50 },
        ],
        items: [{ id: 42, drawing_file_id: 11 }, { id: 43 }],
      },
      mfgCurrentItem: { files: [{ id: 90, file_name: 'корпус.pdf', kind: 'pdf' }] },
    }, extra || {}),
    showToast(msg, type) { context._toast = { msg, type }; },
  };
  const code = section('function _pdfSource()', 'function mfgOpenPdf(');
  const opener = section('// v2.45.880: открыть исходный чертёж детали', 'function paintZoom(itemId)');
  vm.runInNewContext(
    `${code}\n${opener}\nthis.src = _pdfSource; this.open = paintOpenDrawing;`,
    context
  );
  return context;
}

test('источник файлов переключается между корпусами и окраской', () => {
  const ctx = viewerContext();

  ctx.state._pdfSrc = 'mfg';
  assert.equal(ctx.src().url(90), '/api/mfg/files/90/download');
  assert.deepEqual(ctx.src().files.map((f) => f.id), [90]);

  ctx.state._pdfSrc = 'paint';
  assert.equal(ctx.src().url(11), '/api/paint-calcs/7/files/11/download');
  assert.deepEqual(ctx.src().files.map((f) => f.id), [11, 14]);
});

test('клик по кнопке открывает просмотрщик на чертеже этой детали', () => {
  const ctx = viewerContext();
  const calls = [];
  ctx.mfgOpenPdf = (itemId, fileId, src) => calls.push({ itemId, fileId, src });

  ctx.open(42);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)),
    [{ itemId: null, fileId: 11, src: 'paint' }]);
});

test('деталь без чертежа объясняет это словами, а не молчит', () => {
  const ctx = viewerContext();
  ctx.mfgOpenPdf = () => assert.fail('просмотрщик открываться не должен');

  ctx.open(43);

  assert.match(ctx._toast.msg, /Чертёж/);
  assert.equal(ctx._toast.type, 'error');
});
