const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app3 = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');

function section(from, to) {
  const start = app3.indexOf(from);
  const end = app3.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return app3.slice(start, end);
}

// Рейс — это маршрут забора грузов. Ссылки в навигаторы фронт считает сам,
// той же формулой, что бэкенд шлёт курьеру: 2ГИС ждёт «долгота,широта»,
// Яндекс — «широта,долгота». Перепутать порядок — курьер поедет в океан.
test('ссылки 2ГИС и Яндекс собираются в правильном порядке координат', () => {
  const context = {};
  vm.runInNewContext(
    section('function _ltNavLinks(points)', 'async function loadLogiTrips') +
      '\nthis.f = _ltNavLinks;',
    context
  );
  const links = context.f([
    { lat: 55.04, lon: 60.10 },
    { lat: 55.08, lon: 60.08 },
    { lat: null, lon: null }, // точка без координат не должна ломать ссылку
  ]);
  assert.equal(links.gis, 'https://2gis.ru/directions/points/60.1,55.04;60.08,55.08');
  assert.equal(links.ya, 'https://yandex.ru/maps/?rtext=55.04,60.1~55.08,60.08&rtt=auto');
});

test('одна точка с координатами — маршрут не строится, ссылок нет', () => {
  const context = {};
  vm.runInNewContext(
    section('function _ltNavLinks(points)', 'async function loadLogiTrips') +
      '\nthis.f = _ltNavLinks;',
    context
  );
  const links = context.f([{ lat: 55.04, lon: 60.1 }, { lat: null, lon: null }]);
  assert.equal(links.gis, '');
  assert.equal(links.ya, '');
});

// Логистика теперь двухвидовая: «Грузы» и «Рейсы». Экран грузов обязан
// делегировать на рейсы, иначе вкладка будет мёртвой.
test('Логистика переключается между «Грузами» и «Рейсами»', () => {
  const loader = section('async function loadLogisticsPickups()', 'function _luchIsCompleted');
  assert.match(loader, /state\._logiView === 'trips'/, 'нет делегирования на вид рейсов');
  assert.match(loader, /loadLogiTrips\(\)/, 'грузовой экран не зовёт loadLogiTrips');
  assert.match(loader, /_logiTabsHtml\('pickups'\)/, 'на экране грузов нет вкладок');
  for (const fn of ['loadLogiTrips', 'logiTripNew', 'logiTripCreate', 'logiTripOpen',
                    'ltPtStatus', 'ltTripSend', 'logiPointsDir']) {
    assert.ok(app3.includes('function ' + fn), `нет функции ${fn}`);
  }
});

// Статусы точек в карточке рейса — те же слова, что курьер пишет в MAX.
test('карточка рейса умеет «забрал», «проблема» и возврат в ожидание', () => {
  const render = section('function _ltTripRender(trip)', 'async function ltPtMove');
  assert.match(render, /ltPtStatus\(' \+ p\.id \+ ',\\'done\\'\)/);
  assert.match(render, /ltPtStatus\(' \+ p\.id \+ ',\\'problem\\'\)/);
  assert.match(render, /Отправить курьеру в MAX/);
});

test('стили рейсов на месте', () => {
  for (const cls of ['.lg-tabs', '.lg-tab.on', '.lt-card', '.lt-prog-fill',
                     '.lt-pool-i', '.lt-pt.done .n', '.lt-dir-form']) {
    assert.ok(css.includes(cls), `нет стиля ${cls}`);
  }
});
