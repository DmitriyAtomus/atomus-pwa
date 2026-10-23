// v2.46.252: навигация по базе предприятий — панель поверх таблицы, ←/→ по выборке, #prospects/<id>, защита несохранённого.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'prospects.js'), 'utf8');
const escapeHtml = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const plain = v => JSON.parse(JSON.stringify(v));

function harness(opts = {}) {
  const elements = new Map();
  let wrap = { scrollTop: 0, scrollLeft: 0 };
  const node = id => {
    if (!elements.has(id)) {
      const el = { id, textContent: '', value: '', hidden: true, disabled: false, open: false, dataset: {}, classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, focus() {}, _html: '' };
      Object.defineProperty(el, 'innerHTML', { get() { return this._html; }, set(v) {
        this._html = v;
        // Перерисовка: поля карточки и таблица — новые DOM-узлы.
        if (id === 'prospects-detail') for (const k of [...elements.keys()]) if (/^prospect-(field-|note|call-note|callback|contacts|after|body|pos|prev|next|dirty)/.test(k)) elements.delete(k);
        if (id === 'prospects-list') wrap = { scrollTop: 0, scrollLeft: 0 };
      } });
      if (id === 'prospects-list') el.querySelector = () => wrap;
      elements.set(id, el);
    }
    return elements.get(id);
  };
  const loc = { pathname: '/', search: '', hash: opts.hash || '' };
  const hist = { calls: [], pushState(s, t, u) { this.calls.push(['push', u]); loc.hash = u.slice(u.indexOf('#')) ; }, replaceState(s, t, u) { this.calls.push(['replace', u]); const i = u.indexOf('#'); loc.hash = i >= 0 ? u.slice(i) : ''; }, back() { this.calls.push(['back']); loc.hash = ''; } };
  const store = new Map(Object.entries(opts.storage || {}));
  const toasts = [], confirms = [];
  const ctx = vm.createContext({ URL, URLSearchParams, escapeHtml, setTimeout, clearTimeout, Date, Set, Map,
    canManageSales: () => true, showToast: (m, t) => toasts.push([m, t]),
    confirm: msg => { confirms.push(msg); return opts.confirm !== undefined ? opts.confirm : true; },
    location: loc, history: hist,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    state: { currentScreen: opts.screen || 'sales-prospects' },
    document: { createElement: () => ({}), head: { appendChild() {} }, getElementById: node, querySelectorAll: () => [], querySelector: s => (s.startsWith('#') || s.startsWith('[') ? node(s) : null) } });
  vm.runInContext(source, ctx);
  return { ctx, node, loc, hist, toasts, confirms, store, getWrap: () => wrap };
}
const ROWS = ['ATM-1', 'ATM-2', 'ATM-3'].map((id, i) => ({ id, name: 'Завод ' + (i + 1), phone: '8 (351) 222-33-4' + i, stage: 'new', revision: 1 }));
function listing(rows = ROWS, page = 1, total = rows.length) {
  return { rows, total, page, pages: Math.ceil(total / 50) || 1, stats: { total }, facets: { segment: [], region: [], owner: [] }, stages: { new: 'Новый' }, consents: {} };
}
function api(h, { rows = ROWS, pages = {}, total } = {}) {
  const seen = [];
  h.ctx.apiGet = async url => {
    seen.push(url);
    if (url.startsWith('/api/employees/active')) return { employees: [{ short_name: 'Иванов И.' }] };
    const m = /^\/api\/sales\/prospects\/([^/?]+)$/.exec(url);
    if (m) { const id = decodeURIComponent(m[1]); return { id, name: 'Карточка ' + id, phone: '8 (351) 222-33-44', stage: 'new', revision: 5, events: [], events_total: 0, contractors: [], source_data: {}, contacts_json: '[]' }; }
    const page = Number(new URLSearchParams(url.split('?')[1]).get('page')) || 1;
    return listing(pages[page] || rows, page, total || rows.length);
  };
  return seen;
}

test('prev/next over the current filtered page, page edges and dropped-out card', () => {
  const { ctx } = harness();
  let nav = ctx.prospectsNavInfo(ROWS, 'ATM-2', -1, 1, 3);
  assert.deepEqual(plain(nav), { index: 1, inList: true, position: 2, total: 3, prev: 'ATM-1', next: 'ATM-3', prevPage: false, nextPage: false });
  assert.equal(ctx.prospectsNavLabel(nav), '2 из 3');
  nav = ctx.prospectsNavInfo(ROWS, 'ATM-3', -1, 2, 120);   // 3 rows shown of page 2, more pages exist
  assert.equal(nav.position, 53); assert.equal(nav.next, null); assert.equal(nav.nextPage, true);
  nav = ctx.prospectsNavInfo(ROWS, 'ATM-1', -1, 2, 120);
  assert.equal(nav.prev, null); assert.equal(nav.prevPage, true);
  // «Перезвонить» убрал карточку из «На сегодня» — соседи берутся по прежнему месту.
  nav = ctx.prospectsNavInfo([ROWS[0], ROWS[2]], 'ATM-2', 1, 1, 2);
  assert.equal(nav.inList, false); assert.equal(nav.prev, 'ATM-1'); assert.equal(nav.next, 'ATM-3');
  assert.equal(ctx.prospectsNavLabel(nav), 'вне текущей выборки');
  assert.equal(ctx.prospectsNavInfo(ROWS, 'NOPE', -1, 1, 3).next, null);
});

test('stepping opens neighbours with replaceState and crosses pages', async () => {
  const h = harness(); const seen = api(h, { rows: ROWS, total: 53, pages: { 1: ROWS, 2: [{ id: 'ATM-51', name: 'Завод 51', stage: 'new', revision: 1 }] } });
  await h.ctx.loadProspects();
  await h.ctx.prospectsOpen('ATM-2');
  assert.equal(h.loc.hash, '#prospects/ATM-2');
  assert.deepEqual(h.hist.calls[0], ['push', '/#prospects/ATM-2']);
  assert.equal(h.node('prospect-pos').textContent, '2 из 53');
  await h.ctx.prospectsStep(1);
  assert.equal(h.ctx._prospects.current.id, 'ATM-3');
  assert.deepEqual(h.hist.calls.at(-1), ['replace', '/#prospects/ATM-3']);
  await h.ctx.prospectsStep(1);   // end of page 1 → loads page 2, opens its first row
  assert.ok(seen.some(u => u.includes('page=2')));
  assert.equal(h.ctx._prospects.current.id, 'ATM-51');
  assert.equal(h.node('prospect-pos').textContent, '51 из 53');
  await h.ctx.prospectsStep(-1);  // back across the page edge → last row of page 1
  assert.equal(h.ctx._prospects.current.id, 'ATM-3');
});

test('closing a card opened from the table goes back in history; deep link closes with replaceState', async () => {
  const h = harness(); api(h);
  await h.ctx.loadProspects();
  await h.ctx.prospectsOpen('ATM-1');
  assert.equal(h.ctx._prospects.drawerOpen, true);
  assert.equal(h.ctx.prospectsClose(), true);
  assert.deepEqual(h.hist.calls.at(-1), ['back']);
  assert.equal(h.ctx._prospects.drawerOpen, false);
  assert.equal(h.node('prospects-detail').hidden, true);

  const d = harness({ hash: '#prospects/ATM-%D0%AF1', screen: 'home' }); api(d);
  const selected = [];
  d.ctx.selectSection = s => selected.push(['section', s]);
  d.ctx.selectSidebarItem = s => { selected.push(['screen', s]); d.ctx.state.currentScreen = s; return d.ctx.loadProspects(); };
  assert.equal(d.ctx.prospectsHashId('#prospects/ATM-%D0%AF1'), 'ATM-Я1');
  assert.equal(d.ctx.prospectsHashId('#prospects/'), '');
  assert.equal(d.ctx.prospectsHashId('#other/ATM-1'), '');
  assert.equal(d.ctx.prospectsDeepLink(), true);
  assert.deepEqual(plain(selected), [['section', 'sales'], ['screen', 'sales-prospects']]);
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  assert.equal(d.ctx._prospects.current.id, 'ATM-Я1');
  assert.equal(d.hist.calls.length, 0);   // deep link doesn't add a history entry
  d.ctx.prospectsClose();
  assert.deepEqual(d.hist.calls.at(-1), ['replace', '/']);
  assert.equal(harness().ctx.prospectsDeepLink(), false);
});

test('browser Back (hash removed) closes the card; hash to another id opens it', async () => {
  const h = harness(); api(h);
  await h.ctx.loadProspects();
  await h.ctx.prospectsOpen('ATM-1');
  h.loc.hash = '#prospects/ATM-3'; h.ctx.prospectsOnHash();
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  assert.equal(h.ctx._prospects.current.id, 'ATM-3');
  h.loc.hash = ''; h.ctx.prospectsOnHash();
  assert.equal(h.ctx._prospects.drawerOpen, false);
  assert.equal(h.ctx._prospects.current, null);
});

test('unsaved edits: guard blocks next/close/Esc/Back when user cancels', async () => {
  const h = harness({ confirm: false }); api(h);
  await h.ctx.loadProspects();
  await h.ctx.prospectsOpen('ATM-1');
  h.ctx.prospectsMarkDirty({ target: { id: 'prospect-field-owner' } });
  assert.equal(h.ctx.prospectsIsDirty(), true);
  assert.equal(h.node('prospect-dirty').hidden, false);
  await h.ctx.prospectsStep(1);
  assert.equal(h.ctx._prospects.current.id, 'ATM-1');
  assert.equal(h.ctx.prospectsClose(), false);
  h.ctx.prospectsKey({ key: 'Escape', target: {} });
  assert.equal(h.ctx._prospects.drawerOpen, true);
  h.loc.hash = ''; h.ctx.prospectsOnHash();        // Back
  assert.equal(h.ctx._prospects.drawerOpen, true);
  assert.equal(h.loc.hash, '#prospects/ATM-1');    // hash restored, card stays
  assert.ok(h.confirms.length >= 4);
  // Typing into contact rows / call note also counts as unsaved.
  assert.equal(h.ctx.prospectsDirtyKey({ id: '', closest: () => ({}) }), 'contacts_json');
  assert.equal(h.ctx.prospectsDirtyKey({ id: 'prospect-call-note-card-ATM-1' }), 'call_note');
  assert.equal(h.ctx.prospectsDirtyKey({ id: 'prospect-callback-date-card-ATM-1', closest: () => null }), '');
});

test('unsaved edits: confirming discards them and navigates', async () => {
  const h = harness({ confirm: true }); api(h);
  await h.ctx.loadProspects();
  await h.ctx.prospectsOpen('ATM-1');
  h.ctx.prospectsMarkDirty({ target: { id: 'prospect-note' } });
  await h.ctx.prospectsStep(1);
  assert.equal(h.ctx._prospects.current.id, 'ATM-2');
  assert.equal(h.ctx.prospectsIsDirty(), false);
  assert.equal(h.confirms.length, 1);
});

test('keyboard: ←/→, J/K and Russian о/л navigate; ignored while typing or with modifiers', async () => {
  const h = harness(); api(h);
  await h.ctx.loadProspects();
  await h.ctx.prospectsOpen('ATM-1');
  const press = async (key, target = { tagName: 'DIV' }, extra = {}) => { h.ctx.prospectsKey({ key, target, preventDefault() {}, ...extra }); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); };
  await press('ArrowRight'); assert.equal(h.ctx._prospects.current.id, 'ATM-2');
  await press('j'); assert.equal(h.ctx._prospects.current.id, 'ATM-3');
  await press('л'); assert.equal(h.ctx._prospects.current.id, 'ATM-2');
  await press('ArrowLeft', { tagName: 'INPUT' }); assert.equal(h.ctx._prospects.current.id, 'ATM-2');
  await press('k', { tagName: 'TEXTAREA' }); assert.equal(h.ctx._prospects.current.id, 'ATM-2');
  await press('ArrowLeft', { tagName: 'DIV' }, { ctrlKey: true }); assert.equal(h.ctx._prospects.current.id, 'ATM-2');
  await press('Escape'); assert.equal(h.ctx._prospects.drawerOpen, false);
  await press('ArrowRight'); assert.equal(h.ctx._prospects.current, null);   // closed: keys do nothing
});

test('logging a call from the card keeps unsaved form edits and offers «Следующее →»', async () => {
  const h = harness(); api(h);
  h.ctx.apiPost = async () => ({ ok: true, status: 201, data: { ok: true, revision: 6 } });
  await h.ctx.loadProspects();
  await h.ctx.prospectsOpen('ATM-1');
  h.node('prospect-field-owner').value = 'Петрова А.'; h.ctx.prospectsMarkDirty({ target: { id: 'prospect-field-owner' } });
  h.node('prospect-field-next_date').value = '2026-12-01'; h.ctx.prospectsMarkDirty({ target: { id: 'prospect-field-next_date' } });
  h.node('prospect-note').value = 'черновик комментария'; h.ctx.prospectsMarkDirty({ target: { id: 'prospect-note' } });
  h.node('prospect-callback-date-card-ATM-1').value = '2026-10-09';
  await h.ctx.prospectsCallSubmit('ATM-1', 'card', 'callback');
  // Card was re-rendered (fields are new nodes), edits restored except next_* that the callback just set.
  assert.equal(h.node('prospect-field-owner').value, 'Петрова А.');
  assert.equal(h.node('prospect-note').value, 'черновик комментария');
  assert.equal(h.node('prospect-field-next_date').value, '');
  assert.deepEqual([...h.ctx._prospects.dirty].sort(), ['note', 'owner']);
  assert.equal(h.ctx._prospects.current.id, 'ATM-1');
  assert.equal(h.node('prospect-after-call').hidden, false);
  assert.match(h.node('prospect-after-call').innerHTML, /Записано: Перезвонить.*Следующее →/);
});

test('auto-advance after a call moves to the next company', async () => {
  const h = harness({ storage: { atomus_prospects_autonext: '1' } }); api(h);
  h.ctx.apiPost = async () => ({ ok: true, status: 201, data: { ok: true, revision: 6 } });
  await h.ctx.loadProspects();
  await h.ctx.prospectsOpen('ATM-1');
  await h.ctx.prospectsCallSubmit('ATM-1', 'card', 'no_answer');
  assert.equal(h.ctx._prospects.current.id, 'ATM-2');
  h.ctx.prospectsAutoNext(false);
  assert.equal(h.store.get('atomus_prospects_autonext'), '0');
});

test('table re-render keeps its scroll position for the same selection', async () => {
  const h = harness(); api(h);
  await h.ctx.loadProspects();
  h.getWrap().scrollTop = 420;
  await h.ctx.loadProspects();
  assert.equal(h.getWrap().scrollTop, 420);
  h.ctx._prospects.direction = 'cheese';
  h.getWrap().scrollTop = 420;
  await h.ctx.loadProspects();   // other selection → starts from top
  assert.equal(h.getWrap().scrollTop, 0);
});

test('card layout: sticky head with position, call button, sections in calling order', async () => {
  const h = harness(); api(h);
  await h.ctx.loadProspects();
  await h.ctx.prospectsOpen('ATM-2');
  const html = h.node('prospects-detail').innerHTML;
  assert.match(html, /<header class="pdw-head">/);
  assert.match(html, /id="prospect-prev"[^>]*onclick="prospectsStep\(-1\)"/);
  assert.match(html, /Позвонить<\/a><a class="pdw-mainphone" href="tel:\+73512223344">/);
  const order = ['id="pdw-contacts"', 'id="pdw-call"', 'id="pdw-work"', 'id="pdw-history"'].map(s => html.indexOf(s));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), String(order));
  assert.doesNotMatch(html.slice(0, html.indexOf('id="pdw-call"')), /<details[^>]*><summary>Контакты/);  // contacts are not collapsed
});

test('integration hooks: app deep link + leaving the screen closes the drawer; no split layout', () => {
  const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
  assert.match(app, /function _restoreLastView\(\) \{\n  if \(_voiceDeepLink\(\)\) return;\n[^\n]*\n  if \(typeof prospectsDeepLink === 'function' && prospectsDeepLink\(\)\) return;/);
  assert.match(app, /function selectSidebarItem\(screenName\) \{\n[^\n]*\n  if \(screenName !== 'sales-prospects' && typeof _prospects !== 'undefined' && _prospects\.drawerOpen/);
  assert.doesNotMatch(source, /classList\.add\('prospect-split'\)/);
  const css = fs.readFileSync(path.join(root, 'prospects.css'), 'utf8');
  assert.match(css, /\.prospect-drawer\{position:fixed;[^}]*width:min\(760px,calc\(100vw - var\(--prospect-drawer-gap,0px\)\)\)/);
  assert.match(css, /@media\(max-width:760px\)\{\.prospect-drawer\{width:100vw/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'campaigns.js'), 'utf8'), /prospect-split/);
});
