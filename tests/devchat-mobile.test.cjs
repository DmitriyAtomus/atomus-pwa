// Мобильный комфорт чата «Клод» (v2.45.955): камера, чипы, терминал «вживую».
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('камера: отдельный input с capture, кнопка и чип зовут его', () => {
  assert.match(html, /id="devchat-camera-input"[^>]*capture="environment"/,
    'нет input с capture — на телефоне не откроется камера');
  assert.match(html, /onclick="devChatCamera\(\)"/);
  assert.match(app, /function devChatCamera\(\)/);
  // на десктопе камера ни к чему — прячется стилями
  assert.match(css, /\.app\.desktop-layout .*\.dchat-cam \{ display: none; \}/);
});

test('быстрые чипы над полем ввода подставляют текст', () => {
  assert.match(html, /id="devchat-chips"/);
  assert.match(html, /devChatQuick\(this\)/);
});

test('терминал «вживую»: открывается тапом по статусу, копит журнал со временем', () => {
  assert.match(html, /id="devchat-term-full"/);
  assert.match(html, /onclick="devChatTermOpen\(\)"/, 'статус в шапке не открывает терминал');
  assert.match(app, /function devChatTermOpen\(\)/);
  assert.match(app, /function devChatTermClose\(\)/);
  // журнал пишется в момент прихода строк — бэкенд времени не хранит
  assert.match(app, /_devChatLogProgress\(\);/, 'журнал не подключён к циклу опроса');
  const fn = app.slice(app.indexOf('function _devChatLogProgress'));
  assert.match(fn.slice(0, 900), /lastIndexOf\(_devChatTermLast\)/,
    'нет диффа скользящего окна — строки будут дублироваться');
});

test('таймер задачи: старт по running, сброс когда всё закрыто', () => {
  assert.match(app, /_devChatRunSince = Date\.now\(\)/);
  assert.match(app, /if \(!working\) _devChatRunSince = null;/);
});
