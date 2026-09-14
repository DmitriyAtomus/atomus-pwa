const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-2.js'), 'utf8');
const start = source.indexOf('function _parseModelChars(m)');
const end = source.indexOf('// Лениво подгружаем картинку', start);
assert.notEqual(start, -1, 'Не найден блок характеристик модели');
assert.notEqual(end, -1, 'Не найден конец блока характеристик модели');
const code = source.slice(start, end);

function makeContext({ permission = false, catalog = false, direction } = {}) {
  const ctx = {
    cache: {
      models: {
        directions: [direction || { id: 7, code: 'panels', name: 'Щиты управления' }],
      },
    },
    canManageSales: () => catalog,
    hasPermission: (key) => permission && key === 'catalog.manage_panel_schemes',
    escapeHtml: (v) => String(v == null ? '' : v),
  };
  vm.runInNewContext(`${code}\nthis.render = _renderModelCharsBlock;`, ctx);
  return ctx;
}

const panelModel = {
  id: 42,
  direction_id: 7,
  scheme_file_key: 'models/42/scheme.pdf',
  scheme_file_name: 'ЩУ-005.pdf',
};

test('отдельное право показывает загрузку и удаление схемы у щита', () => {
  const html = makeContext({ permission: true }).render(panelModel);
  assert.match(html, /onchange="uploadModelScheme\(42, this\)"/);
  assert.match(html, /onclick="deleteModelSchemeFile\(42\)"/);
  assert.doesNotMatch(html, /uploadModelPhoto/);
  assert.doesNotMatch(html, /uploadModelSpec/);
  assert.doesNotMatch(html, /openCharsEditor/);
});

test('отдельное право не действует на схемы другого направления', () => {
  const html = makeContext({
    permission: true,
    direction: { id: 8, code: 'chl', name: 'Чиллеры' },
  }).render({ ...panelModel, direction_id: 8 });
  assert.doesNotMatch(html, /uploadModelScheme/);
  assert.doesNotMatch(html, /deleteModelSchemeFile/);
  assert.match(html, /downloadModelScheme\(42\)/, 'открывать существующую схему можно');
});

test('обычный работник без отдельного права не видит управление схемой', () => {
  const html = makeContext().render(panelModel);
  assert.doesNotMatch(html, /uploadModelScheme/);
  assert.doesNotMatch(html, /deleteModelSchemeFile/);
});

test('полный доступ к каталогу сохраняет прежние кнопки', () => {
  const html = makeContext({ catalog: true }).render(panelModel);
  assert.match(html, /uploadModelScheme/);
  assert.match(html, /deleteModelSchemeFile/);
  assert.match(html, /uploadModelPhoto/);
  assert.match(html, /uploadModelSpec/);
  assert.match(html, /openCharsEditor/);
});
