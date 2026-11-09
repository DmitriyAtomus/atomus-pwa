/* v2.46.286 — группы изделий, массовый поставщик и сроки. Данные сохраняются
 * через /api/supply/board; никакие действия этого экрана не отправляют письма. */
(function (root) {
  'use strict';
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = n => '<i class="ti ti-' + n + '" aria-hidden="true"></i>';
  const selected = new Set(), collapsed = new Set(), pending = new Map();
  const label = { buy:'Купить', inv:'Ждём счёт', pay:'На оплату', go:'Оплачено, едет', draft:'Черновик' };
  let S, hooks, host, filterText = '', savedFocus = null;

  function decorateRows(rows, board) {
    const entries = board.entries || {};
    return rows.map(original => {
      const r = Object.assign({}, original, { problems: (original.problems || []).slice() });
      r.key = r.board_key || r.key;
      if (r.plan_contracts && r.plan_contracts.length > 1) r.dk = 'shared';
      const m = entries[r.key] || {};
      r.board_revision = m.revision || 0;
      r.original_title = r.title;
      if (m.title) r.title = m.title;
      const coveredModels = [...new Set((r.coveredNeeds || []).flatMap(n=>n.models || []))];
      r.group_name = m.group_name || (r.plan_models && r.plan_models.length === 1 ? r.plan_models[0] : '') ||
        (coveredModels.length === 1 ? coveredModels[0] : '') ||
        (r.kind === 'order' ? 'Заказы поставщикам' : (r.dk === 'stock' ? 'Для склада' : 'Общие комплектующие'));
      if (r.kind !== 'order' && m.supplier_id) {
        r.supplier_id = m.supplier_id; r.supplier = m.supplier_name || 'Поставщик';
        r.supplier_email = m.supplier_email || '';
        r.problems = r.problems.filter(p => p !== 'nosup');
        r.sub = (r.sub || '').replace(/\s*·?\s*<nosup>/g, '');
      }
      r.ready_date = r.kind === 'order' ? (r.ready_date || null) : (m.ready_date || null);
      r.arrival_date = r.kind === 'order' ? (r.expected || null) : (m.arrival_date || null);
      r.board_hidden = !!(m.hidden || (entries['d:' + r.dk] || {}).hidden);
      r.board_consumed = !!(r.kind !== 'order' && m.draft_active);
      r.hay = [r.hay,r.title,r.group_name,r.supplier,r.ready_date,r.arrival_date].join(' ').toLowerCase();
      return r;
    });
  }
  function allowed() {
    if (!S || !S.boardReady || S.loading || S.loadError) return false;
    if (typeof root.hasPermission === 'function' && root.hasPermission('supply.manage')) return true;
    return typeof state !== 'undefined' && state.user && (state.user.roles || []).some(x => ['director','zam','manager'].includes(x));
  }
  function destName(key, r) {
    const m = ((S.board || {}).entries || {})['d:' + key];
    return (m && m.title) || ({ stock:'Склад', shop:'Цех', none:'Без «Куда»', shared:'Общие потребности' }[key]) ||
      ((r && r.dest && r.dest.contractor ? r.dest.contractor + ' · ' : '') + '№' + key.replace(/^c:/, ''));
  }
  function fmtDate(v) { return v ? String(v).slice(8,10) + '.' + String(v).slice(5,7) + '.' + String(v).slice(0,4) : 'не указан'; }
  function today() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Yekaterinburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
  function targets(rows) {
    return rows.map(r => ({ key:r.key, revision:r.board_revision || 0,
      ...(r.kind === 'order' ? {expected_date:r.arrival_date || null,ready_date:r.ready_date || null} : {}),
      ...(r.kind !== 'order' ? {qty:r.quantity} : {}) }));
  }
  function picked() { return (S.rows || []).filter(r => selected.has(r.key)); }
  function supplierTargets(rows, keys, row) {
    // Клик по поставщику выделенной строки относится ко всему выделению.
    if (row && !keys.has(row.key)) return [row];
    return rows.filter(r => keys.has(r.key) && r.kind !== 'order' && r.stage === 'buy');
  }
  function visible() {
    const filtered = root.__sbv.sbFilter(S.rows, S.f);
    return filtered.filter(r => !filterText || r.hay.includes(filterText.toLowerCase()));
  }
  function subgroups(rows) {
    const map = new Map();
    rows.forEach(r => {
      const prefix = r.dk + '|' + (r.kind === 'order' ? 'orders|' : 'needs|');
      let key = prefix + r.group_name, title = r.group_name;
      if (S.mode === 'supplier') { key = prefix + 'supplier:' + (r.supplier_id || 0); title = r.supplier || 'Поставщик не выбран'; }
      if (S.mode === 'stage') { key = prefix + 'stage:' + r.stage; title = label[r.stage] || r.stage; }
      if (!map.has(key)) map.set(key,{key,title,rows:[]});
      map.get(key).rows.push(r);
    });
    return [...map.values()];
  }
  function button(action, text, extra='') { return '<button type="button" data-baction="'+action+'" '+extra+'>'+text+'</button>'; }
  function badge(r) {
    const stage = r.status === 'draft' ? 'draft' : r.stage;
    const raw = r._raw || {};
    const mfg = r.status === 'paid' && (raw.paid_substage === 'manufacturing' || raw.order_paid_substage === 'manufacturing');
    const text = r.dupLabel || (r.status === 'partial' ? 'Пришло частично' : r.status === 'shipping' ? 'Едет' : mfg ? 'В изготовлении' : label[stage]) || 'Купить';
    return '<span class="sbw-badge '+(r.dupLabel?'bad':stage)+'">'+E(text)+'</span>';
  }
  function rowHTML(r, manage) {
    const date = (r.ready_date?'Изготовят: '+fmtDate(r.ready_date):'') + (r.ready_date&&r.arrival_date?' · ':'') + (r.arrival_date?'Придёт: '+fmtDate(r.arrival_date):'');
    const late = r.arrival_date && r.arrival_date < today();
    const invoice = r.kind === 'order' && r._raw && r._raw.invoice_number;
    const meta = [r.sku,r.label,invoice ? 'Счёт №' + invoice : ''].filter(Boolean).join(' · ');
    const supplier = r.supplier || 'Выбрать';
    const more = manage ? button('row-menu', icon('dots'), 'data-key="'+E(r.key)+'" class="sbw-icon" aria-label="Действия: '+E(r.title)+'"') : '';
    return '<tr class="'+(selected.has(r.key)?'selected':'')+'" data-row="'+E(r.key)+'">'+
      '<td class="sbw-check">'+(manage?'<input type="checkbox" data-select="'+E(r.key)+'" aria-label="Выбрать '+E(r.title)+'" '+(selected.has(r.key)?'checked':'')+'>':'')+'</td>'+
      '<td class="sbw-name">'+button('open',E(r.title),'data-key="'+E(r.key)+'" class="sbw-title"')+
      (meta?'<div class="sbw-meta">'+E(meta)+'</div>':'')+
      (r.coveredNeeds||[]).map(n=>'<div class="sbw-coverage">'+E(n.models.length?n.models.join(', '):n.name)+
        ': нужно '+E(n.qty)+' '+E(n.unit)+' · в заказе осталось '+E(n.remaining)+' '+E(n.unit)+
        ' · докупить 0'+(n.surplus>0?' · сверх потребности '+E(n.surplus)+' '+E(n.unit):'')+'</div>').join('')+
      (r.kind==='order'&&r.lines&&r.lines.length?button('lines',(S.open[r.key]?'Скрыть состав':'Состав заказа')+' · '+r.lines.length,'data-key="'+E(r.key)+'" class="sbw-lines-toggle" aria-expanded="'+!!S.open[r.key]+'"'):'')+
      '<div class="sbw-dates '+(late?'late':'')+'">'+button('dates',icon('calendar')+' '+E(date || 'Указать сроки')+(late?' · срок прошёл':''),'data-key="'+E(r.key)+'" '+(!manage?'disabled':'') )+'</div></td>'+
      '<td class="sbw-qty">'+E(r.qty || '—')+(r.kind==='order'?'<div class="sbw-meta">'+(r.fromInvoice?'по счёту':'к получению')+'</div>':'')+'</td>'+
      '<td class="sbw-supplier">'+(r.stage==='buy'&&manage?button('supplier',icon(r.supplier?'building-store':'plus')+' '+E(supplier),'data-key="'+E(r.key)+'"'):E(r.supplier||'Не указан'))+'</td>'+
      '<td class="sbw-stage">'+badge(r)+(r.amount?'<div class="sbw-meta">'+Number(r.amount).toLocaleString('ru-RU')+' ₽</div>':'')+'</td>'+
      '<td class="sbw-more">'+more+'</td></tr>'+
      (S.open[r.key] && r.lines && r.lines.length ? '<tr class="sbw-detail-row"><td colspan="6"><div class="sbw-lines">'+r.lines.map(l=>'<div><span>'+E(l.name)+'</span><span>'+E(l.qty)+' '+E(l.unit||'шт.')+'</span></div>').join('')+'</div></td></tr>':'');
  }
  function groupHTML(g, manage) {
    const shut = collapsed.has(g.key), count = g.rows.filter(r=>selected.has(r.key)).length;
    const buy = g.rows.filter(r=>r.kind!=='order'&&r.stage==='buy');
    const selectedBuy = buy.filter(r=>selected.has(r.key));
    const supplierCount = selectedBuy.length || buy.length;
    const noSup = g.rows.filter(r=>r.stage==='buy'&&!r.supplier_id).length;
    return '<section class="sbw-group"><div class="sbw-grouphead">'+
      button('collapse',icon(shut?'chevron-right':'chevron-down')+'<span><strong>'+E(g.title)+'</strong><small>'+g.rows.length+' позиций'+(noSup?' · '+noSup+' без поставщика':'')+'</small></span>','data-group="'+E(g.key)+'" aria-expanded="'+!shut+'" class="sbw-group-title"')+
      (manage?button('group-menu',icon('dots'),'data-group="'+E(g.key)+'" class="sbw-icon" aria-label="Действия с группой '+E(g.title)+'"'):'')+'</div>'+
      (shut?'':'<div class="sbw-group-tools">'+(manage?'<label><input type="checkbox" data-select-group="'+E(g.key)+'" '+(count===g.rows.length?'checked':'')+'>Выбрать все '+g.rows.length+'</label>':'')+
      (manage&&supplierCount?button('group-supplier','Поставщик '+(selectedBuy.length?'выбранным':'всей группе')+' · '+supplierCount,'data-group="'+E(g.key)+'" class="primary"'):'')+
      '<span>'+(g.rows[0].kind==='order'?'Уже оформленные заказы':'Количество — к покупке')+'</span></div>'+
      '<table class="sbw-table"><thead><tr><th class="sbw-check"></th><th>Позиция</th><th class="sbw-qty">Кол-во</th><th class="sbw-supplier">Поставщик</th><th class="sbw-stage">Этап</th><th class="sbw-more"></th></tr></thead><tbody>'+g.rows.map(r=>rowHTML(r,manage)).join('')+'</tbody></table>')+'</section>';
  }
  function render(h, s, callbacks) {
    host=h; S=s; hooks=callbacks;
    const rows=S.rows, manage=allowed();
    selected.forEach(k=>{if(!rows.some(r=>r.key===k))selected.delete(k);});
    if (!manage) selected.clear();
    const dests=[...new Set(rows.map(r=>r.dk))];
    if(S.f.dest!=='all'&&!dests.includes(S.f.dest))S.f.dest='all';
    const seen=visible();
    const counter=document.getElementById('sup-shop-counter');if(counter)counter.textContent=rows.length;
    const entries=(S.board||{}).entries||{};
    const hiddenN=Object.values(entries).filter(e=>e.hidden).length;
    let html='<div class="sbw"><div class="sbw-top"><span class="sbw-muted">Потребности по договорам и изделиям'+(S.loading?' · обновляем…':'')+'</span><div class="sbw-top-actions">'+
      button('archive',icon('archive')+' Убранное <small>'+hiddenN+'</small>')+
      button('destinations',icon('map-pin')+' Куда закупаем',(!manage?'disabled':''))+
      button('new-order',icon('plus')+' Новый заказ','class="primary" '+(!manage?'disabled':''))+'</div></div>';
    if(S.loadError)html+='<div class="sbw-error" role="alert">Не все данные загрузились. Изменения недоступны до обновления. '+button('reload','Повторить')+'</div>';
    html+=root.__sbv.sbTilesHtml(root.__sbv.sbTiles(rows),S.f.tile);
    html+='<div class="sbw-search"><input type="search" id="sbw-search" value="'+E(filterText)+'" placeholder="Деталь, артикул, ORD, поставщик" aria-label="Поиск закупок"><select id="sbw-mode" aria-label="Группировка">'+[['dest','По изделиям'],['supplier','По поставщику'],['stage','По этапу']].map(([k,v])=>'<option value="'+k+'" '+(S.mode===k?'selected':'')+'>'+v+'</option>').join('')+'</select>'+button('reset-filter','Сбросить фильтры','class="quiet"')+'</div>';
    html+='<div class="sbw-tabs">'+button('dest','Все <small>'+rows.length+'</small>','data-dest="all" class="'+(S.f.dest==='all'?'on':'')+'"')+dests.map(k=>button('dest',E(destName(k,rows.find(r=>r.dk===k)))+' <small>'+rows.filter(r=>r.dk===k).length+'</small>','data-dest="'+E(k)+'" class="'+(S.f.dest===k?'on':'')+'"')).join('')+'</div>';
    if(manage){const n=picked().length;html+='<div class="sbw-bulk">'+(n?'<strong>Выбрано '+n+' позиций</strong>'+button('supplier',icon('building-store')+' Выбрать поставщика','class="primary"')+button('move',icon('folder')+' В группу')+button('dates',icon('calendar')+' Сроки')+button('draft',icon('file-text')+' Подготовить заказ')+button('hide',icon('archive'),'class="sbw-icon" aria-label="Убрать выбранное"')+button('clear','Снять','class="quiet"'):'<span class="sbw-muted">Отметьте позиции, чтобы назначить поставщика и сроки сразу всем.</span>')+'</div>';}
    if(S.f.tile)html+='<div class="sbw-filter-note">Фильтр: '+E(S.f.tile==='problem'?'Требуют решения':label[S.f.tile])+'</div>';
    const shownDests=[...new Set(seen.map(r=>r.dk))];
    shownDests.forEach(d=>{const dr=seen.filter(r=>r.dk===d);html+='<div class="sbw-dest-head"><div>'+icon(d==='stock'?'building-warehouse':'file-text')+'<h2>'+E(destName(d,dr[0]))+'</h2></div>'+(manage?button('dest-menu',icon('dots'),'data-dest="'+E(d)+'" class="sbw-icon" aria-label="Изменить назначение"'):'')+'</div>'+(d==='shared'?'<p class="sbw-muted sbw-shared">Общая потребность нескольких договоров — количество учтено один раз.</p>':'');
      [['needs','Нужно заказать',dr.filter(r=>r.kind!=='order')],['orders','Заказы и счета',dr.filter(r=>r.kind==='order')]].forEach(([kind,title,items])=>{
        if(!items.length)return;
        html+='<section class="sbw-section" data-section="'+kind+'"><h3>'+title+' <small>'+items.length+'</small></h3>'+
          (kind==='orders'?'<p class="sbw-muted">Счёт, оплата и поставка показаны в строке своего заказа.</p>':'')+subgroups(items).map(g=>groupHTML(g,manage)).join('')+'</section>';
      });
    });
    if(!seen.length)html+='<div class="sbw-empty">'+(S.loading?'Загружаем…':rows.length?'Нет позиций по выбранному фильтру.':'В рабочем списке нет позиций.')+'</div>';
    html+='<div class="sbw-foot">'+button('legacy','Старый вид экрана','class="quiet"')+'</div></div>';
    host.innerHTML=html;
    host.onchange=onChange;host.onclick=onClick;
    host.querySelectorAll('[data-select-group]').forEach(e=>{const g=subgroups(seen).find(x=>x.key===e.dataset.selectGroup);const n=g.rows.filter(r=>selected.has(r.key)).length;e.indeterminate=n>0&&n<g.rows.length;});
    const search=document.getElementById('sbw-search');search.oninput=()=>{filterText=search.value;selected.clear();savedFocus={search:true,start:search.selectionStart};hooks.paint();};
    if(savedFocus){if(savedFocus.search){search.focus();try{search.setSelectionRange(savedFocus.start,savedFocus.start);}catch(_){}}else{const el=[...host.querySelectorAll('[data-select]')].find(e=>e.dataset.select===savedFocus.key);if(el)el.focus();}savedFocus=null;}
  }
  function onChange(ev){const e=ev.target,d=e.dataset;
    if(d.select){e.checked?selected.add(d.select):selected.delete(d.select);savedFocus={key:d.select};hooks.paint();}
    else if(d.selectGroup){const g=subgroups(visible()).find(x=>x.key===d.selectGroup);g.rows.forEach(r=>e.checked?selected.add(r.key):selected.delete(r.key));hooks.paint();}
    else if(e.id==='sbw-mode'){root.sbSet('mode',e.value);}
  }
  function rowByKey(key){return (S.allRows||S.rows).find(r=>r.key===key);}
  function onClick(ev){const b=ev.target.closest('[data-baction]');if(!b)return;const d=b.dataset,a=d.baction;const r=d.key?rowByKey(d.key):null;
    if(a==='clear'){selected.clear();hooks.paint();}
    else if(a==='collapse'){collapsed.has(d.group)?collapsed.delete(d.group):collapsed.add(d.group);hooks.paint();}
    else if(a==='dest'){root.sbSet('dest',d.dest);}
    else if(a==='reset-filter'){filterText='';S.f={q:'',dest:'all',tile:'',problems:false};selected.clear();hooks.paint();}
    else if(a==='reload'){root.loadSupplyShopping();}
    else if(a==='legacy'){root.sbLegacy(true);}
    else if(a==='new-order'){if(allowed())root.openNewSupplyOrder();}
    else if(a==='open'&&r){if(r.kind==='order')root.openSupplyOrder(r.order_id);else if(r.kind==='item')root.openComponentDetail(r.component_id);else if(allowed())menuRows([r],r.title);}
    else if(a==='lines'&&r){S.open[r.key]=!S.open[r.key];hooks.paint();}
    else if(a==='archive')showArchive();
    else if(!allowed())return;
    else if(a==='supplier'){const rows=supplierTargets(S.rows,selected,r);supplierDialog(rows.length?rows:picked());}
    else if(a==='group-supplier'){const g=subgroups(visible()).find(x=>x.key===d.group);const buy=g.rows.filter(r=>r.kind!=='order'&&r.stage==='buy');const chosen=buy.filter(r=>selected.has(r.key));supplierDialog(chosen.length?chosen:buy);}
    else if(a==='dates')datesDialog(r?[r]:picked());
    else if(a==='move')moveDialog(picked());
    else if(a==='hide')hideDialog(picked());
    else if(a==='draft')draftDialog(picked());
    else if(a==='row-menu'&&r)menuRows([r],r.title);
    else if(a==='group-menu'){const g=subgroups(visible()).find(x=>x.key===d.group);menuRows(g.rows,g.title,true);}
    else if(a==='dest-menu')destinationDialog(d.dest);
    else if(a==='destinations')destinationsDialog();
  }
  function notify(message,type){if(root.showToast)root.showToast(message,type||'success');}
  function modal(title,body,actions,setup){
    let m=document.getElementById('sbw-dialog');if(m)m.remove();savedFocus=document.activeElement;
    m=document.createElement('dialog');m.id='sbw-dialog';m.className='sbw-dialog';m.setAttribute('aria-labelledby','sbw-dialog-title');
    m.innerHTML='<div class="sbw-dialog-head"><h3 id="sbw-dialog-title">'+E(title)+'</h3><button type="button" data-close class="sbw-icon" aria-label="Закрыть">'+icon('x')+'</button></div><div class="sbw-dialog-body">'+body+'<div id="sbw-dialog-error" role="alert"></div></div><div class="sbw-dialog-foot">'+(actions||'<button type="button" data-close>Закрыть</button>')+'</div>';
    document.body.appendChild(m);m.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>m.close());
    const focusBefore=savedFocus;savedFocus=null;m.addEventListener('close',()=>{m.remove();if(focusBefore&&focusBefore.isConnected)focusBefore.focus();});
    m.showModal();if(setup)setup(m);return m;
  }
  function error(e){const el=document.getElementById('sbw-dialog-error');if(el)el.textContent=e.message||String(e);else notify(e.message||String(e),'error');}
  async function post(path,body,btn){
    const fingerprint=path+JSON.stringify(body);if(!pending.has(fingerprint))pending.set(fingerprint,root.crypto.randomUUID());
    if(btn)btn.disabled=true;
    try{const res=await root.apiPost(path,{...body,request_id:pending.get(fingerprint)});
      if(!res||!res.ok||!res.data||!res.data.ok){pending.delete(fingerprint);throw new Error((res&&res.data&&res.data.message)||'Не удалось сохранить');}
      pending.delete(fingerprint);return res.data;
    }finally{if(btn&&btn.isConnected)btn.disabled=false;}
  }
  async function save(rows,patch,btn){const res=await post('/api/supply/board/change',{targets:targets(rows),patch},btn);await hooks.reload();return res;}
  function commitDialog(title,body,rows,patch,text='Сохранить'){
    modal(title,body,'<button type="button" data-close>Отмена</button><button type="button" id="sbw-save" class="primary">'+text+'</button>',m=>{m.querySelector('#sbw-save').onclick=async ev=>{try{await save(rows,typeof patch==='function'?patch():patch,ev.currentTarget);m.close();notify('Изменения сохранены');}catch(e){error(e);}};});
  }
  function renameRows(rows,title,field,value){commitDialog(title,'<label for="sbw-name">Название</label><input id="sbw-name" maxlength="200" value="'+E(value)+'"><p>Меняется подпись рабочего списка. Документы сохраняются.</p>',rows,()=>{const v=document.getElementById('sbw-name').value.trim();if(!v)throw new Error('Введите название');return {[field]:v};});}
  function menuRows(rows,title,group){
    const ordersOnly=rows.every(r=>r.kind==='order');
    modal(title,'<div class="sbw-menu">'+(group?'<button type="button" id="sbw-select-all">Выбрать всю группу</button>':'')+'<button type="button" id="sbw-rename">Переименовать'+(group?' группу':'')+'</button><button type="button" id="sbw-move">Перенести в группу</button>'+(ordersOnly?'<button type="button" id="sbw-order-dest">Изменить «Куда»</button>':'')+'<button type="button" id="sbw-dates">Указать сроки</button>'+(!group?'<button type="button" id="sbw-history">История изменений</button>':'')+'<button type="button" id="sbw-hide" class="danger">Убрать из списка</button></div>',null,m=>{
      m.querySelector('#sbw-rename').onclick=()=>renameRows(rows,group?'Название группы':'Название позиции',group?'group_name':'title',title);
      m.querySelector('#sbw-move').onclick=()=>moveDialog(rows);m.querySelector('#sbw-dates').onclick=()=>datesDialog(rows);m.querySelector('#sbw-hide').onclick=()=>hideDialog(rows);
      if(ordersOnly)m.querySelector('#sbw-order-dest').onclick=()=>{m.close();root.sbDestPick(rows.map(r=>r.order_id));};
      if(group)m.querySelector('#sbw-select-all').onclick=()=>{rows.forEach(r=>selected.add(r.key));m.close();hooks.paint();};
      else m.querySelector('#sbw-history').onclick=()=>historyDialog(rows[0]);
    });
  }
  function hideDialog(rows){if(!rows.length)return;commitDialog('Убрать из рабочего списка?', '<p>Позиций: '+rows.length+'. Заказы, счета и оплата сохранятся. Вернуть можно через «Убранное».</p>'+rows.slice(0,5).map(r=>'<div class="sbw-dialog-line">'+E(r.title)+'</div>').join(''),rows,{hidden:true},'Убрать из списка');}
  async function supplierDialog(rows){
    if(!rows.length)return;
    if(rows.some(r=>r.stage!=='buy')){modal('Выбор поставщика','<p>Выберите позиции на этапе «Купить». У уже оформленного заказа поставщик связан со счётом.</p>');return;}
    const m=modal('Поставщик для '+rows.length+' позиций','<p>Поставщик назначится всем выбранным позициям. Количество каждой детали сохранится.</p><input id="sbw-supplier-q" type="search" placeholder="Найти поставщика" aria-label="Найти поставщика"><div id="sbw-supplier-options">Загрузка…</div>','<button type="button" data-close>Отмена</button><button type="button" id="sbw-supplier-save" class="primary" disabled>Назначить '+rows.length+' позициям</button>');
    try{const data=await root.apiGet('/api/suppliers');if(!m.isConnected)return;const suppliers=(data.suppliers||data.items||[]).filter(s=>s.is_active!==false&&s.is_active!==0);let choice=null;
      const draw=()=>{const q=m.querySelector('#sbw-supplier-q').value.toLowerCase();m.querySelector('#sbw-supplier-options').innerHTML=suppliers.filter(s=>(s.name+' '+(s.inn||'')).toLowerCase().includes(q)).map(s=>'<label class="sbw-option"><input type="radio" name="sbw-supplier" value="'+Number(s.id)+'" '+(choice===s.id?'checked':'')+'><span>'+E(s.name)+'<small>'+E(s.inn?'ИНН '+s.inn:'')+'</small></span></label>').join('')||'<p>Поставщики не найдены</p>';m.querySelectorAll('[name="sbw-supplier"]').forEach(e=>e.onchange=()=>{choice=Number(e.value);m.querySelector('#sbw-supplier-save').disabled=false;});};
      draw();m.querySelector('#sbw-supplier-q').oninput=draw;m.querySelector('#sbw-supplier-save').onclick=async ev=>{try{await save(rows,{supplier_id:choice},ev.currentTarget);m.close();notify('Поставщик назначен: '+rows.length+' позиций');}catch(e){error(e);}};
    }catch(e){error(e);}
  }
  function moveDialog(rows){if(!rows.length)return;if(new Set(rows.map(r=>r.dk)).size>1){modal('Перенос в группу','<p>Выберите позиции одного договора или назначения.</p>');return;}
    const names=[...new Set(S.rows.filter(r=>r.dk===rows[0].dk).map(r=>r.group_name))];
    commitDialog('Группа для '+rows.length+' позиций','<label for="sbw-group-name">Выберите группу или введите новую</label><input id="sbw-group-name" list="sbw-groups" maxlength="200" placeholder="Например, Щит управления"><datalist id="sbw-groups">'+names.map(n=>'<option value="'+E(n)+'">').join('')+'</datalist>',rows,()=>{const v=document.getElementById('sbw-group-name').value.trim();if(!v)throw new Error('Введите название группы');return {group_name:v};},'Перенести');
  }
  function datesDialog(rows){if(!rows.length)return;const fields=[['ready_date','Изготовят к'],['arrival_date','Придёт к нам']];
    commitDialog('Сроки · '+rows.length+' позиций','<p>Можно изменить одну дату или обе. Прежние сроки сохраняются в истории.</p>'+fields.map(([k,t])=>{const vals=[...new Set(rows.map(r=>r[k]||''))];return '<label for="sbw-date-'+k+'">'+t+'</label><div class="sbw-date-field"><select id="sbw-date-action-'+k+'" aria-label="Изменить '+t+'"><option value="keep">Не менять</option><option value="set">Указать дату</option><option value="clear">Очистить</option></select><input type="date" id="sbw-date-'+k+'" value="'+E(vals.length===1?vals[0]:'')+'" disabled></div><small>Сейчас: '+(vals.length===1?fmtDate(vals[0]):'разные сроки')+'</small>';}).join(''),rows,()=>{const patch={};for(const[k,t]of fields){const action=document.getElementById('sbw-date-action-'+k).value,value=document.getElementById('sbw-date-'+k).value;if(action==='set'&&!value)throw new Error('Укажите дату «'+t+'»');if(action!=='keep')patch[k]=action==='clear'?null:value;}if(!Object.keys(patch).length)throw new Error('Выберите срок для изменения');return patch;},'Применить '+rows.length+' позициям');
    fields.forEach(([k])=>{document.getElementById('sbw-date-action-'+k).onchange=()=>{document.getElementById('sbw-date-'+k).disabled=document.getElementById('sbw-date-action-'+k).value!=='set';};});
  }
  async function historyDialog(row){const m=modal('История изменений','<div id="sbw-history-list">Загрузка…</div>');try{const data=await root.apiGet('/api/supply/board/history?key='+encodeURIComponent(row.key));if(!m.isConnected)return;
    const titles={title:'Название',group_name:'Группа',ready_date:'Изготовят к',arrival_date:'Придёт к нам',supplier_id:'Поставщик',hidden:'Убрано из списка',draft_order_id:'Заказ'};
    m.querySelector('#sbw-history-list').innerHTML=(data.items||[]).map(h=>'<div class="sbw-history">'+Object.entries(h.changes||{}).map(([k,v])=>'<div><b>'+E(titles[k]||k)+':</b> '+E(v.old==null?'—':v.old)+' → '+E(v.new==null?'—':v.new)+'</div>').join('')+'<small>'+E(h.author_name)+' · '+E(new Date(h.created_at.replace(' ','T')+'Z').toLocaleString('ru-RU',{timeZone:'Asia/Yekaterinburg'}))+' Екб</small></div>').join('')||'<p>Изменений ещё нет.</p>';
  }catch(e){error(e);}}
  function destTarget(d){const m=((S.board||{}).entries||{})['d:'+d]||{};return {key:'d:'+d,board_revision:m.revision||0};}
  function destinationDialog(d){const r=S.rows.find(r=>r.dk===d),title=destName(d,r);modal('Куда: '+title,'<div class="sbw-menu"><button type="button" id="sbw-dest-rename">Переименовать</button><button type="button" id="sbw-dest-hide" class="danger">Убрать из списка</button></div>',null,m=>{
    m.querySelector('#sbw-dest-rename').onclick=()=>renameRows([destTarget(d)],'Название назначения','title',title);
    m.querySelector('#sbw-dest-hide').onclick=()=>commitDialog('Убрать «'+title+'»?', '<p>Будут скрыты это назначение и его позиции: '+S.rows.filter(r=>r.dk===d).length+'. Документы и оплата сохранятся. Вернуть можно через «Убранное».</p>',[destTarget(d)],{hidden:true},'Убрать из списка');
  });}
  function destinationsDialog(){const dests=[...new Set(S.rows.map(r=>r.dk))];const m=modal('Куда закупаем',dests.map(d=>'<button type="button" data-edit-dest="'+E(d)+'" class="sbw-dest-option">'+E(destName(d,S.rows.find(r=>r.dk===d)))+icon('pencil')+'</button>').join('')||'<p>Назначений нет</p>');m.querySelectorAll('[data-edit-dest]').forEach(b=>b.onclick=()=>destinationDialog(b.dataset.editDest));}
  function showArchive(){const entries=Object.values(((S.board||{}).entries)||{}).filter(e=>e.hidden);const m=modal('Убранное из списка',entries.map(e=>'<div class="sbw-archive-row"><div><b>'+E(e.title||e.source_label||e.key)+'</b><small>'+E(e.key.startsWith('d:')?'Назначение':'Позиция · история сохранена')+'</small></div><button type="button" data-restore="'+E(e.key)+'" '+(!allowed()?'disabled':'')+'>Вернуть</button></div>').join('')||'<p>Убранных позиций нет.</p>');
    m.querySelectorAll('[data-restore]').forEach(b=>b.onclick=async()=>{const e=entries.find(x=>x.key===b.dataset.restore);try{await save([{key:e.key,board_revision:e.revision}],{hidden:false},b);m.close();showArchive();}catch(err){error(err);}});
  }
  function draftDialog(rows){if(!rows.length)return;if(rows.some(r=>r.stage!=='buy')){modal('Подготовка заказа','<p>Выберите только позиции «Купить». Уже оформленные заказы повторно не добавляются.</p>');return;}if(rows.some(r=>!r.supplier_id)){supplierDialog(rows);return;}
    const m=modal('Подготовить заказ','<p>Выбрано '+rows.length+' позиций. Разные поставщики, группы и сроки попадут в отдельные черновики. Отправка поставщику — отдельное действие в карточке заказа.</p>'+rows.map(r=>'<div class="sbw-preview-line"><span>'+E(r.title)+'<small>'+E(r.supplier)+' · '+E(r.group_name)+'</small></span><b>'+E(r.qty)+'</b></div>').join(''),'<button type="button" data-close>Отмена</button><button type="button" id="sbw-draft-save" class="primary">Создать черновики</button>');
    m.querySelector('#sbw-draft-save').onclick=async ev=>{try{const result=await post('/api/supply/board/drafts',{targets:targets(rows)},ev.currentTarget);selected.clear();m.close();await root.loadSupplyShopping();const done=modal('Черновики созданы',(result.orders||[]).map(o=>'<button type="button" class="sbw-dest-option" data-open-order="'+o.id+'">'+E(o.order_label)+' · '+o.items_count+' позиций '+icon('chevron-right')+'</button>').join(''));done.querySelectorAll('[data-open-order]').forEach(b=>b.onclick=()=>{done.close();root.openSupplyOrder(Number(b.dataset.openOrder));});}catch(e){error(e);}};
  }
  const api={decorateRows,targets,supplierTargets,render,badge,clearSelection:()=>selected.clear(),fmtDate};
  root.SupplyBoard=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
