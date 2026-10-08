// v2.46.248: Продажи → Отчёты → вкладка «По базе заводов».
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');
const start = src.indexOf('// ============ ОТЧЁТЫ МЕНЕДЖЕРОВ (ежедневный KPI) ============');
const end = src.indexOf('// ============ INIT ============');
assert.ok(start > 0 && end > start, 'блок отчётов не найден в app-4.js');
const block = src.slice(start, end);
const escapeHtml = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function harness(tab) {
  const els = new Map();
  const node = id => {
    if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', value: '', addEventListener() {}, classList: { toggle() {} } });
    return els.get(id);
  };
  const store = { srTab: tab };
  const calls = { get: [], post: [] };
  const ctx = vm.createContext({
    escapeHtml, console,
    getInitials: n => (n || '').slice(0, 2),
    formatMoneyShort: n => String(n),
    showToast() {}, confirm: () => true,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    document: { getElementById: node },
  });
  ctx.window = ctx;
  ctx.apiGet = async url => { calls.get.push(url); return ctx.__resp(url); };
  ctx.apiPost = async (url, body) => { calls.post.push([url, body]); return { ok: true, status: 200, data: {} }; };
  vm.runInContext(block, ctx);
  return { ctx, node, calls, store };
}

const baseResp = {
  month: '2026-10', today: '2026-10-08', scope: 'own', can_edit: true,
  fields: ['calls', 'connects', 'interested', 'presentations', 'refusals'],
  my_reports: { '2026-10-06': { calls: 30, connects: 18, interested: 3, presentations: 2, refusals: 5, comment: 'Сыроварня просит КП' } },
  managers: [{
    employee_id: 9, name: 'Малахова Любовь Александровна', position: 'Менеджер по продажам',
    totals: { calls: 40, connects: 20, interested: 4, presentations: 3, refusals: 6 },
    reports: [
      { id: 2, report_date: '2026-10-07', calls: 10, connects: 2, interested: 1, presentations: 1, refusals: 1, comment: '<b>x</b>',
        cum: { calls: 40, connects: 20, interested: 4, presentations: 3, refusals: 6 } },
      { id: 1, report_date: '2026-10-06', calls: 30, connects: 18, interested: 3, presentations: 2, refusals: 5, comment: 'Сыроварня просит КП',
        cum: { calls: 30, connects: 18, interested: 3, presentations: 2, refusals: 5 } },
    ],
  }],
};

test('вкладка «По базе заводов» грузит свой endpoint и рисует форму из 5 полей', async () => {
  const { ctx, node, calls } = harness('base');
  ctx.__resp = () => JSON.parse(JSON.stringify(baseResp));
  await ctx.loadSalesReports();
  assert.deepEqual(calls.get, ['/api/sales/base-reports?month=2026-10']);
  const html = node('sales-reports-body').innerHTML;
  assert.match(html, /Общий отчёт/);
  assert.match(html, /По базе заводов/);
  for (const k of ['calls', 'connects', 'interested', 'presentations', 'refusals']) assert.match(html, new RegExp('id="sbr-' + k + '"'));
  assert.match(html, /id="sbr-comment"/);
  assert.doesNotMatch(html, /sbr-(no_answer|wrong_number|lpr_found|offers|callbacks|seg_)/);
  // воронка: звонки → дозвоны → интерес → презентации, отказы отдельно
  assert.match(html, /40<\/b> звонков.*50%.*20<\/b> дозвонов.*20%.*4<\/b> с интересом.*75%.*3<\/b> презентаций/s);
  assert.match(html, /отказы: <b>6<\/b> · 30% дозвонов/);
  // комментарий экранируется
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

test('общая вкладка по-прежнему ходит в /api/sales/reports', async () => {
  const { ctx, calls, node } = harness('general');
  ctx.__resp = () => ({ month: '2026-10', today: '2026-10-08', can_edit: false, my_reports: {}, managers: [] });
  await ctx.loadSalesReports();
  assert.deepEqual(calls.get, ['/api/sales/reports?month=2026-10']);
  assert.match(node('sales-reports-body').innerHTML, /sr-tab active[^>]*>Общий отчёт/);
});

test('сохранение отправляет только 5 цифр и комментарий', async () => {
  const { ctx, node, calls } = harness('base');
  ctx.__resp = () => JSON.parse(JSON.stringify(baseResp));
  await ctx.loadSalesReports();
  node('sbr-date').value = '2026-10-08';
  Object.assign(node('sbr-calls'), { value: '25' }); node('sbr-connects').value = '12';
  node('sbr-interested').value = '2'; node('sbr-presentations').value = '-3'; node('sbr-refusals').value = 'x';
  node('sbr-comment').value = '  Главный технолог ждёт презентацию ';
  await ctx.saveSalesBaseReport();
  assert.equal(calls.post.length, 1);
  assert.equal(calls.post[0][0], '/api/sales/base-reports');
  assert.deepEqual(JSON.parse(JSON.stringify(calls.post[0][1])), {
    date: '2026-10-08', calls: 25, connects: 12, interested: 2, presentations: 0, refusals: 0,
    comment: 'Главный технолог ждёт презентацию',
  });
});

test('текст для Telegram и недели месяца', () => {
  const { ctx } = harness('base');
  const r = baseResp.managers[0].reports[1];
  const t = ctx._sbrReportToText('Малахова Любовь Александровна', 'Менеджер по продажам', r);
  assert.match(t, /^Малахова Любовь Александровна\nОтчёт по базе заводов\nДата 06\.10\.26\n/);
  assert.match(t, /Звонков: 30\nДозвонились: 18\nИнтерес есть: 3\nОтправлено презентаций: 2\nОтказы: 5\nКомментарий: Сыроварня просит КП\n/);
  assert.match(t, /\*итого: отказов = 5\*$/);
  const weeks = JSON.parse(JSON.stringify(ctx._sbrWeeks('2026-10')));
  assert.equal(weeks[0].start, '2026-10-01'); assert.equal(weeks[0].end, '2026-10-04'); // 01.10.2026 — четверг
  assert.equal(weeks[1].start, '2026-10-05'); assert.equal(weeks[1].end, '2026-10-11');
  assert.equal(weeks[weeks.length - 1].end, '2026-10-31');
});

test('режим «Неделя» пересчитывает итоги по дням недели', async () => {
  const { ctx, node } = harness('base');
  ctx.__resp = () => JSON.parse(JSON.stringify(baseResp));
  await ctx.loadSalesReports();
  ctx._sbrSetPeriod('week');
  ctx._sbrSetWeek(0); // 01–04.10 — отчётов нет
  assert.match(node('sales-reports-body').innerHTML, /отчётов по базе пока нет/);
  ctx._sbrSetWeek(1); // 05–11.10 — оба отчёта
  const html = node('sales-reports-body').innerHTML;
  assert.match(html, /Итого за неделю 05–11\.10/);
  assert.match(html, /40<\/b> звонков/);
});
