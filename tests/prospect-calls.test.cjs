// v2.46.251: звонки, кликабельные телефоны, быстрые действия и выбор ответственного в базе предприятий.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'prospects.js'), 'utf8');
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function harness(manage = true) {
  const elements = new Map();
  const node = id => {
    if (!elements.has(id)) elements.set(id, { id, innerHTML: '', textContent: '', value: '', hidden: true, dataset: {}, classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, focus() {} });
    return elements.get(id);
  };
  const toasts = [];
  const ctx = vm.createContext({ URL, URLSearchParams, escapeHtml, setTimeout, clearTimeout, Date,
    canManageSales: () => manage, showToast: (m, t) => toasts.push([m, t]),
    document: { createElement: () => ({}), head: { appendChild() {} }, getElementById: node, querySelectorAll: () => [], querySelector: s => node(s) } });
  vm.runInContext(source, ctx); return { ctx, node, toasts };
}
const listing = rows => ({ rows, total: rows.length, page: 1, pages: 1, stats: { total: rows.length }, facets: { segment: [], region: [], owner: [] }, stages: { new: 'Новый' }, consents: {} });

test('чиллер: после дозвона итог и комментарий передаются отдельно от контакта', async () => {
  const { ctx, node } = harness();
  const posts = [];
  ctx._prospects.rows = [{ id: 'CH-1', name: 'Чиллер', direction: 'chillers', revision: 1, phone: '83512223344' }];
  ctx.apiPost = async (url, body) => { posts.push([url, body]); return { ok: true, status: 201, data: { ok: true } }; };
  ctx.apiGet = async () => listing([{ id: 'CH-1', name: 'Чиллер', direction: 'chillers', revision: 2 }]);
  assert.match(ctx.prospectsCallBox('CH-1', 'row'), /Итог разговора/);
  assert.doesNotMatch(ctx.prospectsCallBox('CH-1', 'row'), /С кем говорили/);
  node('prospect-call-note-row-CH-1').value = 'Нужна цена после расчёта';
  node('prospect-chiller-choice-row-CH-1').value = 'callback';
  node('prospect-chiller-date-row-CH-1').value = '2026-10-23';
  node('prospect-chiller-time-row-CH-1').value = '11:00';
  await ctx.prospectsCallSubmit('CH-1', 'row', 'reached');
  assert.equal(posts[0][0], '/api/sales/prospects/CH-1/calls');
  assert.deepEqual(JSON.parse(JSON.stringify(posts[0][1])), {
    revision: 1, result: 'reached', outcome: 'callback', note: 'Нужна цена после расчёта',
    phone: '+73512223344', next_date: '2026-10-23', next_time: '11:00',
  });
});

test('view switch styles only its buttons, never the whole screen', () => {
  const { ctx } = harness();
  const screen = { className: 'screen active', dataset: {} };
  const table = { className: '', dataset: { prospectView: 'table' }, setAttribute() {} };
  const board = { className: '', dataset: { prospectView: 'board' }, setAttribute() {} };
  ctx.document.querySelector = () => screen;
  ctx.document.querySelectorAll = selector => {
    assert.equal(selector, '.prospect-view-switch button[data-prospect-view]');
    return [table, board];
  };
  ctx._prospects.view = 'table';
  ctx.prospectsSyncViewButtons();
  assert.equal(screen.className, 'screen active');
  assert.equal(screen.dataset.prospectView, 'table');
  assert.equal(table.className, 'btn btn-primary');
  assert.equal(board.className, 'btn btn-secondary');
});

test('RU phones in any format normalize to tel:+7…, junk is not linked', () => {
  const { ctx } = harness();
  for (const raw of ['8 (351) 222-33-44', '+7 351 222 33 44', '7-351-222-33-44', '(351) 222-33-44', '83512223344 доб. 105'])
    assert.equal(ctx.prospectsTel(raw), '+73512223344', raw);
  assert.equal(ctx.prospectsTel('9001234567'), '+79001234567');
  assert.equal(ctx.prospectsTel('+375 29 123-45-67'), '+375291234567');
  assert.equal(ctx.prospectsTel('222-33-44'), '');
  assert.equal(ctx.prospectsTel('javascript:alert(1)'), '');
  const phones = ctx.prospectsPhones('8 (351) 222-33-44; +7 900 123-45-67, 22-33');
  assert.deepEqual(JSON.parse(JSON.stringify(phones.map(p => p.tel))), ['+73512223344', '+79001234567', '']);
});

test('table: row opens card, phone is tel: link, quick call/comment buttons present', async () => {
  const { ctx, node } = harness();
  ctx.apiGet = async () => listing([{ id: 'ATM-1', name: 'Завод', phone: '8 (351) 222-33-44; 8 900 000-00-01; 8 900 000-00-02', stage: 'new', revision: 3, calls_count: 2, last_call_result: 'reached', last_call_at: '2026-10-08 06:00:00' }]);
  await ctx.loadProspects();
  const html = node('prospects-list').innerHTML;
  assert.match(html, /<tr class="prospect-row" data-prospect-id="ATM-1" onclick="prospectsRowClick\(event,'ATM-1'\)"/);
  assert.match(html, /href="tel:\+73512223344"/);
  assert.match(html, /href="tel:\+79000000001"/);
  assert.doesNotMatch(html, /tel:\+79000000002/);  // only two phones in the row, rest summarized
  assert.match(html, /ещё 1/);
  assert.match(html, /prospectsQuick\(event,'ATM-1','call'\)/);
  assert.match(html, /prospectsQuick\(event,'ATM-1','comment'\)/);
  assert.match(html, /Звонков: 2/);
});

test('viewer sees no quick-action column', async () => {
  const { ctx, node } = harness(false);
  ctx.apiGet = async () => listing([{ id: 'ATM-1', name: 'Завод', phone: '', stage: 'new', revision: 1 }]);
  await ctx.loadProspects();
  assert.doesNotMatch(node('prospects-list').innerHTML, /prospectsQuick|Действия/);
});

test('row click ignores links, buttons and checkboxes', () => {
  const { ctx } = harness(); const opened = [];
  ctx.prospectsOpen = id => opened.push(id);
  ctx.prospectsRowClick({ target: { closest: () => ({}) } }, 'ATM-1');
  assert.equal(opened.length, 0);
  ctx.prospectsRowClick({ target: { closest: () => null } }, 'ATM-1');
  assert.deepEqual(opened, ['ATM-1']);
});

test('call result posts typed call with row revision; callback needs a date first', async () => {
  const { ctx, node } = harness(); const posts = [];
  ctx._prospects.rows = [{ id: 'ATM-1', revision: 5, phone: '8 (351) 222-33-44' }];
  ctx.apiPost = async (url, body) => { posts.push({ url, body }); return { ok: true, status: 201, data: { ok: true, revision: 6 } }; };
  ctx.apiGet = async () => listing([{ id: 'ATM-1', name: 'Завод', revision: 6 + posts.length, phone: '8 (351) 222-33-44', stage: 'new' }]);
  node('prospect-call-note-row-ATM-1').value = 'Секретарь, перезвонить инженеру';
  await ctx.prospectsCallResult('ATM-1', 'row', 'no_answer');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/api/sales/prospects/ATM-1/calls');
  assert.deepEqual(JSON.parse(JSON.stringify(posts[0].body)), { revision: 5, result: 'no_answer', note: 'Секретарь, перезвонить инженеру', phone: '+73512223344' });
  // «Перезвонить» first reveals date/time (prefilled), only the explicit save posts.
  await ctx.prospectsCallResult('ATM-1', 'row', 'callback');
  assert.equal(posts.length, 1);
  assert.equal(node('prospect-callback-row-ATM-1').hidden, false);
  assert.match(node('prospect-callback-date-row-ATM-1').value, /^\d{4}-\d{2}-\d{2}$/);
  node('prospect-callback-date-row-ATM-1').value = '';
  await ctx.prospectsCallSubmit('ATM-1', 'row', 'callback');
  assert.equal(posts.length, 1);
  assert.match(node('prospect-call-status-row-ATM-1').textContent, /дату/);
  node('prospect-callback-date-row-ATM-1').value = '2026-10-09';
  node('prospect-callback-time-row-ATM-1').value = '11:30';
  await ctx.prospectsCallSubmit('ATM-1', 'row', 'callback');
  assert.equal(posts.length, 2);
  assert.equal(posts[1].body.next_date, '2026-10-09');
  assert.equal(posts[1].body.next_time, '11:30');
  assert.equal(posts[1].body.revision, 7);  // refreshed revision after the first call
});

test('server conflict on call is reported and data refreshed', async () => {
  const { ctx, node, toasts } = harness(); let reloads = 0;
  ctx._prospects.rows = [{ id: 'ATM-1', revision: 5, phone: '' }];
  ctx.apiPost = async () => ({ ok: false, status: 409, data: { message: 'Карточку уже изменили. Откройте её заново.' } });
  ctx.apiGet = async () => { reloads++; return listing([]); };
  node('prospect-call-person-row-ATM-1').value = 'Иван Петров';
  await ctx.prospectsCallSubmit('ATM-1', 'row', 'reached');
  assert.match(node('prospect-call-status-row-ATM-1').textContent, /уже изменили/);
  assert.equal(reloads, 1);
  assert.ok(toasts.some(t => t[1] === 'info'));
});

test('call can move a card to a chosen board column in the same request', async () => {
  const { ctx, node } = harness(); const posts = [];
  ctx._prospects.rows = [{ id: 'ATM-1', revision: 3, stage: 'new', phone: '' }];
  ctx.apiPost = async (url, body) => { posts.push({ url, body }); return { ok: true, status: 201, data: { revision: 4 } }; };
  ctx.apiGet = async () => listing([{ id: 'ATM-1', revision: 4, stage: 'contact' }]);
  node('prospect-call-stage-row-ATM-1').value = 'contact';
  node('prospect-call-person-row-ATM-1').value = 'Иван Петров';
  await ctx.prospectsCallSubmit('ATM-1', 'row', 'reached');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.stage, 'contact');
  assert.equal(posts[0].body.result, 'reached');
});

test('call records who answered and what to send without hiding the comment', async () => {
  const { ctx, node } = harness(); const posts = [];
  ctx._prospects.rows = [{ id: 'ATM-1', revision: 3, stage: 'new', phone: '', contact_person: 'Петров' }];
  const html = ctx.prospectsCallBox('ATM-1', 'row');
  assert.match(html, /С кем говорили/);
  assert.match(html, /Что отправить/);
  assert.doesNotMatch(html, /value="Петров"/); // manager confirms who actually answered
  node('prospect-call-person-row-ATM-1').value = 'Иван Петров, инженер';
  node('prospect-call-send-row-ATM-1').value = 'КП на чиллер 50 кВт';
  node('prospect-call-note-row-ATM-1').value = 'Нужна вода +5 °C';
  ctx.apiPost = async (url, body) => { posts.push(body); return { ok: true, status: 201, data: { revision: 4 } }; };
  ctx.apiGet = async () => listing([{ id: 'ATM-1', revision: 4, stage: 'new' }]);
  await ctx.prospectsCallSubmit('ATM-1', 'row', 'reached');
  assert.equal(posts[0].called_person, 'Иван Петров, инженер');
  assert.equal(posts[0].to_send, 'КП на чиллер 50 кВт');
  assert.equal(posts[0].note, 'Нужна вода +5 °C');
});

test('later column requires a reason; callback date is reused', () => {
  const { ctx, node } = harness();
  node('prospect-call-stage-card-ATM-1').value = 'later';
  assert.throws(() => ctx.prospectsCallStagePayload('ATM-1', 'card', 'callback'), /причину/);
  node('prospect-call-reason-card-ATM-1').value = 'Бюджет в следующем квартале';
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.prospectsCallStagePayload('ATM-1', 'card', 'callback'))),
    { stage: 'later', close_reason: 'Бюджет в следующем квартале' });
  node('prospect-call-stage-date-card-ATM-1').value = '2026-10-20';
  assert.equal(ctx.prospectsCallStagePayload('ATM-1', 'card', 'reached').next_date, '2026-10-20');
});

test('mobile save and next moves once after recording the chosen column', async () => {
  const { ctx, node } = harness(); const posts = []; let steps = 0;
  ctx._prospects.rows = [{ id: 'ATM-1', revision: 5, stage: 'new', phone: '' }];
  node('pm-call-sheet').dataset = { prospectId: 'ATM-1', result: 'reached' };
  node('prospect-call-person-sheet-ATM-1').value = 'Иван Петров';
  node('prospect-call-stage-sheet-ATM-1').value = 'needs';
  ctx.apiPost = async (url, body) => { posts.push({ url, body }); return { ok: true, status: 201, data: { revision: 6 } }; };
  ctx.prospectsCallSheetClose = () => {};
  ctx.loadProspects = async () => {};
  ctx.prospectsOpen = async () => {};
  ctx.prospectsStep = async () => { steps++; };
  await ctx.prospectsCallSheetSave(true);
  assert.equal(posts[0].body.stage, 'needs');
  assert.equal(steps, 1);
});

test('completed conversation needs a person and stays visible in all company views', async () => {
  const { ctx, node } = harness(); const posts = [];
  const row = { id: 'ATM-1', name: 'Завод', revision: 1, stage: 'new', phone: '', spoken_at: '2026-10-12 10:00:00', spoken_with: 'Иван <Петров>' };
  ctx._prospects.rows = [row];
  ctx.apiPost = async (url, body) => { posts.push(body); return { ok: true, status: 201, data: {} }; };
  ctx.apiGet = async () => listing([row]);
  await ctx.prospectsCallSubmit('ATM-1', 'row', 'reached');
  assert.equal(posts.length, 0);
  assert.match(node('prospect-call-status-row-ATM-1').textContent, /с кем/);
  node('prospect-call-person-row-ATM-1').value = 'Иван Петров';
  await ctx.prospectsCallSubmit('ATM-1', 'row', 'reached');
  assert.equal(posts[0].called_person, 'Иван Петров');
  const table = node('prospects-list').innerHTML;
  assert.match(table, /Звонок был · Иван &lt;Петров&gt;/);
  ctx.prospectsRenderBoard(listing([row]));
  assert.match(node('prospects-list').innerHTML, /Звонок был · Иван &lt;Петров&gt;/);
  assert.match(ctx.prospectsMobileListHtml(listing([row])), /Звонок был · Иван &lt;Петров&gt;/);
  assert.match(ctx.prospectsHeadHtml(row, { new: 'Новый' }), /Звонок был · Иван &lt;Петров&gt;/);
});

test('quick comment uses PATCH note with revision and requires text', async () => {
  const { ctx, node } = harness(); const patches = [];
  ctx._prospects.rows = [{ id: 'ATM-1', revision: 9 }];
  ctx.apiPatch = async (url, body) => { patches.push({ url, body }); return { ok: true, revision: 10 }; };
  ctx.apiGet = async () => listing([]);
  await ctx.prospectsQuickComment('ATM-1');
  assert.equal(patches.length, 0);
  node('prospect-quick-note-ATM-1').value = '  Выслали опросный лист  ';
  await ctx.prospectsQuickComment('ATM-1');
  assert.deepEqual(JSON.parse(JSON.stringify(patches)), [{ url: '/api/sales/prospects/ATM-1', body: { revision: 9, note: 'Выслали опросный лист' } }]);
});

test('history shows call events with icon and result, escapes text', () => {
  const { ctx } = harness();
  const html = ctx.prospectsHistory([
    { created_at: '2026-10-08 06:00:00', actor: 1, actor_name: 'Любовь', kind: 'call', result: 'callback', changes_json: JSON.stringify({ call: { to: 'callback' }, phone: { to: '+73512223344' }, next_date: { to: '2026-10-09' }, note: { to: '<b>x</b>' } }) },
    { created_at: '2026-10-08 05:00:00', actor: 1, actor_name: 'Любовь', kind: 'edit', result: '', changes_json: JSON.stringify({ note: { to: 'Обычный комментарий' } }) },
  ], { stages: {}, consents: {} });
  assert.match(html, /ti-phone-call/);
  assert.match(html, /Звонок: Перезвонить/);
  assert.match(html, /\+73512223344/);
  assert.match(html, /Дата контакта: <\/b>2026-10-09/);
  assert.match(html, /&lt;b&gt;x/);
  assert.match(html, /Обычный комментарий/);
  assert.equal((html.match(/Звонок:/g) || []).length, 1);
});

test('history shows called person and send item once and escapes them', () => {
  const { ctx } = harness();
  const html = ctx.prospectsHistory([{ created_at: '2026-10-12 10:00:00', actor: 1, kind: 'call', result: 'reached',
    changes_json: JSON.stringify({ call: { to: 'reached' }, called_person: { to: '<Иван>' }, contact_person: { to: '<Иван>' },
      to_send: { to: 'КП <50 кВт>' }, next_action: { to: 'Отправить: КП <50 кВт>' } }) }], { stages: {}, consents: {} });
  assert.match(html, /С кем говорили: <\/b>&lt;Иван&gt;/);
  assert.match(html, /Что отправить: <\/b>КП &lt;50 кВт&gt;/);
  assert.doesNotMatch(html, /Контактный специалист:/);
  assert.doesNotMatch(html, /Следующий шаг:/);
});

test('owner select lists employees and keeps a legacy free-text value', () => {
  const { ctx } = harness();
  const html = ctx.prospectsOwnerControl('Любовь Старая', ['Иванов И.', 'Петрова А.']);
  assert.match(html, /<select id="prospect-field-owner">/);
  assert.match(html, /<option value="">Не назначен<\/option>/);
  assert.match(html, /<option value="Иванов И.">/);
  assert.match(html, /<option value="Любовь Старая" selected>Любовь Старая \(из прежней записи\)/);
  assert.match(ctx.prospectsOwnerControl('Любовь', null), /<input id="prospect-field-owner"/);
});

test('employee list is read from /api/employees/active {employees:[…]} and cached', async () => {
  const { ctx } = harness(); let calls = 0;
  ctx.apiGet = async url => { calls++; assert.equal(url, '/api/employees/active'); return { employees: [{ short_name: 'Иванов И.', full_name: 'Иванов Иван' }, { full_name: 'Петрова Анна' }] }; };
  assert.deepEqual(JSON.parse(JSON.stringify(await ctx.prospectsEmployees())), ['Иванов И.', 'Петрова Анна']);
  await ctx.prospectsEmployees();
  assert.equal(calls, 1);
});

test('mailing button is secondary, not the primary blue action', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<button class="btn btn-secondary" onclick="campaignsNew\(\)">/);
  assert.doesNotMatch(html, /btn-primary" onclick="campaignsNew\(\)"/);
});

test('release: version, cache, version.json and changelog stay in sync', () => {
  const ver = /const APP_VERSION = "(v[\d.]+)"/.exec(fs.readFileSync(path.join(root, 'app-1.js'), 'utf8'))[1];
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), new RegExp("atomus-" + ver.replace(/\./g, '\\.') + "'"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).version, ver);
  assert.match(fs.readFileSync(path.join(root, 'app-3.js'), 'utf8'), new RegExp("const HELP_CHANGELOG = \\[\\n  \\{version:'" + ver.replace(/\./g, '\\.') + "'"));
});
