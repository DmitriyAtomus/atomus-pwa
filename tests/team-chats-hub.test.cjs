// Хаб «Чаты» (v2.46.135): вкладки «Все / Мой ход / Непрочитанные / Архив»,
// поиск, чипы «мяч»/статус расчёта и архив. Фильтр — чистая функция,
// гоняем её настоящим кодом app-4.js на фейках.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');

function slice(from, to) {
  const i = app.indexOf(from);
  assert.ok(i >= 0, 'не найдено: ' + from);
  const j = app.indexOf(to, i);
  assert.ok(j > i, 'не найден конец: ' + to);
  return app.slice(i, j);
}

const code = slice('const TC_CALC_ST =', 'function _tcTabsBar')
  + 'return {_tcBallMine, _tcVisibleChats};';
const { _tcBallMine, _tcVisibleChats } = new Function(code)();

const CHATS = [
  { id: 1, title: 'Расчёт Р-1 · Камера сушки', archived: false, unread: 0, last_at: '2026-08-27',
    calc: { status: 'in_progress', ball_employee_id: 7, ball_holder_name: 'Подкорытов Д.С.', ball_days: 4 } },
  { id: 2, title: 'Расчёт Р-3 · Холодильную установку', archived: false, unread: 1, last_at: '2026-08-29',
    calc: { status: 'cancelled', ball_employee_id: 7, ball_holder_name: 'Подкорытов Д.С.', ball_days: 9 } },
  { id: 3, title: 'Расчёт Р-9 · Оборудование для камер', archived: false, unread: 0, last_at: '2026-09-01',
    calc: { status: 'in_progress', ball_employee_id: 2, ball_holder_name: 'Малахова Л.А.', ball_days: 1 } },
  { id: 4, title: 'Расчёт Р-2 · 2 камеры для Влады', archived: true, unread: 0, last_at: '2026-08-20',
    calc: { status: 'to_offer', ball_employee_id: null, ball_holder_name: '', ball_days: 0 } },
  { id: 5, title: 'Чат монтажников', archived: false, unread: 3, last_at: '2026-08-30' },
];

test('«мяч у меня» — только живые расчёты, отказ не считается ходом', () => {
  assert.ok(_tcBallMine(CHATS[0], 7));
  assert.ok(!_tcBallMine(CHATS[1], 7));      // cancelled — хода нет
  assert.ok(!_tcBallMine(CHATS[2], 7));      // мяч у Малаховой
  assert.ok(!_tcBallMine(CHATS[4], 7));      // без расчёта
});

test('вкладка «Все»: сначала мой ход, потом непрочитанные, архив скрыт', () => {
  const ids = _tcVisibleChats(CHATS, 'all', '', 7).map(c => c.id);
  assert.deepEqual(ids, [1, 5, 2, 3]);       // 1 — мой ход; 5,2 — unread по дате; 3 — остальное
});

test('вкладки фильтруют: мой ход, непрочитанные, архив', () => {
  assert.deepEqual(_tcVisibleChats(CHATS, 'ball', '', 7).map(c => c.id), [1]);
  assert.deepEqual(_tcVisibleChats(CHATS, 'unread', '', 7).map(c => c.id).sort(), [2, 5]);
  assert.deepEqual(_tcVisibleChats(CHATS, 'arch', '', 7).map(c => c.id), [4]);
});

test('поиск сужает по названию без учёта регистра', () => {
  assert.deepEqual(_tcVisibleChats(CHATS, 'all', 'влады', 7).map(c => c.id), []);   // Влада в архиве
  assert.deepEqual(_tcVisibleChats(CHATS, 'arch', 'влады', 7).map(c => c.id), [4]);
  assert.deepEqual(_tcVisibleChats(CHATS, 'all', 'монтаж', 7).map(c => c.id), [5]);
});

test('строка чата несёт чипы и архив, рендер идёт по отфильтрованным', () => {
  assert.match(app, /tc2-ball mine[^>]*>🎾 ваш ход/);
  assert.match(app, /tc2-st s-' \+ st\[1\]/);
  assert.match(app, /_tcArchive\(event,' \+ c\.id/);
  assert.match(app, /\/api\/team-chats\/' \+ chatId \+ '\/archive/);
  assert.match(app, /shown\.map\(_tcRowV2\)/);
  assert.match(app, /shown\.forEach\(c => \{/);         // старый вид тоже фильтруется
  assert.match(app, /_tcTabsBar\(chats, myEmpId\)/);
  assert.match(app, /Мяч не у вас/);
});
