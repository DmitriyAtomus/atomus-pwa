// v2.46.289: галочка «Создавать задачи другим» показывает «Новая задача».
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const app2 = fs.readFileSync(path.join(root, 'app-2.js'), 'utf8');
const version = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));

function slice(src, from, to) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, 'не найдено: ' + from);
  const j = src.indexOf(to, i);
  assert.ok(j > i, 'не найден конец: ' + to);
  return src.slice(i, j);
}

function loadCanManage() {
  const code = slice(app2, 'function canManageTasks', 'function tasksAutoOnly');
  return new Function('state', 'hasPermission', code + '\nreturn canManageTasks;');
}

test('мастер с правом ставит обычную задачу и не теряет правки щита', () => {
  const can = loadCanManage()(
    { user: { roles: ['master'], permissions: ['tasks.create_for_others'] } },
    (key) => key === 'tasks.create_for_others');
  assert.equal(can(''), true);
  assert.equal(can('automation'), true);
});

test('мастер без права по-прежнему только в «Автоматике»', () => {
  const can = loadCanManage()(
    { user: { roles: ['master'], permissions: ['production.view'] } },
    () => false);
  assert.equal(can(''), false);
  assert.equal(can(undefined), false);
  assert.equal(can('automation'), true);
});

test('роль task_creator с сервера тоже открывает кнопку', () => {
  const can = loadCanManage()(
    { user: { roles: ['master', 'task_creator'], permissions: [] } },
    () => false);
  assert.equal(can(''), true);
});

test('версия 289 записана в четырёх местах', () => {
  assert.equal(version.version, 'v2.46.289');
  const app1 = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const app3 = fs.readFileSync(path.join(root, 'app-3.js'), 'utf8');
  assert.match(app1, /const APP_VERSION = "v2\.46\.289"/);
  assert.match(sw, /const CACHE_VERSION = 'atomus-v2\.46\.289'/);
  assert.match(app3, /const HELP_CHANGELOG = \[\r?\n  \{version:'v2\.46\.289'/);
});
