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

test('курс «Школа приёмки УПД»: 6 глав, чек-лист, 12 корректных вопросов', () => {
  const list = courses();
  const c = list.find(x => x.id === 'upd_intake');
  assert.ok(c, 'нет курса upd_intake');
  assert.equal(c.pass, 10);
  assert.equal(c.chapters.length, 6);
  assert.ok(c.checklist.length >= 5);
  assert.equal(c.quiz.length, 12);
  c.quiz.forEach((q, i) => {
    assert.ok(q.q && q.q.length > 10, 'пустой вопрос #' + (i + 1));
    assert.ok(Array.isArray(q.o) && q.o.length >= 2, 'мало вариантов #' + (i + 1));
    assert.ok(Number.isInteger(q.a) && q.a >= 0 && q.a < q.o.length,
      'кривой индекс ответа #' + (i + 1));
    assert.ok(q.why && q.why.length > 5, 'нет разбора #' + (i + 1));
  });
  // ключевые темы курса на месте
  const all = JSON.stringify(c);
  assert.match(all, /счёт на оплату/i);
  assert.match(all, /дубликат/i);
  assert.match(all, /Не разнесено/i);
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
  assert.match(lh, /Кто сдавал/);
});

test('подсказка в Базе знаний: конспект приёмки УПД со ссылкой на курс', () => {
  assert.match(app3, /id: 'sup-upd-intake'/);
  assert.match(app3, /Приёмка УПД: от бумаги до склада/);
  const art = slice(app3, "id: 'sup-upd-intake'", "id: 'sup-supplier'");
  assert.match(art, /selectSidebarItem\(\\'help-training\\'\)/);
  assert.match(art, /дубликат/i);
});
