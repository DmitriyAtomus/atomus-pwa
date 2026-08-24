# -*- coding: utf-8 -*-
"""Стенд для ленты CRM: настоящий код экрана «Расчёт окраски» + поддельный API.

Собирает самодостаточную страницу: :root-токены и блок стилей окраски из
app.css, блок функций окраски из app-4.js — как есть, без правок. Данные и
сохранение подменяются заглушками ПОСЛЕ вставки кода CRM.
"""
import io
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

css_all = io.open(os.path.join(HERE, 'app.css'), encoding='utf-8').read().split('\n')
root = '\n'.join(css_all[0:23])            # :root с токенами
paint_css = '\n'.join(css_all[22649:22947])  # блок «Расчёт окраски»

js_all = io.open(os.path.join(HERE, 'app-4.js'), encoding='utf-8').read().split('\n')
paint_js = '\n'.join(js_all[16535:17192])  # блок окраски целиком, включая комплекты

TPL = u"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Расчёт окраски — сколько комплектов</title>
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
__PAINTCSS__
</style></head><body><div class="wrap">
<div class="lead">
  <h1>Где указать, сколько штук комплектов</h1>
  <p>Штуки на плитке детали — это количество <b>на один комплект</b> (как в ведомости деталей к изделию).
     Сколько комплектов красим — новое поле <b>«Комплектов»</b> в итогах, рядом с площадью.
     Поставили 5 — площадь, порошок, сводка по материалу и ведомость PDF пересчитались на всю партию,
     а на плитках и в таблице видно, сколько это штук. Ниже живой экран: жмите − / + у «Комплектов».</p>
</div>
<div id="paint-calc-content"></div>
</div>
<script>
/* ==== заглушки окружения CRM ==== */
const state = {};
const TOKEN_KEY = 'x'; const API_BASE = '';
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
function showToast(){}
function _plural(n,f){ var k=n%100, m=n%10; return k>=11&&k<=14?f[2]:(m===1?f[0]:(m>=2&&m<=4?f[1]:f[2])); }
function _ralHex(r){ return ({'RAL 9016':'#F1F0EA','RAL 9003':'#F4F4F4','RAL 7035':'#D7D7D7'})[String(r).trim()]||'#CBD5E1'; }
function _ralName(r){ return ({'RAL 9016':'транспортный белый','RAL 9003':'сигнальный белый','RAL 7035':'светло-серый'})[String(r).trim()]||''; }
function apiGet(){ return Promise.resolve(DEMO); }
function apiPost(){ return Promise.resolve({ok:false}); }
function openPaintRalPicker(){} function openPaintMaterialPicker(){} function openPaintRename(){}
function paintManualOpen(){}
function openPaintVedomost(){ alert('В CRM отсюда открывается ведомость PDF — она уже собирается на всю партию'); }
function deletePaintCalc(){} function loadPaintCalcs(){} function paintUploadFiles(){}
function paintDropFiles(e){ e.preventDefault(); }
function removePaintItem(){} function paintBatchPdf(){} function paintItemsStatus(){} function mfgOpenPdf(){}

/* ==== НАСТОЯЩИЙ код экрана из app-4.js ==== */
__PAINTJS__

/* ==== данные и сохранение без сервера (переопределяем ПОСЛЕ кода CRM) ==== */
function _svg(w,h){ return '<svg viewBox="0 0 170 110" xmlns="http://www.w3.org/2000/svg">' +
  '<rect x="' + (85-w/2) + '" y="' + (55-h/2) + '" width="' + w + '" height="' + h + '" rx="4" fill="#fff" stroke="#2D5F8B" stroke-width="1.4"/>' +
  '<circle cx="' + (85-w/2+9) + '" cy="' + (55-h/2+9) + '" r="2.6" fill="none" stroke="#2D5F8B"/>' +
  '<circle cx="' + (85+w/2-9) + '" cy="' + (55+h/2-9) + '" r="2.6" fill="none" stroke="#2D5F8B"/></svg>'; }
var PREP_INOX = 'Обезжиривание, абразивоструйная обработка либо адгезионный грунт (фосфатирование НЕ применять)';
var PREP_ST = 'Обезжиривание, фосфатирование';
var DEMO = {
  id: 1, doc_number: 'АГ.РД-008/26', title: 'Окраска — AG-10.000.000СБ Блок нагревателя',
  ral: 'RAL 9016', sets_qty: 1, total_paint_m2: 0, warnings: [], files: [], items: [
    {id:1, calc_id:1, designation:'AG-10.000.001', name:'Крышка нагревателя', qty:1, thickness_mm:1,
     material:'AISI 304', ral:'RAL 9016', net_area_m2:0.2, paint_per_part_m2:0.44, holes_count:42,
     svg:_svg(120,34), data:{material_info:{name:'Нержавеющая сталь', prep:PREP_INOX}}},
    {id:2, calc_id:1, designation:'AG-10.000.002', name:'Крышка коробки распределительной', qty:1, thickness_mm:1,
     material:'AISI 304', ral:'RAL 9016', net_area_m2:0.02, paint_per_part_m2:0.04, holes_count:2,
     svg:_svg(70,60), data:{material_info:{name:'Нержавеющая сталь', prep:PREP_INOX}}},
    {id:3, calc_id:1, designation:'AG-10.000.003', name:'Прижим ТЭНа', qty:2, thickness_mm:1,
     material:'AISI 304', ral:'RAL 9016', net_area_m2:0.005, paint_per_part_m2:0.01, holes_count:1,
     svg:_svg(46,74), data:{material_info:{name:'Нержавеющая сталь', prep:PREP_INOX}}},
    {id:4, calc_id:1, designation:'AG-10.001.002', name:'Коробка распределительная', qty:1, thickness_mm:0.8,
     material:'Ст3', ral:'', net_area_m2:0.03, paint_per_part_m2:0.06, holes_count:12,
     svg:_svg(96,58), data:{material_info:{name:'Углеродистая сталь (принято по умолчанию)', prep:PREP_ST}}}
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
  c.warnings = ['Ведомости деталей в комплекте нет — количество принято по 1 шт на комплект, ' +
                'проставьте вручную кнопками − / + на плитке детали; сколько комплектов красим — ' +
                'поле «Комплектов» в итогах расчёта'];
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
_demoRecalc();
renderPaintCalcDetail(DEMO);
</script></body></html>
"""

html = (TPL.replace('__ROOT__', root)
           .replace('__PAINTCSS__', paint_css)
           .replace('__PAINTJS__', paint_js))

out = os.path.expanduser('~/castweb/devchat_out/1046/paint-sets.html')
io.open(out, 'w', encoding='utf-8').write(html)
print('written', out, len(html))
