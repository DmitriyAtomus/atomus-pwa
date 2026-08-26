// Типовой бак AG-04.001.000СБ: возврат через стенку снят, поэтому сохранённые
// номера трёх старых зон должны безопасно перейти на две донные.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const page = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'project.html'), 'utf8');
function section(from, to) {
  const a = page.indexOf(from);
  const b = page.indexOf(to, a);
  assert.notEqual(a, -1, 'не нашёл начало блока: ' + from);
  assert.notEqual(b, -1, 'не нашёл конец блока: ' + to);
  return page.slice(a, b);
}

test('старый бак с тремя зонами мигрирует на забор и слив без возврата', () => {
  const code = section('const TANK_PORT_SCHEMA=2;', 'function tankZonesOwn(it)');
  const tankPortSchema = new Function(code + '\nreturn tankPortSchema;')();
  const old = {
    d: { id: 'bak-525x200x425' }, zn: [{}, {}], pv: 0,
    po: {
      0: { off: 1 },
      1: { p0: [-197, 11.2, 11], tip: [-197, 11.2, -14.4] },
      2: { p0: [-100.5, -43.8, 12.5], tip: [-100.5, -43.8, -6.5] },
    },
  };
  tankPortSchema(old, true);
  assert.equal(old.pv, 2);
  assert.equal(old._pvShift, true);
  assert.deepEqual(Object.keys(old.po), ['0', '1']);
  assert.deepEqual(old.po[0].p0, [-197, 11.2, 11], 'забор стал зоной 0');
  assert.deepEqual(old.po[1].p0, [-100.5, -43.8, 12.5], 'слив стал зоной 1');
  assert.equal(old.po[0].off, undefined, 'флаг старого возврата не перешёл на забор');

  const current = { d: { id: 'bak-525x200x425' }, zn: [{}, {}], pv: 2,
    po: { 0: { off: 1 } } };
  tankPortSchema(current, true);
  assert.equal(current.po[0].off, 1, 'новую схему повторно не сдвигаем');
});

test('версия зон и ссылки обвязки сохраняются и мигрируют вместе', () => {
  const payload = section('function projPayload(){', 'function save(){');
  assert.match(payload, /pv:p\.pv\|\|undefined/);
  const load = section('async function loadProjectData(data)', 'async function openProject(id)');
  assert.match(load, /pv:s\.pv/);
  assert.match(load, /if\(p\.link\.zi===0\)p\.link=null/,
    'посадка на удалённый возврат снимается');
  assert.match(load, /p\.link\.zi--/,
    'ссылки на забор и слив сдвигаются вместе с зонами');
});
