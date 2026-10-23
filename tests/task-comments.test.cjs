// Обсуждение в задаче (v2.46.133): комментарии и события правок одной лентой,
// отправка без перерисовки карточки, бейджи «💬 N» в списке и на доске.
// Рендер гоняем настоящим кодом app-2.js на фейковых данных.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'app-2.js'), 'utf8');

function slice(from, to) {
  const i = app.indexOf(from);
  assert.ok(i >= 0, 'не найдено: ' + from);
  const j = app.indexOf(to, i);
  assert.ok(j > i, 'не найден конец: ' + to);
  return app.slice(i, j);
}

const code =
  slice('function taskTimeAgo(iso)', 'function _taskDiscGrow(el)') +
  'return {taskTimeAgo, _taskDiscItemHtml, renderTaskDiscussion};';
const esc = (v) => String(v).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => 'dt:' + iso;
const { taskTimeAgo, _taskDiscItemHtml, renderTaskDiscussion } =
  new Function('escapeHtml', 'formatTaskDateTime', code)(esc, fmt);

test('лента: реплики пузырями, события — служебной строкой', () => {
  const h = renderTaskDiscussion({ comments: [
    { id: 1, kind: 'comment', author_name: 'Дмитрий', text: 'Возьми срочно', mine: false, can_delete: false, created_at: '2026-09-03 08:00:00' },
    { id: 2, kind: 'event', author_name: 'Сборщик', text: 'статус: Новая → В работе', created_at: '2026-09-03 08:05:00' },
    { id: 3, kind: 'comment', author_name: 'Сборщик', text: 'Принял <ок>', mine: true, can_delete: true, created_at: '2026-09-03 08:06:00' },
  ]});
  assert.match(h, /Обсуждение/);
  assert.match(h, /id="task-disc-cnt"[^>]*>2</);              // счётчик — только живые реплики
  assert.match(h, /task-disc-ev/);
  assert.match(h, /Сборщик · статус: Новая → В работе/);
  assert.match(h, /task-disc-msg mine/);                       // свои — справа
  assert.match(h, /Принял &lt;ок&gt;/);                        // текст экранирован
  assert.match(h, /deleteTaskComment\(3\)/);                   // удалить можно только где can_delete
  assert.ok(!h.includes('deleteTaskComment(1)'));
  assert.match(h, /task-disc-inp/);                            // поле ввода на месте
});

test('пустая лента зовёт написать первым и прячет счётчик', () => {
  const h = renderTaskDiscussion({ comments: [] });
  assert.match(h, /Пока тихо/);
  assert.match(h, /style="display:none"/);
});

test('время по-человечески: «только что», минуты, часы', () => {
  const iso = (msAgo) => {
    const d = new Date(Date.now() - msAgo);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  };
  assert.equal(taskTimeAgo(iso(20 * 1000)), 'только что');
  assert.equal(taskTimeAgo(iso(5 * 60 * 1000)), '5 мин назад');
  assert.equal(taskTimeAgo(iso(3 * 3600 * 1000)), '3 ч назад');
  assert.equal(taskTimeAgo(''), '');
});

test('отправка дописывает ленту без перерисовки карточки', () => {
  const send = slice('async function sendTaskComment()', 'async function deleteTaskComment');
  assert.match(send, /\/api\/tasks\/' \+ state\.currentTaskId \+ '\/comments/);
  assert.match(send, /insertAdjacentHTML\('beforeend', _taskDiscItemHtml/);
  assert.match(send, /feed\.scrollTop = feed\.scrollHeight/);
  assert.match(send, /inp\.focus\(\)/);
  // Enter — отправить, Shift+Enter — перенос
  assert.match(app, /e\.key === 'Enter' && !e\.shiftKey/);
});

test('бейджи комментариев в строке списка и на доске', () => {
  assert.match(app, /tkr-tag cmt[^>]*>💬 ' \+ t\.comments_count/);
  assert.match(app, /task-meta-comments[^>]*><i class="ti ti-message-circle"><\/i>' \+ t\.comments_count/);
});

test('карточка рендерит обсуждение и мотает ленту вниз', () => {
  assert.match(app, /html \+= renderTaskDiscussion\(t\);/);
  assert.match(app, /const feed = document\.getElementById\('task-disc-feed'\);\s*\n\s*if \(feed\) feed\.scrollTop = feed\.scrollHeight;/);
});
