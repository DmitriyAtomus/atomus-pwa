const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-1.js'), 'utf8');

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `Не найдено начало секции: ${from}`);
  assert.notEqual(end, -1, `Не найден конец секции: ${to}`);
  return source.slice(start, end);
}

function fmt() {
  const context = {};
  vm.runInNewContext(
    section('function _fmtWorkTime(ts, withDate)', 'function _chatPrettyTime(iso)') +
      '\nthis.f = _fmtWorkTime;',
    context
  );
  return context.f;
}

// Реальный случай: Иванов работал 05.08 с 09:04 до автостопа в 18:00.
// В базе это UTC — 04:04 и 13:00. Раньше интерфейс резал строку и показывал
// «04:04 – 13:00», из-за чего казалось, что счётчик шёл ночью.
test('время из базы показывается по-нашему, а не по UTC', () => {
  const f = fmt();

  assert.equal(f('2026-08-05 04:04:10'), '09:04');
  assert.equal(f('2026-08-05 13:00:00'), '18:00');
});

test('дату добавляем по запросу — для комментариев', () => {
  const f = fmt();

  assert.equal(f('2026-08-05 04:04:10', true), '05.08 09:04');
});

test('время после полуночи по UTC уезжает на нужную дату', () => {
  const f = fmt();

  // 23:30 по Екатеринбургу — это ещё вчерашние 18:30 UTC
  assert.equal(f('2026-08-05 18:30:00', true), '05.08 23:30');
  // 02:00 UTC 6-го = 07:00 утра 6-го у нас
  assert.equal(f('2026-08-06 02:00:00', true), '06.08 07:00');
});

test('значение с явным часовым поясом не сдвигается второй раз', () => {
  const f = fmt();

  assert.equal(f('2026-08-05T04:04:10Z'), '09:04');
  assert.equal(f('2026-08-05T09:04:10+05:00'), '09:04');
});

test('пустое и битое значение не роняют карточку', () => {
  const f = fmt();

  assert.equal(f(''), '');
  assert.equal(f(null), '');
  assert.equal(f('какая-то ерунда'), '');
});

test('отрезки «Мой день» и комментарии работ используют этот формат', () => {
  assert.match(source, /const t1 = g\.started_at \? _fmtWorkTime\(g\.started_at\) : '—'/);
  assert.match(source, /const t2 = g\.ended_at \? _fmtWorkTime\(g\.ended_at\) : '…'/);
  assert.match(source, /const when = _fmtWorkTime\(t, true\)/);
  // строковую нарезку времени в этих местах не оставляем
  assert.doesNotMatch(source, /String\(g\.started_at\)\.slice\(11, 16\)/);
});
