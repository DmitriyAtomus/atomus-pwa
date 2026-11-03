// v2.46.282: этапы по типу изделия + новая карточка работы (макет mockup_nvp.png)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const a1 = fs.readFileSync(path.join(root, 'app-1.js'), 'utf8');
const a2 = fs.readFileSync(path.join(root, 'app-2.js'), 'utf8');
const a3 = fs.readFileSync(path.join(root, 'app-3.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

function slice(from, to) {
  const i = a1.indexOf(from);
  const j = a1.indexOf(to, i + 1);
  assert.ok(i >= 0 && j > i, 'не найден кусок ' + from);
  return a1.slice(i, j);
}

const code = [
  slice('function _pwdStagesByPos(items)', 'async function _fillWorkStages(w)'),
  slice('function _pwdStagesSummary(items, meta)', 'async function _pwdLoadEmployees()'),
].join('\n');
const ctx = {
  window: {}, perms: true,
  escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  plural: (n, a, b, c) => { const m = n % 10, h = n % 100; return (m === 1 && h !== 11) ? a : (m >= 2 && m <= 4 && (h < 10 || h >= 20)) ? b : c; },
  _formatHelpingDuration: () => '1ч 25м',
  _pwdStageEkbTime: () => '15:40',
  Date,
};
ctx.hasPermission = () => ctx.perms;
vm.runInNewContext(code + '\nthis.api = { _pwdStagesHtml, _pwdEffectiveExec, _pwdGenitive, _pwdStageIcon, _pwdRingHtml, _pwdIsPackingStage, _pwdStagesSummary };', ctx);
const A = ctx.api;

function nvpStages() {
  const names = ['Сварка', 'Зачистка', 'Покраска', 'Сборка', 'Упаковка'];
  return names.map((name, k) => ({
    id: 100 + k, position: k + 1, name, stage_type_id: 10 + k, requires: k ? String(k) : null,
    is_done: k === 0 ? 1 : 0, done_by_name: k === 0 ? 'Шевелев М.И.' : null, done_at: k === 0 ? '2026-11-02 10:40:00' : null,
    assignee_id: null, assignee_name: null, norm_hours: null, fact_hours: k === 0 ? 3.17 : (k === 1 ? 1.42 : 0),
    running: k === 1 ? [{ employee_id: 7, name: 'Шевелев М.И.', started_at: '2026-11-03 08:00:00' }] : [],
    parts_wait: [],
  }));
}
const work = { id: 105, status: 'in_progress', active_helpers: [{ id: 7, is_me: true, stage_id: 11 }] };
const meta = { template: { label: 'Донагреватели', level: 'subgroup' }, summary: { progress: 20, total: 5, done: 1, weighted: false } };

test('НВП: 5 этапов лентой — готово / идёт / ждёт, как в макете', () => {
  const html = A._pwdStagesHtml(nvpStages(), work, meta);
  assert.match(html, /Сейчас идёт/);
  assert.match(html, /этап 2 из 5/);
  assert.match(html, /Зачистка — готово/);
  assert.match(html, /pwdStageStopDone\(105,101\)/, 'моё идущее — «Стоп + готово»');
  assert.match(html, /шаблон Донагреватели · 5 этапов/);
  assert.equal((html.match(/class="pwd-st /g) || []).length, 5);
  assert.match(html, /class="pwd-st done"/);
  assert.match(html, /class="pwd-st run mine"/);
  assert.equal((html.match(/class="pwd-st wait"/g) || []).length, 3);
  assert.match(html, /начнётся после «Зачистки»/);
  assert.match(html, /начнётся после «Покраски»/);
  assert.match(html, /исполнитель: <b>не назначен<\/b>/);
  assert.match(html, /норма: <b>—<\/b>/);
  assert.match(html, /Шевелев М\.И\. · 02\.11 в 15:40/);
  assert.match(html, /CRM предложит перевести работу в статус/);
  assert.match(html, /Прогресс<b>20%<\/b>/);
  assert.match(html, /Считается по этапам: 1 из 5 готов\. Вручную не меняется\./);
  assert.match(html, /ti-flame/); assert.match(html, /ti-sparkles/); assert.match(html, /ti-brush/);
  assert.match(html, /ti-tool/); assert.match(html, /ti-package/);
});

test('исполнитель и норма — правит только мастер/директор', () => {
  ctx.perms = true;
  let html = A._pwdStagesHtml(nvpStages(), work, meta);
  assert.match(html, /pwdStageSetAssignee\(105,102\)/);
  assert.match(html, /pwdStageSetNorm\(105,102\)/);
  ctx.perms = false;
  html = A._pwdStagesHtml(nvpStages(), work, meta);
  assert.doesNotMatch(html, /pwdStageSetAssignee/);
  assert.doesNotMatch(html, /pwdStageRename/);
  ctx.perms = true;
  const st = nvpStages();
  st[2].assignee_id = 9; st[2].assignee_name = 'Иванов А.А.'; st[2].norm_hours = 2.5;
  html = A._pwdStagesHtml(st, work, meta);
  assert.match(html, /исполнитель: <b>Иванов А\.А\.<\/b>/);
  assert.match(html, /норма: <b>2\.5ч<\/b>/);
});

test('без идущего этапа — «Следующий этап» с кнопкой «Начать»', () => {
  const st = nvpStages();
  st[1].running = [];
  const html = A._pwdStagesHtml(st, { id: 105, status: 'in_progress', active_helpers: [] }, meta);
  assert.match(html, /Следующий этап/);
  assert.match(html, /Начать «Зачистка»/);
  assert.match(html, /class="pwd-st open"/);
});

test('закрытая работа — без кнопок действий', () => {
  const html = A._pwdStagesHtml(nvpStages(), { id: 105, status: 'done', active_helpers: [] }, meta);
  assert.doesNotMatch(html, /Сейчас идёт|Следующий этап|pwdStageStart|pwdStageToggleDone/);
  assert.doesNotMatch(html, /CRM предложит/);
});

test('чиллер: 26 этапов, готовые сворачиваются, контрольные точки — «ждём»', () => {
  const st = Array.from({ length: 26 }, (_, k) => ({
    id: k + 1, position: k + 1, name: 'Этап ' + (k + 1), stage_type_id: 200 + k,
    requires: k === 17 ? '13' : (k === 18 ? '13,18' : null), is_done: k < 5 ? 1 : 0, running: [], fact_hours: 0, parts_wait: [],
  }));
  const html = A._pwdStagesHtml(st, { id: 7, status: 'in_progress', active_helpers: [] }, { template: { label: 'Чиллера' }, summary: { progress: 19 } });
  assert.match(html, /5 готовых этапов свёрнуто/);
  assert.equal((html.match(/class="pwd-st /g) || []).length, 21);
  assert.match(html, /ждём: «Этап 13», «Этап 18»/);
  assert.match(html, /шаблон Чиллера · 26 этапов/);
});

test('исполнение: из работы, иначе из модели', () => {
  assert.equal(A._pwdEffectiveExec({ model_exec_fixed: 'Нерж. AISI' }).code, 'stainless');
  assert.equal(A._pwdEffectiveExec({ model_exec_fixed: 'Стандарт' }).label, 'Стандарт');
  assert.equal(A._pwdEffectiveExec({ execution_type: 'stainless', model_exec_fixed: 'Стандарт' }).code, 'stainless');
  assert.equal(A._pwdEffectiveExec({}), null);
});

test('родительный падеж и упаковка', () => {
  assert.equal(A._pwdGenitive('Зачистка'), 'Зачистки');
  assert.equal(A._pwdGenitive('Покраска'), 'Покраски');
  assert.equal(A._pwdGenitive('Сборка'), 'Сборки');
  assert.equal(A._pwdGenitive('Сварка'), 'Сварки');
  assert.equal(A._pwdGenitive('Изготовление рамы'), 'Изготовление рамы');
  assert.ok(A._pwdIsPackingStage('Упаковка'));
  assert.ok(A._pwdIsPackingStage('Изготовление тары и упаковка чиллера'));
  assert.ok(!A._pwdIsPackingStage('Сборка'));
});

test('проводка: ползунок прячется, подсказки статусов, шапка с кольцом', () => {
  assert.match(a1, /querySelector\('#pkb-detail-modal \.pwd-progress-block'\);\n  if \(manual\) manual\.style\.display = 'none';/);
  assert.match(a1, /if \(makeDone && _pwdMaybeSuggestStatus\(workId, res\)\) return;/);
  assert.match(a1, /status: 'packing'/);
  assert.match(a1, /'<div class="modal-header pwd-hero">'/);
  assert.match(a1, /showProductionWorkQr\(' \+ w\.id \+ '\)/);
  assert.match(a1, /stages\/rebuild', \{ force: true \}/);
  assert.match(css, /\.pkb-detail-modal \.modal-header\.pwd-hero \{/);
});

test('редактор шаблона — выбор подгруппы', () => {
  assert.match(a2, /function _dstSetScope\(val\)/);
  assert.match(a2, /'\?subgroup_id=' \+ st\.subgroupId/);
  assert.match(a2, /body\.subgroup_id = window\._dst\.subgroupId/);
});

test('версия одна и та же во всех местах', () => {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).version;
  assert.match(v, /^v2\.46\.\d+$/);
  assert.match(a1, new RegExp('const APP_VERSION = "' + v + '";'));
  assert.match(sw, new RegExp("const CACHE_VERSION = 'atomus-" + v + "';"));
  assert.match(a3, new RegExp("const HELP_CHANGELOG = \\[\\n  \\{version:'" + v + "'"));
});

test('мягкий порядок (не чиллер): следующий этап можно начать раньше, с предупреждением', () => {
  const items = nvpStages().map(s => Object.assign(s, { soft_order: 1 }));
  const html = A._pwdStagesHtml(items, work, meta);
  assert.equal((html.match(/class="pwd-st wait/g) || []).length, 0, 'замков нет');
  assert.equal((html.match(/class="pwd-st open early"/g) || []).length, 3);
  assert.match(html, /Можно раньше/);
  assert.match(html, /по порядку — после «Зачистки», можно раньше/);
  assert.match(html, /pwdStageStart\(105,12\)/, 'у «Покраски» есть «Начать»');
});

test('мягкий порядок: идущий раньше срока этап помечен предупреждением', () => {
  const items = nvpStages().map(s => Object.assign(s, { soft_order: 1 }));
  items[1].running = [];
  items[3].running = [{ employee_id: 8, name: 'Иванов А.А.', started_at: '2026-11-03 08:00:00' }];
  const html = A._pwdStagesHtml(items, work, meta);
  assert.match(html, /начат раньше: ещё не готово «Покраска»/);
});

test('чиллер (soft_order=0) — замки как раньше', () => {
  const items = nvpStages().map(s => Object.assign(s, { soft_order: 0 }));
  const html = A._pwdStagesHtml(items, work, meta);
  assert.equal((html.match(/class="pwd-st wait"/g) || []).length, 3);
  assert.doesNotMatch(html, /Можно раньше/);
});

test('без этапов (переделка): карточка даёт добавить этап вручную', () => {
  const i = a1.indexOf('async function _fillWorkStages(w)');
  const body = a1.slice(i, a1.indexOf('function _pwdStagesSummary', i));
  assert.match(body, /if \(!items\.length\) \{/);
  assert.match(body, /pwdStageAdd\(' \+ w\.id \+ '\)/);
  assert.match(body, /добавьте их вручную/);
});
