'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const app1 = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const app2 = fs.readFileSync(path.join(root, 'app-2.js'), 'utf8');
const app3 = fs.readFileSync(path.join(root, 'app-3.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
const ver = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));

test('версия v2.46.297 согласована во всех файлах', () => {
  assert.equal(ver.version, 'v2.46.297');
  assert.match(app1, /const APP_VERSION = "v2\.46\.297"/);
  assert.match(sw, /const CACHE_VERSION = 'atomus-v2\.46\.297'/);
  assert.match(app3, /version:'v2\.46\.297'/);
  assert.equal(ver.date, '10.11.2026');
});

test('лимиты совпадают с бэкендом: 5 файлов, фото 8 МБ, док 20 МБ, видео 50 МБ', () => {
  assert.match(app2, /const TASK_FILES_MAX_PER_UPLOAD = 5/);
  assert.match(app2, /const TASK_FILE_MAX_PHOTO = 8 \* 1024 \* 1024/);
  assert.match(app2, /const TASK_FILE_MAX_VIDEO = 50 \* 1024 \* 1024/);
  assert.match(app2, /const TASK_FILE_MAX_DOC = 20 \* 1024 \* 1024/);
});

function loadHelpers() {
  const start = app2.indexOf('const TASK_FILES_MAX_PER_UPLOAD = 5;');
  const end = app2.indexOf('function addPendingTaskFiles(');
  assert.ok(start >= 0 && end > start);
  const ctx = {};
  vm.runInNewContext(app2.slice(start, end), ctx);
  return ctx;
}

test('taskFileMaxSize: типы и потолок размера', () => {
  const h = loadHelpers();
  const MB = 1024 * 1024;
  assert.equal(h.taskFileMaxSize({ name: 'a.jpg', type: 'image/jpeg' }), 8 * MB);
  assert.equal(h.taskFileMaxSize({ name: 'a.png', type: 'image/png' }), 8 * MB);
  assert.equal(h.taskFileMaxSize({ name: 'a.mp4', type: 'video/mp4' }), 50 * MB);
  assert.equal(h.taskFileMaxSize({ name: 'a.pdf', type: 'application/pdf' }), 20 * MB);
  assert.equal(h.taskFileMaxSize({ name: 'a.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 20 * MB);
  assert.equal(h.taskFileMaxSize({ name: 'щит.dwg', type: 'application/octet-stream' }), 20 * MB);
  assert.equal(h.taskFileMaxSize({ name: 'a.step', type: '' }), 20 * MB);
  assert.equal(h.taskFileMaxSize({ name: 'virus.exe', type: 'application/octet-stream' }), 0);
  assert.equal(h.taskFileMaxSize({ name: 'note.bin', type: 'application/octet-stream' }), 0);
});

test('taskFileValidateList отсекает большой и неизвестный файл', () => {
  const h = loadHelpers();
  const res = h.taskFileValidateList([
    { name: 'ok.pdf', type: 'application/pdf', size: 1000 },
    { name: 'big.pdf', type: 'application/pdf', size: 21 * 1024 * 1024 },
    { name: 'x.exe', type: 'application/octet-stream', size: 10 },
    { name: 'empty.pdf', type: 'application/pdf', size: 0 },
  ]);
  assert.equal(res.ok.length, 1);
  assert.equal(res.ok[0].name, 'ok.pdf');
  assert.equal(res.errors.length, 2);
  assert.match(res.errors[0], /big\.pdf/);
  assert.match(res.errors[1], /x\.exe/);
});

test('в форме новой задачи есть кнопка, drop-зона и список с удалением', () => {
  assert.match(app2, /function renderTaskFormFilesBlock\(/);
  assert.match(app2, /if \(!isEdit\) html \+= renderTaskFormFilesBlock\(\)/);
  assert.match(app2, /id="tf-file-btn"/);
  assert.match(app2, /Прикрепить файл/);
  assert.match(app2, /id="tf-files"/);
  assert.match(app2, /ondrop="_taskFormFilesDrop\(event\)"/);
  assert.match(app2, /function addPendingTaskFiles\(/);
  assert.match(app2, /function removePendingTaskFile\(/);
  assert.match(app2, /function _taskFormFilesDrop\(/);
  assert.match(css, /\.tf2-attach/);
  assert.match(css, /\.tf2-files/);
});

test('после POST /api/tasks файлы загружаются на новый id; ошибка не теряет задачу', () => {
  const start = app2.indexOf('async function submitTaskForm()');
  const end = app2.indexOf('\n// ---- Виджет «Мои задачи» на главной ----', start);
  const fn = app2.slice(start, end);
  assert.match(fn, /uploadPendingTaskFiles\(created\.id, pending\)/);
  assert.match(fn, /state\.currentTaskId = created\.id/);
  // currentTaskId ставится ДО загрузки файлов
  assert.ok(fn.indexOf('state.currentTaskId = created.id') < fn.indexOf('uploadPendingTaskFiles(created.id, pending)'));
  assert.match(fn, /Задача создана, но не загрузились/);
  assert.match(fn, /state\.taskFileUploadFail/);
  assert.match(fn, /selectSidebarItem\('task-detail'\)/);
  assert.match(app2, /async function postTaskFiles\(taskId, files\)/);
  assert.match(app2, /\/api\/tasks\/' \+ taskId \+ '\/files'/);
  assert.match(app2, /async function uploadPendingTaskFiles\(/);
  assert.match(app2, /TASK_FILES_MAX_PER_UPLOAD/);
});

test('в карточке всегда виден блок файлов: кнопка, drop, скачивание, удаление', () => {
  const start = app2.indexOf('function renderTaskFiles(t)');
  const end = app2.indexOf('\nfunction _taskFileRowHtml', start);
  const fn = app2.slice(start, end);
  assert.doesNotMatch(fn, /files\.length \? '' : ' style="display:none"'/);
  assert.match(fn, /id="task-card-file"[^>]*style="display:none"/);
  assert.match(fn, /id="task-files-attach"/);
  assert.match(fn, /Прикрепить файл/);
  assert.match(fn, /ondrop="_taskFilesDrop\(event\)"/);
  assert.match(fn, /id="task-files-empty"/);
  assert.match(fn, /task-files-fail/);
  assert.match(app2, /function _taskFileRowHtml\(f\)/);
  assert.match(app2, /API_BASE \+ f\.url/);
  assert.match(app2, /async function deleteTaskFile\(fid\)/);
  assert.match(app2, /\/api\/tasks\/files\/' \+ fid/);
  assert.match(app2, /id="task-disc-attach"/);
  assert.match(css, /\.task-files-attach/);
});

test('черновик не сериализует File, pending очищается при новой/отмене', () => {
  const draft = app2.slice(app2.indexOf('function _saveTaskDraft()'), app2.indexOf('function _loadTaskDraft()'));
  assert.doesNotMatch(draft, /taskFormPendingFiles/);
  assert.match(app2, /state\.taskFormPendingFiles = \[\];/);
  const discard = app2.slice(app2.indexOf('function discardTaskDraft()'), app2.indexOf('function openNewTask()'));
  assert.match(discard, /state\.taskFormPendingFiles = \[\];/);
});
