// Расстановку узлов в проекте чиллера считает Клод, а не браузер: в конструкторе
// есть заявка, оболочка кладёт её в чат «Чиллеры», а сцена подхватывает ответ.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const proj = fs.readFileSync(path.join(root, 'chiller', 'project.html'), 'utf8');

test('в конструкторе есть кнопка заявки, а правил компоновки в браузере нет', () => {
  assert.match(proj, /id="bAsk"[^>]*>🧠 Клод, расставь/);
  // ролевых слотов и автокомпоновки больше нет — иначе получилось бы две
  // конкурирующие расстановки: одна по табличке, другая от Клода
  assert.doesNotMatch(proj, /const SLOT=/);
  assert.doesNotMatch(proj, /function autoLayout/);
});

test('заявка уходит наверх сообщением с номером проекта и составом', () => {
  const fn = proj.slice(proj.indexOf('function askLayout'), proj.indexOf('function showLayNote'));
  assert.match(fn, /atom-chiller-layout/);
  assert.match(fn, /PROJ\.id/);
  assert.match(fn, /Состав сцены/);
  // состав сохраняем до заявки: Клод должен читать то же, что на экране
  assert.match(fn, /'PATCH',\{data:projPayload\(\)\}/);
  // открытая сама по себе страница не молчит, а отдаёт текст для чата
  assert.match(fn, /parent===window/);
});

test('оболочка отправляет заявку в чат «Чиллеры» от имени владельца', () => {
  const listener = app.slice(app.indexOf("e.data.type !== 'atom-chiller-chat'"),
                             app.indexOf('// Esc закрывает шторку'));
  assert.match(listener, /atom-chiller-layout/);
  assert.match(listener, /roles\.includes\('director'\)/);
  assert.match(listener, /openChillerChat\(/);
  const ask = app.slice(app.indexOf('async function _chillerChatAsk'),
                        app.indexOf("e.data.type !== 'atom-chiller-chat'"));
  assert.match(ask, /devChatSend\(/);
  assert.match(ask, /atom-chiller/);
});

test('компоновку со стороны сервера подхватываем, а руку не выдёргиваем', () => {
  const poll = proj.slice(proj.indexOf('async function pollProject'), proj.indexOf('/* «Собрать по схеме»'));
  assert.match(poll, /updated_at/);
  assert.match(poll, /loadProjectData/);
  assert.match(poll, /_touchedAt/);              // только что двигали руками — показываем кнопку
  assert.match(poll, /showLayNote\(p\.data&&p\.data\.layout,true\)/);
  assert.match(proj, /setInterval\(pollProject,15000\)/);
});

test('в проекте хранятся отметка, наклон и пояснение к компоновке', () => {
  const pay = proj.slice(proj.indexOf('function projPayload'), proj.indexOf('function save()'));
  assert.match(pay, /z:p\.obj\.position\.z/);
  assert.match(pay, /t:p\.obj\.rotation\.y/);
  assert.match(pay, /d\.layout=layoutNote/);
});

test('новая деталь ложится на выкладку, а не в машину', () => {
  const park = proj.slice(proj.indexOf('function parkItem'), proj.indexOf('/* ═══ заявка Клоду'));
  assert.match(park, /s\.min\.y-320/);           // ряд перед фасадом корпуса
  assert.match(park, /boxFree/);
  assert.match(proj, /else parkItem\(it\);/);
});
