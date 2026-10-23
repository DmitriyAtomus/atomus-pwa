/* Чёрная сцена «Атом Чиллера» на телефоне (v2.46.030).
   Кадр сверялся только по ширине: один кадр с нулевой высотой — и camera.aspect
   уходил в Infinity навсегда, сцена оставалась чёрной. Тест гоняет настоящую
   функцию tick() из chiller/project.html на подставном канвасе. */
const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/../chiller/project.html', 'utf8');
const i = src.indexOf('function tick(){');
assert.ok(i > 0, 'tick() в chiller/project.html не найдена');
let d = 0, end = i;
for (let k = src.indexOf('{', i); k < src.length; k++) {
  if (src[k] === '{') d++;
  else if (src[k] === '}') { d--; if (!d) { end = k + 1; break; } }
}
const tickSrc = src.slice(i, end);

const cv = { clientWidth: 0, clientHeight: 0, width: 0, height: 0 };
const camera = { aspect: 1, position: { set() {} }, lookAt() {}, updateProjectionMatrix() {} };
let drawn = 0;
const env = {
  requestAnimationFrame() {},
  $: () => cv,
  renderer: {
    getPixelRatio: () => 2,
    setSize(w, h) { cv.width = Math.round(w * 2); cv.height = Math.round(h * 2); },
    render() { drawn++; },
  },
  camera, scene: { fog: { near: 0, far: 0 } }, glLost: false,
  target: { x: 0, y: 0, z: 0 }, dist: 3200, phi: 1.15, theta: -0.95,
  fogSync() {}, tagReset() {}, portsSync() {}, rotSync() {},
};
const tick = new Function(...Object.keys(env), tickSrc + '; return tick;')(...Object.values(env));

// 1) кадр при нулевой высоте — как на телефоне, пока раскладка не устоялась
cv.clientWidth = 393; cv.clientHeight = 0;
tick();
assert.strictEqual(drawn, 0, 'кадр нулевого размера рисовать не надо');

// 2) высота появилась, ширина та же — сцена обязана ожить
cv.clientHeight = 620;
tick(); tick();
assert.ok(Number.isFinite(camera.aspect) && camera.aspect > 0,
  'camera.aspect остался ' + camera.aspect + ' — сцена будет чёрной');
assert.strictEqual(camera.aspect, 393 / 620, 'кадр не пересчитан по новой высоте');
assert.ok(drawn > 0, 'сцена не рисуется');

// 3) поворот телефона: сменилась только высота
cv.clientHeight = 380;
tick();
assert.strictEqual(camera.aspect, 393 / 380, 'смену высоты кадр не заметил');

// 4) контекст WebGL отобрали — кадры не гоним
const before = drawn;
env.glLost = true;
const tick2 = new Function(...Object.keys(env), tickSrc + '; return tick;')(...Object.values(env));
tick2();
assert.strictEqual(drawn, before, 'при потерянном контексте рисовать нечего');

console.log('ok — сцена чиллера переживает нулевую высоту и поворот');
