const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app1 = fs.readFileSync(path.join(__dirname, '..', 'app-1.js'), 'utf8');

function section(from, to) {
  const start = app1.indexOf(from);
  const end = app1.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return app1.slice(start, end);
}

// MAX ID сотрудника — тот номер, который бот присылает человеку в ответ
// («Ваш ID: 103763925»). Директор вписывает его в карточку, и с этого момента
// человек проходит к боту и получает чек-листы рейсов лично.
function editContext(emp) {
  const context = {
    state: { employeeFormMode: '', currentEmployeeId: null, employeeForm: {}, user: { id: 1 } },
    cache: { employees: { employees: [emp] } },
    hasPermission: () => true,
    showToast: () => {},
    selectSidebarItem: () => {},
  };
  vm.runInNewContext(
    section('function openEditEmployee(empId)', 'function cancelEmployeeForm()') +
      '\nthis.openEditEmployee = openEditEmployee;',
    context
  );
  context.openEditEmployee(emp.id);
  return context.state.employeeForm;
}

test('карточка сотрудника подхватывает привязанный MAX ID', () => {
  const f = editContext({ id: 10, full_name: 'Подкорытов Сергей Анатольевич', max_user_id: 103763925 });
  assert.equal(f.max_user_id, '103763925');
});

test('у непривязанного сотрудника поле пустое, а не «null»', () => {
  const f = editContext({ id: 11, full_name: 'Шевелев Михаил Иванович', max_user_id: null });
  assert.equal(f.max_user_id, '');
});

test('пустое поле уезжает на бэкенд как null — это отвязка', () => {
  const submit = section('async function submitEmployeeForm()', 'async function toggleEmployeeActive');
  assert.match(submit, /payload\.max_user_id\s*=\s*f\.max_user_id\s*\?\s*parseInt\(f\.max_user_id\)\s*:\s*null/);
  // и только в режиме редактирования — при создании бэкенд поля не ждёт
  const guarded = submit.slice(submit.indexOf('if (isEdit) {', submit.indexOf('payload.telegram_id')));
  assert.ok(guarded.indexOf('payload.max_user_id') > -1 && guarded.indexOf('payload.max_user_id') < 200,
    'payload.max_user_id должен стоять внутри if (isEdit)');
});

test('в поле MAX ID остаются только цифры', () => {
  const render = section('function renderEmployeeForm()', 'async function submitEmployeeForm()');
  assert.match(render, /id="empf-max-id"/);
  assert.match(render, /state\.employeeForm\.max_user_id = e\.target\.value\.replace\(\/\\D\/g/);
});
