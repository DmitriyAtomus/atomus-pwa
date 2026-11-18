const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app1 = fs.readFileSync(path.join(__dirname, '..', 'app-1.js'), 'utf8');
const app3 = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');

function extract(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, 'Не найден блок: ' + startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, 'Не найден конец блока после: ' + startNeedle);
  return source.slice(start, end);
}

test('canManageComponents true при праве или canManageSales', () => {
  const code = extract(
    app1,
    'function canManageSales() {',
    '// v2.45.194: кто видит суммы договоров/цены.'
  );
  function run({ roles = [], perms = [] } = {}) {
    const ctx = {
      state: { user: { roles } },
      hasPermission: (key) => perms.includes(key),
    };
    vm.runInNewContext(
      code + '\nthis.canManageSales = canManageSales;\nthis.canManageComponents = canManageComponents;',
      ctx
    );
    return ctx;
  }

  assert.equal(run({ roles: ['director'] }).canManageComponents(), true);
  assert.equal(run({ roles: ['manager'] }).canManageComponents(), true);
  assert.equal(run({ roles: ['master'], perms: ['catalog.manage_components'] }).canManageComponents(), true);
  assert.equal(run({ roles: ['master'], perms: ['production.view'] }).canManageComponents(), false);
  assert.equal(run({ roles: ['master'], perms: ['catalog.manage_panel_schemes'] }).canManageComponents(), false);
});

test('openComponentForm gate использует canManageComponents', () => {
  const start = app3.indexOf('async function openComponentForm(componentId) {');
  assert.notEqual(start, -1);
  const gate = app3.slice(start, start + 350);
  assert.match(gate, /canManageComponents/);
  assert.match(gate, /Недостаточно прав/);
  assert.doesNotMatch(gate, /Доступ только директору и заму/);
});

test('loadComponentsCatalog: кнопка + по canManageComponents, диагностика по canManageSales', () => {
  const start = app3.indexOf('async function loadComponentsCatalog() {');
  const end = app3.indexOf('if (!cache.componentCategories)', start);
  const block = app3.slice(start, end);
  assert.match(block, /canManageComponents/);
  assert.match(block, /canAdmin = canManageSales\(\)/);
  assert.match(block, /diagBtn[\s\S]*canAdmin/);
  assert.match(block, /dupsBtn[\s\S]*canAdmin/);
  assert.match(block, /newBtn[\s\S]*canCreate/);
});

test('_renderWarehouseDashActions показывает «Комплектующее» только с правом', () => {
  const start = app3.indexOf('const WH_TAB_ACTIONS = {');
  const end = app3.indexOf('function _updateWarehouseTabBadges(counts) {', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const code = app3.slice(start, end) + '\nthis.render = _renderWarehouseDashActions;\nthis.WH_TAB_ACTIONS = WH_TAB_ACTIONS;';

  function render({ create = false, admin = false } = {}) {
    let html = '';
    const host = {
      set innerHTML(v) { html = v; },
      get innerHTML() { return html; },
    };
    const ctx = {
      document: { getElementById: (id) => (id === 'wh-dash-actions' ? host : null) },
      canManageComponents: () => create,
      canManageSales: () => admin,
    };
    vm.runInNewContext(code, ctx);
    ctx.render('components');
    return html;
  }

  const withPerm = render({ create: true, admin: false });
  assert.match(withPerm, /openComponentForm\(\)/);
  assert.doesNotMatch(withPerm, /openBomDiagnose/);
  assert.doesNotMatch(withPerm, /openComponentDuplicates/);
  assert.doesNotMatch(withPerm, /openMasterBomImport/);
  assert.doesNotMatch(withPerm, /openComponentReceiveModal/);

  const none = render({ create: false, admin: false });
  assert.doesNotMatch(none, /openComponentForm\(\)/);

  const full = render({ create: true, admin: true });
  assert.match(full, /openComponentForm\(\)/);
  assert.match(full, /openBomDiagnose/);
  assert.match(full, /openComponentDuplicates/);
});

test('версия v2.46.312 проставлена', () => {
  assert.match(app1, /const APP_VERSION = "v2\.46\.312"/);
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(sw, /atomus-v2\.46\.312/);
  const ver = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8'));
  assert.equal(ver.version, 'v2.46.312');
  assert.match(app3, /version:'v2\.46\.312'/);
});

test('удаление в форме только при canManageSales', () => {
  assert.match(app3, /\(isEdit && canManageSales\(\)\) \?[\s\S]*?deleteComponent/);
  assert.match(app3, /isEdit && canManageSales\(\) && c && c\.execution_type !== 'stainless'/);
});
