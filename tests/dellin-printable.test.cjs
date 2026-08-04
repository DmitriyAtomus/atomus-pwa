const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

function renderBlock(dl) {
  const context = {
    escapeHtml(value) {
      return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    },
  };
  const code = section(
    'function _dellinCredentialsHtml(configured)',
    'function dellinTrack('
  );
  vm.runInNewContext(`${code}\nthis.render = _dellinBlockHtml;`, context);
  return context.render(dl);
}

const SHIPMENT = {
  id: 7,
  order_id: '64837115',
  dellin_number: '26-50070011147',
  source: 'journal',
  direction: 'incoming',
  auto_status: 'Груз в пути',
  total_sum: 4991,
  is_paid: 0,
};

test('в карточке журнала есть кнопка счёта и место под документ', () => {
  const html = renderBlock({
    configured: true,
    summary: {},
    journal: { days: 90, visible_count: 1 },
    shipments: [SHIPMENT],
  });

  assert.match(html, /onclick="dellinDoc\(7\)"/);
  assert.match(html, /id="dl-doc-7"/);
  // Неоплаченный счёт подсвечен основной кнопкой — видно, за что платить.
  assert.match(html, /id="dl-doc-btn-7" onclick/);
  assert.match(html, /class="btn btn-primary btn-small" id="dl-doc-btn-7"/);
});

test('оплаченный заказ не выделяет кнопку счёта', () => {
  const html = renderBlock({
    configured: true,
    summary: {},
    journal: { days: 90, visible_count: 1 },
    shipments: [{ ...SHIPMENT, id: 8, is_paid: 1 }],
  });

  assert.match(html, /class="btn btn-secondary btn-small" id="dl-doc-btn-8"/);
});

test('без подключённого кабинета кнопки счёта нет', () => {
  const html = renderBlock({
    configured: false,
    summary: {},
    journal: {},
    shipments: [SHIPMENT],
  });

  assert.doesNotMatch(html, /dellinDoc\(/);
});

test('счёт запрашивается у своего бэкенда с токеном и режимом', async () => {
  const calls = [];
  const cont = { dataset: {}, style: {}, innerHTML: '', querySelector: () => null };
  const context = {
    document: {
      getElementById(id) {
        return id === 'dl-doc-7' ? cont : null;
      },
    },
    state: { isDesktop: true },
    localStorage: { getItem: () => 'token-for-test' },
    API_BASE: 'https://api.example',
    TOKEN_KEY: 'atomus_token',
    URL: { createObjectURL: () => 'blob:pdf', revokeObjectURL() {} },
    escapeHtml: (v) => String(v || ''),
    showToast() {},
    async fetch(url, opts) {
      calls.push({ url, opts });
      return {
        ok: true,
        headers: { get: () => '' },
        async blob() { return { type: 'application/pdf' }; },
      };
    },
  };
  const code = section(
    '// ============ ПЕЧАТНЫЕ ФОРМЫ ДЛ',
    '// ============ ДЕЛОВЫЕ ЛИНИИ — полный журнал'
  );
  vm.runInNewContext(`${code}\nthis.doc = dellinDoc;`, context);

  await context.doc(7);

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://api.example/api/logistics/dellin/7/printable?mode=bill'
  );
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer token-for-test');
  assert.match(cont.innerHTML, /<iframe/);
  assert.match(cont.innerHTML, /dellinDocDownload\(7,'bill'\)/);
  assert.equal(cont.dataset.mode, 'bill');
});

test('ошибка от ДЛ показывается текстом, а не пустым блоком', async () => {
  const cont = { dataset: {}, style: {}, innerHTML: '', querySelector: () => null };
  const context = {
    document: { getElementById: (id) => (id === 'dl-doc-9' ? cont : null) },
    state: { isDesktop: true },
    localStorage: { getItem: () => 'token-for-test' },
    API_BASE: 'https://api.example',
    TOKEN_KEY: 'atomus_token',
    URL: { createObjectURL: () => 'blob:pdf', revokeObjectURL() {} },
    escapeHtml: (v) => String(v || ''),
    showToast() {},
    async fetch() {
      return {
        ok: false,
        status: 502,
        async json() { return { message: 'ДЛ пока не сформировали этот документ' }; },
      };
    },
  };
  const code = section(
    '// ============ ПЕЧАТНЫЕ ФОРМЫ ДЛ',
    '// ============ ДЕЛОВЫЕ ЛИНИИ — полный журнал'
  );
  vm.runInNewContext(`${code}\nthis.doc = dellinDoc;`, context);

  await context.doc(9, 'invoice');

  assert.match(cont.innerHTML, /ДЛ пока не сформировали этот документ/);
  assert.match(cont.innerHTML, /только плательщику/);
});
