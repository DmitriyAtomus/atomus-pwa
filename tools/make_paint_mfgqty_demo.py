# -*- coding: utf-8 -*-
"""Стенд для ленты CRM: «штуки из ведомости изделия» на настоящем коде экрана.

Как и стенд комплектов, собирает самодостаточную страницу: токены и блок
стилей окраски из app.css, блок функций окраски и новый блок выбора изделия
из app-4.js — как есть. Сервер подменён заглушкой: /mfg-matches отдаёт два
изделия, /qty-from-mfg ставит количество из ведомости.
"""
import io
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def slice_between(lines, start_mark, end_mark, start_from=0):
    a = next(i for i, l in enumerate(lines) if start_mark in l and i >= start_from)
    b = next(i for i, l in enumerate(lines) if end_mark in l and i > a)
    return '\n'.join(lines[a:b]), b


css = io.open(os.path.join(HERE, 'app.css'), encoding='utf-8').read().split('\n')
root = '\n'.join(css[0:23])
paint_css, _ = slice_between(css, 'v2.45.836: РАСЧЁТ ОКРАСКИ',
                             'v2.45.853: корпуса — файлы изделия')

js = io.open(os.path.join(HERE, 'app-4.js'), encoding='utf-8').read().split('\n')
part1, pos = slice_between(js, 'v2.45.836: РАСЧЁТ ОКРАСКИ — развёртки',
                           '// ---------- «Своя деталь» ----------')
part2, _ = slice_between(js, 'v2.46.058: ШТУКИ ИЗ ВЕДОМОСТИ ИЗДЕЛИЯ',
                         'function openPaintVedomost(calcId) {', pos)
paint_js = part1 + '\n\n' + part2

TPL = u"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Расчёт окраски — штуки из ведомости изделия</title>
<style>
__ROOT__
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; background: var(--bg);
       color: var(--text-dark); font-size: 14px; padding: 16px; }
.ti { display: none; }
.wrap { max-width: 1180px; margin: 0 auto; }
.lead { background: #fff; border: 1px solid var(--border); border-left: 4px solid var(--brand);
        border-radius: 12px; padding: 14px 18px; margin-bottom: 14px; }
.lead h1 { font-size: 17px; margin-bottom: 6px; }
.lead p { font-size: 13px; color: var(--text-mid); line-height: 1.6; }
.lead b { color: var(--brand); }
.btn { border: 1px solid var(--border); background: #fff; border-radius: 8px; padding: 7px 12px;
       font-size: 13px; cursor: pointer; font-family: inherit; }
.btn-primary { background: var(--brand); color: #fff; border-color: var(--brand); }
.btn-small { padding: 6px 10px; font-size: 12.5px; }
.icon-btn { border: 1px solid var(--border); background: #fff; border-radius: 8px; padding: 5px 8px; cursor: pointer; }
.modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, .45); display: none;
                 align-items: flex-start; justify-content: center; padding: 40px 16px; z-index: 60; }
.modal-overlay.visible { display: flex; }
.modal { background: #fff; border-radius: 14px; width: 100%; box-shadow: 0 18px 50px rgba(15, 23, 42, .25); }
.modal-header { display: flex; align-items: center; justify-content: space-between;
                padding: 14px 18px; border-bottom: 1px solid var(--border); }
.modal-header h3 { font-size: 15px; }
.modal-close { border: 0; background: transparent; font-size: 16px; cursor: pointer; color: var(--text-light); }
.modal-content { padding: 16px 18px; }
.toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 22px; z-index: 90;
         background: #0F766E; color: #fff; border-radius: 10px; padding: 10px 16px; font-size: 13px;
         box-shadow: 0 10px 26px rgba(15, 23, 42, .25); }
__PAINTCSS__
</style></head><body><div class="wrap">
<div class="lead">
  <h1>Количество деталей подтягивается из изделия</h1>
  <p>Ту же папку раскроя уже заводили в <b>«Изготовление корпусов»</b> — там разобрана ведомость
     деталей и стоит количество на изделие. Расчёт окраски теперь берёт штуки оттуда: при загрузке
     файлов — сам, а если изделий несколько или количество поправили — кнопкой
     <b>«Штуки из изделия»</b> в шапке. Ниже живой экран: нажмите её.</p>
</div>
<div id="paint-calc-content"></div>
</div>
<script>
/* ==== заглушки окружения CRM ==== */
const state = {};
const TOKEN_KEY = 'x'; const API_BASE = '';
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
function showToast(msg, kind){ var t = document.createElement('div'); t.className = 'toast';
  if (kind === 'error') t.style.background = '#B91C1C'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(function(){ t.remove(); }, 2600); }
function _plural(n,f){ var k=n%100, m=n%10; return k>=11&&k<=14?f[2]:(m===1?f[0]:(m>=2&&m<=4?f[1]:f[2])); }
function _ralHex(r){ return ({'RAL 9016':'#F1F0EA','RAL 9003':'#F4F4F4','RAL 7035':'#D7D7D7'})[String(r).trim()]||'#CBD5E1'; }
function _ralName(r){ return ({'RAL 9016':'транспортный белый','RAL 9003':'сигнальный белый','RAL 7035':'светло-серый'})[String(r).trim()]||''; }
function openPaintRalPicker(){} function openPaintMaterialPicker(){} function openPaintRename(){}
function paintManualOpen(){}
function openPaintVedomost(){ alert('В CRM отсюда открывается ведомость PDF — количество в ней уже из ведомости изделия'); }
function deletePaintCalc(){} function loadPaintCalcs(){} function paintUploadFiles(){}
function paintDropFiles(e){ e.preventDefault(); }
function removePaintItem(){} function paintBatchPdf(){} function paintItemsStatus(){} function mfgOpenPdf(){}

/* ==== поддельный сервер ==== */
var VEDOMOST = { 'AG-10.000.001': 1, 'AG-10.000.002': 1, 'AG-10.000.003': 6,
                 'AG-10.000.004': 2, 'AG-10.001.002': 1, 'AG-10.001.003': 2 };
var MATCHES = { total: 7, items: [
  { item_id: 12, designation: 'AG-10.000.000СБ', name: 'Блок нагревателя',
    section_name: 'Донагреватели', matched: 6, parts_count: 12 },
  { item_id: 8, designation: 'AG-08.000.000СБ', name: 'Корпус чиллера 600x900',
    section_name: 'Чиллеры', matched: 1, parts_count: 21 } ] };
function apiGet(path){ return Promise.resolve(path.indexOf('mfg-matches') >= 0 ? MATCHES : DEMO); }
function apiPost(path, body){
  var c = state.currentPaintCalc, applied = 0;
  if (body && body.item_id === 12) {
    c.items.forEach(function(it){
      var q = VEDOMOST[it.designation];
      if (q && it.qty !== q) { it.qty = q; applied++; }
    });
    c.warnings = ['Количество из «Изготовления корпусов» — изделие «AG-10.000.000СБ Блок нагревателя»: ' +
                  'по 6 из 7 позиций' + (applied ? ', изменено ' + applied : ', всё уже совпадало')];
  }
  _demoRecalc();
  return Promise.resolve({ ok: true, status: 200, data: { applied: applied, calc: c } });
}

/* ==== НАСТОЯЩИЙ код экрана из app-4.js ==== */
__PAINTJS__

/* ==== данные без сервера ==== */
function _svg(w,h){ return '<svg viewBox="0 0 170 110" xmlns="http://www.w3.org/2000/svg">' +
  '<rect x="' + (85-w/2) + '" y="' + (55-h/2) + '" width="' + w + '" height="' + h + '" rx="4" fill="#fff" stroke="#2D5F8B" stroke-width="1.4"/>' +
  '<circle cx="' + (85-w/2+9) + '" cy="' + (55-h/2+9) + '" r="2.6" fill="none" stroke="#2D5F8B"/>' +
  '<circle cx="' + (85+w/2-9) + '" cy="' + (55+h/2-9) + '" r="2.6" fill="none" stroke="#2D5F8B"/></svg>'; }
var PREP_INOX = 'Обезжиривание, абразивоструйная обработка либо адгезионный грунт (фосфатирование НЕ применять)';
var PREP_ST = 'Обезжиривание, фосфатирование';
var INOX = ['Нержавеющая сталь', PREP_INOX], ST = ['Углеродистая сталь (принято по умолчанию)', PREP_ST];
function _it(id, d, n, area, w, h, th, mat, prep, holes){
  return { id:id, calc_id:1, designation:d, name:n, qty:1, thickness_mm:th, material:mat,
           ral:'RAL 9016', net_area_m2:+(area/2).toFixed(3), paint_per_part_m2:area,
           holes_count:holes, svg:_svg(w,h), data:{material_info:{name:prep[0], prep:prep[1]}} };
}
var DEMO = {
  id: 1, doc_number: 'АГ.РД-008/26', title: 'Окраска — AG-10.000.000СБ Блок нагревателя',
  ral: 'RAL 9016', sets_qty: 1, total_paint_m2: 0, warnings: [], files: [], items: [
    _it(1, 'AG-10.000.001', 'Крышка нагревателя', 0.44, 120, 34, 1, 'AISI 304', INOX, 42),
    _it(2, 'AG-10.000.002', 'Крышка коробки распределительной', 0.04, 70, 60, 1, 'AISI 304', INOX, 2),
    _it(3, 'AG-10.000.003', 'Прижим ТЭНа', 0.01, 46, 74, 1, 'AISI 304', INOX, 1),
    _it(4, 'AG-10.000.004', 'Кронштейн датчика', 0.004, 22, 78, 1, 'AISI 304', INOX, 1),
    _it(5, 'AG-10.001.002', 'Коробка распределительная', 0.06, 96, 58, 0.8, 'Ст3', ST, 12),
    _it(6, 'AG-10.001.003', 'Кабель-канал', 0.06, 118, 26, 1, 'AISI 304', INOX, 6),
    _it(7, 'AG-10.002.005', 'Кронштейн термостата', 0.01, 40, 70, 1, 'AISI 304', INOX, 3)
  ]
};
function _demoRecalc() {
  var c = state.currentPaintCalc, sets = Math.max(parseInt(c.sets_qty,10)||1,1);
  var bm = {}, total = 0, rals = [];
  c.items.forEach(function(it){
    it.paint_total_m2 = +(it.paint_per_part_m2 * (it.qty||1) * sets).toFixed(6);
    total += it.paint_total_m2;
    var mi = (it.data && it.data.material_info) || {}, m = mi.name || '—';
    var b = bm[m] || (bm[m] = {area_m2:0, parts:0, prep:mi.prep||'', thickness:[]});
    b.area_m2 = +(b.area_m2 + it.paint_total_m2).toFixed(4);
    b.parts += (it.qty||1) * sets;
    if (it.thickness_mm && b.thickness.indexOf(it.thickness_mm) < 0) b.thickness.push(it.thickness_mm);
    if (it.ral && rals.indexOf(it.ral) < 0) rals.push(it.ral);
  });
  c.total_paint_m2 = +total.toFixed(4);
  c.totals = {by_material:bm, ral_list:rals, mass_control_failed:[],
              powder:{min_kg:+(total*0.15).toFixed(2), max_kg:+(total*0.2).toFixed(2)}};
}
_paintSetsSave = function(calcId, sets) {
  state.currentPaintCalc.sets_qty = Math.max(parseInt(sets,10)||1,1);
  _demoRecalc(); renderPaintCalcDetail(state.currentPaintCalc);
  return Promise.resolve();
};
savePaintItem = function(calcId, itemId, patch) {
  var it = state.currentPaintCalc.items.filter(function(x){ return x.id === itemId; })[0];
  if (it && patch && patch.qty) it.qty = Math.max(parseInt(patch.qty,10)||1,1);
  _demoRecalc(); renderPaintCalcDetail(state.currentPaintCalc);
  return Promise.resolve();
};
try { localStorage.setItem('paintView', window.innerWidth <= 820 ? 'tiles' : 'table'); } catch(e) {}
state.currentPaintCalc = DEMO;
DEMO.warnings = ['Ведомости деталей в комплекте нет — количество принято по 1 шт на комплект, ' +
                 'проставьте вручную кнопками − / + на плитке детали; сколько комплектов красим — ' +
                 'поле «Комплектов» в итогах расчёта'];
_demoRecalc();
renderPaintCalcDetail(DEMO);
</script></body></html>
"""

html = (TPL.replace('__ROOT__', root)
           .replace('__PAINTCSS__', paint_css)
           .replace('__PAINTJS__', paint_js))

out = os.path.expanduser('~/castweb/devchat_out/1056/paint-qty-from-mfg.html')
os.makedirs(os.path.dirname(out), exist_ok=True)
io.open(out, 'w', encoding='utf-8').write(html)
print('written', out, len(html))
