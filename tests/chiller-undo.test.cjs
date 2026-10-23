// Компоновка проекта (chiller/project.html): отмена действия (Ctrl+Z).
// История — стек снимков того же payload, что уходит в CRM. Проверяем, что
// шаг пишется перед каждым изменением сцены, что снимок возвращает деталь
// с прежним uid (иначе развалятся посадки на корпус) и что «вернуть» работает.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'chiller', 'project.html'), 'utf8');

function section(from, to) {
  const a = page.indexOf(from);
  const b = page.indexOf(to, a);
  assert.notEqual(a, -1, 'не нашёл начало блока: ' + from);
  assert.notEqual(b, -1, 'не нашёл конец блока: ' + to);
  return page.slice(a, b);
}

test('кнопки отмены есть в панели сцены и в подсказке', () => {
  assert.match(page, /id="bUndo"[^>]*>↶ Отменить/);
  assert.match(page, /id="bRedo"[^>]*>↷ Вернуть/);
  assert.match(page, /Ctrl\+Z — отменить/);
  assert.match(page, /\$\('#bUndo'\)\.onclick=undoAct/);
  assert.match(page, /\$\('#bRedo'\)\.onclick=redoAct/);
});

test('Ctrl+Z и Ctrl+Y перехватываются до команд сцены и не мешают печатать', () => {
  const keys = section("addEventListener('keydown'", 'function roleOf');
  // сначала поля ввода (там Ctrl+Z — это текст), только потом наши сочетания
  assert.ok(keys.indexOf("t==='INPUT'") < keys.indexOf('e.ctrlKey'),
    'обработка Ctrl+Z должна стоять после выхода из полей ввода');
  assert.match(keys, /kz=\/\^\[zZяЯ\]\$\/\.test\(e\.key\)/);   // русская раскладка тоже
  assert.match(keys, /ky=\/\^\[yYнН\]\$\/\.test\(e\.key\)/);
  assert.match(keys, /\(kz&&!e\.shiftKey\)\?undoAct\(\):redoAct\(\)/);
});

test('шаг истории пишется перед каждым изменением сцены', () => {
  const cases = [
    [/pushHist\('добавление детали'\);\s*\/\/[^\n]*\n\s*const obj=new THREE\.Mesh/, 'добавление'],
    [/function delSel\(\)\{if\(!sel\)return;\s*pushHist\('удаление детали'\)/, 'удаление'],
    [/confirm\('Убрать все детали со сцены\?'\)\)return;\s*pushHist\('очистку сцены'\)/, 'очистка'],
    [/function spinSel\(ax\)\{[\s\S]{0,600}?pushHist\('поворот детали'\)/, 'поворот'],
    [/pushHist\(dz>0\?'подъём детали':'опускание детали'\)/, 'подъём'],
    [/pushHist\('посадку на пол'\)/, 'на пол'],
    [/pushHist\(sel\.pin\?'снятие закрепления':'закрепление детали'\)/, 'закрепление'],
    [/pushHist\('посадку на корпус'\)/, 'посадка на корпус'],
    [/pushHist\('отсоединение от корпуса'\)/, 'отсоединение'],
    [/pushHist\('назначение модели на схеме'\)/, 'схема'],
    [/dragSnap=\{s:histSnap\(\),t:'перемещение детали'\}/, 'перетаскивание'],
  ];
  cases.forEach(([re, what]) => assert.match(page, re, 'нет шага истории: ' + what));
  // составные действия — один шаг на всю операцию, а не по шагу на деталь
  assert.match(page, /const h=histBegin\('расстановку по функциям'\)/);
  assert.match(page, /const h=histBegin\('сборку по схеме'\)/);
  // история не тянется из чужого проекта
  assert.match(page, /_loading=false;\s*histReset\(\)/);
});

test('перетаскивание пишет шаг только при настоящем сдвиге', () => {
  const move = section("cv.addEventListener('pointermove'", 'const off=()=>');
  assert.match(move, /if\(nx===sel\.obj\.position\.x&&ny===sel\.obj\.position\.y\)return;/);
  assert.match(move, /if\(dragSnap\)\{pushHistRaw\(dragSnap\);dragSnap=null;\}/);
});

/* ── как ведёт себя сам стек: гоняем настоящий код истории на заглушках сцены ── */
function stand() {
  const code = section('function projPayload(){', 'function setProjName(n){');
  const box = {
    placed: [], sel: null, uidSeq: 1, _loading: false, schemaData: {}, DATA: [],
    saved: 0, toasts: [],
    toast(t) { box.toasts.push(t); },
    save() { box.saved++; },
    select(it) { box.sel = it; },
    refresh() {}, renderSchema() {}, applyOff() {}, pinMark() {},
    scene: { remove() {} },
    btns: {},
    // кнопки подменяем пустышками — заодно видно, что и как гасит histBtns
    $(id) {
      if (!box.btns[id]) box.btns[id] = {
        cls: new Set(), title: '', onclick: null,
        classList: { toggle(c, on) { on ? box.btns[id].cls.add(c) : box.btns[id].cls.delete(c); } },
      };
      return box.btns[id];
    },
    // сигнатура как у настоящей addItem(d, at, rot, tilt, roll)
    async addItem(d, at, rot, tilt, roll) {
      const it = {
        uid: box.uidSeq++, id: d.id, d, pin: false, link: null, off: [],
        obj: { position: { x: (at && at.x) || 0, y: (at && at.y) || 0, z: (at && at.z) || 0,
                           set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
               rotation: { x: roll || 0, y: tilt || 0, z: rot || 0,
                           set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
               updateMatrixWorld() {} },
      };
      box.placed.push(it);
      return it;
    },
  };
  box.DATA = [{ id: 'frame-1', ready: true }, { id: 'comp-1', ready: true }];
  vm.createContext(box);
  vm.runInContext(code, box);
  // HIST и undoAct объявлены через const — свойствами контекста они не станут,
  // читаем их так же, как читал бы код страницы
  box.peek = expr => vm.runInContext(expr, box);
  return box;
}

test('отмена возвращает удалённую деталь с прежним uid, местом и посадкой', async () => {
  const s = stand();
  const fr = await s.addItem(s.DATA[0], { x: 0, y: 0, z: 0 });
  const cp = await s.addItem(s.DATA[1], { x: -240, y: -140, z: 35 });
  cp.link = { to: fr.uid, mount: 'bolt10', face: 'pan' };
  const uid = cp.uid;

  s.pushHist('удаление детали');
  s.placed.splice(s.placed.indexOf(cp), 1);
  assert.equal(s.placed.length, 1);

  await s.histGo(true);
  assert.equal(s.placed.length, 2);
  const back = s.placed.find(p => p.uid === uid);
  assert.ok(back, 'деталь вернулась под своим uid');
  assert.deepEqual([back.obj.position.x, back.obj.position.y, back.obj.position.z], [-240, -140, 35]);
  assert.equal(JSON.stringify(back.link),
    JSON.stringify({ to: fr.uid, mount: 'bolt10', face: 'pan' }));
  assert.ok(s.toasts.some(t => t.startsWith('Отменено: удаление детали')));

  assert.match(s.btns['#bRedo'].title, /^Вернуть удаление детали/);
  assert.ok(s.btns['#bUndo'].cls.has('off'), 'отменять больше нечего — кнопка гаснет');

  await s.histGo(false);                       // «вернуть» — деталь снова убрана
  assert.equal(s.placed.length, 1);
  assert.ok(s.toasts.some(t => t.startsWith('Возвращено: удаление детали')));
});

test('составное действие — один шаг истории, глубина ограничена', async () => {
  const s = stand();
  await s.addItem(s.DATA[0], { x: 0, y: 0, z: 0 });
  const was = s.histBegin('сборку по схеме');
  s.pushHist('добавление детали');
  s.pushHist('добавление детали');
  s.histEnd(was);
  assert.equal(s.peek('HIST.un.length'), 1);
  assert.equal(s.peek('HIST.un[0].t'), 'сборку по схеме');

  const max = s.peek('HIST.max');
  for (let i = 0; i < max + 20; i++) s.pushHist('поворот детали');
  assert.equal(s.peek('HIST.un.length'), max);
});

test('новое действие обнуляет стек «вернуть», отменять пустое безопасно', async () => {
  const s = stand();
  await s.addItem(s.DATA[1], { x: 0, y: 0, z: 0 });
  s.pushHist('поворот детали');
  s.placed[0].obj.rotation.z = Math.PI / 2;
  await s.histGo(true);
  assert.equal(s.placed[0].obj.rotation.z, 0);
  assert.equal(s.peek('HIST.re.length'), 1);
  s.pushHist('удаление детали');                // после новой правки возвращать нечего
  assert.equal(s.peek('HIST.re.length'), 0);
  s.peek('HIST.un.length = 0');
  await s.histGo(true);
  assert.ok(s.toasts.includes('Отменять нечего'));
});
