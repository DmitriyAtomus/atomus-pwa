const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

// Мини-DOM для окна выбора «Куда»
function fakeDom() {
  const els = {};
  const mk = (id) => ({
    id, style: {}, attrs: {}, children: [], value: '', disabled: false, textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    querySelector() { return null; }, querySelectorAll() { return []; }, remove() { delete els[this.id]; },
    set innerHTML(h) { this._html = h; for (const m of h.matchAll(/id="([^"]+)"/g)) els[m[1]] = mk(m[1]); }, get innerHTML() { return this._html; },
  });
  return {
    els,
    getElementById: (id) => els[id] || null,
    createElement: () => mk('__new'),
    body: { appendChild(el) { els[el.id] = el; } },
  };
}

function loadSc(dom, posts) {
  const g = globalThis;
  g.document = dom;
  g.apiPost = async (url, body) => { posts.push([url, body]); return { ok: true, data: { ok: true } }; };
  g.apiGet = async () => ({ contracts: [{ id: 17, number: '24ТД/10.26', contractor_name: 'Молочный двор', status: 'production' }] });
  g.showToast = () => {};
  g.cache = { contracts: [{ id: 17, number: '24ТД/10.26', contractor_name: 'Молочный двор', status: 'production' }] };
  delete require.cache[require.resolve('../supply-chain.js')];
  return require('../supply-chain.js');
}

test('v2.46.285: окно «Куда» — один заказ без строк: all=true, текущее назначение подставлено', async () => {
  const dom = fakeDom(); const posts = [];
  const sc = loadSc(dom, posts);
  let done = 0;
  await sc.scOpenDestPicker(463, null, () => { done++; }, { type: 'stock' }, { labels: ['ORD-463'] });
  const modal = dom.els['sc-dest-modal'];
  assert.ok(modal, 'окно открыто');
  assert.match(modal.innerHTML, /Куда · ORD-463/);
  assert.match(modal.innerHTML, /data-v="contract"[^>]*>.*Договор/);
  assert.match(modal.innerHTML, /data-v="stock" class="on"/);
  assert.match(modal.innerHTML, /data-v="shop"/);
  await dom.els['scdp-save'].onclick();
  assert.deepEqual(posts, [['/api/supply-orders/463/dest', { dest_type: 'stock', contract_id: null, item_ids: [], all: true }]]);
  assert.equal(done, 1);
});

test('v2.46.285: окно «Куда» — договор обязателен, массово по нескольким заказам', async () => {
  const dom = fakeDom(); const posts = [];
  const sc = loadSc(dom, posts);
  await sc.scOpenDestPicker([462, 456], null, null, null, { labels: ['ORD-462', 'ORD-456'] });
  assert.match(dom.els['sc-dest-modal'].innerHTML, /Куда · 2 заказа/);
  dom.els['scdp'].attrs['data-value'] = 'contract';
  await dom.els['scdp-save'].onclick();
  assert.equal(posts.length, 0, 'без договора не сохраняем');
  assert.equal(dom.els['scdp-err'].textContent, 'Выберите договор');
  dom.els['scdp-contract'].value = '17';
  await dom.els['scdp-save'].onclick();
  assert.deepEqual(posts.map(p => p[0]), ['/api/supply-orders/462/dest', '/api/supply-orders/456/dest']);
  assert.ok(posts.every(p => p[1].dest_type === 'contract' && p[1].contract_id === 17 && p[1].all === true));
});

test('v2.46.285: карточка заказа — поле «Куда» есть и у заказа без строк', () => {
  const src = read('supply-chain.js');
  assert.match(src, /«Куда» в карточке — всегда редактируемое, и у заказа без строк/);
  assert.doesNotMatch(src, /if \(kind !== 'service' && items\.length\) \{/);
  assert.match(src, /Изменить «Куда»/);
  assert.match(src, /Назначить «Куда»/);
  assert.match(read('app-3.js'), /Назначение платежа: ' \+ escapeHtml\(o\.purpose\)/);
});

test('v2.46.285: «Что закупить» — кнопка открывает выбор, у «Без «Куда»» — «Назначить всем»', () => {
  const sb = require('../supply-buy.js');
  const rows = sb.sbBuildRows({
    orders: [
      { id: 463, order_label: 'ORD-463', status: 'paid', supplier_id: 1, supplier_name: 'Крафт', created_at: '2026-11-02 11:10:47', invoice_total: 224472, step: { days: 1 } },
      { id: 456, order_label: 'ORD-456', status: 'paid', supplier_id: 2, supplier_name: 'Озон', created_at: '2026-10-27 12:12:42', invoice_total: 4440, step: { days: 1 } },
    ], waiting: { items: [] }, shop: { groups: [] }, cp: [], closed: [],
  });
  rows.forEach(r => assert.equal(r.action.js, 'sbDestPick(' + r.order_id + ')'));
  const g = sb.sbGroups(rows, 'dest')[0];
  assert.equal(g.kind, 'none');
  assert.match(sb.groupHead(g), /sbDestPick\(\[463,456\]\)/);
  assert.match(sb.groupHead(g), /Назначить всем \(2\)/);
});

test('актуальная версия согласована, история v2.46.285 сохранена', () => {
  const v=JSON.parse(read('version.json')).version;
  assert.ok(read('app-1.js').includes('APP_VERSION = "'+v+'"'));
  assert.ok(read('sw.js').includes("atomus-"+v+"'"));
  assert.ok(read('app-3.js').includes("HELP_CHANGELOG = [\n  {version:'"+v+"'"));
  assert.ok(read('app-3.js').includes("{version:'v2.46.285'"));
});
