// «🧪 Прогон вариаций» + «⤳ Расставить по контуру» (v2.46.151): стенд качества
// сборки — случайные модели на узлы контура × случайный корпус, раскладка,
// замеры (наезды/упоры/вне габарита) и тихая обвязка; отчёт со сводкой.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const src = fs.readFileSync(path.join(__dirname, '..', 'chiller', 'project.html'), 'utf8');
function slice(from, to) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, 'не найдено: ' + from);
  const j = src.indexOf(to, i);
  assert.ok(j > i, 'не найден конец: ' + to);
  return src.slice(i, j);
}

test('стенд: проект снимается в память и возвращается, история и автосохранение молчат', () => {
  const run = slice('async function stressRun(n)', 'async function stressOpen');
  assert.match(run, /const backup=projPayload\(\)/);
  assert.match(run, /_loading=true/);
  assert.match(run, /HIST\.hold=true/);
  assert.match(run, /loadProjectData\(\{items:backup\.items,schema:schBackup\}\)/);
  assert.match(run, /STRESS\.stop/);                   // Esc останавливает
});

test('одна вариация меряет наезды, упоры, выход за габарит, «не входит» и обвязку', () => {
  const one = slice('async function stressOne(pick,fr)', 'async function stressRun');
  assert.match(one, /collSet/);
  assert.match(one, /hitSet/);
  assert.match(one, /outSet/);
  assert.match(one, /fitWhy\(it\)/);
  assert.match(one, /bindRunAll\(\)/);
  assert.match(one, /layoutByCircuit\(\)/);
});

test('кандидаты берутся по категории узла, как в конвейере подбора', () => {
  const c = slice('function stressCandidates()', 'function stressBar');
  assert.match(c, /asgResolveCat\(nd\)/);
  assert.match(c, /roleOf\(d\)==='frame'/);
});

test('отчёт: сводка, топы причин и открытие вариации в сцене', () => {
  const r = slice('function stressReport(st)', 'function stressAsk');
  assert.match(r, /чистые сборки/);
  assert.match(r, /Почему не легли линии/);
  assert.match(r, /stressOpen\(/);
  assert.match(r, /Скопировать JSON/);
});

test('расстановка по контуру: порт навстречу, возвратный ряд, без сдвига поперёк оси', () => {
  const l = slice('function layoutByCircuit(){', 'function layoutByCircuitUI');
  assert.match(l, /rotTo\(B,zb,dW\.clone\(\)\.negate\(\)\)/);   // прямо по ходу — навстречу
  assert.match(l, /rotTo\(B,zb,dW\.clone\(\)\)/);               // возвратный ряд — в ту же сторону
  assert.match(l, /INSIDE\.has\(roleOf\(B\.d\)\)/);              // бак снаружи не трогаем
  assert.doesNotMatch(l, /const clamp=/);                      // поперёк оси не двигаем
  assert.match(src, /id="bCircuit"[^>]*>⤳ Расставить по контуру/);
  assert.match(src, /id="bStress"[^>]*>🧪 Прогон вариаций/);
  assert.match(src, /\$\('#bStress'\)\.onclick=stressAsk;/);
});

test('bindBySchema — обёртка над тихим bindRunAll', () => {
  const b = slice('async function bindBySchema()', 'function bindReport');
  assert.match(b, /await bindRunAll\(\)/);
  assert.match(b, /bindReport\(rep\)/);
});
