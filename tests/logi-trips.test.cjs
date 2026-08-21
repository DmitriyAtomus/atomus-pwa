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

// Рейс — это маршрут забора грузов. Ссылку в навигатор фронт считает сам,
// той же формулой, что бэкенд шлёт курьеру. Только Яндекс (решение
// директора после прогона 12.08.2026: 2ГИС собирал маршрут криво):
// rtext ждёт «широта,долгота» — перепутать порядок, и курьер поедет в океан.
test('ссылка Яндекса собирается в правильном порядке координат, 2ГИС убран', () => {
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
  assert.equal(links.ya, 'https://yandex.ru/maps/?rtext=55.04,60.1~55.08,60.08&rtt=auto');
  assert.equal(links.gis, undefined);
  assert.ok(!app3.includes('2gis.ru'), 'в коде осталась ссылка на 2ГИС');
});

test('одна точка с координатами — маршрут не строится, ссылок нет', () => {
  const context = {};
  vm.runInNewContext(
    section('function _ltNavLinks(points)', 'async function loadLogiTrips') +
      '\nthis.f = _ltNavLinks;',
    context
  );
  const links = context.f([{ lat: 55.04, lon: 60.1 }, { lat: null, lon: null }]);
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

// «Оптимизировать» спрашивает OSRM /trip: waypoint_index у i-й исходной
// точки — её место в кратчайшем объезде. Перепутать направление
// отображения — курьер поедет по «оптимальному» маршруту задом наперёд.
test('порядок точек после оптимизации собирается по waypoint_index', () => {
  const context = {};
  vm.runInNewContext(
    section('function _ltOptimizedIds(points, waypoints)', 'async function ltTripOptimize') +
      '\nthis.f = _ltOptimizedIds;',
    context
  );
  // исходно точки [A=10, B=11, C=12]; OSRM говорит: A остаётся первой,
  // B едем третьей (index 2), C — второй (index 1)
  const ids = context.f(
    [{ id: 10 }, { id: 11 }, { id: 12 }],
    [{ waypoint_index: 0 }, { waypoint_index: 2 }, { waypoint_index: 1 }]
  );
  assert.deepEqual(ids, [10, 12, 11]);
});

test('карточка рейса рисует карту и умеет оптимизировать', () => {
  const render = section('function _ltTripRender(trip)', 'async function ltPtMove');
  assert.match(render, /lt-map-wrap/, 'нет контейнера карты');
  assert.match(render, /_ltTripMap\(trip\)/, 'рендер не зовёт карту');
  assert.match(render, /ltTripOptimize/, 'нет кнопки оптимизации');
  assert.ok(app3.includes('function _ltEnsureLeaflet'), 'нет ленивого Leaflet');
  assert.ok(app3.includes('router.project-osrm.org/trip/v1/driving'), 'нет вызова OSRM /trip');
});

// ETA: время в пути +25% на город, 7 минут стоянки на каждой точке.
// Стоянка добавляется ПОСЛЕ прибытия — иначе первая точка «уезжает» на 7 минут.
test('ETA по точкам: прибытие без стоянки, стоянка перед следующим плечом', () => {
  const context = {};
  vm.runInNewContext(
    section('function _ltEtaChain(coordIds, legs, startMs)', 'function _ltStatsHtml') +
      '\nthis.f = _ltEtaChain;',
    context
  );
  // старт 10:00, плечи по 8 минут (480 с): 480*1.25 = 10 минут езды
  const start = new Date(2026, 7, 11, 10, 0, 0).getTime();
  const etas = context.f([1, 2, 3], [{ duration: 480 }, { duration: 480 }], start);
  assert.equal(etas[2], '10:10');            // 10 мин езды, без стоянки
  assert.equal(etas[3], '10:27');            // +7 стоянка +10 езды
  assert.equal(etas[1], undefined);          // старт — прибытия нет
});

// Аналитика считается из списка рейсов: рейсы старше 30 дней не в счёт,
// длительность — от отправки курьеру до закрытия.
test('сводка за 30 дней: свежие рейсы в счёте, старые нет', () => {
  const context = { plural: (n, a, b, c) => a, escapeHtml: (s) => s };
  vm.runInNewContext(
    section('function _ltStatsHtml(trips, nowMs)', 'async function ltPtAddOpen') +
      '\nthis.f = _ltStatsHtml;',
    context
  );
  const now = new Date(2026, 7, 11, 12, 0, 0).getTime();
  const html = context.f([
    { trip_date: '2026-08-10', status: 'done', points_count: 4, done_count: 4,
      problem_count: 0, driver_name: 'Иванов',
      sent_at: '2026-08-10 09:00:00', done_at: '2026-08-10 11:00:00' },
    { trip_date: '2026-08-05', status: 'done', points_count: 3, done_count: 2,
      problem_count: 1, driver_name: 'Иванов',
      sent_at: '2026-08-05 09:00:00', done_at: '2026-08-05 10:00:00' },
    { trip_date: '2026-05-01', status: 'done', points_count: 99, done_count: 99,
      problem_count: 9, driver_name: 'Старый' }, // старше 30 дней — мимо
  ], now);
  assert.match(html, /за 30 дней <b>2 рейс<\/b>/);
  assert.match(html, /точек <b>7<\/b>/);
  assert.match(html, /забрано <b>6<\/b>/);
  assert.match(html, /проблем <b>1<\/b>/);
  assert.match(html, /1 ч 30 м/);            // (120 + 60) / 2 минут
  assert.match(html, /Иванов<\/b> \(2\)/);
  assert.ok(!html.includes('Старый'));
});

test('допланирование не предлагает то, что уже в рейсе', () => {
  const add = section('async function ltPtAddOpen()', 'async function ltPtAddGo');
  assert.match(add, /inTrip/, 'нет фильтра уже добавленных грузов');
  assert.match(add, /pickup-pool/, 'пул не запрашивается');
  const goStart = app3.indexOf('async function ltPtAddGo()');
  assert.notEqual(goStart, -1, 'нет функции ltPtAddGo');
  const go = app3.slice(goStart);
  assert.match(go, /Отправить ещё раз/, 'нет напоминания перепослать чек-лист');
});

// Геокодер: адрес в справочнике → координаты сами. Ответ, пришедший после
// того как адрес поменяли, применять нельзя — заполнит чужие координаты.
test('справочник точек сам ищет координаты по адресу', () => {
  const geoStart = app3.indexOf('async function ltDirGeo()');
  assert.notEqual(geoStart, -1, 'нет функции ltDirGeo');
  const geo = app3.slice(geoStart);
  assert.match(geo, /\/api\/logistics\/geocode\?q=/, 'не зовёт эндпоинт геокодера');
  assert.match(geo, /curAddr !== addr/, 'нет защиты от устаревшего ответа');
  const dir = section('async function logiPointsDir()', 'async function ltDirReload');
  assert.match(dir, /ltDirGeo/, 'поле адреса не подключено к геокодеру');
});

test('стили рейсов на месте', () => {
  for (const cls of ['.lg-tabs', '.lg-tab.on', '.lt-card', '.lt-prog-fill',
                     '.lt-pool-i', '.lt-pt.done .n', '.lt-dir-form']) {
    assert.ok(css.includes(cls), `нет стиля ${cls}`);
  }
});

// v2.46.023: геокодер не знает дом (Миасс, Готвальда 1/1в) — точка садится на
// улицу. Это должно быть видно в списке, а место — уточняться тыком по карте.
test('точка с примерными координатами помечена и правится по карте', () => {
  const render = section('function _ltTripRender(trip)', 'async function ltPtMove');
  assert.match(render, /geo_exact/, 'в списке точек нет признака примерных координат');
  assert.match(render, /Точка на карте примерная/, 'нет пометки о примерной точке');

  const edit = section('function ltPtEdit(pid)', 'function ltPtGeoClear');
  assert.match(edit, /lt-pe-map/, 'в правке точки нет карты');
  assert.match(edit, /draggable: true/, 'маркер нельзя перетащить');
  assert.match(edit, /map\.on\('click'/, 'клик по карте не ставит точку');

  const save = section('async function ltPtEditSave(pid)', 'async function ltPtDel');
  assert.match(save, /body\.lat = /, 'ручные координаты не уходят на сервер');

  for (const cls of ['.lt-geo-warn', '#lt-pe-map']) {
    assert.ok(css.includes(cls), `нет стиля ${cls}`);
  }
});
