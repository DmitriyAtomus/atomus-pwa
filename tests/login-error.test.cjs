const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-1.js'), 'utf8');

function loadFormatter() {
  const start = source.indexOf('function formatApiErrorMessage(value, fallback)');
  const end = source.indexOf('async function apiPost', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  vm.runInNewContext(
    `${source.slice(start, end)}\nthis.format = formatApiErrorMessage;`,
    context
  );
  return context.format;
}

test('ошибка-объект превращается в понятное сообщение', () => {
  const format = loadFormatter();

  assert.equal(format({ error: { message: 'Доступ временно закрыт' } }),
    'Доступ временно закрыт');
  assert.equal(format({ detail: [{ msg: 'Поле обязательно' }] }),
    'Поле обязательно');
  assert.equal(format({}, 'Неверный пароль'), 'Неверный пароль');
  assert.notEqual(format({ error: { code: 'security_checkpoint' } }), '[object Object]');
});

test('форма входа всегда пропускает ответ через форматтер', () => {
  assert.match(source, /el\.textContent = formatApiErrorMessage\(msg, ''\)/);
  assert.match(source,
    /setStatus\(formatApiErrorMessage\(r\.data, 'Неверный пароль'\), 'error'\)/);
});
