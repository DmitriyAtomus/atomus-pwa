const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app-2.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('форма задачи отправляет массив исполнителей', () => {
  assert.match(app, /assignee_ids:\s*\(f\.assignee_ids \|\| \[\]\)/);
  assert.match(app, /можно выбрать нескольких/);
  assert.match(app, /function toggleTaskAssignee\(employeeId\)/);
  assert.match(css, /\.task-assignee-option\.selected/);
});

test('пикер отмечает сразу нескольких сотрудников', () => {
  const start = app.indexOf('function renderTaskAssigneePicker()');
  const end = app.indexOf('function setTaskPriority(', start);
  assert.ok(start >= 0 && end > start, 'найдены функции пикера исполнителей');
  const source = app.slice(start, end);
  const context = {
    cache: {
      activeEmployees: [
        { id: 10, short_name: 'Иванов И.И.' },
        { id: 20, short_name: 'Петров П.П.' },
        { id: 30, short_name: 'Сидоров С.С.' },
      ],
    },
    state: { taskForm: { assignee_ids: [10, 20] } },
    escapeHtml: value => String(value == null ? '' : value),
    document: { getElementById: () => null },
    localStorage: { setItem() {}, removeItem() {} },
  };
  vm.runInNewContext(source + '\nresult = renderTaskAssigneePicker();', context);
  assert.match(context.result, /Иванов И\.И\./);
  assert.match(context.result, /Петров П\.П\./);
  assert.equal((context.result.match(/aria-checked="true"/g) || []).length, 2);
  assert.equal((context.result.match(/task-assignee-chip/g) || []).length, 2);
});

test('карточка и список используют полный список исполнителей', () => {
  assert.match(app, /function getTaskAssignees\(t\)/);
  assert.match(app, /taskAssignees\.some\(emp => Number\(emp\.id\) === Number\(myEmpId\)\)/);
  assert.match(app, /Исполнители:/);
  assert.match(app, /task-assignee-avatars/);
});
