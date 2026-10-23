// Помощь → Обучение (v2.46.144): «Школа приёмки УПД» — главы, чек-лист,
// экзамен. Курс — литерал TRAINING_COURSES в app-4.js: вытаскиваем его
// настоящим кодом и проверяем целостность вопросов; подсчёт балла гоняем
// реальной _trScore.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app4 = fs.readFileSync(path.join(__dirname, '..', 'app-4.js'), 'utf8');
const app3 = fs.readFileSync(path.join(__dirname, '..', 'app-3.js'), 'utf8');
const app1 = fs.readFileSync(path.join(__dirname, '..', 'app-1.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function slice(src, from, to) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, 'не найдено: ' + from);
  const j = src.indexOf(to, i);
  assert.ok(j > i, 'не найден конец: ' + to);
  return src.slice(i, j);
}

function courses() {
  const code = slice(app4, 'const TRAINING_COURSES = [', '\nstate._training');
  return new Function(code + 'return TRAINING_COURSES;')();
}

// v2.46.146: школ десять — по всем разделам; у каждой проверяем целостность одинаково
test('все курсы целы: главы, чек-лист, 12 корректных вопросов, сдача от 10', () => {
  const list = courses();
  assert.deepEqual(list.map(c => c.id).sort(), [
    'contract_new', 'defects', 'hr', 'logistics', 'production',
    'sales_calcs', 'shipment', 'supply_cycle', 'tasks', 'upd_intake', 'warehouse',
  ]);
  list.forEach(c => {
    assert.ok(c.cat && c.cat.length > 2, c.id + ': нет раздела (cat)');
    assert.equal(c.pass, 10, c.id + ': проходной балл');
    assert.ok(c.chapters.length >= 4 && c.chapters.length <= 8, c.id + ': глав ' + c.chapters.length);
    assert.ok(c.checklist.length >= 4, c.id + ': короткий чек-лист');
    assert.equal(c.quiz.length, 12, c.id + ': вопросов должно быть 12');
    c.quiz.forEach((q, i) => {
      assert.ok(q.q && q.q.length > 10, c.id + ': пустой вопрос #' + (i + 1));
      assert.ok(Array.isArray(q.o) && q.o.length >= 2, c.id + ': мало вариантов #' + (i + 1));
      assert.ok(Number.isInteger(q.a) && q.a >= 0 && q.a < q.o.length,
        c.id + ': кривой индекс ответа #' + (i + 1));
      assert.ok(q.why && q.why.length > 5, c.id + ': нет разбора #' + (i + 1));
    });
  });
});

test('ключевые темы каждой школы на месте', () => {
  const list = courses();
  const upd = JSON.stringify(list.find(c => c.id === 'upd_intake'));
  assert.match(upd, /счёт на оплату/i);
  assert.match(upd, /дубликат/i);
  assert.match(upd, /Не разнесено/i);
  const con = JSON.stringify(list.find(c => c.id === 'contract_new'));
  assert.match(con, /спецификаци/i);
  assert.match(con, /На хранении/);
  assert.match(con, /Готов к отгрузке → Отгружен частично/);
  assert.match(con, /на основе КП/);
  const shp = JSON.stringify(list.find(c => c.id === 'shipment'));
  assert.match(shp, /Сборка к отгрузке/i);
  assert.match(shp, /Отгрузить по коду/);
  assert.match(shp, /Расход: отгружена по договору/);
  assert.match(shp, /Откатить отгрузку/);
  // v2.46.146: новые школы
  const prod = JSON.stringify(list.find(c => c.id === 'production'));
  assert.match(prod, /Начать частично/);
  assert.match(prod, /вакуумирован/i);
  assert.match(prod, /На склад.*По договору/);
  const wh = JSON.stringify(list.find(c => c.id === 'warehouse'));
  assert.match(wh, /Свободные/);
  assert.match(wh, /Списание/);
  assert.match(wh, /Что закупить/);
  // v2.46.156: инвентаризация и приход вручную
  assert.match(wh, /Инвентаризация: три способа/);
  assert.match(wh, /Сверка по фото/);
  assert.match(wh, /Восстановить/);
  assert.match(wh, /Приход комплектующих вручную/);
  const whC = list.find(c => c.id === 'warehouse');
  assert.ok(whC.quiz.filter(q => /инвентариз|сверка по фото|бланк/i.test(q.q + q.o.join(' '))).length >= 4,
    'в тесте склада мало вопросов про инвентаризацию');
  const sc = JSON.stringify(list.find(c => c.id === 'supply_cycle'));
  assert.match(sc, /Закрыть заявку/);
  assert.match(sc, /Заказан → Оплачен → В пути → На складе/);
  const tk = JSON.stringify(list.find(c => c.id === 'tasks'));
  assert.match(tk, /Автоматика/);
  assert.match(tk, /Enter отправляет/);
  const df = JSON.stringify(list.find(c => c.id === 'defects'));
  assert.match(df, /Сообщить о замечании/);
  assert.match(df, /директор и зам/i);
  const lg = JSON.stringify(list.find(c => c.id === 'logistics'));
  assert.match(lg, /Забрать сейчас/);
  const hr = JSON.stringify(list.find(c => c.id === 'hr'));
  assert.match(hr, /Уровни доступа|уровнем доступа/i);
  // v2.46.147: школа расчётов
  const cl = JSON.stringify(list.find(c => c.id === 'sales_calcs'));
  assert.match(cl, /Передать мяч|передай мяч/i);
  assert.match(cl, /завис/);
  assert.match(cl, /Создать КП/);
  assert.match(cl, /На мне/);
});

test('список курсов группируется по разделам', () => {
  const lh = slice(app4, 'async function loadHelpTraining()', 'function openTrainingCourse');
  assert.match(lh, /tr-sec/);
  assert.match(lh, /TR_CAT_ORDER/);
  assert.match(lh, /Promise\.all/);   // результаты 10 курсов тянутся параллельно
});

test('_trScore честно считает балл', () => {
  const code = slice(app4, 'function _trScore(questions, answers)', 'function _trBlocksHtml');
  const _trScore = new Function(code + 'return _trScore;')();
  const qs = [{ a: 1 }, { a: 0 }, { a: 2 }];
  assert.equal(_trScore(qs, [1, 0, 2]), 3);
  assert.equal(_trScore(qs, [1, 1, 1]), 1);
  assert.equal(_trScore(qs, []), 0);
});

test('экран и навигация вшиты: сайдбар, screen, роутинг', () => {
  assert.match(html, /data-nav="help-training"/);
  assert.match(html, /data-screen="help-training"/);
  assert.match(html, /id="help-training-body"/);
  assert.match(app1, /if \(screenName === 'help-training'\)\s+loadHelpTraining\(\);/);
});

test('балл уезжает на сервер, «сдано» подтверждает бэкенд', () => {
  const fin = slice(app4, 'async function trFinishQuiz()', '// FAQ');
  assert.match(fin, /apiPost\('\/api\/training\/results', \{ course_id: c\.id, score: score \}\)/);
  assert.match(fin, /Разбор ошибок/);
});

test('сводка по команде рисуется, когда бэкенд её отдал (директор)', () => {
  const lh = slice(app4, 'async function loadHelpTraining()', 'function openTrainingCourse');
  assert.match(lh, /res && res\.team/);
  assert.match(lh, /Результаты команды/);
  assert.match(lh, /Учебный центр/);       // v2.46.146: шапка с общим прогрессом
});

test('подсказка в Базе знаний: конспект приёмки УПД со ссылкой на курс', () => {
  assert.match(app3, /id: 'sup-upd-intake'/);
  assert.match(app3, /Приёмка УПД: от бумаги до склада/);
  const art = slice(app3, "id: 'sup-upd-intake'", "id: 'sup-supplier'");
  assert.match(art, /selectSidebarItem\(\\'help-training\\'\)/);
  assert.match(art, /дубликат/i);
});

// v2.46.145: статьи о договоре и отгрузке ведут в свои школы
test('статьи «новый договор» и «отгрузка по QR» ссылаются на обучение', () => {
  const contract = slice(app3, "id: 'sales-new-contract'", "id: 'sales-offers'");
  assert.match(contract, /Школа договора/);
  assert.match(contract, /selectSidebarItem\(\\'help-training\\'\)/);
  const ship = slice(app3, "id: 'wh-ship-qr'", "id: 'sales-box-content'");
  assert.match(ship, /Школа отгрузки/);
  assert.match(ship, /selectSidebarItem\(\\'help-training\\'\)/);
});
