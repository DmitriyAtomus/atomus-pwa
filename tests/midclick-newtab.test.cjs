/**
 * Средний клик (колесо мыши) по кнопке CRM открывает её в новой вкладке.
 *
 * Кнопки CRM — не ссылки, действие переносится в новую вкладку строкой onclick.
 * Главное здесь — фильтр: в фоновой вкладке разрешено повторять только
 * «открывающие» действия. Если фильтр протечёт, средний клик по «Удалить»
 * молча удалит запись во второй вкладке.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app1 = fs.readFileSync(path.join(__dirname, '..', 'app-1.js'), 'utf8');
const app4 = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');

function midModule() {
  const from = 'const MID_KEY_PREFIX';
  const to = 'function _midCtxSnapshot';
  const start = app1.indexOf(from);
  const end = app1.indexOf(to, start);
  assert.notEqual(start, -1, 'не найден блок среднего клика');
  assert.notEqual(end, -1, 'не найден конец блока');
  const ctx = {};
  vm.runInNewContext(
    app1.slice(start, end) + '\nthis.safe = _midCodeSafe; this.codeFromEl = _midCodeFromEl;',
    ctx
  );
  return ctx;
}

test('в новой вкладке повторяются только открывающие действия', () => {
  const { safe } = midModule();
  for (const code of [
    "selectSidebarItem('planerka')",
    "selectSection('warehouse')",
    'openContractDetail(12)',
    'showAssemblyCard(7)',
    "openWorkCard(5);closeModal()",
  ]) {
    assert.equal(safe(code), true, `должно открываться: ${code}`);
  }
  for (const code of [
    'deleteContract(12)',
    'saveWork(3)',
    'sendToMax(1)',
    'openWork(1);deleteWork(1)',   // открывашка в связке с опасным — целиком нельзя
    'state.currentContractId = 5',
    "fetch('/api/contracts/1', {method:'DELETE'})",
    'eval(atob(x))',
    '(() => deleteAll())()',
    'openX(' + 'a'.repeat(500) + ')',
  ]) {
    assert.equal(safe(code), false, `не должно открываться: ${code}`);
  }
});

test('цель клика берётся из onclick, таба раздела или пункта меню', () => {
  const { codeFromEl } = midModule();
  // мини-DOM: closest ищет по цепочке parent
  function el(attrs, parent) {
    const node = {
      _attrs: attrs || {},
      parentNode: parent || null,
      dataset: {},
      getAttribute(n) { return n in this._attrs ? this._attrs[n] : null; },
      closest(sel) {
        const sels = sel.split(',');
        let cur = this;
        while (cur) {
          for (const s of sels) {
            const key = s.trim().replace(/^\[|\]$/g, '');
            if (key === 'a[href]') { if (cur._tag === 'a' && cur._attrs.href) return cur; continue; }
            if (key in cur._attrs) return cur;
          }
          cur = cur.parentNode;
        }
        return null;
      },
    };
    if (attrs && attrs['data-section']) node.dataset.section = attrs['data-section'];
    if (attrs && attrs['data-nav']) node.dataset.nav = attrs['data-nav'];
    return node;
  }

  const icon = el({}, el({ onclick: "openContractDetail(12)" }));
  assert.equal(codeFromEl(icon), 'openContractDetail(12)');

  const tab = el({ 'data-section': 'production' });
  assert.equal(codeFromEl(tab), "selectSection('production')");

  const navItem = el({ 'data-nav': 'planerka' });
  assert.equal(codeFromEl(navItem), "selectSidebarItem('planerka')");

  // опасная кнопка: цель есть, но открывать нельзя → пустая строка (покажем подсказку)
  assert.equal(codeFromEl(el({ onclick: 'deleteWork(3)' })), '');

  // не кнопка вовсе → null, средний клик работает как обычно
  assert.equal(codeFromEl(el({})), null);
});

test('новая вкладка забирает действие из localStorage, а не из адреса', () => {
  // в адресе только короткий ключ: чужая ссылка не должна выполнять код
  assert.match(app1, /window\.open\(window\.location\.pathname \+ '\?mid=' \+ key, '_blank'\)/);
  assert.match(app4, /localStorage\.getItem\('atomus_mid_' \+ _midK\)/);
  assert.match(app4, /localStorage\.removeItem\('atomus_mid_' \+ _midK\)/);
  assert.match(app4, /\/\^\[A-Za-z0-9\]\+\$\//);   // ключ строго буквы-цифры
});

test('в новой вкладке открывается тот же раздел, экран и карточка', () => {
  const from = 'function _midApplyCtx';
  const to = 'function _midIsTypingTarget';
  const start = app1.indexOf(from);
  const end = app1.indexOf(to, start);
  assert.notEqual(start, -1);
  const calls = [];
  const timers = [];
  const ctx = {
    state: {},
    SECTION_CONFIG: { sales: { defaultScreen: 'sales-contracts' }, home: { defaultScreen: 'home-dashboard' } },
    selectSection: (s) => calls.push('section:' + s),
    selectSidebarItem: (s) => calls.push('screen:' + s),
    openContractDetail: (id) => calls.push('open:' + id),
    document: { querySelector: () => ({}) },
    setTimeout: (fn) => timers.push(fn),
    console: { warn() {} },
  };
  ctx.window = ctx;
  vm.runInNewContext(app1.slice(start, end) + String.fromCharCode(10) + 'this.apply = _midApplyAction;', ctx);
  ctx.apply({ code: 'openContractDetail(12)', section: 'sales', screen: 'sales-contract-detail', ctx: { contractId: 77 } });
  timers.forEach((fn) => fn());
  assert.deepEqual(calls, ['section:sales', 'screen:sales-contract-detail', 'open:12']);
  // карточка договора должна открыться в том же контексте, что и в исходной вкладке
  assert.equal(ctx.state.currentContractId, 77);
});
