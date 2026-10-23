/**
 * Свои точки рейса: куда заехать, что сделать, комментарий.
 *
 * Рейс — не только «забрать груз»: бывает отвезти щиты, оплатить пошлину,
 * подписать документы, просто заехать посмотреть. Дело точки должно
 * доехать до бэкенда (ключи те же, что в logi_trips.POINT_ACTIONS),
 * попасть в чек-лист MAX, задачу и ленту ТВ.
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

function actions() {
  const context = {};
  vm.runInNewContext(
    section('const _LT_ACTIONS = [', 'const _LT_STATUS') +
      '\nthis.act = _ltAct; this.opts = _ltActOptions; this.list = _LT_ACTIONS;',
    context
  );
  return context;
}

// Ключи дел общие с бэкендом: разойдутся — точка приедет «забрать»
// вместо «отвезти», и водитель поедет не с тем грузом.
test('дела точки совпадают с бэкендом и падают в «забрать» при незнакомом ключе', () => {
  const c = actions();
  const keys = c.list.map((a) => a[0]);
  assert.equal(keys.join(','), 'pickup,deliver,pay,docs,meet,look,other');
  assert.equal(c.act('deliver')[1], 'Отвезти');
  assert.equal(c.act('деловая-чушь')[0], 'pickup');
  assert.equal(c.act(null)[0], 'pickup');
  assert.equal(c.act('pay')[3], 'Оплатил');
});

test('в списке дел выбрано текущее, по умолчанию — «забрать»', () => {
  const c = actions();
  assert.match(c.opts('docs'), /value="docs" selected/);
  assert.ok(!/value="pickup" selected/.test(c.opts('docs')));
  assert.match(c.opts(''), /value="pickup" selected/);
});

// Форма своей точки одна на «Новый рейс» и на допланирование — иначе
// в одном месте забудут комментарий, и он не уедет водителю.
test('своя точка — это дело, куда, адрес и комментарий', () => {
  const row = section('function _ltCustomRowHtml(act)', 'function _ltCollectCustom');
  for (const f of ['action', 'title', 'address', 'note']) {
    assert.ok(row.includes('data-f="' + f + '"'), `в форме точки нет поля ${f}`);
  }
  const newTrip = section('async function logiTripNew()', 'function ltCustomAdd');
  assert.match(newTrip, /id="lt-custom"/);
  const addOpen = section('async function ltPtAddOpen()', 'async function ltPtAddGo');
  assert.match(addOpen, /_ltCustomRowHtml/, 'допланирование не использует общую форму точки');
  assert.match(addOpen, /ltCustomAdd\(\\'lt-add-custom\\'\)/, 'нельзя добавить вторую свою точку');
});

test('сборка рейса шлёт дело и комментарий, пустые строки пропускает', () => {
  const context = { out: [] };
  vm.runInNewContext(
    section('function _ltCollectCustom(sel)', 'const _LT_STATUS') +
      '\nthis.f = _ltCollectCustom;',
    Object.assign(context, {
      document: {
        querySelectorAll(sel) {
          assert.equal(sel, '#lt-custom .lt-custom-row');
          const mk = (v) => ({
            querySelector: (q) => {
              const f = q.match(/data-f="(\w+)"/)[1];
              return v[f] === undefined ? null : { value: v[f] };
            },
          });
          return [
            mk({ action: 'deliver', title: '  Таватуй  ', address: 'Екатеринбург, Ленина 1',
                 note: 'два щита, отдать кладовщику' }),
            mk({ action: 'pay', title: '   ', address: '', note: 'пустая строка' }),
            mk({ title: 'Без выбора дела' }),
          ];
        },
      },
    })
  );
  const pts = context.f('#lt-custom');
  assert.equal(pts.length, 2, 'строка без названия не должна уезжать в рейс');
  assert.equal(JSON.stringify(pts[0]), JSON.stringify({
    title: 'Таватуй', address: 'Екатеринбург, Ленина 1',
    note: 'два щита, отдать кладовщику', action: 'deliver', source_kind: 'custom',
  }));
  assert.equal(pts[1].action, 'pickup', 'без выбора дела точка должна быть «забрать»');
});

// В карточке рейса видно, что за дело и с каким комментарием, а кнопка
// «✓» подписана по делу: на оплате «Забрал» звучит бессмысленно.
test('карточка рейса показывает дело, комментарий и правку своей точки', () => {
  const render = section('function _ltTripRender(trip)', 'async function ltPtMove');
  assert.match(render, /_ltAct\(p\.action\)/, 'дело точки не читается');
  assert.match(render, /lt-act/, 'нет чипа с делом');
  assert.match(render, /lt-cmt/, 'комментарий точки не выводится');
  assert.match(render, /title="' \+ act\[3\] \+ '"/, 'кнопка «сделал» не подписана по делу');
  assert.match(render, /ltPtEdit\(/, 'нет кнопки правки точки');
  assert.match(render, /const own = !p\.source_id/, 'правку дают и точкам из пула');
});

test('правка точки уходит PATCH-ом и не теряет кавычки в названии', () => {
  const edit = section('function ltPtEdit(pid)', 'async function ltPtDel');
  assert.match(edit, /apiPatch\('\/api\/logistics\/trips\/' \+ trip\.id \+ '\/points\/' \+ pid/);
  assert.ok(!/value="' \+/.test(edit), 'значения подставляются в атрибут — кавычки сломают форму');
  assert.match(edit, /el\.value = v \|\| ''/, 'значения не проставляются полями');
  assert.match(edit, /Отправить ещё раз/, 'нет напоминания перепослать чек-лист');
  for (const id of ['lt-pe-act', 'lt-pe-title', 'lt-pe-addr', 'lt-pe-note']) {
    assert.ok(edit.includes(id), `в форме правки нет поля ${id}`);
  }
});

test('стили своей точки на месте', () => {
  for (const cls of ['.lt-custom-row', '.lt-custom-row .full', '.lt-act', '.lt-cmt']) {
    assert.ok(css.includes(cls), `нет стиля ${cls}`);
  }
});
