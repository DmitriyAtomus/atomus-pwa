const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// Вырезаем функцию/константу по имени (простой подсчёт скобок).
function grab(src, head) {
  const i = src.indexOf(head);
  assert.notEqual(i, -1, head);
  if (head.startsWith('const ')) return src.slice(i, src.indexOf('\n', i) + 1);
  let j = src.indexOf('{', i), depth = 0;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) break;
  }
  return src.slice(i, j + 1) + '\n';
}

function load(nowIsoUtc) {
  const a1 = read('app-1.js'), a4 = read('app-4.js');
  const code = [
    grab(a1, 'const ATOMUS_TZ_OFFSET_MIN'), grab(a1, 'function _atomusPad2'),
    grab(a1, 'function _atomusFmtShifted'), grab(a1, 'function atomusLocalTs'),
    grab(a1, 'function atomusLocalToday'), grab(a1, 'function _chatPrettyDate'),
    grab(a4, 'function _formatChatTime'), grab(a4, 'function _formatDaySeparator'),
    grab(a4, 'function _tchatListTime'),
  ].join('\n') + '\nthis.api = { atomusLocalTs, atomusLocalToday, _chatPrettyDate, _formatChatTime, _formatDaySeparator, _tchatListTime };';
  const fixed = Date.parse(nowIsoUtc);
  class FakeDate extends Date {
    constructor(...a) { super(...(a.length ? a : [fixed])); }
    static now() { return fixed; }
  }
  const ctx = { Date: FakeDate, parseInt, String };
  vm.runInNewContext(code, ctx);
  return ctx.api;
}

test('naive UTC из БД показывается по Екатеринбургу (+5)', () => {
  const t = load('2026-11-09T12:45:00Z');
  assert.equal(t.atomusLocalTs('2026-11-09 11:46:46'), '2026-11-09 16:46:46'); // сообщение №202
  assert.equal(t.atomusLocalTs('2026-11-02 05:12:06'), '2026-11-02 10:12:06');
  assert.equal(t.atomusLocalTs('2026-11-09T20:30:00'), '2026-11-10 01:30:00'); // переход через полночь
});

test('строки с зоной не сдвигаются дважды, дата без времени не меняется', () => {
  const t = load('2026-11-09T12:45:00Z');
  assert.equal(t.atomusLocalTs('2026-09-14T12:22:28+00:00'), '2026-09-14 17:22:28');
  assert.equal(t.atomusLocalTs('2026-11-09T11:46:46Z'), '2026-11-09 16:46:46');
  assert.equal(t.atomusLocalTs('2026-11-09T16:46:46+05:00'), '2026-11-09 16:46:46');
  assert.equal(t.atomusLocalTs('2026-11-09 16:46:46.123+0500'), '2026-11-09 16:46:46');
  assert.equal(t.atomusLocalTs('2026-11-09'), '2026-11-09');
  assert.equal(t.atomusLocalTs(''), '');
  assert.equal(t.atomusLocalTs(null), '');
});

test('время сообщения и разделители «Сегодня»/«Вчера» по Екатеринбургу', () => {
  const t = load('2026-11-09T12:45:00Z'); // 17:45 Екб
  assert.equal(t._formatChatTime('2026-11-09 11:46:46'), '16:46');
  assert.equal(t._tchatListTime('2026-11-09 11:46:46'), '16:46');
  assert.equal(t._tchatListTime('2026-11-09T11:46:46'), '16:46');
  assert.equal(t._chatPrettyDate(t.atomusLocalTs('2026-11-09 11:46:46').slice(0, 10)), 'Сегодня');
  assert.equal(t._formatDaySeparator('2026-11-08'), 'Вчера');
  assert.equal(t._formatChatTime('2026-11-02 05:12:06'), '02.11 10:12');
});

test('после полуночи по Екатеринбургу (ещё вчера по UTC) «сегодня» верное', () => {
  const t = load('2026-11-09T20:30:00Z'); // 01:30 10.11 Екб
  assert.equal(t.atomusLocalToday(0), '2026-11-10');
  assert.equal(t._chatPrettyDate('2026-11-10'), 'Сегодня');
  assert.equal(t._chatPrettyDate('2026-11-09'), 'Вчера');
  assert.equal(t._tchatListTime('2026-11-09 20:10:00'), '01:10');
  assert.equal(t._formatChatTime('2026-11-09 20:10:00'), '01:10');
  assert.equal(t._formatDaySeparator('2026-11-10'), 'Сегодня');
});

test('все чаты используют atomusLocalTs, а не голый created_at', () => {
  assert.match(read('app-1.js'), /const ts = atomusLocalTs\(m\.created_at\);/);
  assert.match(read('app-3.js'), /const t = atomusLocalTs\(m\.created_at\);/);
  const a4 = read('app-4.js');
  assert.match(a4, /const day = atomusLocalTs\(m\.created_at\)\.slice\(0, 10\);/);
  assert.match(a4, /const ts = atomusLocalTs\(m\.created_at\);/);
});