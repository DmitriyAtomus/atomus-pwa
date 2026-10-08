/* Dairy manufacturers — server-backed records; campaigns require an explicit launch. */
var _prospects = { page: 1, request: 0, detailRequest: 0, current: null, total: 0, pages: 1, dirty: new Set(), drawerOpen: false, openingId: null, navAnchor: -1, pendingOpen: null, pushedHash: false, dict: null, file: null, preview: false, view: 'table', direction: 'chillers', rows: [] };
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
/* v2.46.251: телефоны РФ в любом формате → tel:+7XXXXXXXXXX; звонки и быстрые действия. */
var PROSPECT_CALL_RESULTS = { reached: 'Дозвонился', no_answer: 'Не дозвонился', callback: 'Перезвонить' };
var PROSPECT_CALL_ICONS = { reached: 'ti-phone-check', no_answer: 'ti-phone-x', callback: 'ti-phone-call' };
function prospectsTel(raw) {
  const text = String(raw || '').replace(/\s*(?:доб|вн|ext|x)\.?\s*\d.*$/i, '').trim();
  let d = text.replace(/\D/g, '');
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return '+7' + d.slice(1);
  if (d.length === 10 && /^[3489]/.test(d)) return '+7' + d;
  if (text[0] === '+' && d.length >= 11 && d.length <= 15) return '+' + d;
  return '';
}
function prospectsPhones(raw) {
  return String(raw || '').split(/[;,\n]+|\s\/\s/).map(function (v) { return v.trim(); }).filter(Boolean)
    .map(function (v) { return { raw: v, tel: prospectsTel(v) }; });
}
function prospectsPhoneLinks(raw, limit) {
  const list = prospectsPhones(raw);
  const shown = limit ? list.slice(0, limit) : list;
  return shown.map(function (p) {
    return p.tel ? '<a class="prospect-tel" href="tel:' + p.tel + '" onclick="event.stopPropagation()"><i class="ti ti-phone"></i> ' + prospectsEscape(p.raw) + '</a>' : prospectsEscape(p.raw);
  }).join('<br>') + (limit && list.length > limit ? '<div class="prospect-meta">ещё ' + (list.length - limit) + '</div>' : '');
}
function prospectsTomorrow() {
  const now = new Date(Date.now() + 5 * 3600 * 1000 + 24 * 3600 * 1000);  // Екатеринбург, UTC+5
  return now.toISOString().slice(0, 10);
}
function prospectsCallBox(id, scope) {
  const k = scope + '-' + id;
  return '<div class="prospect-callbox" data-call-scope="' + prospectsEscape(k) + '">' +
    '<textarea id="prospect-call-note-' + prospectsEscape(k) + '" rows="2" maxlength="5000" placeholder="Комментарий к звонку (необязательно)"></textarea>' +
    '<div class="prospect-call-buttons">' + Object.keys(PROSPECT_CALL_RESULTS).map(function (r) {
      return '<button type="button" class="btn btn-secondary prospect-call-' + r + '" onclick="prospectsCallResult(\'' + prospectsEscape(id) + '\',\'' + scope + '\',\'' + r + '\')"><i class="ti ' + PROSPECT_CALL_ICONS[r] + '"></i> ' + PROSPECT_CALL_RESULTS[r] + '</button>';
    }).join('') + '</div>' +
    '<div class="prospect-callback" id="prospect-callback-' + prospectsEscape(k) + '" hidden><label>Когда перезвонить<input type="date" id="prospect-callback-date-' + prospectsEscape(k) + '"></label>' +
    '<label>Время<input type="time" id="prospect-callback-time-' + prospectsEscape(k) + '" value="10:00"></label>' +
    '<button type="button" class="btn btn-primary" onclick="prospectsCallSubmit(\'' + prospectsEscape(id) + '\',\'' + scope + '\',\'callback\')">Сохранить перезвон</button></div>' +
    '<span class="prospect-meta" id="prospect-call-status-' + prospectsEscape(k) + '" role="status"></span></div>';
}
function prospectsRevisionOf(id) {
  if (_prospects.current && _prospects.current.id === id) return _prospects.current.revision;
  const row = (_prospects.rows || []).find(function (r) { return r.id === id; });
  return row ? row.revision : undefined;
}
function prospectsCallResult(id, scope, result) {
  if (!canManageSales()) return;
  if (result === 'callback') {
    const k = scope + '-' + id, box = document.getElementById('prospect-callback-' + k);
    const dateEl = document.getElementById('prospect-callback-date-' + k);
    if (dateEl && !dateEl.value) dateEl.value = prospectsTomorrow();
    if (box) box.hidden = false;
    if (dateEl && dateEl.focus) dateEl.focus();
    return;
  }
  return prospectsCallSubmit(id, scope, result);
}
async function prospectsPost(path, body) {
  // apiPost не бросает ошибку, а возвращает {ok,status,data}.
  let res;
  try { res = await apiPost(path, body); }
  catch (e) { if (e && e.name === 'SyntaxError') throw new Error('Сервер ещё не обновлён для записи звонков (нужен бэкенд v2.46.249)'); throw e; }
  if (res && (res.status === 404 || res.status === 405) && !(res.data && res.data.message)) throw new Error('Сервер ещё не обновлён для записи звонков (нужен бэкенд v2.46.249)');
  if (res && typeof res.ok === 'boolean' && Object.prototype.hasOwnProperty.call(res, 'data')) {
    if (!res.ok) { const err = new Error((res.data && res.data.message) || ('HTTP ' + res.status)); err.status = res.status; throw err; }
    return res.data;
  }
  return res;
}
function prospectsConflict(e) { return !!e && (e.status === 409 || /уже изменили/i.test(e.message || '')); }
async function prospectsAfterQuick(id) {
  await loadProspects();
  if (_prospects.current && _prospects.current.id === id) await prospectsOpen(id);
}
async function prospectsCallSubmit(id, scope, result) {
  if (!canManageSales() || _prospects.posting) return;
  const k = scope + '-' + id, status = document.getElementById('prospect-call-status-' + k);
  const revision = prospectsRevisionOf(id);
  if (typeof revision !== 'number') { showToast('Обновите список и попробуйте ещё раз', 'error'); return; }
  const body = { revision: revision, result: result, note: (document.getElementById('prospect-call-note-' + k) || {}).value || '' };
  const first = prospectsPhones((_prospects.current && _prospects.current.id === id ? _prospects.current : (_prospects.rows || []).find(function (r) { return r.id === id; }) || {}).phone)[0];
  if (first) body.phone = first.tel || first.raw;
  if (result === 'callback') {
    body.next_date = (document.getElementById('prospect-callback-date-' + k) || {}).value || '';
    body.next_time = (document.getElementById('prospect-callback-time-' + k) || {}).value || '';
    if (!body.next_date) { if (status) status.textContent = 'Укажите дату, когда перезвонить'; return; }
  }
  _prospects.posting = true; if (status) status.textContent = 'Сохраняем…';
  try {
    await prospectsPost('/api/sales/prospects/' + encodeURIComponent(id) + '/calls', body);
    showToast('Звонок записан: ' + PROSPECT_CALL_RESULTS[result], 'success');
    _prospects.quick = null;
    if (scope === 'card') {
      if (_prospects.dirty) _prospects.dirty.delete('call_note');
      await prospectsRefreshCard(id, result);
      _prospects.posting = false;
      await prospectsAfterCall(id, result);
    } else await prospectsAfterQuick(id);
  } catch (e) {
    if (status) status.textContent = e.message || 'Не удалось записать звонок';
    if (prospectsConflict(e)) {
      showToast('Карточку уже изменили — обновили данные, повторите', 'info');
      if (scope === 'card') await prospectsRefreshCard(id); else await prospectsAfterQuick(id);
    }
  } finally { _prospects.posting = false; }
}
async function prospectsQuickComment(id) {
  if (!canManageSales() || _prospects.posting) return;
  const el = document.getElementById('prospect-quick-note-' + id), status = document.getElementById('prospect-call-status-row-' + id);
  const note = el ? el.value.trim() : '';
  if (!note) { if (status) status.textContent = 'Напишите комментарий'; return; }
  const revision = prospectsRevisionOf(id);
  if (typeof revision !== 'number') return;
  _prospects.posting = true; if (status) status.textContent = 'Сохраняем…';
  try {
    await apiPatch('/api/sales/prospects/' + encodeURIComponent(id), { revision: revision, note: note });
    showToast('Комментарий сохранён', 'success'); _prospects.quick = null;
    await prospectsAfterQuick(id);
  } catch (e) {
    if (status) status.textContent = e.message || 'Не удалось сохранить';
    if (prospectsConflict(e)) { showToast('Карточку уже изменили — обновили данные, повторите', 'info'); await prospectsAfterQuick(id); }
  } finally { _prospects.posting = false; }
}
function prospectsQuick(event, id, mode) {
  if (event && event.stopPropagation) event.stopPropagation();
  if (!canManageSales()) return;
  const same = _prospects.quick && _prospects.quick.id === id && _prospects.quick.mode === mode;
  document.querySelectorAll('.prospect-quick-row').forEach(function (el) { el.remove(); });
  if (same) { _prospects.quick = null; return; }
  _prospects.quick = { id: id, mode: mode };
  const row = document.querySelector('tr[data-prospect-id="' + id + '"]');
  if (!row || !row.insertAdjacentHTML) return;
  const cols = row.children ? row.children.length : 5;
  const inner = mode === 'call' ? prospectsCallBox(id, 'row') :
    '<div class="prospect-callbox"><textarea id="prospect-quick-note-' + prospectsEscape(id) + '" rows="2" maxlength="5000" placeholder="Комментарий: с кем говорили, о чём договорились…"></textarea>' +
    '<div class="prospect-call-buttons"><button type="button" class="btn btn-primary" onclick="prospectsQuickComment(\'' + prospectsEscape(id) + '\')"><i class="ti ti-message"></i> Сохранить комментарий</button></div>' +
    '<span class="prospect-meta" id="prospect-call-status-row-' + prospectsEscape(id) + '" role="status"></span></div>';
  row.insertAdjacentHTML('afterend', '<tr class="prospect-quick-row" onclick="event.stopPropagation()"><td colspan="' + cols + '">' + inner + '</td></tr>');
}
function prospectsRowClick(event, id) {
  const t = event && event.target;
  if (t && t.closest && t.closest('a,button,input,select,textarea,label,.prospect-quick-row')) return;
  prospectsOpen(id);
}
async function prospectsEmployees() {
  if (_prospects.employees) return _prospects.employees;
  try {
    const d = await apiGet('/api/employees/active');
    const list = Array.isArray(d) ? d : (d && (d.employees || d.items)) || [];
    _prospects.employees = list.map(function (e) { return e.short_name || e.full_name || ''; }).filter(Boolean);
  } catch (_) { _prospects.employees = null; }
  return _prospects.employees;
}
function prospectsOwnerControl(value, employees) {
  if (!employees || !employees.length) return prospectsField('owner', value);
  const opts = {}; opts[''] = 'Не назначен';
  employees.forEach(function (n) { opts[n] = n; });
  if (value && !opts[value]) opts[value] = value + ' (из прежней записи)';
  return prospectsField('owner', value || '', opts);
}
function prospectsCallSummary(r) {
  if (!r.calls_count) return '';
  const when = r.last_call_at ? new Date(String(r.last_call_at).replace(' ', 'T') + 'Z') : null;
  return '<span class="prospect-call-summary"><i class="ti ti-phone"></i> Звонков: ' + Number(r.calls_count) +
    (when && !isNaN(when) ? ' · последний ' + prospectsEscape(when.toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) : '') +
    (r.last_call_result ? ' — ' + prospectsEscape(PROSPECT_CALL_RESULTS[r.last_call_result] || r.last_call_result) : '') + '</span>';
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
    _prospects.total = result.total; _prospects.pages = result.pages;
    // Перерисовка таблицы (после звонка/сохранения) не сбрасывает её прокрутку, если выборка та же.
    const listKey = params.toString() + '|' + _prospects.view;
    const oldWrap = root.querySelector ? root.querySelector('.prospect-table-wrap') : null;
    const keepScroll = oldWrap && _prospects.listKey === listKey ? [oldWrap.scrollTop, oldWrap.scrollLeft] : null;
    _prospects.listKey = listKey;
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
    else root.innerHTML = '<div class="prospect-table-wrap"><table class="prospect-table"><thead><tr>' + (canManageSales() ? '<th>Выбор</th>' : '') + '<th>Производство</th><th>Контакты</th><th>Этап / ответственный</th><th>Следующий шаг</th>' + (canManageSales() ? '<th>Действия</th>' : '') + '</tr></thead><tbody>' +
      result.rows.map(function (r) {
        const site = prospectsUrl(r.site); const id = prospectsEscape(r.id);
        return '<tr class="prospect-row" data-prospect-id="' + id + '" onclick="prospectsRowClick(event,\'' + id + '\')" title="Открыть карточку">' + (canManageSales() ? '<td><input class="campaign-select" type="checkbox" data-campaign-select="' + id + '" aria-label="Выбрать ' + prospectsEscape(r.name) + '"' + (typeof _campaigns !== 'undefined' && _campaigns.selected.has(r.id) ? ' checked' : '') + ' onchange="campaignsToggle(\'' + id + '\',this.checked)"></td>' : '') + '<td class="prospect-col-name"><button class="prospect-name" onclick="prospectsOpen(\'' + id + '\')">' + prospectsEscape(r.name) + '</button>' +
          '<div class="prospect-meta">' + prospectsEscape(r.segment) + (r.priority ? ' · Приоритет ' + prospectsEscape(r.priority) : '') + '</div><div class="prospect-meta">' + prospectsEscape([r.region, r.city].filter(Boolean).join(' · ')) + '</div></td>' +
          '<td><div>' + (r.email ? prospectsEscape(r.email) : '<span class="prospect-missing">Почта не найдена</span>') + '</div><div>' +
          (r.phone ? prospectsPhoneLinks(r.phone, 2) : '<span class="prospect-missing">Телефон не найден</span>') + '</div>' +
          (site ? '<a href="' + prospectsEscape(site) + '" target="_blank" rel="noopener noreferrer">Сайт ↗</a>' : '') +
          '<div class="prospect-meta">' + prospectsEscape(r.verification) + '</div></td>' +
          '<td><span class="prospect-stage">' + prospectsEscape(result.stages[r.stage] || r.stage) + '</span><div class="prospect-meta">' + prospectsEscape(r.owner || 'Не назначен') + '</div>' + (r.calls_count ? '<div class="prospect-meta">' + prospectsCallSummary(r) + '</div>' : '') + '</td>' +
          '<td><div>' + prospectsEscape(r.next_action || 'Уточнить профиль и нужного специалиста') + '</div><div class="prospect-meta">' + prospectsEscape(prospectsDate(r.next_date) + ' ' + (r.next_time || '')) + '</div></td>' +
          (canManageSales() ? '<td class="prospect-actions"><button class="icon-btn" title="Записать звонок" aria-label="Записать звонок" onclick="prospectsQuick(event,\'' + id + '\',\'call\')"><i class="ti ti-phone"></i></button><button class="icon-btn" title="Комментарий" aria-label="Комментарий" onclick="prospectsQuick(event,\'' + id + '\',\'comment\')"><i class="ti ti-message"></i></button></td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div>';
    if (keepScroll && root.querySelector) { const w = root.querySelector('.prospect-table-wrap'); if (w) { w.scrollTop = keepScroll[0]; w.scrollLeft = keepScroll[1]; } }
    if (_prospects.drawerOpen) prospectsRenderNav();
    if (_prospects.pendingOpen) { const pending = _prospects.pendingOpen; _prospects.pendingOpen = null; prospectsOpen(pending, { fromHash: true }); }
    document.getElementById('prospects-pagination').innerHTML = '<button class="btn btn-secondary" onclick="prospectsPage(-1)"' + (result.page <= 1 ? ' disabled' : '') + '>← Назад</button><span>' + result.page + ' / ' + result.pages + '</span><button class="btn btn-secondary" onclick="prospectsPage(1)"' + (result.page >= result.pages ? ' disabled' : '') + '>Далее →</button>';
  } catch (e) {
    if (seq === _prospects.request) root.innerHTML = '<div class="empty-block">' + prospectsEscape(e.message || 'Не удалось загрузить базу') + '<br><button class="btn btn-secondary" onclick="loadProspects()">Повторить</button></div>';
  } finally { if (seq === _prospects.request) root.removeAttribute('aria-busy'); }
}

/* ===== v2.46.252: карточка поверх таблицы, ←/→ по выборке, ссылка #prospects/<id>, защита несохранённого ===== */
var PROSPECT_HASH_RE = /^#prospects\/([^\/?#]+)$/;
var PROSPECT_PER_PAGE = 50;
function prospectsHashId(hash) {
  const m = PROSPECT_HASH_RE.exec(String(hash || ''));
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch (_) { return ''; }
}
function prospectsHashFor(id) { return '#prospects/' + encodeURIComponent(id); }
// Соседи в текущей (отфильтрованной и отсортированной сервером) выдаче. anchor — прежнее место карточки,
// если после звонка она выпала из выборки (например, «Перезвонить» убрал её из «На сегодня»).
function prospectsNavInfo(rows, id, anchor, page, total, perPage) {
  rows = rows || []; perPage = perPage || PROSPECT_PER_PAGE; page = Math.max(1, page || 1);
  total = typeof total === 'number' ? total : rows.length;
  const base = (page - 1) * perPage, more = base + rows.length < total;
  let index = -1;
  for (let i = 0; i < rows.length; i++) if (rows[i].id === id) { index = i; break; }
  if (index >= 0) {
    return { index: index, inList: true, position: base + index + 1, total: total,
      prev: index > 0 ? rows[index - 1].id : null, next: index < rows.length - 1 ? rows[index + 1].id : null,
      prevPage: index === 0 && page > 1, nextPage: index === rows.length - 1 && more };
  }
  if (typeof anchor === 'number' && anchor >= 0) {
    const at = Math.min(anchor, rows.length);
    return { index: -1, inList: false, position: 0, total: total,
      prev: at > 0 ? rows[at - 1].id : null, next: at < rows.length ? rows[at].id : null,
      prevPage: at === 0 && page > 1, nextPage: at >= rows.length && more };
  }
  return { index: -1, inList: false, position: 0, total: total, prev: null, next: null, prevPage: false, nextPage: false };
}
function prospectsNavCurrent() {
  const id = _prospects.current ? _prospects.current.id : _prospects.openingId;
  return prospectsNavInfo(_prospects.rows, id, _prospects.navAnchor, _prospects.page, _prospects.total);
}
function prospectsNavLabel(nav) {
  return nav.inList ? nav.position + ' из ' + nav.total : 'вне текущей выборки';
}
function prospectsRenderNav() {
  const nav = prospectsNavCurrent();
  const pos = document.getElementById('prospect-pos'); if (pos) pos.textContent = prospectsNavLabel(nav);
  const prev = document.getElementById('prospect-prev'); if (prev) prev.disabled = !(nav.prev || nav.prevPage);
  const next = document.getElementById('prospect-next'); if (next) next.disabled = !(nav.next || nav.nextPage);
  const after = document.getElementById('prospect-after-next'); if (after) after.disabled = !(nav.next || nav.nextPage);
  return nav;
}

/* --- несохранённые изменения --- */
function prospectsIsDirty() { return !!(_prospects.dirty && _prospects.dirty.size); }
function prospectsDirtyKey(el) {
  if (!el) return '';
  const id = el.id || '';
  if (id.indexOf('prospect-field-') === 0) return id.slice(15);
  if (id === 'prospect-note') return 'note';
  if (id.indexOf('prospect-call-note-card-') === 0) return 'call_note';
  if (el.closest && el.closest('.prospect-extra-contact')) return 'contacts_json';
  return '';
}
function prospectsDirtyBadge() {
  const el = document.getElementById('prospect-dirty'); if (el) el.hidden = !prospectsIsDirty();
}
function prospectsMarkDirty(event) {
  const key = prospectsDirtyKey(event && event.target);
  if (!key) return;
  if (!_prospects.dirty) _prospects.dirty = new Set();
  _prospects.dirty.add(key); prospectsDirtyBadge();
}
function prospectsMarkContacts() {
  if (!_prospects.dirty) _prospects.dirty = new Set();
  _prospects.dirty.add('contacts_json'); prospectsDirtyBadge();
}
function prospectsConfirmLeave() {
  if (!prospectsIsDirty()) return true;
  const ok = typeof confirm === 'function' ? confirm('В карточке есть несохранённые изменения. Уйти без сохранения?') : true;
  if (ok) { _prospects.dirty.clear(); prospectsDirtyBadge(); }
  return ok;
}
// Снимок изменённых, но не сохранённых полей — чтобы перерисовка карточки (после звонка) их не теряла.
function prospectsSnapshot(skip) {
  const snap = {};
  (_prospects.dirty ? Array.from(_prospects.dirty) : []).forEach(function (key) {
    if ((skip || []).indexOf(key) >= 0) return;
    if (key === 'contacts_json') { snap[key] = JSON.stringify(prospectsReadContacts()); return; }
    const el = document.getElementById(key === 'note' ? 'prospect-note' : key === 'call_note' ? 'prospect-call-note-card-' + (_prospects.current ? _prospects.current.id : '') : 'prospect-field-' + key);
    if (el) snap[key] = el.value;
  });
  return snap;
}
function prospectsRestore(snap) {
  _prospects.dirty = new Set();
  Object.keys(snap || {}).forEach(function (key) {
    if (key === 'contacts_json') {
      const root = document.getElementById('prospect-contacts');
      if (root) root.innerHTML = prospectsContacts(snap[key]);
    } else {
      const el = document.getElementById(key === 'note' ? 'prospect-note' : key === 'call_note' ? 'prospect-call-note-card-' + (_prospects.current ? _prospects.current.id : '') : 'prospect-field-' + key);
      if (!el) return;
      el.value = snap[key];
    }
    _prospects.dirty.add(key);
  });
  if (Object.keys(snap || {}).some(function (k) { return ['contact_person', 'contact_role', 'email', 'phone', 'site', 'qualification', 'need', 'comment', 'consent', 'consent_date', 'consent_basis', 'contacts_json'].indexOf(k) >= 0; })) {
    const d = document.getElementById('prospect-edit-contacts'); if (d) d.open = true;
  }
  prospectsDirtyBadge();
}

/* --- адрес страницы --- */
function prospectsHasHistory() { return typeof history !== 'undefined' && typeof location !== 'undefined' && !!history.replaceState; }
function prospectsSetHash(id, replace) {
  if (!prospectsHasHistory()) return;
  const want = prospectsHashFor(id);
  if (location.hash === want) return;
  const url = location.pathname + location.search + want;
  if (replace || prospectsHashId(location.hash)) history.replaceState({ prospect: id }, '', url);
  else { history.pushState({ prospect: id }, '', url); _prospects.pushedHash = true; }
}
function prospectsClearHash() {
  if (!prospectsHasHistory() || !prospectsHashId(location.hash)) return;
  if (_prospects.pushedHash) { _prospects.pushedHash = false; history.back(); }
  else history.replaceState(null, '', location.pathname + location.search);
}
function prospectsOnHash() {
  if (typeof location === 'undefined') return;
  const id = prospectsHashId(location.hash);
  const openId = _prospects.current ? _prospects.current.id : _prospects.openingId;
  if (!id) {
    if (!_prospects.drawerOpen) return;
    if (!prospectsConfirmLeave()) {  // «Назад» при несохранённых правках — остаёмся в карточке
      if (openId && prospectsHasHistory()) { history.pushState({ prospect: openId }, '', location.pathname + location.search + prospectsHashFor(openId)); _prospects.pushedHash = true; }
      return;
    }
    prospectsClose({ force: true, fromHash: true });
    return;
  }
  if (_prospects.drawerOpen && id === openId) return;
  if (typeof state !== 'undefined' && state && state.currentScreen !== 'sales-prospects') { prospectsDeepLink(); return; }
  prospectsOpen(id, { fromHash: true });
}
// Прямая ссылка …/#prospects/<id>: открыть «Базу предприятий» и карточку после загрузки списка.
function prospectsDeepLink() {
  const id = typeof location !== 'undefined' ? prospectsHashId(location.hash) : '';
  if (!id) return false;
  _prospects.pendingOpen = id;
  try { if (typeof selectSection === 'function') selectSection('sales'); } catch (_) {}
  if (typeof selectSidebarItem === 'function') selectSidebarItem('sales-prospects');
  return true;
}

/* --- выдвижная панель --- */
function prospectsDrawer() {
  const root = document.getElementById('prospects-detail');
  if (root && !root._drawerReady && document.body && document.body.appendChild) {
    // Переносим в <body>: панель поверх таблицы, таблица не сжимается и сохраняет прокрутку.
    document.body.appendChild(root);
    root.classList.add('prospects', 'prospect-drawer');
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Карточка предприятия');
    const backdrop = document.createElement('div');
    backdrop.id = 'prospects-backdrop'; backdrop.className = 'prospect-backdrop'; backdrop.hidden = true;
    backdrop.addEventListener('click', function () { prospectsClose(); });
    document.body.appendChild(backdrop);
    root._drawerReady = true;
  }
  return root;
}
function prospectsShowDrawer(on) {
  const root = prospectsDrawer(); if (!root) return;
  root.hidden = !on; _prospects.drawerOpen = !!on;
  const backdrop = document.getElementById('prospects-backdrop'); if (backdrop) backdrop.hidden = !on;
  const html = document.documentElement;
  if (html && html.classList) html.classList[on ? 'add' : 'remove']('prospect-drawer-open');
  if (on && html && html.style && document.querySelectorAll) {
    let gap = 0;
    document.querySelectorAll('.sidebar').forEach(function (sb) {
      const rc = sb.getBoundingClientRect ? sb.getBoundingClientRect() : null;
      if (rc && rc.width > 0 && rc.height > 0) gap = Math.max(gap, rc.right);
    });
    html.style.setProperty('--prospect-drawer-gap', gap + 'px');
  }
}
function prospectsJump(sectionId) {
  const el = document.getElementById(sectionId);
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function prospectsStep(delta) {
  if (!_prospects.current) return;
  if (!prospectsConfirmLeave()) return;
  const nav = prospectsNavCurrent();
  let target = delta < 0 ? nav.prev : nav.next;
  if (!target && (delta < 0 ? nav.prevPage : nav.nextPage)) {
    _prospects.page += delta < 0 ? -1 : 1;
    await loadProspects();
    const rows = _prospects.rows || [];
    target = rows.length ? (delta < 0 ? rows[rows.length - 1].id : rows[0].id) : null;
  }
  if (!target) { showToast(delta < 0 ? 'Это первое предприятие в выборке' : 'Это последнее предприятие в выборке', 'info'); return; }
  await prospectsOpen(target, { replace: true });
}
function prospectsAutoNext(value) {
  try {
    if (typeof value === 'boolean') localStorage.setItem('atomus_prospects_autonext', value ? '1' : '0');
    return localStorage.getItem('atomus_prospects_autonext') === '1';
  } catch (_) { return false; }
}
// После записи звонка из карточки: предложить «Следующее →» (или перейти сразу, если включено).
async function prospectsAfterCall(id, result) {
  const box = document.getElementById('prospect-after-call');
  if (box) {
    box.hidden = false;
    box.innerHTML = '<i class="ti ti-circle-check"></i> Записано: ' + prospectsEscape(PROSPECT_CALL_RESULTS[result] || result) +
      ' <button type="button" class="btn btn-primary" id="prospect-after-next" onclick="prospectsStep(1)">Следующее →</button>';
    prospectsRenderNav();
  }
  if (prospectsAutoNext() && _prospects.current && _prospects.current.id === id) await prospectsStep(1);
}
function prospectsKey(e) {
  if (!_prospects.drawerOpen || !e) return;
  if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); prospectsClose(); return; }
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const t = e.target, tag = t && t.tagName ? String(t.tagName).toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
  const k = e.key;
  // J/K (и о/л на русской раскладке) — как в почте: J — следующее, K — предыдущее.
  if (k === 'ArrowRight' || k === 'j' || k === 'J' || k === 'о' || k === 'О') { if (e.preventDefault) e.preventDefault(); prospectsStep(1); }
  else if (k === 'ArrowLeft' || k === 'k' || k === 'K' || k === 'л' || k === 'Л') { if (e.preventDefault) e.preventDefault(); prospectsStep(-1); }
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('hashchange', prospectsOnHash);
  window.addEventListener('keydown', prospectsKey);
  window.addEventListener('beforeunload', function (e) { if (prospectsIsDirty()) { e.preventDefault(); e.returnValue = ''; } });
}

function prospectsClose(opts) {
  opts = opts || {};
  if (!opts.force && !prospectsConfirmLeave()) return false;
  if (_prospects.dirty) _prospects.dirty.clear();
  const lastId = _prospects.current ? _prospects.current.id : _prospects.openingId;
  ++_prospects.detailRequest; _prospects.current = null; _prospects.openingId = null;
  const root = document.getElementById('prospects-detail'); if (root) root.hidden = true;
  const overview = document.getElementById('prospects-overview'); if (overview) overview.hidden = false;
  prospectsShowDrawer(false);
  if (!opts.fromHash) prospectsClearHash(); else _prospects.pushedHash = false;
  // Возвращаем взгляд на строку, с которой работали.
  if (lastId && document.querySelector) {
    const row = document.querySelector('tr[data-prospect-id="' + String(lastId).replace(/["\\]/g, '') + '"]');
    if (row && row.scrollIntoView) { row.scrollIntoView({ block: 'nearest' }); if (row.classList) { document.querySelectorAll('.prospect-row-last').forEach(function (el) { el.classList.remove('prospect-row-last'); }); row.classList.add('prospect-row-last'); } }
  }
  return true;
}
function prospectsField(key, value, options, area) {
  const id = 'prospect-field-' + key;
  let control;
  if (options) control = '<select id="' + id + '">' + prospectsOptions(options, value) + '</select>';
  else if (area) control = '<textarea id="' + id + '" rows="3" maxlength="5000">' + prospectsEscape(value) + '</textarea>';
  else control = '<input id="' + id + '" type="' + (key === 'next_time' ? 'time' : key.endsWith('_date') ? 'date' : 'text') + '" maxlength="5000" value="' + prospectsEscape(value) + '">';
  return '<label class="prospect-field' + (area ? ' wide' : '') + '"><span>' + PROSPECT_LABELS[key] + '</span>' + control + '</label>';
}
function prospectsHeadHtml(r, stages) {
  const phones = prospectsPhones(r.phone), main = phones.find(function (p) { return p.tel; }) || phones[0];
  const stage = r.stage ? '<span class="prospect-stage">' + prospectsEscape((stages || {})[r.stage] || r.stage) + '</span>' : '';
  return '<header class="pdw-head">' +
    '<div class="pdw-toprow"><button type="button" class="btn btn-secondary pdw-back" onclick="prospectsClose()">← К базе</button>' +
    '<div class="pdw-nav"><button type="button" class="icon-btn" id="prospect-prev" onclick="prospectsStep(-1)" title="Предыдущее (← или K)" aria-label="Предыдущее предприятие"><i class="ti ti-chevron-left"></i></button>' +
    '<span class="pdw-pos" id="prospect-pos" aria-live="polite">…</span>' +
    '<button type="button" class="icon-btn" id="prospect-next" onclick="prospectsStep(1)" title="Следующее (→ или J)" aria-label="Следующее предприятие"><i class="ti ti-chevron-right"></i></button></div>' +
    '<span class="pdw-dirty" id="prospect-dirty" hidden>● не сохранено</span>' +
    '<button type="button" class="icon-btn pdw-close" onclick="prospectsClose()" title="Закрыть (Esc)" aria-label="Закрыть карточку"><i class="ti ti-x"></i></button></div>' +
    '<h2 class="pdw-title">' + prospectsEscape(r.name || 'Предприятие') + '</h2>' +
    '<div class="pdw-sub">' + prospectsEscape([r.region, r.city].filter(Boolean).join(' · ')) + (r.direction ? ' · ' + prospectsEscape(PROSPECT_DIRECTIONS[r.direction] || r.direction) : '') + ' ' + stage +
    (r.owner ? ' <span class="prospect-meta">' + prospectsEscape(r.owner) + '</span>' : '') + '</div>' +
    '<div class="pdw-callrow">' + (main && main.tel ? '<a class="btn btn-primary prospect-call-btn" href="tel:' + main.tel + '"><i class="ti ti-phone"></i> Позвонить</a><a class="pdw-mainphone" href="tel:' + main.tel + '">' + prospectsEscape(main.raw) + '</a>' :
      '<span class="prospect-missing">' + (main ? prospectsEscape(main.raw) + ' — номер не распознан' : 'Телефон не указан') + '</span>') +
    ' ' + prospectsCallSummary(r) + '</div>' +
    '<nav class="pdw-tabs" aria-label="Разделы карточки"><button type="button" onclick="prospectsJump(\'pdw-contacts\')">Контакты</button><button type="button" onclick="prospectsJump(\'pdw-call\')">Звонок</button><button type="button" onclick="prospectsJump(\'pdw-work\')">Работа</button><button type="button" onclick="prospectsJump(\'pdw-history\')">История</button></nav>' +
    '</header>';
}
function prospectsContactsView(r) {
  let extra = []; try { extra = JSON.parse(r.contacts_json || '[]'); } catch (_) {}
  const site = prospectsUrl(r.site);
  const emails = String(r.email || '').split(/[;,\s]+/).filter(function (v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); });
  const rows = [
    ['Телефоны', r.phone ? prospectsPhoneLinks(r.phone) : '<span class="prospect-missing">не указаны</span>'],
    ['Почта', emails.length ? emails.map(function (m) { return '<a href="mailto:' + prospectsEscape(m) + '">' + prospectsEscape(m) + '</a>'; }).join('<br>') : (r.email ? prospectsEscape(r.email) : '<span class="prospect-missing">не найдена</span>')],
    ['Сайт', site ? '<a href="' + prospectsEscape(site) + '" target="_blank" rel="noopener noreferrer">' + prospectsEscape(r.site) + ' ↗</a>' : (r.site ? prospectsEscape(r.site) : '—')],
    ['Контактное лицо', r.contact_person ? prospectsEscape(r.contact_person) + (r.contact_role ? ' <span class="prospect-meta">' + prospectsEscape(r.contact_role) + '</span>' : '') : '<span class="prospect-meta">не указано — уточните при звонке</span>']
  ];
  if (extra.length) rows.push(['Другие сотрудники', extra.map(function (c) {
    return [c.name ? '<b>' + prospectsEscape(c.name) + '</b>' : '', c.role ? prospectsEscape(c.role) : '', c.phone ? prospectsPhoneLinks(c.phone) : '', c.email ? prospectsEscape(c.email) : ''].filter(Boolean).join(' · ');
  }).join('<br>')]);
  rows.push(['Отрасль', prospectsEscape(r.segment || '—')], ['Адрес', prospectsEscape(r.address || 'не найден')]);
  if (r.inn) rows.push(['ИНН', prospectsEscape(r.inn)]);
  return '<dl class="pdw-contacts">' + rows.map(function (v) { return '<dt>' + v[0] + '</dt><dd>' + v[1] + '</dd>'; }).join('') + '</dl>';
}
function prospectsCardHtml(r, employees, dict) {
  const source = r.source_data || {};
  const sources = ['source', 'email_source', 'phone_source', 'site_pages'].map(function (k) { return source[k] || ''; }).join(' ');
  const urls = [...new Set(sources.match(/https?:\/\/[^\s;|]+/g) || [])];
  const analysis = [['Факты', source.fact], ['Применение — гипотеза', source.use], ['Подбор', source.fit], ['Серийность — оценка', source.repeat], ['Барьеры', source.risk], ['Кого попросить', source.role], ['Вопрос', source.ask], ['Следующий шаг', source.next], ['Маршрут', source.route]].filter(function (v) { return v[1]; });
  const manage = canManageSales();
  return prospectsHeadHtml(r, dict.stages) + '<div class="pdw-body" id="prospect-body">' +
    '<section class="pdw-section" id="pdw-contacts"><h3>Контакты</h3>' + prospectsContactsView(r) +
    '<div class="prospect-note">' + (r.direction === 'chillers' ? 'Чиллеры 1,5–50 кВт: вода от +5 °C, пропиленгликоль от −10 °C. Холодопроизводительность уточняется при рабочем режиме.' : 'Климатическое оборудование под продукт, помещение и загрузку.') + '</div></section>' +
    (analysis.length ? '<section class="pdw-section"><details class="prospect-source" open><summary>Анализ и вопросы для звонка</summary><dl>' + analysis.map(function (v) { return '<dt>' + v[0] + '</dt><dd>' + prospectsEscape(v[1]) + '</dd>'; }).join('') + '</dl></details></section>' : '') +
    '<section class="pdw-section" id="pdw-call" oninput="prospectsMarkDirty(event)"><h3>Результат звонка</h3>' +
    (manage ? prospectsCallBox(r.id, 'card') + '<div class="pdw-after-call" id="prospect-after-call" hidden></div>' +
      '<label class="pdw-autonext"><input type="checkbox" id="prospect-autonext"' + (prospectsAutoNext() ? ' checked' : '') + ' onchange="prospectsAutoNext(this.checked)"> После записи звонка сразу открывать следующее предприятие</label>' :
      '<p class="prospect-meta">Записывать звонки могут директор, заместитель и менеджеры.</p>') + '</section>' +
    '<section class="pdw-section" id="pdw-work"><h3>Работа с предприятием</h3>' +
    '<form id="prospect-form" onsubmit="prospectsSave(event)" oninput="prospectsMarkDirty(event)" onchange="prospectsMarkDirty(event)"><fieldset' + (!manage ? ' disabled' : '') + '><div class="prospect-fields">' +
    prospectsField('stage', r.stage, dict.stages) + prospectsOwnerControl(r.owner, employees) +
    prospectsField('next_action', r.next_action) + prospectsField('next_date', r.next_date) + prospectsField('next_time', r.next_time) +
    prospectsField('direction', r.direction || 'dairy', PROSPECT_DIRECTIONS) + prospectsField('annual_units', r.annual_units) +
    prospectsField('close_reason', r.close_reason) + '</div>' +
    '<label class="prospect-field prospect-comment"><span>Новый комментарий</span><textarea id="prospect-note" rows="3" maxlength="5000" placeholder="С кем говорили, что обсудили, о чём договорились…"></textarea></label>' +
    '<div class="prospect-save-row"><button class="btn btn-primary" type="submit" id="prospect-save">Сохранить</button><button type="button" class="btn btn-secondary" onclick="prospectsOffer()"' + (!manage ? ' disabled' : '') + '>Создать КП</button><span id="prospect-save-result" role="status"></span></div>' +
    '<details class="prospect-source" id="prospect-edit-contacts"><summary>Изменить контакты и сведения</summary><div class="prospect-fields">' +
    prospectsField('contact_person', r.contact_person) + prospectsField('contact_role', r.contact_role) +
    prospectsField('email', r.email) + prospectsField('phone', r.phone) + prospectsField('site', r.site) +
    prospectsField('qualification', r.qualification, PROSPECT_QUALIFICATIONS) + prospectsField('need', r.need, null, true) +
    prospectsField('comment', r.comment, null, true) + prospectsField('consent', r.consent, dict.consents) +
    prospectsField('consent_date', r.consent_date) + prospectsField('consent_basis', r.consent_basis, null, true) +
    '</div><h4>Другие сотрудники предприятия</h4><div id="prospect-contacts">' + prospectsContacts(r.contacts_json) +
    '</div><button type="button" class="btn btn-secondary" onclick="prospectsAddContact()">+ Контакт</button></details></fieldset></form></section>' +
    '<section class="pdw-section" id="pdw-history"><h3>История комментариев и звонков</h3><div id="prospect-events">' + prospectsHistory(r.events || [], dict) +
    '</div><button class="btn btn-secondary" id="prospect-more-history" onclick="prospectsMoreHistory()"' + ((r.events || []).length >= (r.events_total || 0) ? ' hidden' : '') + '>Показать ещё</button></section>' +
    '<section class="pdw-section"><details class="prospect-source"><summary>Источники и исходные контакты</summary><dl>' +
    [['Проверка', source.verification], ['Дата сбора', prospectsDate(source.checked)], ['Исходный email', source.email_raw || source.email],
     ['Исходный телефон', source.phone_raw || source.phone], ['Email со страницы сайта', source.site_emails], ['Примечание', source.notes],
     ['Тип адреса', source.address_type || 'Как указан в источнике'], ['Период данных источника', source.origin_period || 'Не указан']].map(function (v) { return '<dt>' + v[0] + '</dt><dd>' + prospectsEscape(v[1] || '—') + '</dd>'; }).join('') +
    '</dl><div class="prospect-source-links">' + urls.map(prospectsLinks).join('<br>') + '</div></details>' +
    ((r.contractors || []).length ? '<div class="prospect-source"><b>Контрагенты с тем же ИНН</b>' + r.contractors.map(function (c) { return '<p><button class="prospect-name" onclick="prospectsContractor(' + Number(c.id) + ')">' + prospectsEscape(c.name) + '</button> ' + prospectsEscape(c.address || '') + '</p>'; }).join('') + '</div>' : '') +
    '<div id="prospect-campaign-history"></div></section></div>';
}
async function prospectsOpen(id, opts) {
  opts = opts || {};
  if (!id) return;
  const openId = _prospects.current ? _prospects.current.id : null;
  if (openId && openId !== id && !prospectsConfirmLeave()) return;
  const seq = ++_prospects.detailRequest;
  const root = prospectsDrawer();
  const wasOpen = !!_prospects.drawerOpen;
  prospectsShowDrawer(true);
  _prospects.openingId = id;
  if (!opts.fromHash) prospectsSetHash(id, opts.replace || wasOpen);
  const known = (_prospects.rows || []).find(function (row) { return row.id === id; });
  const body0 = document.getElementById('prospect-body');
  const keepTop = opts.refresh && body0 ? body0.scrollTop : 0;
  if (!opts.refresh) {
    root.innerHTML = prospectsHeadHtml(known || { name: 'Загружаем карточку…' }, _prospects.dict && _prospects.dict.stages) + '<div class="pdw-body" id="prospect-body"><div class="loading-block">Загружаем карточку…</div></div>';
    prospectsRenderNav();
  }
  try {
    const r = await apiGet('/api/sales/prospects/' + encodeURIComponent(id));
    if (seq !== _prospects.detailRequest) return;
    const dict = _prospects.dict;
    if (!dict) throw new Error('Сначала загрузите список производств');
    const employees = await prospectsEmployees();
    if (seq !== _prospects.detailRequest) return;
    _prospects.current = r;
    const nav = prospectsNavInfo(_prospects.rows, id, _prospects.navAnchor, _prospects.page, _prospects.total);
    if (nav.inList) _prospects.navAnchor = nav.index;
    if (!opts.keepDirty) _prospects.dirty = new Set();
    root.innerHTML = prospectsCardHtml(r, employees, dict);
    prospectsRenderNav(); prospectsDirtyBadge();
    const body = document.getElementById('prospect-body');
    if (body) body.scrollTop = keepTop;
    if (typeof campaignsLoadHistory === 'function') campaignsLoadHistory(id, seq);
  } catch (e) {
    if (seq === _prospects.detailRequest) root.innerHTML = prospectsHeadHtml(known || { name: 'Карточка не открылась' }, _prospects.dict && _prospects.dict.stages) + '<div class="pdw-body" id="prospect-body"><p>' + prospectsEscape(e.message) + '</p></div>';
  }
}
// Перечитать карточку после звонка/конфликта, не теряя несохранённые правки формы.
async function prospectsRefreshCard(id, callResult) {
  const keep = prospectsSnapshot(callResult === 'callback' ? ['next_date', 'next_time', 'next_action', 'call_note'] : ['call_note']);
  await loadProspects();
  if (!_prospects.current || _prospects.current.id !== id) return;
  await prospectsOpen(id, { refresh: true, keepDirty: true, replace: true });
  prospectsRestore(keep);
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
    const keepCall = prospectsSnapshot(['stage', 'owner', 'direction', 'annual_units', 'next_action', 'next_date', 'next_time', 'close_reason', 'note', 'contacts_json', 'contact_person', 'contact_role', 'email', 'phone', 'site', 'qualification', 'need', 'comment', 'consent', 'consent_date', 'consent_basis']);
    _prospects.dirty = new Set();
    await loadProspects();
    if (_prospects.current && _prospects.current.id === id) { await prospectsOpen(id, { refresh: true, replace: true }); prospectsRestore(keepCall); }
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
    const isCall=ev.kind==='call'||!!changes.call;const callResult=ev.result||(changes.call&&changes.call.to)||'';
    const callLine=isCall?'<p class="prospect-event-call"><i class="ti '+(PROSPECT_CALL_ICONS[callResult]||'ti-phone')+'"></i> <b>Звонок: '+prospectsEscape(PROSPECT_CALL_RESULTS[callResult]||callResult||'—')+'</b>'+(changes.phone&&changes.phone.to?' · '+prospectsEscape(changes.phone.to):'')+'</p>':'';
    if(isCall){delete changes.call;delete changes.phone;}
    return '<article class="prospect-event'+(isCall?' prospect-event-callrow':'')+'"><small>'+prospectsEscape(isNaN(when)?ev.created_at:when.toLocaleString('ru-RU',{timeZone:'Asia/Yekaterinburg'}))+' · '+prospectsEscape(ev.actor_name||('Сотрудник #'+ev.actor))+'</small>'+callLine+Object.keys(changes).map(function(key){
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
function prospectsContactFields(c) {return '<div class="prospect-extra-contact">'+[['name','ФИО'],['role','Должность'],['phone','Телефон'],['email','Почта']].map(function(pair){return '<label>'+pair[1]+'<input data-contact="'+pair[0]+'" maxlength="500" value="'+prospectsEscape(c[pair[0]]||'')+'"></label>';}).join('')+'<button type="button" class="btn btn-secondary" onclick="this.parentElement.remove();prospectsMarkContacts()">Удалить контакт</button></div>';}
function prospectsContacts(raw) {let rows=[];try{rows=JSON.parse(raw||'[]');}catch(_){}return rows.map(prospectsContactFields).join('');}
function prospectsAddContact(){const root=document.getElementById('prospect-contacts');if(root.children.length>=20){showToast('Не более 20 контактов','error');return;}root.insertAdjacentHTML('beforeend',prospectsContactFields({}));prospectsMarkContacts();}
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
  if(!canManageSales())return;if(!prospectsClose())return;const root=prospectsDrawer();prospectsShowDrawer(true);
  root.innerHTML='<header class="pdw-head"><div class="pdw-toprow"><button type="button" class="btn btn-secondary pdw-back" onclick="prospectsClose()">← К базе</button><button type="button" class="icon-btn pdw-close" onclick="prospectsClose()" aria-label="Закрыть"><i class="ti ti-x"></i></button></div><h2 class="pdw-title">Новое предприятие</h2></header><div class="pdw-body"><form onsubmit="prospectsCreate(event)"><div class="prospect-fields">'+[['name','Название *'],['city','Город'],['region','Регион'],['segment','Отрасль'],['phone','Телефон'],['email','Почта'],['site','Сайт'],['inn','ИНН'],['address','Адрес площадки']].map(function(p){return '<label class="prospect-field">'+p[1]+'<input name="'+p[0]+'" maxlength="500"'+(p[0]==='name'?' required':'')+'></label>';}).join('')+'<label class="prospect-field">Направление<select name="direction">'+prospectsOptions(PROSPECT_DIRECTIONS,_prospects.direction||'chillers')+'</select></label></div><div class="prospect-save-row"><button class="btn btn-primary" type="submit">Создать</button><span role="status"></span></div></form></div>';
}
async function prospectsCreate(event){event.preventDefault();const form=event.target,button=form.querySelector('button[type=submit]'),output=form.querySelector('[role=status]');button.disabled=true;
  const body=Object.fromEntries(new FormData(form).entries());
  try{const r=await prospectsPost('/api/sales/prospects',body);_prospects.direction=body.direction;await loadProspects();await prospectsOpen(r.id);showToast(r.added?'Предприятие добавлено':'Такая карточка уже есть','success');}
  catch(e){output.textContent=e.message;button.disabled=false;}
}

/* v2026-10-02: защита create task от двойного клика / таймаута */
(function () {
  var s = document.createElement('script');
  s.src = '/task-form-guard.js';
  s.async = false;
  document.head.appendChild(s);
})();
