/* Dairy manufacturers — server-backed records; campaigns require an explicit launch. */
var _prospects = { page: 1, request: 0, detailRequest: 0, current: null, dict: null, file: null, preview: false, view: 'table', direction: 'chillers', rows: [] };
var PROSPECT_DIRECTIONS = {chillers:'Чиллеры', cheese:'Сыроварни', dairy:'Молочные заводы'};
var PROSPECT_LABELS = { direction: 'Направление', next_time: 'Время (Екатеринбург)', annual_units: 'Подтверждённая потребность, шт./год', close_reason: 'Причина переноса / отказа', stage: 'Этап', owner: 'Ответственный', contact_person: 'Контактный специалист',
  contact_role: 'Должность', need: 'Задача клиента', next_action: 'Следующий шаг', next_date: 'Дата контакта',
  consent: 'Согласие на рассылку', consent_basis: 'Основание согласия', consent_date: 'Дата согласия',
  comment: 'Заметки', qualification: 'Профиль производства', email: 'Email', phone: 'Телефон', site: 'Сайт' };
var PROSPECT_QUALIFICATIONS = { unknown: 'Ещё не уточнён', cheese: 'Выпускает выдержанные сыры',
  milk: 'Молочная продукция / другой ассортимент', inactive: 'Не действует' };

function prospectsEscape(value) { return escapeHtml(String(value == null ? '' : value)); }
function prospectsUrl(value) {
  try { const u = new URL(String(value || '').trim()); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; }
  catch (_) { return ''; }
}
function prospectsLinks(value) {
  return (String(value || '').match(/https?:\/\/[^\s;|]+/g) || []).map(function (raw) {
    const url = prospectsUrl(raw); return url ? '<a href="' + prospectsEscape(url) + '" target="_blank" rel="noopener noreferrer">' + prospectsEscape(raw) + '</a>' : '';
  }).join('<br>');
}
function prospectsDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.slice(8) + '.' + value.slice(5, 7) + '.' + value.slice(0, 4) : (value || '—');
}
function prospectsOptions(dict, value, empty) {
  return (empty !== undefined ? '<option value="">' + prospectsEscape(empty) + '</option>' : '') +
    Object.keys(dict || {}).map(function (k) { return '<option value="' + prospectsEscape(k) + '"' + (k === value ? ' selected' : '') + '>' + prospectsEscape(dict[k]) + '</option>'; }).join('');
}
function prospectsFilter() { _prospects.page = 1; loadProspects(); }
function prospectsSearch() { clearTimeout(_prospects.searchTimer); _prospects.searchTimer = setTimeout(prospectsFilter, 300); }
function prospectsPage(delta) { _prospects.page += delta; loadProspects(); }
function prospectsReset() {
  document.querySelectorAll('#prospects-filters input,#prospects-filters select').forEach(function (el) { el.value = ''; });
  prospectsFilter();
}

async function loadProspects() {
  const root = document.getElementById('prospects-list'); if (!root) return;
  const seq = ++_prospects.request;
  const params = new URLSearchParams({ page: _prospects.page });
  if (_prospects.direction) params.set('direction', _prospects.direction);
  document.querySelectorAll('#prospects-filters [data-filter]').forEach(function (el) { if (el.value) params.set(el.dataset.filter, el.value); });
  root.setAttribute('aria-busy', 'true');
  const importButton = document.getElementById('prospects-import-button');
  if (importButton) importButton.hidden = !canManageSales();
  const campaignToolbar = document.getElementById('campaigns-selection-toolbar');
  if (campaignToolbar) campaignToolbar.hidden = !canManageSales();
  try {
    const result = await apiGet('/api/sales/prospects?' + params.toString());
    if (seq !== _prospects.request) return;
    _prospects.dict = result; _prospects.page = result.page; _prospects.rows = result.rows;
    const newButton = document.getElementById('prospects-new-button'); if (newButton) newButton.hidden = !canManageSales();
    const s = result.stats;
    document.getElementById('prospects-kpis').innerHTML = [[s.total, 'производств'], [s.email || 0, 'с почтой'], [s.phone || 0, 'с телефоном'], [s.working || 0, 'в работе'], [s.due || 0, 'контакт сегодня / просрочен']].map(function (v) {
      return '<div class="prospect-kpi"><b>' + prospectsEscape(Number(v[0]).toLocaleString('ru-RU')) + '</b><span>' + v[1] + '</span></div>';
    }).join('');
    ['segment', 'region', 'owner', 'stage'].forEach(function (key) {
      const el = document.querySelector('#prospects-filters [data-filter="' + key + '"]');
      const value = el.value;
      const dict = key === 'stage' ? result.stages : Object.fromEntries(result.facets[key].map(function (v) { return [v, v]; }));
      el.innerHTML = prospectsOptions(dict, value, el.dataset.empty);
    });
    document.getElementById('prospects-count').textContent = 'Найдено: ' + result.total.toLocaleString('ru-RU');
    if (_prospects.view === 'board') prospectsRenderBoard(result);
    else if (!result.rows.length) root.innerHTML = '<div class="empty-block">По этим условиям производств нет. Измените фильтры.</div>';
    else root.innerHTML = '<div class="prospect-table-wrap"><table class="prospect-table"><thead><tr>' + (canManageSales() ? '<th>Выбор</th>' : '') + '<th>Производство</th><th>Контакты</th><th>Этап / ответственный</th><th>Следующий шаг</th></tr></thead><tbody>' +
      result.rows.map(function (r) {
        const site = prospectsUrl(r.site); const firstPhone = (r.phone || '').split(';')[0].trim();
        return '<tr>' + (canManageSales() ? '<td><input class="campaign-select" type="checkbox" data-campaign-select="' + r.id + '" aria-label="Выбрать ' + prospectsEscape(r.name) + '"' + (typeof _campaigns !== 'undefined' && _campaigns.selected.has(r.id) ? ' checked' : '') + ' onchange="campaignsToggle(\'' + r.id + '\',this.checked)"></td>' : '') + '<td><button class="prospect-name" onclick="prospectsOpen(\'' + r.id + '\')">' + prospectsEscape(r.name) + '</button>' +
          '<div class="prospect-meta">' + prospectsEscape(r.segment) + (r.priority ? ' · Приоритет ' + prospectsEscape(r.priority) : '') + '</div><div class="prospect-meta">' + prospectsEscape([r.region, r.city].filter(Boolean).join(' · ')) + '</div></td>' +
          '<td><div>' + (r.email ? prospectsEscape(r.email) : '<span class="prospect-missing">Почта не найдена</span>') + '</div><div>' +
          (/^\+\d{11,15}$/.test(firstPhone) ? '<a href="tel:' + firstPhone + '">' + prospectsEscape(firstPhone) + '</a>' : prospectsEscape(firstPhone || 'Телефон не найден')) + '</div>' +
          (site ? '<a href="' + prospectsEscape(site) + '" target="_blank" rel="noopener noreferrer">Сайт ↗</a>' : '') +
          '<div class="prospect-meta">' + prospectsEscape(r.verification) + '</div></td>' +
          '<td><span class="prospect-stage">' + prospectsEscape(result.stages[r.stage] || r.stage) + '</span><div class="prospect-meta">' + prospectsEscape(r.owner || 'Не назначен') + '</div></td>' +
          '<td><div>' + prospectsEscape(r.next_action || 'Уточнить профиль и нужного специалиста') + '</div><div class="prospect-meta">' + prospectsEscape(prospectsDate(r.next_date) + ' ' + (r.next_time || '')) + '</div></td></tr>';
      }).join('') + '</tbody></table></div>';
    document.getElementById('prospects-pagination').innerHTML = '<button class="btn btn-secondary" onclick="prospectsPage(-1)"' + (result.page <= 1 ? ' disabled' : '') + '>← Назад</button><span>' + result.page + ' / ' + result.pages + '</span><button class="btn btn-secondary" onclick="prospectsPage(1)"' + (result.page >= result.pages ? ' disabled' : '') + '>Далее →</button>';
  } catch (e) {
    if (seq === _prospects.request) root.innerHTML = '<div class="empty-block">' + prospectsEscape(e.message || 'Не удалось загрузить базу') + '<br><button class="btn btn-secondary" onclick="loadProspects()">Повторить</button></div>';
  } finally { if (seq === _prospects.request) root.removeAttribute('aria-busy'); }
}

function prospectsClose() {
  ++_prospects.detailRequest; _prospects.current = null;
  document.getElementById('prospects-detail').hidden = true;
  document.getElementById('prospects-overview').hidden = false;
  document.querySelector('.prospects').classList.remove('prospect-split');
}
function prospectsField(key, value, options, area) {
  const id = 'prospect-field-' + key;
  let control;
  if (options) control = '<select id="' + id + '">' + prospectsOptions(options, value) + '</select>';
  else if (area) control = '<textarea id="' + id + '" rows="3" maxlength="5000">' + prospectsEscape(value) + '</textarea>';
  else control = '<input id="' + id + '" type="' + (key === 'next_time' ? 'time' : key.endsWith('_date') ? 'date' : 'text') + '" maxlength="5000" value="' + prospectsEscape(value) + '">';
  return '<label class="prospect-field' + (area ? ' wide' : '') + '"><span>' + PROSPECT_LABELS[key] + '</span>' + control + '</label>';
}
async function prospectsOpen(id) {
  const seq = ++_prospects.detailRequest;
  const root = document.getElementById('prospects-detail');
  document.getElementById('prospects-overview').hidden = false; root.hidden = false;
  document.querySelector('.prospects').classList.add('prospect-split');
  root.innerHTML = '<button class="btn btn-secondary" onclick="prospectsClose()">← К базе</button><div class="loading-block">Загружаем карточку…</div>';
  try {
    const r = await apiGet('/api/sales/prospects/' + encodeURIComponent(id));
    if (seq !== _prospects.detailRequest) return;
    _prospects.current = r;
    const source = r.source_data || {}, dict = _prospects.dict;
    if (!dict) throw new Error('Сначала загрузите список производств');
    const sources = ['source', 'email_source', 'phone_source', 'site_pages'].map(function (k) { return source[k] || ''; }).join(' ');
    const urls = [...new Set(sources.match(/https?:\/\/[^\s;|]+/g) || [])];
    root.innerHTML = '<button class="btn btn-secondary" onclick="prospectsClose()">← К базе</button>' +
      '<div class="prospect-detail-heading"><h2>' + prospectsEscape(r.name) + '</h2><p>' + prospectsEscape([r.segment, r.region, r.city].filter(Boolean).join(' · ')) + '</p><p>' + prospectsEscape(r.address || 'Адрес не найден') + '</p>' +
      (r.inn ? '<p>ИНН: ' + prospectsEscape(r.inn) + '</p>' : '') + '</div>' +
      '<div class="prospect-toolbar"><span>' + prospectsEscape(r.phone || 'Телефон не указан') + '</span><span>' + prospectsEscape(r.email || 'Почта не указана') + '</span></div>' +
      '<div class="prospect-note">' + (r.direction === 'chillers' ? 'Чиллеры 1,5–50 кВт: вода от +5 °C, пропиленгликоль от −10 °C. Холодопроизводительность уточняется при рабочем режиме.' : 'Климатическое оборудование под продукт, помещение и загрузку.') + '</div>' +
      '<div class="prospect-toolbar"><button class="btn btn-secondary" onclick="prospectsOffer()"' + (!canManageSales() ? ' disabled' : '') + '>Создать КП</button></div>' +
      '<form id="prospect-form" onsubmit="prospectsSave(event)"><fieldset' + (!canManageSales() ? ' disabled' : '') + '><div class="prospect-fields">' +
      prospectsField('stage', r.stage, dict.stages) + prospectsField('owner', r.owner) +
      prospectsField('direction', r.direction || 'dairy', PROSPECT_DIRECTIONS) + prospectsField('annual_units', r.annual_units) +
      prospectsField('next_action', r.next_action) + prospectsField('next_date', r.next_date) + prospectsField('next_time', r.next_time) +
      prospectsField('close_reason', r.close_reason) + '</div>' +
      '<label class="prospect-field prospect-comment"><span>Новый комментарий / результат звонка</span><textarea id="prospect-note" rows="4" maxlength="5000" placeholder="С кем говорили, что обсудили, о чём договорились…"></textarea></label>' +
      '<div class="prospect-save-row"><button class="btn btn-primary" type="submit" id="prospect-save">Сохранить результат</button><span id="prospect-save-result" role="status"></span></div>' +
      '<details class="prospect-source"><summary>Контакты и дополнительные сведения</summary><div class="prospect-fields">' +
      prospectsField('contact_person', r.contact_person) + prospectsField('contact_role', r.contact_role) +
      prospectsField('email', r.email) + prospectsField('phone', r.phone) + prospectsField('site', r.site) +
      prospectsField('qualification', r.qualification, PROSPECT_QUALIFICATIONS) + prospectsField('need', r.need, null, true) +
      prospectsField('comment', r.comment, null, true) + prospectsField('consent', r.consent, dict.consents) +
      prospectsField('consent_date', r.consent_date) + prospectsField('consent_basis', r.consent_basis, null, true) +
      '</div><h4>Другие сотрудники предприятия</h4><div id="prospect-contacts">' + prospectsContacts(r.contacts_json) +
      '</div><button type="button" class="btn btn-secondary" onclick="prospectsAddContact()">+ Контакт</button></details></fieldset></form>' +
      '<div class="prospect-source"><h3>История комментариев и изменений</h3><div id="prospect-events">' + prospectsHistory(r.events, dict) +
      '</div><button class="btn btn-secondary" id="prospect-more-history" onclick="prospectsMoreHistory()"' + (r.events.length >= r.events_total ? ' hidden' : '') + '>Показать ещё</button></div>' +
      '<details class="prospect-source" open><summary>Анализ и вопросы для звонка</summary><dl>' +
      [['Факты',source.fact],['Применение — гипотеза',source.use],['Подбор',source.fit],['Серийность — оценка',source.repeat],['Барьеры',source.risk],['Кого попросить',source.role],['Вопрос',source.ask],['Следующий шаг',source.next],['Маршрут',source.route]].map(function(v){return '<dt>'+v[0]+'</dt><dd>'+prospectsEscape(v[1] || '—')+'</dd>';}).join('') + '</dl></details>' +
      '<details class="prospect-source"><summary>Источники и исходные контакты</summary><dl>' +
      [['Проверка', source.verification], ['Дата сбора', prospectsDate(source.checked)], ['Исходный email', source.email_raw || source.email],
       ['Исходный телефон', source.phone_raw || source.phone], ['Email со страницы сайта', source.site_emails], ['Примечание', source.notes],
       ['Тип адреса', source.address_type || 'Как указан в источнике'], ['Период данных источника', source.origin_period || 'Не указан']].map(function (v) { return '<dt>' + v[0] + '</dt><dd>' + prospectsEscape(v[1] || '—') + '</dd>'; }).join('') +
      '</dl><div class="prospect-source-links">' + urls.map(prospectsLinks).join('<br>') + '</div></details>' +
      (r.contractors.length ? '<div class="prospect-source"><b>Контрагенты с тем же ИНН</b>' + r.contractors.map(function (c) { return '<p><button class="prospect-name" onclick="prospectsContractor(' + Number(c.id) + ')">' + prospectsEscape(c.name) + '</button> ' + prospectsEscape(c.address || '') + '</p>'; }).join('') + '</div>' : '') +
      '<div id="prospect-campaign-history"></div>';
    if (typeof campaignsLoadHistory === 'function') campaignsLoadHistory(id, seq);
  } catch (e) { if (seq === _prospects.detailRequest) root.innerHTML = '<button class="btn btn-secondary" onclick="prospectsClose()">← К базе</button><p>' + prospectsEscape(e.message) + '</p>'; }
}
async function prospectsSave(event) {
  event.preventDefault(); if (!_prospects.current || !canManageSales()) return;
  const button = document.getElementById('prospect-save'), result = document.getElementById('prospect-save-result');
  const id = _prospects.current.id;
  const body = { revision: _prospects.current.revision };
  Object.keys(PROSPECT_LABELS).forEach(function (k) { body[k] = document.getElementById('prospect-field-' + k).value; });
  body.note = document.getElementById('prospect-note').value;
  body.contacts_json = JSON.stringify(prospectsReadContacts());
  button.disabled = true; result.textContent = 'Сохраняем…';
  try {
    await apiPatch('/api/sales/prospects/' + encodeURIComponent(id), body);
    showToast('Карточка сохранена', 'success');
    await loadProspects();
    if (_prospects.current && _prospects.current.id === id) await prospectsOpen(id);
  } catch (e) { result.textContent = e.message || 'Не удалось сохранить'; button.disabled = false; }
}

function prospectsChooseImport(input) { _prospects.file = input.files[0] || null; _prospects.preview = false; document.getElementById('prospects-import-result').textContent = ''; document.getElementById('prospects-import-apply').hidden = true; }
function prospectsShowImport() {
  if (!canManageSales()) return;
  prospectsClose();
  document.getElementById('prospects-import-panel').hidden = false;
}
async function prospectsContractor(id) {
  try {
    const row = await apiGet('/api/contractors/' + id);
    cache.contractors = (cache.contractors || []).filter(function (c) { return c.id !== id; });
    cache.contractors.push(row);
    openContractor(id);
  } catch (e) { showToast(e.message || 'Не удалось открыть контрагента', 'error'); }
}
async function prospectsImport(preview) {
  const output = document.getElementById('prospects-import-result');
  const file = _prospects.file;
  if (!file || file.size > 5 * 1024 * 1024) { output.textContent = 'Выберите XLSX до 5 МБ'; return; }
  if (!preview && !_prospects.preview) return;
  const buttons = document.querySelectorAll('#prospects-import-panel button'); buttons.forEach(function (b) { b.disabled = true; });
  output.textContent = preview ? 'Проверяем файл…' : 'Загружаем базу…';
  try {
    const form = new FormData(); form.append('file', file);
    const token = localStorage.getItem(TOKEN_KEY);
    const response = await fetch(API_BASE + '/api/sales/prospects/import' + (preview ? '?preview=1' : ''), { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
    const r = await response.json(); if (!response.ok) throw new Error(r.message || 'Не удалось загрузить файл');
    if (_prospects.file !== file) return;
    _prospects.preview = preview;
    output.textContent = (preview ? 'Будет добавлено: ' : 'Добавлено: ') + r.added + '. Уже есть в базе: ' + r.skipped + '. Всего в файле: ' + r.received + '.';
    document.getElementById('prospects-import-apply').hidden = !preview || !r.added;
    if (!preview) { await loadProspects(); showToast('Импорт завершён', 'success'); }
  } catch (e) { _prospects.preview = false; document.getElementById('prospects-import-apply').hidden = true; output.textContent = e.message || 'Не удалось прочитать ответ сервера'; }
  finally { buttons.forEach(function (b) { b.disabled = false; }); }
}

function prospectsDirection(value) {
  _prospects.direction = value; _prospects.page = 1; prospectsClose();
  document.querySelectorAll('[data-direction]').forEach(function(b){b.className='btn '+(b.dataset.direction===value?'btn-primary':'btn-secondary');});
  if (typeof campaignsClearSelection === 'function') campaignsClearSelection();
  loadProspects();
}
function prospectsView(view) { _prospects.view = view; loadProspects(); }
function prospectsDue(value) { document.querySelector('[data-filter="due"]').value=value; prospectsFilter(); }
function prospectsRenderBoard(result) {
  const stages = ['new','checking','contact','needs','brief','offer','negotiation','pilot','won','partner','later','closed'];
  document.getElementById('prospects-list').innerHTML = '<p class="prospect-meta">Доска показывает текущую страницу: ' + result.rows.length + ' из ' + result.total + '. Перенесите карточку или откройте её и выберите этап.</p><div class="prospect-board">' + stages.filter(function(s){return result.stages[s];}).map(function(stage){
    const rows=result.rows.filter(function(r){return r.stage===stage;});
    return '<section class="prospect-lane" data-stage="'+stage+'" ondragover="event.preventDefault()" ondrop="prospectsDrop(event,\''+stage+'\')"><h3>'+prospectsEscape(result.stages[stage])+' <span>'+rows.length+'</span></h3>'+rows.map(function(r){
      return '<button class="prospect-board-card" draggable="'+canManageSales()+'" ondragstart="event.dataTransfer.setData(\'text/plain\',\''+r.id+'\')" onclick="prospectsOpen(\''+r.id+'\')"><strong>'+prospectsEscape(r.name)+'</strong><span>'+prospectsEscape(r.city||r.region)+'</span><span>'+prospectsEscape(r.owner||'Ответственный не назначен')+'</span><span>'+prospectsEscape(r.next_action||'Нет следующего действия')+'</span><small>'+prospectsEscape(prospectsDate(r.next_date))+'</small></button>';
    }).join('')+'</section>';
  }).join('')+'</div>';
}
async function prospectsDrop(event,stage) {
  event.preventDefault(); if (!canManageSales() || _prospects.moving) return;
  const id=event.dataTransfer.getData('text/plain');const row=_prospects.rows.find(function(r){return r.id===id;});
  if(!row||row.stage===stage)return;
  if(stage==='closed'||stage==='later'){await prospectsOpen(id);document.getElementById('prospect-field-stage').value=stage;document.getElementById('prospect-field-close_reason').focus();showToast('Укажите причину и сохраните карточку','info');return;}
  _prospects.moving=true;
  try {await apiPatch('/api/sales/prospects/'+encodeURIComponent(id),{revision:row.revision,stage:stage});await loadProspects();if(_prospects.current&&_prospects.current.id===id)await prospectsOpen(id);}
  catch(e){showToast(e.message||'Перенос не сохранён','error');}
  finally{_prospects.moving=false;}
}
function prospectsHistory(events,dict) {
  if(!events.length)return '<p class="prospect-meta">Комментариев пока нет. Запишите результат первого звонка.</p>';
  return events.map(function(ev){
    let changes={};try{changes=JSON.parse(ev.changes_json);}catch(_){}
    const when=new Date(ev.created_at.replace(' ','T')+'Z');
    return '<article class="prospect-event"><small>'+prospectsEscape(isNaN(when)?ev.created_at:when.toLocaleString('ru-RU',{timeZone:'Asia/Yekaterinburg'}))+' · '+prospectsEscape(ev.actor_name||('Сотрудник #'+ev.actor))+'</small>'+Object.keys(changes).map(function(key){
      const value=changes[key].to;const label=key==='stage'?dict.stages[value]:key==='direction'?PROSPECT_DIRECTIONS[value]:key==='consent'?dict.consents[value]:key==='contacts_json'?'Список контактов обновлён':value;
      return '<p>'+(key==='note'?'':'<b>'+prospectsEscape(PROSPECT_LABELS[key]||key)+': </b>')+prospectsEscape(label||'—').replace(/\n/g,'<br>')+'</p>';
    }).join('')+'</article>';
  }).join('');
}
async function prospectsMoreHistory() {
  const row=_prospects.current;if(!row||!row.events.length)return;const button=document.getElementById('prospect-more-history');button.disabled=true;
  try{const r=await apiGet('/api/sales/prospects/'+encodeURIComponent(row.id)+'/history?before='+row.events[row.events.length-1].id);if(_prospects.current!==row)return;
    row.events.push.apply(row.events,r.events);document.getElementById('prospect-events').innerHTML=prospectsHistory(row.events,_prospects.dict);button.hidden=!r.events.length||row.events.length>=row.events_total;
  }catch(e){showToast(e.message,'error');}finally{button.disabled=false;}
}
function prospectsContactFields(c) {return '<div class="prospect-extra-contact">'+[['name','ФИО'],['role','Должность'],['phone','Телефон'],['email','Почта']].map(function(pair){return '<label>'+pair[1]+'<input data-contact="'+pair[0]+'" maxlength="500" value="'+prospectsEscape(c[pair[0]]||'')+'"></label>';}).join('')+'<button type="button" class="btn btn-secondary" onclick="this.parentElement.remove()">Удалить контакт</button></div>';}
function prospectsContacts(raw) {let rows=[];try{rows=JSON.parse(raw||'[]');}catch(_){}return rows.map(prospectsContactFields).join('');}
function prospectsAddContact(){const root=document.getElementById('prospect-contacts');if(root.children.length>=20){showToast('Не более 20 контактов','error');return;}root.insertAdjacentHTML('beforeend',prospectsContactFields({}));}
function prospectsReadContacts(){return Array.from(document.querySelectorAll('.prospect-extra-contact')).map(function(el){const c={};el.querySelectorAll('[data-contact]').forEach(function(i){c[i.dataset.contact]=i.value.trim();});return c;}).filter(function(c){return Object.values(c).some(Boolean);});}
function prospectsOffer(){
  if(!_prospects.current||!canManageSales())return;const r=_prospects.current;
  openNewOffer();
  // Respect any existing recovered draft; never silently replace its customer or notes.
  if(state.offerDraftRestored){showToast('Открыт существующий черновик КП. Проверьте заказчика.','info');return;}
  state.offerForm.comment_internal='Предприятие: '+r.name+' ['+r.id+']\n'+[r.contact_person,r.phone,r.email,r.need].filter(Boolean).join('\n');
  if(r.contractors.length===1){state.offerForm.contractor_id=r.contractors[0].id;state.offerForm.contractor_name=r.contractors[0].name;state.offerForm.contractor_inn=r.inn;}
  renderOfferForm();
}
function prospectsNew(){
  if(!canManageSales())return;prospectsClose();const root=document.getElementById('prospects-detail');root.hidden=false;document.querySelector('.prospects').classList.add('prospect-split');
  root.innerHTML='<button class="btn btn-secondary" onclick="prospectsClose()">Закрыть</button><h2>Новое предприятие</h2><form onsubmit="prospectsCreate(event)"><div class="prospect-fields">'+[['name','Название *'],['city','Город'],['region','Регион'],['segment','Отрасль'],['phone','Телефон'],['email','Почта'],['site','Сайт'],['inn','ИНН'],['address','Адрес площадки']].map(function(p){return '<label class="prospect-field">'+p[1]+'<input name="'+p[0]+'" maxlength="500"'+(p[0]==='name'?' required':'')+'></label>';}).join('')+'<label class="prospect-field">Направление<select name="direction">'+prospectsOptions(PROSPECT_DIRECTIONS,_prospects.direction||'chillers')+'</select></label></div><div class="prospect-save-row"><button class="btn btn-primary" type="submit">Создать</button><span role="status"></span></div></form>';
}
async function prospectsCreate(event){event.preventDefault();const form=event.target,button=form.querySelector('button[type=submit]'),output=form.querySelector('[role=status]');button.disabled=true;
  const body=Object.fromEntries(new FormData(form).entries());
  try{const r=await apiPost('/api/sales/prospects',body);_prospects.direction=body.direction;await loadProspects();await prospectsOpen(r.id);showToast(r.added?'Предприятие добавлено':'Такая карточка уже есть','success');}
  catch(e){output.textContent=e.message;button.disabled=false;}
}

/* v2026-10-02: защита create task от двойного клика / таймаута */
(function () {
  var s = document.createElement('script');
  s.src = '/task-form-guard.js';
  s.async = false;
  document.head.appendChild(s);
})();
