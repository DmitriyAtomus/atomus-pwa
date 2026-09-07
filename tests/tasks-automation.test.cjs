// Поток «Автоматика» (v2.46.139): отдельный экран для правок щитов управления,
// тумблер в форме задачи, чип «⚡ щит» в списке и факт в карточке.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app2 = fs.readFileSync(path.join(__dirname, '..', 'app-2.js'), 'utf8');
const app1 = fs.readFileSync(path.join(__dirname, '..', 'app-1.js'), 'utf8');
const idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function slice(src, from, to) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, 'не найдено: ' + from);
  const j = src.indexOf(to, i);
  assert.ok(j > i, 'не найден конец: ' + to);
  return src.slice(i, j);
}

test('экран потока: раздельные группы, настоящий рендер на фейках', () => {
  const code = slice(app2, 'function renderTasksAuto(tasks)', "// ---- «Назначенные мне» ----")
    + 'return renderTasksAuto;';
  let out = '';
  const container = {};
  Object.defineProperty(container, 'innerHTML', { set(v) { out = v; }, get() { return out; } });
  // v2.46.142: Клава добавила проверку прав в шапке потока — стабим её тоже
  const render = new Function('document', 'renderTaskRow', 'escapeHtml', 'canManageTasks', code)(
    { getElementById: () => container },
    (t) => '<row>' + t.title + '</row>',
    (v) => String(v),
    () => true);
  render([
    { id: 1, title: 'Поменять уставку', status: 'new' },
    { id: 2, title: 'Добавить реле', status: 'in_progress' },
    { id: 3, title: 'Старая правка', status: 'done' },
  ]);
  assert.match(out, /В РАБОТЕ И НОВЫЕ <span>2<\/span>/);
  assert.match(out, /СДЕЛАНО <span>1<\/span>/);
  assert.ok(out.indexOf('Поменять уставку') < out.indexOf('Старая правка'));
  assert.match(out, /openNewTaskAuto\(\)/);
  // пусто — зовём занести первую правку
  render([]);
  assert.match(out, /Заноси первую правку щита/);
});

test('форма: переключатель «Задача / Правка щита», поле щита и черновик', () => {
  // v2.46.142: Клава переделала тумблер в кнопки-виды с пресетами щитов
  assert.ok(app2.includes("setTaskKind(\\'automation\\')"));   // onclick с экранированными кавычками
  assert.match(app2, /id="tf-panel"/);
  assert.match(app2, /setTaskPanel\(/);
  assert.match(app2, /category: f\.category \|\| '',/);
  assert.match(app2, /panel: \(f\.panel \|\| ''\)\.trim\(\)/);
  // предзаполнение из потока и из редактирования
  assert.match(app2, /category: state\.taskAutoPreset \? 'automation' : ''/);
  assert.match(app2, /category: t\.category \|\| ''/);
});

test('чип в списке и факт в карточке', () => {
  assert.match(app2, /tkr-tag auto[^>]*>⚡ ' \+ escapeHtml\(t\.panel \|\| 'щит'\)/);
  assert.match(app2, /Щит управления/);
});

test('навигация подключена: пункт, экран, загрузчик', () => {
  assert.match(idx, /data-nav="tasks-auto"/);
  assert.match(idx, /data-screen="tasks-auto"/);
  assert.match(idx, /id="tasks-auto-content"/);
  assert.match(app1, /if \(screenName === 'tasks-auto'\) loadTasksAuto\(\);/);
  assert.match(app2, /\/api\/tasks\?category=automation/);
});
