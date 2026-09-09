const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('вкладка показывает общий серверный журнал и автора', () => {
  const render = html.slice(
    html.indexOf('function _ccTabHistory()'),
    html.indexOf('function _ccTabCamera()'),
  );
  assert.match(render, /_ccHistoryList/);
  assert.match(render, /Общая история расчётов/);
  assert.match(render, /created_by_name/);
  assert.match(render, /h\.company/);
  assert.match(render, /h\.kw_total/);
  assert.doesNotMatch(render, /_ccLoadLocalHistory/,
    'localStorage не должен быть источником общей вкладки');
});

test('сохранение, открытие и удаление идут через API', () => {
  assert.match(html, /apiPost\('\/api\/cold-calc\/history'/);
  assert.match(html, /apiGet\('\/api\/cold-calc\/history'/);
  assert.match(html, /apiGet\('\/api\/cold-calc\/history\/' \+ encodeURIComponent\(id\)\)/);
  assert.match(html, /apiDelete\('\/api\/cold-calc\/history\/' \+ encodeURIComponent\(id\)\)/);
  assert.match(html, /h\.can_delete \?/,
    'кнопку удаления показываем только когда сервер выдал право');
});

test('старые локальные расчёты переносятся без удаления резервной копии', () => {
  const migration = html.slice(
    html.indexOf('async function _ccImportLocalHistory()'),
    html.indexOf('async function _ccRefreshHistory'),
  );
  assert.match(migration, /\/api\/cold-calc\/history\/import/);
  assert.match(migration, /source_id: h\.id/);
  assert.match(migration, /CC_HIST_MIGRATED_KEY/);
  assert.doesNotMatch(migration, /removeItem\(CC_HIST_KEY\)/,
    'локальную резервную копию не удаляем после переноса');
});

test('все встроенные script-блоки index.html синтаксически корректны', () => {
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/\bsrc=|type=["'](?:importmap|application\/json)/i.test(m[1]));
  assert.ok(scripts.length > 0);
  scripts.forEach((m, index) => {
    assert.doesNotThrow(() => new vm.Script(m[2], {filename: `index-inline-${index}.js`}));
  });
});
