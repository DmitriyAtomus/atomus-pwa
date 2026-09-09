// Журнал щитов (v2.46.168): экран, выдача номера сервером, ревизии с PDF,
// стадии; рендер списка и формы гоняем настоящим кодом.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app1 = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const app4 = fs.readFileSync(path.join(root, 'app-4.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

function render() {
  const i = app4.indexOf('const PJ_STAGE_CLS');
  const j = app4.indexOf('let _pjSearchT', i);
  const code = app4.slice(i, j);
  const state = { _pj: { q: '', section: '', showNew: true } };
  return new Function('state', 'escapeHtml', '_plural', '_ideasWhen', 'API_BASE',
    code + 'return { _pjNewForm, _pjToolbar, _pjTable };')(
    state, x => String(x == null ? '' : x), (n, f) => f[n === 1 ? 0 : 1], x => String(x || '').slice(0, 10), '');
}
const D = {
  sections: [{ code: 'ЩУ-004', name: 'Вентиляция', item_count: 8 }, { code: 'СХ', name: 'Схемы', item_count: 60 }],
  next: { 'ЩУ-004': 9, 'СХ': 61 }, stages: { draft: 'Черновик', issued: 'Выпущен' }, is_director: true,
  panels: [
    { id: 1, designation: 'АГ.ЩУ-004.008/26', title: 'Вентиляция', object: 'Сыроварня', stage: 'issued', stage_label: 'Выпущен',
      panel_dir: 'shu004', revisions_count: 2, last_rev_at: '2026-09-09 10:00', last_qa_ok: 0, last_rev_id: 7, last_rev_url: '/api/panels/files/7?e=1&s=x', author_name: 'Сергей А.', created_at: '2026-09-09' },
    { id: 2, designation: 'АГ.СХ-061/26', title: 'Новый', stage: 'draft', stage_label: 'Черновик', revisions_count: 0, created_at: '2026-09-09' },
  ],
};

test('экран, пункт меню и загрузчик на месте', () => {
  assert.match(html, /data-nav="panels-journal"/);
  assert.match(html, /data-screen="panels-journal"/);
  assert.match(html, /id="panels-journal-content"/);
  assert.match(app1, /if \(screenName === 'panels-journal'\) loadPanelsJournal\(\);/);
  assert.match(app1, /'panels-journal',/);      // форма не перерисовывается автообновлением
});

test('форма выдачи номера показывает следующий номер раздела, список — стадии, QA и PDF', () => {
  const R = render();
  const f = R._pjNewForm(D);
  assert.match(f, /ЩУ-004 · Вентиляция → №9/);
  assert.match(f, /СХ · Схемы → №61/);
  assert.match(f, /pjCreate\(\)/);
  const t = R._pjTable(D);
  assert.match(t, /АГ\.ЩУ-004\.008\/26/);
  assert.match(t, /⚙ генераторы/);
  assert.match(t, /QA с замечаниями/);
  assert.match(t, /2 ревизии/);
  assert.match(t, /Выпущен/);
  assert.match(t, /href="\/api\/panels\/files\/7\?e=1&amp;s=x"|href="\/api\/panels\/files\/7\?e=1&s=x"/);
  assert.match(t, /без пакета/);
  assert.match(R._pjToolbar(D), /2 щита/);
});

test('номер выдаёт сервер, сохранение — PATCH, сборка ложится ревизией', () => {
  const fn = app4.slice(app4.indexOf('async function pjCreate()'));
  assert.match(fn, /apiPost\('\/api\/panels', \{ section: sec\.value, title: t\.value\.trim\(\)/);
  assert.match(fn, /apiPatch\('\/api\/panels\/' \+ id, \{ title:/);
  assert.match(fn, /apiPatch\('\/api\/panels\/' \+ id, \{ stage: 'issued' \}\)/);
  assert.match(fn, /\/api\/schematics\/panels\/' \+ encodeURIComponent\(dir\) \+ '\/build'/);
  assert.match(fn, /ревизия записана/);
  assert.doesNotMatch(fn, /nextNum|Math\.max\(.*num/);   // никакого счёта номера в браузере
  assert.match(css, /\.pj-row \{ display: grid/);
});

// v2.46.169: листы щита и правка метками
test('листы щита: экран, страницы с размером в мм, метки переводятся в лист и мм', () => {
  assert.match(html, /data-screen="panel-sheets"/);
  assert.match(html, /id="ps-pages"/);
  assert.match(app1, /if \(screenName === 'panel-sheets'\) loadPanelSheets\(\);/);
  const ps = app4.slice(app4.indexOf('async function loadPanelSheets()'));
  assert.match(ps, /\/api\/panels\/files\/' \+ rev\.id \+ '\/page\/' \+ n/);
  assert.match(ps, /X-Page-Size-Mm/);
  assert.match(ps, /box\.dataset\.mm = mm/);
  assert.match(ps, /box\.dataset\.page = String\(n\)/);
  // хук метки в index.html: лист + мм от левого верхнего угла
  assert.match(html, /markExtra: function\(m\)\{/);
  assert.match(html, /closest\('\.ps-page'\)/);
  assert.match(html, /мм от левого верхнего угла, как в atomus_pdf/);
  assert.match(html, /Журнал щитов → '\+\(state\._ps\.designation/);
  const mod = fs.readFileSync(path.join(root, 'klava-pick.js'), 'utf8');
  assert.match(mod, /KP\.openTopic = async function \(tid\)/);
  assert.match(mod, /KP\.cfg\.markExtra\(m\)/);
});

test('тема щита и кнопки в карточке', () => {
  assert.match(app4, /apiPost\('\/api\/panels\/' \+ id \+ '\/topic', \{\}\)/);
  assert.match(app4, /KlavaPick\.openTopic\(d\.thread_id\)/);
  assert.match(app4, /Открыть листы/);
  assert.match(app4, /pj-step-n">1</);
  assert.match(app4, /Обсудить с Клавой/);
});

// v2.46.175: клик по листу = метка, не лупа
test('листы: клик включает режим меток, лупа — отдельной кнопкой, панель на листах сразу ждёт метку', () => {
  const ps = app4.slice(app4.indexOf('async function loadPanelSheets()'));
  assert.match(ps, /img\.onclick = function \(\) \{ psStartMark\(\); \}/);
  assert.match(ps, /Отметить на листе/);
  assert.match(ps, /onclick="psZoom\(this\)"/);
  assert.match(ps, /async function psStartMark\(\)[\s\S]*KlavaPick\.pick\(true\)/);
  assert.match(html, /autoPick: function\(\)\{ return \(state\.currentScreen\|\|''\)==='panel-sheets'; \}/);
  const mod = fs.readFileSync(path.join(root, 'klava-pick.js'), 'utf8');
  assert.match(mod, /KP\.cfg\.autoPick && KP\.cfg\.autoPick\(\)/);
});
