const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'app-3.js'),
  'utf8'
);

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

test('настройка Деловых линий отправляет appkey и PAT', () => {
  const save = section(
    'async function dellinSaveKeys()',
    'async function dellinRefresh()'
  );

  assert.match(
    save,
    /apiPost\('\/api\/settings\/dellin',\s*\{\s*appkey:\s*appkey,\s*pat:\s*pat\s*\}\)/
  );
  assert.doesNotMatch(save, /\blogin\s*:/);
  assert.doesNotMatch(save, /\bpassword\s*:/);
});

test('сохранение отправляет точный контракт и очищает PAT', async () => {
  const appkeyEl = { value: ' app-key-for-test ' };
  const patEl = { value: ` dl-api-${'x'.repeat(32)} ` };
  const saveBtn = { disabled: false };
  const requests = [];
  const toasts = [];
  let reloads = 0;
  const context = {
    document: {
      getElementById(id) {
        return {
          'dl-appkey': appkeyEl,
          'dl-pat': patEl,
          'dl-save-keys': saveBtn,
        }[id] || null;
      },
    },
    showToast(message, type) {
      toasts.push({ message, type });
    },
    async apiPost(url, body) {
      requests.push({ url, body });
      return { ok: true, data: { message: 'Подключено' } };
    },
    loadLogisticsPickups() {
      reloads += 1;
    },
    async dellinRefresh() {
      reloads += 1;
    },
  };
  const code = section(
    'function _redactDellinPat(value)',
    'async function dellinRefresh()'
  );
  vm.runInNewContext(`${code}\nthis.save = dellinSaveKeys;`, context);

  await context.save();

  assert.deepEqual(
    JSON.parse(JSON.stringify(requests)),
    [{
      url: '/api/settings/dellin',
      body: { appkey: 'app-key-for-test', pat: `dl-api-${'x'.repeat(32)}` },
    }]
  );
  assert.equal(patEl.value, '');
  assert.equal(saveBtn.disabled, false);
  assert.equal(reloads, 1);
  assert.deepEqual(toasts, [{ message: 'Подключено', type: 'success' }]);
});

test('PAT скрыт в форме и очищается после запроса', () => {
  const save = section(
    'async function dellinSaveKeys()',
    'async function dellinRefresh()'
  );
  const html = section(
    'function _dellinCredentialsHtml(configured)',
    'function dellinSettings()'
  );

  assert.match(html, /id="dl-pat"\s+type="password"/);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(save, /finally\s*\{[\s\S]*patEl\.value\s*=\s*''/);
  assert.doesNotMatch(html, /id="dl-login"/);
  assert.doesNotMatch(html, /id="dl-pass"/);
});

test('ручное обновление показывает число автоматически добавленных грузов', async () => {
  const toasts = [];
  const requests = [];
  let reloads = 0;
  const context = {
    showToast(message, type) {
      toasts.push({ message, type });
    },
    async apiPost(url, body) {
      requests.push({ url, body });
      return { ok: true, data: { synced: 3, total: 4, added: 2, visible: 9 } };
    },
    _redactDellinPat(value) {
      return value;
    },
    loadLogisticsPickups() {
      reloads += 1;
    },
  };
  const code = section(
    'async function dellinRefresh()',
    '// ============ ДЕЛОВЫЕ ЛИНИИ'
  );
  vm.runInNewContext(`${code}\nthis.refresh = dellinRefresh;`, context);

  await context.refresh();

  assert.deepEqual(
    JSON.parse(JSON.stringify(requests)),
    [{ url: '/api/logistics/dellin/refresh', body: {} }]
  );
  assert.deepEqual(toasts, [
    { message: 'Синхронизируем журнал Деловых линий…', type: 'info' },
    { message: 'Журнал обновлён: доступно 9 · новых заказов: 2', type: 'success' },
  ]);
  assert.equal(reloads, 1);
});

test('PAT не может попасть в сообщение интерфейса', () => {
  const redactor = section(
    'function _redactDellinPat(value)',
    'async function dellinSaveKeys()'
  );

  assert.match(redactor, /replace\(\/dl-api-/);
  assert.match(source, /_redactDellinPat\(j\.message/);
});

test('журнал показывает стороны, маршрут, деньги, статус и направления', () => {
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

  const html = context.render({
    configured: true,
    summary: { active: 1, total: 2, incoming: 1, outgoing: 0, payer: 0 },
    journal: { days: 90, visible_count: 2, last_sync_at: '2026-07-27 12:00:00' },
    shipments: [
      {
        id: 1,
        order_id: '64606845',
        dellin_number: '26-02731011431',
        source: 'journal',
        direction: 'incoming',
        ordered_at: '2026-07-23 12:00:00',
        sender_name: 'ООО ОЛИД',
        receiver_name: 'ООО АТОМУС ГРУПП',
        from_city: 'Химки',
        to_city: 'Миасс',
        auto_cargo: 'Оборудование · 19 кг',
        total_sum: 3808,
        is_paid: 0,
        auto_status: 'Груз в пути',
        progress_percent: 64,
      },
      {
        id: 2,
        order_id: '64389849',
        dellin_number: '26-02000000002',
        source: 'journal',
        direction: 'outgoing',
        auto_status: 'Заказ завершён',
        is_closed: 1,
        total_sum: 2064,
        is_paid: 1,
      },
    ],
  });

  assert.match(html, /API кабинета видит 2 заказа/);
  assert.match(html, /64606845/);
  assert.match(html, /Химки/);
  assert.match(html, /Миасс/);
  assert.match(html, /ООО ОЛИД/);
  assert.match(html, /ООО АТОМУС ГРУПП/);
  assert.match(html, /3[\s\u00a0]?808 ₽/);
  assert.match(html, /не оплачен/);
  assert.match(html, /к нам/);
  assert.match(html, /Завершённые заказы/);
  assert.match(html, /dellinSettings\(\)/);
});
