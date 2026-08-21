/**
 * Выбор места для своей точки рейса: «куда уже ездили».
 *
 * Диспетчер не должен набирать адрес заново — место из справочника или из
 * прошлого рейса подставляется целиком, вместе с координатами. Если
 * координаты потерять или, наоборот, оставить от прежнего места, рейс
 * поедет не туда, поэтому проверяем оба края.
 */
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

// Мини-строка формы: поля data-f, как в настоящей разметке
function fakeRow(values) {
  const fields = {};
  ['action', 'title', 'address', 'note', 'lat', 'lon'].forEach((f) => {
    fields[f] = { value: values[f] === undefined ? '' : values[f] };
  });
  return {
    fields,
    querySelector(q) {
      const f = q.match(/data-f="(\w+)"/)[1];
      return fields[f] || null;
    },
  };
}

function placesCtx(places) {
  const context = {
    window: { _ltPlaces: places },
    document: { getElementById: () => null },
  };
  context.window.window = context.window;
  vm.runInNewContext(
    section('function _ltPlaceByName(name)', 'function ltPlaceRowPick') +
      '\nthis.byName = _ltPlaceByName; this.toRow = _ltPlaceToRow; this.type = ltPlaceRowType;',
    context
  );
  return context;
}

const PLACES = [
  { name: 'Терминал ДЛ Миасс', kind: 'dl_terminal', address: 'Миасс, Романенко 19',
    lat: 55.05, lon: 60.1, used: 0, source: 'dir' },
  { name: 'Налоговая', kind: '', address: 'Миасс, Лихачёва 21',
    lat: 55.0, lon: 60.0, action: 'docs', used: 3, source: 'history' },
  { name: 'Заказчик «Таватуй»', kind: '', address: '', lat: null, lon: null,
    used: 1, source: 'history' },
];

test('место находится по названию без оглядки на регистр и пробелы', () => {
  const c = placesCtx(PLACES);
  assert.equal(c.byName(' налоговая ').address, 'Миасс, Лихачёва 21');
  assert.equal(c.byName('Терминал ДЛ Миасс').lat, 55.05);
  assert.equal(c.byName('Кто-то незнакомый'), null);
  assert.equal(c.byName(''), null);
});

test('выбранное место кладёт в строку название, адрес и координаты', () => {
  const c = placesCtx(PLACES);
  const row = fakeRow({});
  c.toRow(row, PLACES[1]);
  assert.equal(row.fields.title.value, 'Налоговая');
  assert.equal(row.fields.address.value, 'Миасс, Лихачёва 21');
  assert.equal(row.fields.lat.value, 55.0);
  assert.equal(row.fields.lon.value, 60.0);
});

test('у места без координат поля координат остаются пустыми — адрес найдёт геокодер', () => {
  const c = placesCtx(PLACES);
  const row = fakeRow({ lat: '55.9', lon: '60.9' });
  c.toRow(row, PLACES[2]);
  assert.equal(row.fields.lat.value, '');
  assert.equal(row.fields.lon.value, '');
});

// Вписал знакомое название руками — адрес подставляем; вписал новое —
// координаты прежнего места обязаны уйти, иначе водитель поедет по ним.
test('набранное руками название подтягивает адрес, чужое — сбрасывает координаты', () => {
  const c = placesCtx(PLACES);
  const row = fakeRow({});
  const input = { value: 'Налоговая', closest: () => row };
  c.type(input);
  assert.equal(row.fields.address.value, 'Миасс, Лихачёва 21');
  assert.equal(row.fields.lat.value, 55.0);

  const input2 = { value: 'Гараж у Петровича', closest: () => row };
  c.type(input2);
  assert.equal(row.fields.lat.value, '', 'координаты прежнего места не сброшены');
  assert.equal(row.fields.lon.value, '');
  assert.equal(row.fields.title.value, 'Гараж у Петровича');
});

test('свой адрес поверх выбранного места не затирается', () => {
  const c = placesCtx(PLACES);
  const row = fakeRow({ address: 'Миасс, свой заезд со двора' });
  const input = { value: 'Налоговая', closest: () => row };
  c.type(input);
  assert.equal(row.fields.address.value, 'Миасс, свой заезд со двора');
});

test('форма своей точки умеет выбирать место и прячет координаты', () => {
  const row = section('function _ltCustomRowHtml(act)', 'function _ltCollectCustom');
  assert.match(row, /ltPlaceRowPick\(this\)/, 'нет кнопки выбора места');
  assert.match(row, /list="lt-places-dl"/, 'нет подсказки в поле «куда заехать»');
  assert.match(row, /onchange="ltPlaceRowType\(this\)"/, 'название руками не разбирается');
  for (const f of ['lat', 'lon']) {
    assert.ok(row.includes('data-f="' + f + '"'), `в форме точки нет поля ${f}`);
  }
});

test('координаты уезжают в рейс только когда место выбрано', () => {
  const context = {};
  vm.runInNewContext(
    section('function _ltCollectCustom(sel)', '// ---------- v2.46.017') +
      '\nthis.f = _ltCollectCustom;',
    Object.assign(context, {
      document: {
        querySelectorAll() {
          return [
            fakeRow({ action: 'pickup', title: 'Налоговая', address: 'Лихачёва 21',
              lat: '55.0', lon: '60.0' }),
            fakeRow({ action: 'deliver', title: 'Новый адрес', address: 'Ленина 1' }),
          ];
        },
      },
    })
  );
  const pts = context.f('#lt-custom');
  assert.equal(pts[0].lat, '55.0');
  assert.equal(pts[0].lon, '60.0');
  assert.ok(!('lat' in pts[1]), 'у ненайденного места не должно быть координат');
});

test('список мест берётся с бэкенда и переживает обрыв связи', () => {
  const ensure = section('async function _ltPlacesEnsure(force)', 'function _ltPlacesDatalist');
  assert.match(ensure, /apiGet\('\/api\/logistics\/places'\)/);
  assert.match(ensure, /window\._ltPlaces = window\._ltPlaces \|\| \[\]/,
    'при ошибке список должен остаться прежним, а не сломать форму');
});

test('подсказки строятся полями — кавычки в названии не ломают список', () => {
  const dl = section('function _ltPlacesDatalist()', 'function _ltPlaceByName');
  assert.ok(!/<option value="' \+/.test(dl), 'опция собирается строкой — кавычки сломают её');
  assert.match(dl, /o\.value = p\.name/);
});

test('выбор места открывается из формы рейса, допланирования и правки', () => {
  const newTrip = section('async function logiTripNew()', 'function ltCustomAdd');
  assert.match(newTrip, /_ltPlacesEnsure\(true\)/, 'в новом рейсе список мест не грузится');
  const addOpen = section('async function ltPtAddOpen()', 'async function ltPtAddGo');
  assert.match(addOpen, /_ltPlacesEnsure\(true\)/, 'в допланировании список мест не грузится');
  const edit = section('function ltPtEdit(pid)', 'async function ltPtEditSave');
  assert.match(edit, /ltPlaceEditPick\(\)/, 'в правке точки нет выбора места');
  assert.match(edit, /_ltPlacesEnsure\(true\)/, 'в правке список мест не грузится');
});

test('правка точки шлёт координаты выбранного места', () => {
  const save = section('async function ltPtEditSave(pid)', 'async function ltPtDel');
  assert.match(save, /body\.lat = v\('lt-pe-lat'\)/);
  assert.match(save, /if \(v\('lt-pe-lat'\) && v\('lt-pe-lon'\)\)/,
    'координаты должны уезжать только парой');
});

test('фильтр показывает место по названию и по адресу, индекс не сбивается', () => {
  const context = { html: '' };
  const box = { set innerHTML(v) { context.html = v; }, get innerHTML() { return context.html; } };
  vm.runInNewContext(
    section('function ltPlaceFilter(q)', 'function ltPlaceChoose(i)') +
      '\nthis.f = ltPlaceFilter;',
    Object.assign(context, {
      window: { _ltPlaces: PLACES },
      document: { getElementById: () => box },
      escapeHtml: (s) => String(s == null ? '' : s),
      _ltKindName: (k) => k || 'Другое',
    })
  );
  context.f('романенко');
  assert.match(context.html, /Терминал ДЛ Миасс/);
  assert.ok(!context.html.includes('Налоговая'));
  assert.match(context.html, /ltPlaceChoose\(0\)/);

  context.f('налог');
  assert.match(context.html, /ltPlaceChoose\(1\)/, 'индекс места должен быть по общему списку');
  assert.match(context.html, /ездили 3 раз/);

  context.f('такого нет');
  assert.match(context.html, /Ничего не нашлось/);
});

test('стили выбора места на месте', () => {
  for (const cls of ['.lt-place-i', '.lt-row-ops', '.lt-place-i .tx small']) {
    assert.ok(css.includes(cls), `нет стиля ${cls}`);
  }
});
