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

test('напоминание показывается ровно за пять минут до планёрки', () => {
  const code = section('function _plReminderTime(value)', 'function plPreviewReminder(value)');
  const context = {};
  vm.runInNewContext(`${code}\nthis.reminderTime = _plReminderTime;`, context);

  assert.equal(context.reminderTime('11:15'), '11:10');
  assert.equal(context.reminderTime('00:03'), '23:58');
});

test('руководитель сохраняет выбранное время через API планёрки', () => {
  const render = section('function renderPlanerka()', 'async function plAtt(');
  const save = section('async function plSaveTime(btn)', 'async function plDone(');

  assert.match(render, /_pl\.can_manage[\s\S]*id="pl-time-input" type="time"/);
  assert.match(render, /id="pl-reminder-time"/);
  assert.match(render, /Клава позовёт в <b id="pl-klava-time">/);
  assert.match(save, /apiPost\('\/api\/planerka\/settings',\s*\{\s*time:\s*v\s*\}\)/);
  assert.match(save, /_pl\.time\s*=\s*r\.data\.time/);
});

test('в планёрке больше нет захардкоженного старого расписания', () => {
  const planerka = section('var _pl = null;', '// ============ v2.45.831:');

  assert.match(planerka, /_pl\.time \|\| '11:15'/);
  assert.doesNotMatch(planerka, /напоминание в 10:40/);
  assert.doesNotMatch(planerka, /_pl\.time \|\| '10:45'/);
});
