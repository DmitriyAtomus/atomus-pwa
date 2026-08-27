const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
const changelog = fs.readFileSync(path.join(root, 'app-3.js'), 'utf8');

test('сотруднику явно предложены основные рабочие форматы', () => {
  assert.match(app, /Word, Excel, PDF, PowerPoint, изображения и 3D-модели STEP\/STL\/OBJ\/GLB/);
  assert.match(app, /Сделай Excel/);
  assert.match(app, /Собери PDF/);
  assert.match(app, /Нарисуй схему/);
  assert.match(app, /Сделай 3D-модель/);
  assert.match(app, /Кто я\?/);
  assert.match(app, /stl\|obj\|glb\|gltf\|step\|stp.*ti-cube-3d-sphere/);
});

test('созданный файл скачивается авторизованным запросом', () => {
  const start = app.indexOf('async function devChatDownloadFile');
  const end = app.indexOf('function _devChatFileCard', start);
  const fn = app.slice(start, end);
  assert.match(fn, /fetch\(API_BASE \+ f\.url/);
  assert.match(fn, /Authorization.*Bearer/);
  assert.match(fn, /await r\.blob\(\)/);
  assert.match(fn, /link\.download = f\.name/);
});

test('ответ показывает карточку скачивания и превью созданной PNG', () => {
  assert.match(app, /function _devChatFileCard\(f\)/);
  assert.match(app, /f\.generated\) bubble\.appendChild\(_devChatFileCard\(f\)\)/);
  assert.match(css, /\.dchat-file\.is-generated/);
  assert.match(css, /\.dchat-file \.go/);
});

test('версия рассказывает о безопасном создании файлов', () => {
  assert.match(changelog, /v2\.46\.095/);
  assert.match(changelog, /личном хранилище без доступа к правкам CRM/);
  assert.match(changelog, /профиль нельзя подменить сообщением/);
  assert.match(changelog, /3D-модель STL/);
});
