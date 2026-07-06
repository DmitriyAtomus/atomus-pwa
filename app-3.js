// ============ ЭТАП 16В-2: задачи по договору ============

cache.contractTasks = {};

async function loadContractTasks(contractId) {
  const container = document.getElementById('scd-tasks-block');
  if (!container) return;
  try {
    // Кеш на договор, инвалидируется при создании/редактировании задачи
    if (!cache.contractTasks[contractId]) {
      const d = await apiGet('/api/contracts/' + contractId + '/tasks');
      cache.contractTasks[contractId] = d;
    }
    renderContractTasksBlock(contractId, cache.contractTasks[contractId]);
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить задачи: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderContractTasksBlock(contractId, d) {
  const container = document.getElementById('scd-tasks-block');
  if (!container) return;
  const tasks = (d && d.tasks) || [];
  const counts = (d && d.counts) || {};
  const canAdd = canManageTasks();

  let html = '<div class="contract-block">';
  html += '<div class="contract-block-header">';
  html += '<div class="contract-block-title"><i class="ti ti-checklist"></i> Задачи по договору';
  if (counts.total) {
    html += ' <span class="contract-block-counter">' + counts.total + '</span>';
  }
  html += '</div>';
  if (canAdd) {
    html += '<button class="btn btn-secondary btn-small" onclick="openNewTaskForContract(' + contractId + ')">' +
            '<i class="ti ti-plus"></i> Новая задача</button>';
  }
  html += '</div>';

  if (!tasks.length) {
    html += '<div class="empty-block" style="padding: 20px 12px;">' +
            '<i class="ti ti-checklist" style="font-size: 28px;"></i>' +
            'По этому договору задач пока нет' +
            (canAdd ? '<br><br><button class="btn btn-primary btn-small" onclick="openNewTaskForContract(' + contractId + ')"><i class="ti ti-plus"></i> Создать первую</button>' : '') +
            '</div>';
  } else {
    // Маленькая сводка по статусам
    if (counts.open || counts.done) {
      html += '<div style="padding: 0 12px 8px; color: var(--text-light); font-size: 12.5px;">' +
              (counts.open ? counts.open + ' открытых' : '') +
              (counts.open && counts.done ? ' · ' : '') +
              (counts.done ? counts.done + ' готовых' : '') +
              '</div>';
    }
    html += '<div style="padding: 0 4px;">';
    tasks.forEach(t => { html += renderTaskRow(t); });
    html += '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

// ЭТАП 16В-2: создать задачу с предзаполненной привязкой к договору
function openNewTaskForContract(contractId) {
  if (!canManageTasks()) {
    showToast('Создавать задачи может директор, зам или менеджер', 'error');
    return;
  }
  // Найдём контрагента для красивой подписи
  const c = state.lastLoadedContract;
  let label = 'договор #' + contractId;
  if (c && c.id === contractId) {
    label = c.number + (c.contractor_name ? ' · ' + c.contractor_name : '');
  }
  state.taskFromContractId = contractId;
  state.taskFromContractLabel = label;
  selectSection('tasks');
  // Небольшая задержка, чтобы переключение раздела завершилось
  setTimeout(() => openNewTask(), 50);
}

// ============================================================
// ============ ЭТАП 18: СКЛАД ============
// ============================================================

cache.warehouseStock = null;     // {stock:[], summary:{}, filter:'all', search:''}
cache.warehouseMovements = null; // {movements:[], filter:'all'}

state.warehouseFilter = 'all';   // 'all' | 'free' | 'reserved'
state.warehouseSearch = '';
state.warehouseSearchTimer = null;
state.movementsFilter = 'all';   // 'all' | 'in' | 'out' | 'write_off'

// v2.43.88: гендер-нейтральные формы — лейбл универсален для «сборки», «блока»,
// «узла», «изделия» и т.п. («блок готов», «сборка готова» — оба корректны
// с одним лейблом «готово»).
const ASSEMBLY_STATUS_LABELS = {
  in_progress: 'в работе',
  ready:       'готово',
  shipped:     'отгружено',
  written_off: 'списано',
};

const ASSEMBLY_STATUS_ORDER = ['in_progress', 'ready', 'shipped', 'written_off'];

// --- Загрузка остатков ---

// ============ ЭТАП 32.2: Номенклатура комплектующих (справочник в Производстве) ============

function openPtDefectsForComponent(componentId) {
  // Переходим в Сервис с фильтром «по компоненту»
  selectSection && selectSection('defects');
  setTimeout(() => {
    if (typeof selectSidebarItem === 'function') selectSidebarItem('defects-list-new');
    // Фильтр по тексту артикула/названия будет проще через поиск — оставляем общий список,
    // пользователь увидит свежую заявку наверху.
  }, 50);
}

async function resolveComponentDefect(defectId, action) {
  const label = action === 'return' ? 'вернуть весь оставшийся брак в склад' : 'списать весь оставшийся брак';
  if (!confirm('Точно ' + label + '?')) return;
  try {
    const res = await fetch(API_BASE + '/api/defect-reports/' + defectId + '/resolve-defect', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j.message || ('Ошибка ' + res.status), 'error');
      return;
    }
    const j = await res.json();
    showToast(action === 'return' ? 'Возвращено в склад' : 'Списано', 'success');
    if (typeof openDefectDetail === 'function' && state.currentDefectId) {
      openDefectDetail(state.currentDefectId);
    }
  } catch (e) {
    showToast('Сеть: не удалось', 'error');
  }
}

/* === v2.44.63: пометить брак комплектующего === */
function openMarkDefectiveModal(componentId, componentName, currentStock, unit) {
  const overlayId = 'mark-defective-modal';
  let m = document.getElementById(overlayId);
  if (m) m.remove();
  m = document.createElement('div');
  m.id = overlayId;
  m.className = 'modal-overlay mark-defective-modal';
  m.innerHTML =
    '<div class="modal">' +
      '<div class="modal-header">' +
        '<h2 style="color:#8C2A2A;"><i class="ti ti-alert-triangle"></i> Пометить брак</h2>' +
        '<button class="icon-btn" onclick="document.getElementById(\'' + overlayId + '\').remove()">' +
          '<i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        '<div class="mark-defective-hint">' +
          '<b>«' + escapeHtml(componentName || '—') + '»</b><br>' +
          'На складе сейчас: <b>' + _fmtQty(currentStock) + ' ' + escapeHtml(unit || 'шт.') + '</b><br>' +
          'Указанное количество уйдёт из остатка в «брак», и автоматически создастся заявка в Сервисе для расследования.' +
        '</div>' +
        '<div class="mark-defective-row">' +
          '<label>Количество (' + escapeHtml(unit || 'шт.') + ')</label>' +
          '<input type="number" id="mark-defective-qty" min="0.001" step="0.001" max="' + (currentStock || 0) + '" value="1" autofocus>' +
        '</div>' +
        '<div class="mark-defective-row">' +
          '<label>Причина (что не так)</label>' +
          '<textarea id="mark-defective-reason" placeholder="Например: плата не запускается, обнаружено при сборке Atom-BBAS-7MT"></textarea>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border);">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'' + overlayId + '\').remove()">Отмена</button>' +
        '<button class="btn-defect-confirm" onclick="submitMarkDefective(' + componentId + ')">' +
          '<i class="ti ti-alert-triangle"></i> Пометить как брак' +
        '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  m.classList.add('visible');
  setTimeout(() => document.getElementById('mark-defective-qty')?.focus(), 60);
}

async function submitMarkDefective(componentId) {
  const qtyStr = document.getElementById('mark-defective-qty')?.value;
  const reason = (document.getElementById('mark-defective-reason')?.value || '').trim();
  const qty = parseFloat(qtyStr);
  if (!qty || qty <= 0) {
    showToast('Введи количество > 0', 'error');
    return;
  }
  if (!reason) {
    showToast('Опиши причину брака', 'error');
    return;
  }
  try {
    const res = await fetch(API_BASE + '/api/components/' + componentId + '/mark-defective', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ qty, reason }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j.message || ('Ошибка ' + res.status), 'error');
      return;
    }
    const j = await res.json();
    document.getElementById('mark-defective-modal')?.remove();
    showToast('Брак зафиксирован, заявка в Сервисе #' + j.defect_id, 'success');
    // Перезагрузим текущий экран
    if (document.querySelector('[data-screen="components-catalog"].active') && typeof loadComponentsCatalog === 'function') {
      loadComponentsCatalog();
    } else if (document.querySelector('[data-screen="warehouse-dashboard"].active') && typeof loadPartsDashboard === 'function') {
      loadPartsDashboard();
    }
  } catch (e) {
    showToast('Сеть: не удалось пометить брак', 'error');
  }
}

async function loadComponentsCatalog() {
  const newBtn = document.getElementById('cc-new-btn');
  const newBtnM = document.getElementById('cc-mobile-new');
  const diagBtn = document.getElementById('cc-diagnose-btn');
  const dupsBtn = document.getElementById('cc-dups-btn');
  const canEdit = canManageSales();
  if (newBtn) newBtn.style.display = canEdit ? '' : 'none';
  if (newBtnM) newBtnM.style.display = canEdit ? '' : 'none';
  if (diagBtn) diagBtn.style.display = canEdit ? '' : 'none';
  if (dupsBtn) dupsBtn.style.display = canEdit ? '' : 'none';

  if (!cache.componentCategories) {
    try {
      const r = await apiGet('/api/components/categories');
      cache.componentCategories = r.categories || [];
    } catch (e) { cache.componentCategories = []; }
    renderCcCategoryChips();
  } else {
    renderCcCategoryChips();
  }
  const container = document.getElementById('cc-list-container');
  if (container) container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const r = await apiGet('/api/components');
    cache.components = r.components || [];
    renderComponentsCatalogList();
  } catch (e) {
    if (container) container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderCcCategoryChips() {
  const wrap = document.getElementById('cc-cat-filters');
  if (!wrap) return;
  const active = state.ccCatFilter || '';
  let html = '<button class="filter-chip' + (active === '' ? ' active' : '') + '" data-cc-cat="" onclick="setCcCategory(\'\')">Все</button>';
  (cache.componentCategories || []).forEach(c => {
    html += '<button class="filter-chip' + (active === String(c.id) ? ' active' : '') + '" data-cc-cat="' + c.id + '" onclick="setCcCategory(\'' + c.id + '\')">' +
            escapeHtml(c.name) + '</button>';
  });
  wrap.innerHTML = html;
}

function setCcCategory(catId) {
  state.ccCatFilter = String(catId || '');
  document.querySelectorAll('#cc-cat-filters .filter-chip').forEach(chip => {
    chip.classList.toggle('active', (chip.dataset.ccCat || '') === state.ccCatFilter);
  });
  renderComponentsCatalogList();
}

function renderComponentsCatalogList() {
  const container = document.getElementById('cc-list-container');
  if (!container) return;
  let list = cache.components || [];

  const catFilter = state.ccCatFilter || '';
  if (catFilter) list = list.filter(c => String(c.category_id) === catFilter);

  const q = ((document.getElementById('cc-search') || {}).value || '').toLowerCase().trim();
  if (q) {
    list = list.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.sku || '').toLowerCase().includes(q)
    );
  }

  if (!list.length) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-package-off"></i>' +
      ((cache.components && cache.components.length) ? 'Ничего не найдено' :
       canManageSales() ? 'Пока нет комплектующих. Нажми «+ Новое комплектующее»' :
       'Пока нет комплектующих') + '</div>';
    return;
  }

  // ЭТАП 33.2: группировка по категориям со сворачиваемыми заголовками
  const groups = {};
  list.forEach(c => {
    const cat = c.category_name || '—';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(c);
  });
  const sortMap = {};
  (cache.componentCategories || []).forEach(c => { sortMap[c.name] = c.sort_order || 0; });
  const catNames = Object.keys(groups).sort((a, b) =>
    (sortMap[a] || 999) - (sortMap[b] || 999) || a.localeCompare(b)
  );
  if (!state.ccListOpenCats) state.ccListOpenCats = {};
  const allOpen = !!q || !!catFilter;

  let html = '';
  catNames.forEach(cat => {
    const items = groups[cat];
    const isOpen = allOpen ? true : !!state.ccListOpenCats[cat];
    html += '<div class="comp-group">' +
      '<button type="button" class="comp-group-toggle' + (isOpen ? ' open' : '') + '" ' +
        'onclick="toggleCatalogGroup(\'' + cat.replace(/'/g, "\\'") + '\')">' +
        '<i class="ti ti-chevron-right comp-group-chev"></i>' +
        '<span>' + escapeHtml(cat) + '</span>' +
        '<span class="comp-group-count">' + items.length + '</span>' +
      '</button>' +
      '<div class="comp-group-body"' + (isOpen ? '' : ' style="display:none;"') + '>' +
        '<div class="comp-table">';
    items.forEach(c => {
      const defectQty = parseFloat(c.qty_defective || 0);
      const defectBadge = defectQty > 0
        ? ' <span class="comp-defect-badge" title="В браке — нажми чтобы посмотреть"><i class="ti ti-alert-triangle"></i>брак ' + _fmtQty(defectQty) + '</span>'
        : '';
      html += '<div class="comp-row" style="grid-template-columns: 1fr auto auto;cursor:pointer;" onclick="openComponentForm(' + c.id + ')">' +
        '<div class="comp-row-main">' +
          '<div class="comp-name">' + escapeHtml(c.name || '—') +
            (c.sku ? ' <span class="comp-sku">' + escapeHtml(c.sku) + '</span>' : '') +
          '</div>' +
          '<div class="comp-meta">' +
            'на складе: <b>' + _fmtQty(c.qty_on_stock) + '</b> ' + escapeHtml(c.unit || 'шт.') +
            defectBadge +
            (c.default_supplier_name ? ' · <i class="ti ti-truck" style="font-size:11px;"></i> ' + escapeHtml(c.default_supplier_name) : '') +
          '</div>' +
        '</div>' +
        '<button class="comp-defect-btn" onclick="event.stopPropagation();openMarkDefectiveModal(' + c.id + ',\'' + escapeHtml((c.name || '').replace(/\\\\/g, '\\\\\\\\').replace(/\'/g, "\\\\'")) + '\',' + (parseFloat(c.qty_on_stock) || 0) + ',\'' + escapeHtml(c.unit || 'шт.') + '\')" title="Пометить брак"><i class="ti ti-bandage"></i><span>Брак</span></button>' +
        '<div style="color:var(--text-light);font-size:18px;"><i class="ti ti-chevron-right"></i></div>' +
      '</div>';
    });
    html += '</div></div></div>';
  });
  container.innerHTML = html;
}

function toggleCatalogGroup(cat) {
  if (!state.ccListOpenCats) state.ccListOpenCats = {};
  state.ccListOpenCats[cat] = !state.ccListOpenCats[cat];
  renderComponentsCatalogList();
}



async function loadWarehouseComponents() {
  const newBtn = document.getElementById('comp-new-btn');
  if (newBtn) newBtn.style.display = canManageSales() ? '' : 'none';

  // Подгружаем категории
  if (!cache.componentCategories) {
    try {
      const r = await apiGet('/api/components/categories');
      cache.componentCategories = r.categories || [];
    } catch (e) {
      cache.componentCategories = [];
    }
  }
  // ЭТАП 33.2: всегда рендерим чипы (раньше пропускалось если кеш уже был)
  renderComponentCategoryChips();

  // Подгружаем список комплектующих
  const container = document.getElementById('comp-list-container');
  if (container) container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const r = await apiGet('/api/components');
    cache.components = r.components || [];
    renderComponentsList();
  } catch (e) {
    if (container) container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderComponentCategoryChips() {
  const wrap = document.getElementById('comp-cat-filters');
  if (!wrap) return;
  const active = state.componentCatFilter || '';
  let html = '<button class="filter-chip' + (active === '' ? ' active' : '') + '" data-comp-cat="" onclick="setComponentCategory(\'\')">Все</button>';
  (cache.componentCategories || []).forEach(c => {
    html += '<button class="filter-chip' + (active === String(c.id) ? ' active' : '') + '" data-comp-cat="' + c.id + '" onclick="setComponentCategory(\'' + c.id + '\')">' +
            escapeHtml(c.name) + '</button>';
  });
  // Кнопка создания нового раздела
  html += '<button class="filter-chip" style="border-style:dashed;color:var(--brand);" onclick="createComponentCategoryPrompt()"><i class="ti ti-plus" style="font-size:11px;"></i> Раздел</button>';
  wrap.innerHTML = html;
}

async function createComponentCategoryPrompt() {
  const name = prompt('Название нового раздела (например: Холодильное, Метизы, Расходники):', '');
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) {
    showToast('Название не может быть пустым', 'error');
    return;
  }
  try {
    const r = await apiPost('/api/components/categories', { name: trimmed });
    if (!r.ok) {
      showToast('Ошибка: ' + ((r.data && r.data.message) || ('HTTP ' + r.status)), 'error');
      return;
    }
    showToast('Раздел «' + trimmed + '» создан', 'success');
    // Обновляем кеш категорий + чипы + сбрасываем siState кеш чтобы выпадашки на УПД тоже обновились
    try {
      const cats = await apiGet('/api/components/categories');
      cache.componentCategories = (cats && (cats.categories || cats.items)) || [];
    } catch (e) { /* игнор */ }
    if (typeof siState !== 'undefined') siState.categories = null;
    // Перерисуем чипы — для обоих UI (старый Components list + новый PtDashboard)
    if (typeof renderComponentCategoryChips === 'function') renderComponentCategoryChips();
    if (typeof loadPartsDashboard === 'function') loadPartsDashboard();
  } catch (e) {
    showToast('Ошибка: ' + (e.message || e), 'error');
  }
}

function setComponentCategory(catId) {
  state.componentCatFilter = String(catId || '');
  document.querySelectorAll('#comp-cat-filters .filter-chip').forEach(chip => {
    chip.classList.toggle('active', (chip.dataset.compCat || '') === state.componentCatFilter);
  });
  renderComponentsList();
}

function filterComponentsList() {
  renderComponentsList();
}

function renderComponentsList() {
  const container = document.getElementById('comp-list-container');
  const counter = document.getElementById('comp-counter');
  if (!container) return;
  let list = cache.components || [];

  // Фильтр по чип-категории
  const catFilter = state.componentCatFilter || '';
  if (catFilter) {
    list = list.filter(c => String(c.category_id) === catFilter);
  }
  // Поиск
  const q = ((document.getElementById('comp-search') || {}).value || '').toLowerCase().trim();
  if (q) {
    list = list.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.sku || '').toLowerCase().includes(q)
    );
  }
  if (counter) counter.textContent = list.length;
  // ЭТАП 28.1: обновим бейдж таба
  if (typeof _updateWarehouseTabBadges === 'function') {
    _updateWarehouseTabBadges({ components: list.length });
  }

  if (!list.length) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-package-off"></i>' +
      (cache.components && cache.components.length ? 'Ничего не найдено' :
        'Пока нет комплектующих. Нажми «+ Комплектующее»') +
      '</div>';
    return;
  }

  // ЭТАП 33.2 + v2.33.7: группировка с цветным дизайном
  // Группируем
  const groups = {};
  list.forEach(c => {
    const cat = c.category_name || '—';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(c);
  });
  // v2.33.7: показываем и пустые категории (включая ту, что Дмитрий создал, но
  // ещё не наполнил — например УТМ). Только если нет активного фильтра/поиска.
  if (!catFilter && !q) {
    (cache.componentCategories || []).forEach(c => {
      if (c.is_active === false || c.is_active === 0) return;
      if (!groups[c.name]) groups[c.name] = [];
    });
  }
  // Сортируем по sort_order из componentCategories
  const sortMap = {};
  (cache.componentCategories || []).forEach(c => { sortMap[c.name] = c.sort_order || 0; });
  const catNames = Object.keys(groups).sort((a, b) =>
    (sortMap[a] || 999) - (sortMap[b] || 999) || a.localeCompare(b)
  );

  // Состояние раскрытости (по умолчанию: все свёрнуты для уменьшения шума,
  // кроме одного случая — когда категорий ≤ 2 или активный фильтр)
  if (!state.compListOpenCats) state.compListOpenCats = {};
  const isFiltered = !!catFilter;
  const isSearching = !!q;
  const allOpen = isSearching || isFiltered;

  let html = '';
  catNames.forEach(cat => {
    const items = groups[cat];
    let isOpen = allOpen;
    if (!allOpen) {
      // если состояние не задано — по умолчанию свёрнуто
      isOpen = !!state.compListOpenCats[cat];
    }
    const catPretty = _nvCapitalize(cat);
    const palCls = _nvPaletteClass(cat);
    const iconCls = _nvIconFor(cat);
    html += '<div class="comp-group">' +
      '<button type="button" class="comp-group-toggle ' + palCls + (isOpen ? ' open' : '') + '" ' +
        'onclick="toggleComponentsGroup(\'' + cat.replace(/'/g, "\\'") + '\')">' +
        '<i class="ti ti-chevron-right comp-group-chev"></i>' +
        '<span class="nv-group-icon"><i class="ti ' + iconCls + '"></i></span>' +
        '<span class="cg-name">' + escapeHtml(catPretty) + '</span>' +
        '<span class="comp-group-count">' + items.length + '</span>' +
      '</button>' +
      '<div class="comp-group-body"' + (isOpen ? '' : ' style="display:none;"') + '>' +
        (items.length === 0
          ? '<div class="empty-block" style="padding:16px;color:var(--text-faint);font-style:italic;">Пока нет комплектующих в этом разделе</div>'
          : '<div class="comp-table">');
    items.forEach(c => {
      const lowStock = (c.min_stock > 0 && c.qty_on_stock < c.min_stock);
      const zeroStock = (c.qty_on_stock <= 0);
      html += '<div class="comp-row">' +
        '<div class="comp-row-main" onclick="openComponentDetail(' + c.id + ')">' +
          '<div class="comp-name">' + _highlightAisi(c.name || '—') +
            (c.sku ? ' <span class="comp-sku">' + escapeHtml(c.sku) + '</span>' : '') +
            (c.execution_type === 'stainless' ? ' <span class="comp-exec-badge aisi" title="Нержавейка AISI">AISI</span>' : '') +
          '</div>' +
          '<div class="comp-meta">' +
            (c.default_supplier_name ? '<i class="ti ti-truck" style="font-size:11px;"></i> ' + escapeHtml(c.default_supplier_name) : '<span style="color:var(--text-light);">без поставщика</span>') +
          '</div>' +
        '</div>' +
        '<div class="comp-row-qty ' + (zeroStock ? 'zero' : (lowStock ? 'low' : '')) + '">' +
          '<div class="comp-qty-num">' + _fmtQty(c.qty_on_stock) + '</div>' +
          '<div class="comp-qty-unit">' + escapeHtml(c.unit || 'шт.') + '</div>' +
        '</div>' +
        '<div class="comp-row-actions">' +
          '<button class="btn btn-secondary btn-small" title="Приход" onclick="openComponentReceiveModal(' + c.id + ')"><i class="ti ti-package-import"></i></button>' +
          '<button class="btn btn-secondary btn-small" title="Списать" onclick="openComponentWriteoffModal(' + c.id + ')"><i class="ti ti-package-export"></i></button>' +
          '<button class="btn btn-secondary btn-small" title="История" onclick="openComponentMovements(' + c.id + ')"><i class="ti ti-history"></i></button>' +
        '</div>' +
      '</div>';
    });
    // Закрываем .comp-table только если открывали (items.length > 0)
    if (items.length > 0) html += '</div>';
    // Закрываем .comp-group-body и .comp-group
    html += '</div></div>';
  });
  container.innerHTML = html;
}

function toggleComponentsGroup(cat) {
  if (!state.compListOpenCats) state.compListOpenCats = {};
  state.compListOpenCats[cat] = !state.compListOpenCats[cat];
  renderComponentsList();
}

function _fmtQty(q) {
  const n = Number(q || 0);
  if (n === Math.round(n)) return String(Math.round(n));
  return n.toFixed(2);
}

// ============ Создание / редактирование комплектующего ============

async function openComponentForm(componentId) {
  if (!canManageSales()) {
    showToast('Доступ только директору и заму', 'error');
    return;
  }
  const isEdit = !!componentId;
  const c = isEdit ? (cache.components || []).find(x => x.id === componentId) : null;
  const cats = cache.componentCategories || [];

  // ЭТАП 33: подгружаем поставщиков если ещё нет
  if (!cache.suppliers) {
    try {
      const r = await apiGet('/api/suppliers');
      cache.suppliers = r.suppliers || [];
    } catch (e) { cache.suppliers = []; }
  }
  const suppliers = cache.suppliers || [];

  let m = document.getElementById('comp-form-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'comp-form-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) closeComponentForm(); };
    document.body.appendChild(m);
  }
  const catOptions = cats.map(cat =>
    '<option value="' + cat.id + '"' + (c && c.category_id === cat.id ? ' selected' : '') + '>' +
    escapeHtml(cat.name) + '</option>'
  ).join('');
  // v2.43.87: поиск поставщика через <datalist> — нативный браузерный autocomplete.
  // В datalist хранятся имена; скрытое поле cf-supplier держит id (как и раньше).
  const supDatalist = suppliers.map(s =>
    '<option value="' + escapeHtml(s.name) + '">'
  ).join('');
  const curSup = (c && c.default_supplier_id)
    ? suppliers.find(s => s.id === c.default_supplier_id)
    : null;
  const curSupName = curSup ? curSup.name : '';
  const curSupId = curSup ? curSup.id : '';

  // ЭТАП 28.3.1: подгружаем supply_items для выпадашки связи
  if (!cache.supplyCatalog) {
    try {
      const dCat = await apiGet('/api/supply-items');
      cache.supplyCatalog = dCat.items || dCat.supply_items || [];
    } catch (e) { cache.supplyCatalog = []; }
  }
  // v2.44.27: siOptions больше не нужны — dropdown «Связь со снабжением» убран из формы

  // v2.44.30: для ТЭНов — отдельные поля «куда идёт» и «кВт».
  // Определяем по названию категории (содержит «тэн»).
  const _isTenCategory = (catId) => {
    if (!catId) return false;
    const cat = cats.find(x => x.id === catId);
    return !!(cat && /тэн/i.test(cat.name || ''));
  };
  const initialCatId = (c && c.category_id) || (cats[0] && cats[0].id) || 0;
  const isTen = _isTenCategory(initialCatId);
  // Подгружаем модели для пикера, если ТЭН
  if (isTen && !cache.models) {
    try {
      cache.models = await apiGet('/api/models');
    } catch (e) { cache.models = { models: [] }; }
  }
  const allModels = (cache.models && cache.models.models) || [];
  // v2.44.31: target_model_ids — массив. Парсим из JSON-строки если пришёл сырой
  // (бэк отдаёт как есть), либо берём массив, либо fallback на target_model_id.
  let curTargetIds = [];
  if (c) {
    const raw = c.target_model_ids;
    if (Array.isArray(raw)) curTargetIds = raw.slice();
    else if (typeof raw === 'string' && raw.trim()) {
      try { const arr = JSON.parse(raw); if (Array.isArray(arr)) curTargetIds = arr; } catch (_) {}
    }
    if (!curTargetIds.length && c.target_model_id) curTargetIds = [c.target_model_id];
  }
  curTargetIds = curTargetIds.map(x => parseInt(x, 10)).filter(x => !Number.isNaN(x));
  // Состояние пикера держим в окне чтобы пикер-модал мог его читать/писать
  window._tenTargetIds = curTargetIds.slice();

  // v2.43.87: модалка с max-height + flex-column, тело внутри прокручивается
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:520px;max-height:92vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-tool"></i> ' + (isEdit ? 'Редактировать' : 'Новое') + ' комплектующее</h3>' +
        '<button class="modal-close" onclick="closeComponentForm()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:18px;flex:1;overflow-y:auto;min-height:0;">' +
        '<label class="form-label">Категория *</label>' +
        '<select id="cf-category" class="form-input" style="margin-bottom:14px;">' +
          (cats.length ? catOptions : '<option value="">— нет категорий —</option>') +
        '</select>' +
        '<label class="form-label">Название *</label>' +
        '<input type="text" id="cf-name" class="form-input" placeholder="Например: Реле РЭК-77/4" value="' + escapeHtml((c && c.name) || '') + '" oninput="_cfAutoUnit(this.value)" style="margin-bottom:14px;" />' +
        '<div style="display:flex;gap:10px;margin-bottom:14px;">' +
          '<div style="flex:2;"><label class="form-label">Артикул / SKU</label>' +
            '<input type="text" id="cf-sku" class="form-input" value="' + escapeHtml((c && c.sku) || '') + '" /></div>' +
          '<div style="flex:1;"><label class="form-label">Единица</label>' +
            '<select id="cf-unit" class="form-input">' +
              ['шт.','м','кг','л','компл.','уп.','м²'].map(u =>
                '<option' + ((c && c.unit === u) || (!c && u === 'шт.') ? ' selected' : '') + '>' + u + '</option>'
              ).join('') +
            '</select></div>' +
        '</div>' +
        // v2.41.0 / v2.44.30: исполнение материала.
        // Для ТЭНов всегда нержавейка — toggle блокируется.
        '<label class="form-label">Исполнение материала' +
          (isTen ? ' <span style="color:var(--text-light);font-weight:400;font-size:11px;">(ТЭН всегда нержавейка)</span>' : '') +
        '</label>' +
        '<div class="exec-toggle" style="margin-bottom:14px;' + (isTen ? 'opacity:0.7;pointer-events:none;' : '') + '">' +
          '<label class="exec-toggle-opt"><input type="radio" name="cf-exec" value="standard"' +
            (!isTen && !(c && c.execution_type === 'stainless') ? ' checked' : '') +
            (isTen ? ' disabled' : '') + '> ' +
            '<span><i class="ti ti-tools"></i> Сталь</span></label>' +
          '<label class="exec-toggle-opt"><input type="radio" name="cf-exec" value="stainless"' +
            (isTen || (c && c.execution_type === 'stainless') ? ' checked' : '') + '> ' +
            '<span><i class="ti ti-shield"></i> AISI (нержавейка)</span></label>' +
        '</div>' +
        // v2.44.31: для ТЭНов — multi-select моделей + мощность
        (isTen ? (
          '<label class="form-label">Куда идёт (можно несколько моделей)</label>' +
          '<div id="cf-target-models-box" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;' +
            'margin-bottom:8px;min-height:40px;padding:8px;border:1px solid var(--border);border-radius:10px;background:#fafbfd;">' +
            _renderTargetModelsChips(curTargetIds, allModels) +
          '</div>' +
          '<button type="button" class="btn btn-secondary btn-sm" onclick="openTargetModelPickerModal()" style="margin-bottom:14px;">' +
            '<i class="ti ti-plus"></i> Добавить модель' +
          '</button>' +
          '<label class="form-label">Мощность, кВт</label>' +
          '<input type="number" id="cf-power-kw" class="form-input" min="0" step="0.1" ' +
            'value="' + ((c && c.power_kw != null) ? c.power_kw : '') + '" ' +
            'placeholder="Например: 2.5" style="margin-bottom:14px;" />'
        ) : '') +
        '<label class="form-label">Основной поставщик</label>' +
        '<div style="display:flex;gap:8px;margin-bottom:14px;align-items:stretch;">' +
          '<input type="text" id="cf-supplier-name" list="cf-suppliers-dl" class="form-input" ' +
            'style="flex:1;margin:0;" placeholder="Начни вводить название или нажми 🔍" ' +
            'value="' + escapeHtml(curSupName) + '" ' +
            'oninput="onComponentSupplierChange()" ' +
            'onclick="openSupplierPickerModal()" readonly>' +
          '<datalist id="cf-suppliers-dl">' + supDatalist + '</datalist>' +
          '<input type="hidden" id="cf-supplier" value="' + (curSupId || '') + '">' +
          '<button type="button" class="btn btn-primary" onclick="openSupplierPickerModal()" ' +
            'title="Выбрать поставщика из списка"><i class="ti ti-search"></i></button>' +
          '<button type="button" class="btn btn-secondary" id="cf-sup-open-btn" ' +
            'onclick="openSupplierFromComponent()" ' +
            'title="Открыть карточку поставщика"' +
            (curSupId ? '' : ' disabled style="opacity:0.5;cursor:not-allowed;"') +
            '><i class="ti ti-external-link"></i></button>' +
        '</div>' +
        // ЭТАП 34.1: кнопка корзины закупки (заглушка — раздел Снабжение скоро)
        '<div style="display:flex;gap:8px;margin-bottom:14px;">' +
          '<button type="button" class="btn btn-secondary" style="flex:1;" ' +
            'onclick="addComponentToPurchaseCart(' + (componentId || 'null') + ')">' +
            '<i class="ti ti-shopping-cart-plus"></i> В корзину закупки' +
          '</button>' +
        '</div>' +
        '<label class="form-label">Мин. остаток (для алертов)</label>' +
        '<input type="number" id="cf-min" class="form-input" value="' + ((c && c.min_stock) || 0) + '" min="0" step="0.01" style="margin-bottom:14px;" />' +
        // v2.45.436: «сколько заказывать» — фиксированное кол-во к заказу при низком
        // остатке. Пусто = авто (заказываем дефицит до минимума).
        '<label class="form-label">Сколько заказывать <span style="color:var(--text-light);font-weight:400;font-size:11px;">(фикс. кол-во при низком остатке; пусто = авто до минимума)</span></label>' +
        '<input type="number" id="cf-reorder" class="form-input" value="' + ((c && c.reorder_qty) || '') + '" min="0" step="0.01" placeholder="напр. 2 (при остатке ≤ минимума заказать 2 шт)" style="margin-bottom:14px;" />' +
        // v2.45.217: кратность закупки (фасовка/бухта) — в «Что закупить» количество
        // округляется вверх до кратного (наконечники по 100, провод по 40/50 м).
        '<label class="form-label">Кратность закупки <span style="color:var(--text-light);font-weight:400;font-size:11px;">(фасовка/бухта — закупаем кратно; пусто = поштучно)</span></label>' +
        '<input type="number" id="cf-pack" class="form-input" value="' + ((c && c.purchase_pack) || '') + '" min="0" step="0.01" placeholder="напр. 100 (наконечники) или 40 (провод)" style="margin-bottom:14px;" />' +
        // v2.44.27: «Связь со снабжением» убрана из UI — путала пользователя
        // (выпадающий список показывал кучу непонятных позиций). Поле в БД
        // остаётся, можно проставить через PATCH /api/components/{id} если нужно.
        '<input type="hidden" id="cf-supply-item" value="' + ((c && c.supply_item_id) || '') + '">' +
        '<label class="form-label">Комментарий</label>' +
        '<textarea id="cf-comment" class="form-input" rows="2" style="resize:vertical;">' + escapeHtml((c && c.comment) || '') + '</textarea>' +
      '</div>' +
      '<div style="padding:14px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">' +
        (isEdit ?
          '<button class="btn btn-secondary" onclick="deleteComponent(' + componentId + ')" style="color:var(--danger);margin-right:auto;">' +
            '<i class="ti ti-trash"></i> Удалить</button>' : '') +
        // v2.41.0: дублирование в нерж — только для существующих стальных позиций с артикулом
        ((isEdit && c && c.execution_type !== 'stainless' && c.sku) ?
          '<button class="btn btn-secondary" onclick="duplicateComponentStainless(' + componentId + ')" title="Создать копию для нержавейки AISI">' +
            '<i class="ti ti-copy"></i> Создать AISI-копию</button>' : '') +
        '<button class="btn btn-secondary" onclick="closeComponentForm()">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitComponentForm(' + (componentId || 'null') + ')"><i class="ti ti-check"></i> Сохранить</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  setTimeout(() => { const n = document.getElementById('cf-name'); if (n) n.focus(); }, 50);
  // Разбивка остатка по маркам (обобщённый компонент → Hisense 3 / Royal 2)
  if (componentId) {
    (async () => {
      try {
        const d = await apiGet('/api/components/' + componentId + '/brands');
        const brands = (d && d.brands) || [];
        if (!brands.length) return;
        const chips = brands.map(b =>
          '<span style="display:inline-block;background:#EEF2FF;color:#3730A3;border-radius:8px;padding:2px 8px;margin:2px 4px 2px 0;font-size:12px;">' +
          escapeHtml(b.brand) + ' — <b>' + _fmtQty(b.qty) + '</b></span>'
        ).join('');
        const box = document.createElement('div');
        box.style.cssText = 'padding:10px 18px;border-bottom:1px solid var(--border);background:#FAFAFE;';
        box.innerHTML = '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-light);margin-bottom:4px;"><i class="ti ti-tags"></i> Марки на складе</div>' + chips;
        const modalEl = m.querySelector('.modal');
        const header = modalEl && modalEl.querySelector('.modal-header');
        if (header && header.parentNode) header.parentNode.insertBefore(box, header.nextSibling);
        else if (modalEl) modalEl.insertBefore(box, modalEl.firstChild);
      } catch (e) { /* марок нет — не показываем */ }
    })();
  }
}

function closeComponentForm() {
  const m = document.getElementById('comp-form-modal');
  if (m) m.classList.remove('visible');
}

// v2.45.213: кабель/провод меряется в метрах — авто-переключаем единицу с «шт.»
// на «м» при вводе названия (вручную можно вернуть назад).
function _cfAutoUnit(name) {
  const sel = document.getElementById('cf-unit');
  if (!sel) return;
  if (/кабель|провод/i.test(name || '') && sel.value === 'шт.') sel.value = 'м';
}

// ============ ЭТАП 34.1: кнопки «Карточка поставщика» и «Корзина закупки» ============

function onComponentSupplierChange() {
  // v2.43.87: поставщик теперь ищется по имени через datalist. Тянем id из
  // cache.suppliers по точному совпадению name и кладём в hidden cf-supplier.
  const nameInp = document.getElementById('cf-supplier-name');
  const hidden = document.getElementById('cf-supplier');
  const btn = document.getElementById('cf-sup-open-btn');
  if (!hidden) return;
  let supId = '';
  if (nameInp) {
    const name = (nameInp.value || '').trim();
    if (name) {
      const sup = (cache.suppliers || []).find(s => (s.name || '').trim() === name);
      if (sup) supId = String(sup.id);
    }
  }
  hidden.value = supId;
  if (btn) {
    const hasValue = !!supId;
    btn.disabled = !hasValue;
    btn.style.opacity = hasValue ? '' : '0.5';
    btn.style.cursor = hasValue ? '' : 'not-allowed';
  }
}

// v2.44.29: модал выбора поставщика — кликабельный список с поиском.
// Срабатывает по клику на input или на лупу.
async function openSupplierPickerModal() {
  // Гарантируем что cache.suppliers подгружен
  if (!cache.suppliers || !cache.suppliers.length) {
    try {
      const r = await apiGet('/api/suppliers');
      cache.suppliers = r.suppliers || [];
    } catch (e) { cache.suppliers = []; }
  }
  const suppliers = (cache.suppliers || []).filter(s => s.is_active !== 0);

  let modal = document.getElementById('sup-picker-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'sup-picker-modal';
    modal.className = 'modal-overlay';
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('visible'); };
    modal.innerHTML = '<div class="modal" style="max-width:520px;max-height:80vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-truck"></i> Выбрать поставщика</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'sup-picker-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:14px 16px;">' +
        '<input type="text" id="sup-picker-search" class="form-input" placeholder="Поиск по названию…" autocomplete="off" oninput="filterSupplierPicker(this.value)">' +
      '</div>' +
      '<div id="sup-picker-list" style="flex:1;overflow-y:auto;padding:0 8px 8px;"></div>' +
    '</div>';
    document.body.appendChild(modal);
  }

  // Сохраняем суплаеров для фильтра + рендерим
  window._supPickerAll = suppliers;
  filterSupplierPicker('');
  modal.classList.add('visible');
  setTimeout(() => {
    const s = document.getElementById('sup-picker-search');
    if (s) { s.value = ''; s.focus(); }
  }, 50);
}

function filterSupplierPicker(query) {
  const list = document.getElementById('sup-picker-list');
  if (!list) return;
  const q = (query || '').trim().toLowerCase();
  const all = window._supPickerAll || [];
  const filtered = q
    ? all.filter(s => (s.name || '').toLowerCase().includes(q))
    : all;

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-block" style="padding:18px;text-align:center;color:var(--text-light);">' +
      (q ? 'Ничего не нашлось' : 'Список поставщиков пуст') + '</div>';
    return;
  }

  const curHidden = document.getElementById('cf-supplier');
  const curId = curHidden ? curHidden.value : '';
  list.innerHTML = filtered.map(s => {
    const isActive = String(s.id) === String(curId);
    return '<button type="button" class="sup-pick-row' + (isActive ? ' active' : '') + '" ' +
      'onclick="pickSupplierFromPicker(' + s.id + ', ' + JSON.stringify(s.name).replace(/"/g, '&quot;') + ')">' +
      '<i class="ti ti-truck"></i>' +
      '<span class="sup-pick-name">' + escapeHtml(s.name || '—') + '</span>' +
      (s.inn ? '<span class="sup-pick-inn">ИНН ' + escapeHtml(s.inn) + '</span>' : '') +
      (isActive ? '<i class="ti ti-check" style="margin-left:auto;color:var(--brand);"></i>' : '') +
    '</button>';
  }).join('');
}

// v2.44.31: multi-select моделей для ТЭНов
function _renderTargetModelsChips(ids, allModels) {
  if (!ids || !ids.length) {
    return '<span style="color:var(--text-faint);font-size:12.5px;padding:4px 6px;">Ни одной модели не выбрано</span>';
  }
  const byId = {};
  (allModels || []).forEach(m => { byId[m.id] = m; });
  return ids.map(id => {
    const m = byId[id];
    const label = m ? (m.name || ('#' + id)) : ('#' + id);
    return '<span class="cf-tm-chip" data-id="' + id + '">' +
      '<i class="ti ti-package"></i>' +
      '<span>' + escapeHtml(label) + '</span>' +
      '<button type="button" class="cf-tm-chip-x" onclick="removeTargetModel(' + id + ')" title="Убрать">' +
        '<i class="ti ti-x"></i></button>' +
    '</span>';
  }).join('');
}

function _refreshTargetModelsBox() {
  const box = document.getElementById('cf-target-models-box');
  if (!box) return;
  const allModels = (cache.models && cache.models.models) || [];
  box.innerHTML = _renderTargetModelsChips(window._tenTargetIds || [], allModels);
}

function removeTargetModel(modelId) {
  if (!window._tenTargetIds) window._tenTargetIds = [];
  window._tenTargetIds = window._tenTargetIds.filter(x => x !== modelId);
  _refreshTargetModelsBox();
}

async function openTargetModelPickerModal() {
  if (!cache.models) {
    try { cache.models = await apiGet('/api/models'); }
    catch (e) { cache.models = { models: [] }; }
  }
  const models = (cache.models && cache.models.models) || [];

  let modal = document.getElementById('target-model-picker-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'target-model-picker-modal';
    modal.className = 'modal-overlay';
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('visible'); };
    modal.innerHTML = '<div class="modal" style="max-width:520px;max-height:80vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-package"></i> Выбрать модели</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'target-model-picker-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:14px 16px;">' +
        '<input type="text" id="tmp-search" class="form-input" placeholder="Поиск по названию или артикулу…" autocomplete="off" oninput="filterTargetModelPicker(this.value)">' +
        '<div style="font-size:11.5px;color:var(--text-light);margin-top:6px;">Клик по строке — добавить/убрать модель. Можно выбрать несколько.</div>' +
      '</div>' +
      '<div id="tmp-list" style="flex:1;overflow-y:auto;padding:0 8px 8px;"></div>' +
      '<div style="padding:12px 16px;border-top:1px solid var(--border);text-align:right;">' +
        '<button type="button" class="btn btn-primary" onclick="document.getElementById(\'target-model-picker-modal\').classList.remove(\'visible\')">' +
          '<i class="ti ti-check"></i> Готово</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(modal);
  }

  window._targetModelAll = models;
  filterTargetModelPicker('');
  modal.classList.add('visible');
  setTimeout(() => {
    const s = document.getElementById('tmp-search');
    if (s) { s.value = ''; s.focus(); }
  }, 50);
}

function filterTargetModelPicker(query) {
  const list = document.getElementById('tmp-list');
  if (!list) return;
  const q = (query || '').trim().toLowerCase();
  const all = window._targetModelAll || [];
  const selected = new Set((window._tenTargetIds || []).map(Number));
  const filtered = q
    ? all.filter(m =>
        ((m.name || '').toLowerCase().includes(q)) ||
        ((m.article || '').toLowerCase().includes(q))
      )
    : all;

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-block" style="padding:18px;text-align:center;color:var(--text-light);">' +
      (q ? 'Ничего не нашлось' : 'Список моделей пуст') + '</div>';
    return;
  }
  list.innerHTML = filtered.slice(0, 100).map(m => {
    const isSel = selected.has(Number(m.id));
    return '<button type="button" class="sup-pick-row' + (isSel ? ' active' : '') + '" ' +
      'onclick="toggleTargetModel(' + m.id + ')">' +
      '<i class="ti ti-package"></i>' +
      '<span class="sup-pick-name">' + escapeHtml(m.name || '—') + '</span>' +
      (m.article ? '<span class="sup-pick-inn">' + escapeHtml(m.article) + '</span>' : '') +
      '<i class="ti ' + (isSel ? 'ti-check' : 'ti-plus') + '" style="margin-left:auto;color:var(--brand);"></i>' +
    '</button>';
  }).join('');
}

function toggleTargetModel(modelId) {
  if (!window._tenTargetIds) window._tenTargetIds = [];
  const i = window._tenTargetIds.indexOf(modelId);
  if (i >= 0) {
    window._tenTargetIds.splice(i, 1);
  } else {
    window._tenTargetIds.push(modelId);
  }
  _refreshTargetModelsBox();
  // Перерисуем список в модале чтобы галочки/плюсы обновились
  const search = document.getElementById('tmp-search');
  filterTargetModelPicker(search ? search.value : '');
}

function pickSupplierFromPicker(supplierId, supplierName) {
  const nameInp = document.getElementById('cf-supplier-name');
  const hidden = document.getElementById('cf-supplier');
  if (nameInp) nameInp.value = supplierName || '';
  if (hidden) hidden.value = String(supplierId);
  // Кнопка «Открыть карточку» становится активной
  const btn = document.getElementById('cf-sup-open-btn');
  if (btn) {
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.cursor = '';
  }
  const modal = document.getElementById('sup-picker-modal');
  if (modal) modal.classList.remove('visible');
}

async function openSupplierFromComponent() {
  const sel = document.getElementById('cf-supplier');
  if (!sel || !sel.value) {
    showToast('Сначала выбери поставщика', 'error');
    return;
  }
  const supplierId = parseInt(sel.value);
  closeComponentForm();
  try {
    if (typeof openEditSupplier === 'function') {
      await openEditSupplier(supplierId);
    } else {
      showToast('Раздел поставщиков недоступен', 'error');
    }
  } catch (e) {
    showToast('Не удалось открыть поставщика', 'error');
  }
}

function addComponentToPurchaseCart(componentId) {
  if (!componentId) {
    showToast('Сначала сохрани комплектующее', 'error');
    return;
  }
  const c = (cache.components || []).find(x => x.id === componentId);
  if (!c) {
    showToast('Комплектующее не найдено', 'error');
    return;
  }
  if (!state.purchaseCart) {
    try {
      state.purchaseCart = JSON.parse(localStorage.getItem('atomus_purchase_cart') || '[]');
    } catch (e) { state.purchaseCart = []; }
  }
  const exist = state.purchaseCart.find(x => x.component_id === componentId);
  if (exist) {
    exist.qty = (exist.qty || 1) + 1;
    showToast('Уже в корзине · теперь ' + exist.qty + ' шт.', 'success');
  } else {
    state.purchaseCart.push({
      component_id: componentId,
      name: c.name,
      supplier_id: c.default_supplier_id || null,
      supplier_name: c.default_supplier_name || '',
      unit: c.unit || 'шт.',
      qty: 1,
    });
    showToast('В корзину закупки (' + state.purchaseCart.length + ' поз.)', 'success');
  }
  try {
    localStorage.setItem('atomus_purchase_cart', JSON.stringify(state.purchaseCart));
  } catch (e) { /* ignore */ }
}


async function submitComponentForm(componentId) {
  const supVal = (document.getElementById('cf-supplier') || {}).value || '';
  const siVal = (document.getElementById('cf-supply-item') || {}).value || '';
  const execRadio = document.querySelector('input[name="cf-exec"]:checked');
  // v2.44.31: ТЭН-поля (могут отсутствовать в DOM если категория не ТЭН)
  const tmBox = document.getElementById('cf-target-models-box');
  const pwInp = document.getElementById('cf-power-kw');
  const data = {
    category_id: parseInt(document.getElementById('cf-category').value),
    name: (document.getElementById('cf-name').value || '').trim(),
    sku: (document.getElementById('cf-sku').value || '').trim(),
    unit: document.getElementById('cf-unit').value,
    min_stock: parseFloat(document.getElementById('cf-min').value || 0),
    purchase_pack: ((document.getElementById('cf-pack') || {}).value || '').trim() === ''
      ? null : parseFloat(document.getElementById('cf-pack').value),
    reorder_qty: ((document.getElementById('cf-reorder') || {}).value || '').trim() === ''
      ? null : parseFloat(document.getElementById('cf-reorder').value),
    comment: (document.getElementById('cf-comment').value || '').trim(),
    default_supplier_id: supVal ? parseInt(supVal) : null,
    supply_item_id: siVal ? parseInt(siVal) : null,
    execution_type: execRadio ? execRadio.value : 'standard',
  };
  if (tmBox) {
    const ids = (window._tenTargetIds || []).map(x => parseInt(x, 10)).filter(x => !Number.isNaN(x));
    data.target_model_ids = ids;
    data.target_model_id = ids[0] || null;   // совместимость со старым полем
  }
  if (pwInp) {
    const v = (pwInp.value || '').trim();
    data.power_kw = v === '' ? null : parseFloat(v);
  }
  if (!data.name) { showToast('Укажи название', 'error'); return; }
  if (!data.category_id) { showToast('Выбери категорию', 'error'); return; }

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const method = componentId ? 'PATCH' : 'POST';
    const url = componentId ? '/api/components/' + componentId : '/api/components';
    const r = await fetch(API_BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось сохранить', 'error');
      return;
    }
    // v2.44.32: если был sync BOM целевых моделей — показываем подробный тост
    const resp = await r.json().catch(() => ({}));
    const sync = resp && (resp.bom_sync || resp._bom_sync);
    if (sync && sync.models_synced) {
      const parts = ['Обновлено BOM в ' + sync.models_synced + ' ' +
        (sync.models_synced === 1 ? 'модели' : 'моделях')];
      if (sync.removed) parts.push('удалено старых ТЭНов: ' + sync.removed);
      showToast((componentId ? 'Сохранено' : 'Комплектующее добавлено') +
        ' · ' + parts.join(', '), 'success');
    } else {
      showToast(componentId ? 'Сохранено' : 'Комплектующее добавлено', 'success');
    }
    closeComponentForm();
    cache.components = null;
    // Перезагрузим текущий активный таб (новый или старый рендер)
    if (state.activeWarehouseTab === 'components' && typeof loadPartsDashboard === 'function') {
      loadPartsDashboard();
    } else if (typeof loadWarehouseComponents === 'function') {
      loadWarehouseComponents();
    }
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// v2.41.0: создать нерж-копию компонента
async function duplicateComponentStainless(componentId) {
  if (!confirm('Создать копию этого компонента для нержавейки AISI?\n\nАртикул останется тот же, qty=0. Затем оприходуй её обычным «Приходом».')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/components/' + componentId + '/duplicate-stainless', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.message || 'Не удалось создать', 'error');
      return;
    }
    const created = await r.json();
    showToast('AISI-копия создана: ' + (created.name || ''), 'success');
    closeComponentForm();
    cache.components = null;
    if (state.activeWarehouseTab === 'components' && typeof loadPartsDashboard === 'function') loadPartsDashboard();
    else if (typeof loadWarehouseComponents === 'function') loadWarehouseComponents();
    // Сразу откроем созданную карточку
    setTimeout(() => openComponentForm(created.id), 350);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// v2.41.0: открыть модалку «Импорт BOM из текста» для модели
function openBomImportFromText(modelId, modelName) {
  state._bomImportModelId = modelId;
  let m = document.getElementById('bom-import-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'bom-import-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) closeBomImportModal(); };
    document.body.appendChild(m);
  }
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:880px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-clipboard-data"></i> Импорт BOM (Excel / текст)' +
          (modelName ? ' — ' + escapeHtml(modelName) : '') + '</h3>' +
        '<button class="modal-close" onclick="closeBomImportModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:18px;max-height:70vh;overflow:auto;">' +
        // v2.45.220: загрузка Excel + скачивание шаблона
        '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">' +
          '<button class="btn btn-secondary btn-small" onclick="downloadBomTemplate()"><i class="ti ti-file-download"></i> Скачать шаблон Excel</button>' +
          '<label class="btn btn-secondary btn-small" style="cursor:pointer;"><i class="ti ti-file-upload"></i> Загрузить Excel' +
            '<input type="file" accept=".xlsx,.xls" style="display:none;" onchange="uploadBomExcel(this)"></label>' +
        '</div>' +
        '<p style="margin:0 0 10px;color:var(--text-mid);">' +
          '<b>Excel:</b> скачай шаблон, заполни (Кол-во · Исполнение · Артикул · Наименование) и загрузи — строки подставятся ниже. ' +
          '<b>Или текст:</b> скопируй колонку из Excel и вставь сюда. <b>«N» в скобках = AISI</b>.' +
        '</p>' +
        '<textarea id="bom-import-text" rows="8" placeholder="(1) AG-16.002.002 Кронштейн левый (лист 1мм) ГИБКА&#10;(0,8N) AG-10.002.004 Прижим ГИБКА&#10;..." ' +
          'style="width:100%;box-sizing:border-box;font-family:Menlo,Consolas,monospace;font-size:13px;padding:10px;border:1px solid var(--border);border-radius:8px;"></textarea>' +
        '<div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap;">' +
          '<button class="btn btn-secondary" onclick="previewBomImport()"><i class="ti ti-eye"></i> Проверить</button>' +
          '<label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text-mid);">' +
            '<input type="checkbox" id="bom-replace-existing"> Заменить существующий BOM</label>' +
          '<label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text-mid);">' +
            '<input type="checkbox" id="bom-accept-wrong"> Принимать с другим исполнением</label>' +
          // v2.45.221: создавать новые позиции для «не найденных» строк
          '<label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text-mid);" title="Если позиции нет в каталоге — создать её и добавить в BOM">' +
            '<input type="checkbox" id="bom-create-missing" checked onchange="_updateBomImportGo()"> Создавать недостающие позиции</label>' +
        '</div>' +
        '<div id="bom-import-preview" style="margin-top:14px;"></div>' +
      '</div>' +
      '<div style="padding:14px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn btn-secondary" onclick="closeBomImportModal()">Отмена</button>' +
        '<button class="btn btn-primary" id="bom-import-go" onclick="confirmBomImport()" disabled>' +
          '<i class="ti ti-download"></i> Импортировать</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

function closeBomImportModal() {
  const m = document.getElementById('bom-import-modal');
  if (m) m.classList.remove('visible');
  state._bomImportPreview = null;
}

// v2.45.220: скачать шаблон Excel для BOM
async function downloadBomTemplate() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/bom/template.xlsx', { headers: { 'Authorization': 'Bearer ' + token } });
    if (!r.ok) { showToast('Не удалось скачать шаблон', 'error'); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'bom_template.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) { showToast('Ошибка скачивания', 'error'); }
}

// v2.45.220: загрузить Excel → подставить строки в текст BOM → авто-проверка
async function uploadBomExcel(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  const box = document.getElementById('bom-import-preview');
  if (box) box.innerHTML = '<div class="loading-block">Читаем Excel…</div>';
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch(API_BASE + '/api/bom/excel-to-text', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { if (box) box.innerHTML = ''; showToast(d.message || 'Не удалось прочитать Excel', 'error'); input.value = ''; return; }
    const ta = document.getElementById('bom-import-text');
    if (ta) ta.value = d.text || '';
    if (box) box.innerHTML = '';
    showToast('Загружено строк: ' + (d.rows || 0) + '. Проверяем…', 'success');
    if (typeof previewBomImport === 'function') previewBomImport();
  } catch (e) { showToast('Ошибка загрузки файла', 'error'); }
  input.value = '';
}

async function previewBomImport() {
  const ta = document.getElementById('bom-import-text');
  const text = (ta && ta.value || '').trim();
  if (!text) { showToast('Вставь текст BOM', 'error'); return; }
  const box = document.getElementById('bom-import-preview');
  box.innerHTML = '<div class="loading-block">Разбираем…</div>';
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/bom/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      box.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i> ' + escapeHtml(e.message || 'Ошибка разбора') + '</div>';
      return;
    }
    const d = await r.json();
    state._bomImportPreview = d;
    _renderBomPreview(box, d);
    _updateBomImportGo();
  } catch (e) {
    box.innerHTML = '<div class="empty-block">Ошибка соединения</div>';
  }
}

function _renderBomPreview(box, data) {
  const s = data.summary || {};
  let html =
    '<div class="bom-preview-summary">' +
      '<span class="bom-pill ok"><i class="ti ti-check"></i> Точно: <b>' + (s.matched_exact || 0) + '</b></span>' +
      '<span class="bom-pill warn"><i class="ti ti-alert-triangle"></i> Другое исп.: <b>' + (s.wrong_execution || 0) + '</b></span>' +
      '<span class="bom-pill bad"><i class="ti ti-x"></i> Не найдено: <b>' + (s.no_match || 0) + '</b></span>' +
      '<span class="bom-pill"><i class="ti ti-list"></i> Всего: <b>' + (s.total || 0) + '</b></span>' +
    '</div>' +
    '<div class="bom-preview-list">';
  (data.items || []).forEach(it => {
    const p = it.parsed || {};
    let icon, cls;
    if (it.match === 'exact') { icon = 'ti-check'; cls = 'ok'; }
    else if (it.match === 'wrong_execution') { icon = 'ti-alert-triangle'; cls = 'warn'; }
    else { icon = 'ti-x'; cls = 'bad'; }
    let info;
    if (it.component) {
      const exec = it.component.execution_type === 'stainless' ? 'AISI' : 'Сталь';
      info = '<span class="bom-comp">' + escapeHtml(it.component.name || '') +
             ' · ' + escapeHtml(it.component.sku || '') + ' · ' + exec + '</span>';
    } else {
      info = '<span class="bom-comp" style="color:var(--text-light);">Не сопоставлено</span>';
    }
    const execTag = p.execution_type === 'stainless' ? ' <span class="bom-exec-tag aisi">AISI</span>' : '';
    html += '<div class="bom-preview-row ' + cls + '">' +
      '<i class="ti ' + icon + '"></i>' +
      '<div class="bom-preview-main">' +
        '<div class="bom-preview-raw">' + escapeHtml(it.raw || '') + '</div>' +
        '<div class="bom-preview-parsed">' +
          (p.sku ? '<b>' + escapeHtml(p.sku) + '</b>' : '<span style="color:var(--danger);">артикул не найден</span>') +
          ' · ' + (p.qty || 1) + ' шт' + execTag +
          ' → ' + info +
        '</div>' +
      '</div>' +
    '</div>';
  });
  html += '</div>';
  box.innerHTML = html;
}

// v2.45.221: кнопка «Импортировать» активна если есть совпадения ИЛИ включено
// «создавать недостающие» (тогда импортируем даже не найденные строки).
function _updateBomImportGo() {
  const goBtn = document.getElementById('bom-import-go');
  if (!goBtn) return;
  const d = state._bomImportPreview;
  if (!d || !d.summary) { goBtn.disabled = true; return; }
  const cm = !!(document.getElementById('bom-create-missing') || {}).checked;
  const hasMatched = (d.summary.matched_exact > 0) || (d.summary.wrong_execution > 0);
  goBtn.disabled = !(hasMatched || (cm && d.summary.total > 0));
}

async function confirmBomImport() {
  const modelId = state._bomImportModelId;
  if (!modelId) return;
  const text = (document.getElementById('bom-import-text') || {}).value || '';
  const replaceExisting = !!(document.getElementById('bom-replace-existing') || {}).checked;
  const acceptWrongExecution = !!(document.getElementById('bom-accept-wrong') || {}).checked;
  const createMissing = !!(document.getElementById('bom-create-missing') || {}).checked;
  if (!text.trim()) return;
  if (replaceExisting && !confirm('Существующий BOM будет полностью заменён. Продолжить?')) return;
  const btn = document.getElementById('bom-import-go');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i> Импорт…'; }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/models/' + modelId + '/bom/import-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        text: text,
        replace_existing: replaceExisting,
        accept_wrong_execution: acceptWrongExecution,
        create_missing: createMissing,
      }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.message || 'Не удалось импортировать', 'error');
      return;
    }
    const d = await r.json();
    showToast('Импортировано: ' + d.imported + ' из ' + d.total +
              (d.created ? ' (новых: ' + d.created + ')' : '') +
              (d.skipped && d.skipped.length ? ' (пропущено ' + d.skipped.length + ')' : ''), 'success');
    closeBomImportModal();
    // Перезагрузим карточку модели если она открыта
    if (typeof reloadCurrentModelDetail === 'function') {
      try { reloadCurrentModelDetail(); } catch (_) {}
    } else if (typeof openModelDetail === 'function' && state.currentModelId) {
      try { openModelDetail(state.currentModelId); } catch (_) {}
    }
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-download"></i> Импортировать'; }
  }
}

// v2.41.0: диагностика BOM-связей
async function openBomDiagnose() {
  let m = document.getElementById('bom-diagnose-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'bom-diagnose-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:780px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-stethoscope"></i> Диагностика BOM-связей</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'bom-diagnose-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:18px;max-height:70vh;overflow:auto;" id="bom-diagnose-body">' +
        '<div class="loading-block">Проверяем спецификации…</div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  await _reloadBomDiagnose();
}

async function _reloadBomDiagnose() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/bom/diagnose', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      document.getElementById('bom-diagnose-body').innerHTML =
        '<div class="empty-block">' + escapeHtml(e.message || 'Ошибка') + '</div>';
      return;
    }
    const d = await r.json();
    _renderBomDiagnose(d);
  } catch (e) {
    document.getElementById('bom-diagnose-body').innerHTML = '<div class="empty-block">Ошибка соединения</div>';
  }
}

function _renderBomDiagnose(report) {
  const ci = report.contract_items || {};
  const bom = report.model_bom || {};
  let html =
    // v2.41.4: большая кнопка «Починить всё»
    '<div class="autofix-banner">' +
      '<div class="autofix-banner-text">' +
        '<i class="ti ti-wand"></i>' +
        '<div>' +
          '<div class="autofix-banner-title">Починить всё одним кликом</div>' +
          '<div class="autofix-banner-sub">Программа сама заполнит артикулы, склеит дубли и привяжет спецификации к номенклатуре. Безопасно: можно прерывать, ничего не удаляется.</div>' +
        '</div>' +
      '</div>' +
      '<button class="btn btn-primary" onclick="runAutoFixBom()"><i class="ti ti-wand"></i> Запустить</button>' +
    '</div>' +
    '<details style="margin-bottom:14px;"><summary style="cursor:pointer;color:var(--text-mid);font-size:13px;">Хочу сделать вручную пошагово</summary>' +
    '<p style="margin:10px 0 8px;color:var(--text-mid);">' +
      '<b>Шаг 1.</b> Заполнить пустые артикулы в номенклатуре.' +
    '</p>' +
    '<button class="btn btn-secondary" onclick="runBackfillSku()">' +
      '<i class="ti ti-wand"></i> Заполнить артикулы' +
    '</button>' +
    '<p style="margin:10px 0 0;color:var(--text-mid);">' +
      '<b>Шаг 2.</b> Склеить дубли в номенклатуре (кнопка «Дубли» в шапке Склада).' +
    '</p>' +
    '<p style="margin:10px 0 0;color:var(--text-mid);">' +
      '<b>Шаг 3.</b> Привязать осиротевшие спецификации — кнопка «Привязать всё что нашлось» внизу.' +
    '</p>' +
    '</details>';
  // Сводка
  const totalProblems = (ci.total_unbound || 0) + (bom.total_unbound || 0);
  const totalCanFix = (ci.matched_exact || 0) + (bom.matched_exact || 0);
  const totalWrongExec = (ci.wrong_execution || 0) + (bom.wrong_execution || 0);
  const totalNoMatch = (ci.no_match || 0) + (bom.no_match || 0);
  const totalNoArt = (ci.no_article || 0) + (bom.no_article || 0);
  html +=
    '<div class="bom-preview-summary">' +
      '<span class="bom-pill ok"><i class="ti ti-check"></i> Можно привязать: <b>' + totalCanFix + '</b></span>' +
      '<span class="bom-pill warn"><i class="ti ti-alert-triangle"></i> Другое исполнение: <b>' + totalWrongExec + '</b></span>' +
      '<span class="bom-pill bad"><i class="ti ti-x"></i> Не найдено: <b>' + totalNoMatch + '</b></span>' +
      '<span class="bom-pill"><i class="ti ti-question-mark"></i> Нет артикула: <b>' + totalNoArt + '</b></span>' +
      '<span class="bom-pill"><i class="ti ti-list"></i> Всего проблем: <b>' + totalProblems + '</b></span>' +
    '</div>';
  // Детализация по типам
  html += '<div style="margin-top:12px;display:flex;gap:10px;font-size:12px;color:var(--text-light);flex-wrap:wrap;">' +
    '<span>Строк договоров без связи: <b>' + (ci.total_unbound || 0) + '</b></span>' +
    '<span>Строк BOM с битой связью: <b>' + (bom.total_unbound || 0) + '</b></span>' +
  '</div>';
  const items = report.items_to_fix || [];
  if (items.length) {
    html += '<div style="margin-top:14px;font-size:13px;color:var(--text-mid);">' +
      'Проблемные позиции (' + items.length + ' первых):</div>' +
      '<div class="bom-preview-list" style="margin-top:8px;">';
    items.slice(0, 30).forEach(it => {
      const cls = it.match === 'exact' ? 'ok' : 'warn';
      const kindLabel = it.kind === 'model_bom' ? 'BOM ' + (it.model_name || '') : 'Договор';
      html += '<div class="bom-preview-row ' + cls + '">' +
        '<i class="ti ' + (it.match === 'exact' ? 'ti-check' : 'ti-alert-triangle') + '"></i>' +
        '<div class="bom-preview-main">' +
          '<div class="bom-preview-raw">' +
            '<span style="color:var(--brand);font-weight:600;">[' + escapeHtml(kindLabel) + ']</span> ' +
            escapeHtml(it.raw || '') +
          '</div>' +
          '<div class="bom-preview-parsed">артикул <b>' + escapeHtml(it.sku || '') + '</b>' +
            (it.match === 'wrong_execution' ? ' · найдено: <b>' + (it.found_execution === 'stainless' ? 'AISI' : 'Сталь') + '</b>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
    html += '<div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">' +
      '<label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text-mid);margin-right:auto;">' +
        '<input type="checkbox" id="bom-diag-accept-wrong"> Принимать с другим исполнением</label>' +
      '<button class="btn btn-primary" onclick="applyBomDiagFixes()"><i class="ti ti-check"></i> Привязать всё что нашлось</button>' +
    '</div>';
  } else {
    html += '<div style="margin-top:14px;text-align:center;padding:20px;color:var(--text-light);">' +
      '<i class="ti ti-circle-check" style="font-size:32px;color:#15803D;"></i><br>' +
      'Все позиции уже корректно привязаны</div>';
  }
  document.getElementById('bom-diagnose-body').innerHTML = html;
}

// v2.41.4: «Починить всё одним кликом»
async function runAutoFixBom() {
  if (!confirm(
    'Программа выполнит подряд:\n\n' +
    '1) Заполнит пустые артикулы в номенклатуре\n' +
    '2) Склеит дубли (победитель = с большим остатком)\n' +
    '3) Привяжет осиротевшие спецификации по артикулу\n\n' +
    'Это безопасно: остатки складываются, ничего не удаляется (дубли деактивируются). Продолжить?'
  )) return;
  const body = document.getElementById('bom-diagnose-body');
  if (body) body.innerHTML = '<div class="loading-block">Работаем… Это может занять до минуты.</div>';
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/bom/auto-fix', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      if (body) body.innerHTML = '<div class="empty-block">' + escapeHtml(e.detail || e.message || 'Не удалось') + '</div>';
      return;
    }
    const d = await r.json();
    const bf = d.backfill || {};
    const am = d.auto_merge || {};
    let summary =
      '<div class="autofix-result">' +
        '<div class="autofix-result-title"><i class="ti ti-circle-check" style="color:#15803D;"></i> Готово!</div>' +
        '<div class="autofix-result-grid">' +
          '<div><div class="afr-num">' + (bf.updated || 0) + '</div><div class="afr-lab">артикулов заполнено</div></div>' +
          '<div><div class="afr-num">' + (am.groups_processed || 0) + '</div><div class="afr-lab">групп дублей склеено</div></div>' +
          '<div><div class="afr-num">' + (am.components_merged || 0) + '</div><div class="afr-lab">записей слито</div></div>' +
          '<div><div class="afr-num">' + (am.model_bom_moved || 0) + '</div><div class="afr-lab">связей BOM перенесено</div></div>' +
          '<div><div class="afr-num">' + (am.contract_items || 0) + '</div><div class="afr-lab">строк договоров</div></div>' +
          '<div><div class="afr-num">' + (d.fixed_model_bom || 0) + '</div><div class="afr-lab">BOM перепривязано</div></div>' +
        '</div>' +
      '</div>';
    if (body) body.innerHTML = summary;
    cache.components = null;
    showToast('Готово — открой любой НПВ и проверь', 'success');
    // Через 1.5 сек перезагрузим диагностику чтобы увидеть остаточные проблемы
    setTimeout(_reloadBomDiagnose, 1500);
  } catch (e) {
    if (body) body.innerHTML = '<div class="empty-block">Ошибка соединения</div>';
  }
}

// v2.41.6: импорт мастер-BOM из xlsx-файла
function openMasterBomImport() {
  let m = document.getElementById('master-bom-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'master-bom-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:1000px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-file-upload"></i> Загрузка мастер-BOM из Excel</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'master-bom-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:18px;max-height:75vh;overflow:auto;" id="master-bom-body">' +
        '<p style="margin:0 0 14px;color:var(--text-mid);">' +
          'Загрузи xlsx-файл с эталонными BOMами. Программа разберёт все узлы, найдёт компоненты по артикулам, ' +
          'предложит сопоставление с моделями в CRM и покажет превью перед применением.' +
        '</p>' +
        '<div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;">' +
          '<input type="file" id="master-bom-file" accept=".xlsx" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:8px;">' +
          '<button class="btn btn-primary" onclick="uploadMasterBom()">' +
            '<i class="ti ti-upload"></i> Загрузить и разобрать' +
          '</button>' +
        '</div>' +
        '<div id="master-bom-preview"></div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

async function uploadMasterBom() {
  const fileInput = document.getElementById('master-bom-file');
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    showToast('Выбери файл', 'error');
    return;
  }
  const file = fileInput.files[0];
  const preview = document.getElementById('master-bom-preview');
  preview.innerHTML = '<div class="loading-block">Загружаем и разбираем файл…</div>';
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(API_BASE + '/api/bom/master/parse', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: fd,
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      preview.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i> ' +
        escapeHtml(e.message || e.detail || 'Ошибка разбора') +
        (e.missing ? '<br>Отсутствуют колонки: ' + escapeHtml(e.missing.join(', ')) : '') +
      '</div>';
      return;
    }
    const d = await r.json();
    state._masterBomSuggestions = d.suggestions || [];
    // v2.41.11: сохраняем сами разобранные узлы — больше не полагаемся на серверный кэш
    state._masterBomNodes = {};
    (d.nodes || []).forEach(n => { state._masterBomNodes[n.name] = n; });
    // Подгружаем список моделей CRM для дропдаунов
    if (!cache.models) {
      try {
        const m = await apiGet('/api/models?with_stock=false');
        cache.models = m;
      } catch (e) { cache.models = { models: [] }; }
    }
    _renderMasterBomPreview(d);
  } catch (e) {
    preview.innerHTML = '<div class="empty-block">Ошибка соединения</div>';
  }
}

function _renderMasterBomPreview(data) {
  const sugs = data.suggestions || [];
  const models = (cache.models && cache.models.models) || [];
  let html =
    '<div class="bom-preview-summary">' +
      '<span class="bom-pill ok"><i class="ti ti-check"></i> Узлов в файле: <b>' + (data.node_count || 0) + '</b></span>' +
    '</div>' +
    '<p style="margin:14px 0 8px;color:var(--text-mid);font-size:13px;">' +
      'Для каждого узла выбери модель в CRM, в которую нужно загрузить его BOM. <b>Существующий BOM модели будет полностью заменён.</b>' +
    '</p>' +
    '<div style="margin-bottom:10px;display:flex;gap:8px;align-items:center;">' +
      '<button class="btn btn-secondary btn-small" onclick="masterBomToggleAll(true)">' +
        '<i class="ti ti-checks"></i> Включить все с предложением</button>' +
      '<button class="btn btn-secondary btn-small" onclick="masterBomToggleAll(false)">' +
        '<i class="ti ti-square"></i> Выключить все</button>' +
      '<label style="margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text-mid);">' +
        '<input type="checkbox" id="master-bom-create-missing" checked> Создавать недостающие компоненты автоматом</label>' +
    '</div>' +
    '<div class="master-bom-table">';
  // Опции дропдауна моделей
  const modelOptionsHtml = (selectedId) => {
    let opts = '<option value="">— выбери модель —</option>';
    models.forEach(m => {
      opts += '<option value="' + m.id + '"' + (m.id === selectedId ? ' selected' : '') + '>' +
        escapeHtml(m.name || '') + (m.article ? ' (' + escapeHtml(m.article) + ')' : '') +
      '</option>';
    });
    return opts;
  };
  sugs.forEach((s, i) => {
    const ok = s.suggested_model_id && s.matched_components > 0;
    html += '<div class="mb-row' + (ok ? ' has-suggestion' : '') + '">' +
      '<label class="mb-check"><input type="checkbox" id="mb-check-' + i + '"' +
        (ok ? ' checked' : '') + '></label>' +
      '<div class="mb-node">' +
        '<div class="mb-node-name">' + escapeHtml(s.node_name || '') + '</div>' +
        '<div class="mb-node-stats">' +
          '<span class="mb-pill ok">✓ ' + (s.matched_components || 0) + '</span>' +
          (s.will_create ? '<span class="mb-pill warn">+ ' + s.will_create + ' создать</span>' : '') +
          (s.no_match ? '<span class="mb-pill bad">? ' + s.no_match + '</span>' : '') +
          '<span class="mb-pill">всего ' + (s.row_count || 0) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="mb-model">' +
        '<select id="mb-model-' + i + '" class="form-input" style="margin:0;">' +
          modelOptionsHtml(s.suggested_model_id) +
        '</select>' +
        (s.suggested_model_id ?
          '<div class="mb-suggested">→ ' + escapeHtml(s.suggested_model_name || '') +
          ' <span style="color:var(--text-light);">(score ' + s.score + ')</span></div>' :
          '<div class="mb-suggested" style="color:var(--danger);">⚠ Не найдено предложение — выбери вручную или пропусти</div>') +
      '</div>' +
    '</div>';
  });
  html += '</div>' +
    '<div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">' +
      '<button class="btn btn-primary" onclick="applyMasterBom()">' +
        '<i class="ti ti-check"></i> Применить ко всем включённым' +
      '</button>' +
    '</div>';
  document.getElementById('master-bom-preview').innerHTML = html;
}

function masterBomToggleAll(value) {
  const sugs = state._masterBomSuggestions || [];
  sugs.forEach((s, i) => {
    const chk = document.getElementById('mb-check-' + i);
    if (!chk) return;
    if (value) {
      // Включаем только те у кого есть предложение и хотя бы одно совпадение
      chk.checked = !!(s.suggested_model_id && s.matched_components > 0);
    } else {
      chk.checked = false;
    }
  });
}

async function applyMasterBom() {
  const sugs = state._masterBomSuggestions || [];
  const nodesMap = state._masterBomNodes || {};
  const createMissing = !!(document.getElementById('master-bom-create-missing') || {}).checked;
  const assignments = [];
  sugs.forEach((s, i) => {
    const chk = document.getElementById('mb-check-' + i);
    if (!chk || !chk.checked) return;
    const sel = document.getElementById('mb-model-' + i);
    const model_id = sel && sel.value ? parseInt(sel.value, 10) : null;
    if (!model_id) return;
    const node = nodesMap[s.node_name];
    if (!node || !node.rows || !node.rows.length) {
      console.warn('Нет rows для узла', s.node_name);
      return;
    }
    assignments.push({
      node_name: s.node_name,
      model_id:  model_id,
      rows:      node.rows,  // v2.41.11: передаём содержимое узла, чтобы не зависеть от кэша
    });
  });
  if (!assignments.length) {
    showToast('Не выбрано ни одного узла для применения (или потеряны данные — загрузи файл заново)', 'error');
    return;
  }
  if (!confirm(
    'Будет применено BOMов: ' + assignments.length + '.\n\n' +
    'Существующие BOM выбранных моделей будут полностью заменены эталоном из файла.\n\n' +
    (createMissing ? '✓ Недостающие компоненты будут созданы автоматически.\n' : '') +
    '\nПродолжить?'
  )) return;
  const preview = document.getElementById('master-bom-preview');
  if (preview) preview.innerHTML = '<div class="loading-block">Применяем… Это может занять до минуты.</div>';
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/bom/master/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        assignments: assignments,
        create_missing_components: createMissing,
      }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      if (preview) preview.innerHTML = '<div class="empty-block">' + escapeHtml(e.message || e.detail || e.error || 'Ошибка') + '</div>';
      return;
    }
    const d = await r.json();
    _renderMasterBomResult(d);
    cache.components = null;
    cache.models = null;
  } catch (e) {
    if (preview) preview.innerHTML = '<div class="empty-block">Ошибка соединения: ' + escapeHtml(String(e)) + '</div>';
  }
}

function _renderMasterBomResult(data) {
  const results = data.results || [];
  let html =
    '<div class="autofix-result">' +
      '<div class="autofix-result-title"><i class="ti ti-circle-check" style="color:#15803D;"></i> BOMы применены</div>' +
      '<div class="autofix-result-grid">' +
        '<div><div class="afr-num">' + (data.total_applied || 0) + '</div><div class="afr-lab">строк применено</div></div>' +
        '<div><div class="afr-num">' + (data.total_skipped || 0) + '</div><div class="afr-lab">строк пропущено</div></div>' +
        '<div><div class="afr-num">' + (data.components_created || 0) + '</div><div class="afr-lab">компонентов создано</div></div>' +
      '</div>' +
    '</div>';
  // Если ничего не применилось — подсказка
  if (!data.total_applied && results.length) {
    html += '<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:12px 14px;margin-bottom:12px;color:#92400E;font-size:13px;">' +
      '<i class="ti ti-alert-triangle"></i> <b>Ничего не применилось.</b> ' +
      'Возможные причины: 1) кэш узлов потерян — нажми «Загрузить и разобрать» ещё раз; ' +
      '2) на бэке ошибка — смотри подробности ниже.' +
    '</div>';
  }
  html += '<div class="bom-preview-list">';
  results.forEach(r => {
    if (r.error) {
      html += '<div class="bom-preview-row bad">' +
        '<i class="ti ti-x"></i>' +
        '<div class="bom-preview-main">' +
          '<div class="bom-preview-raw"><b>' + escapeHtml(r.node_name || '') + '</b></div>' +
          '<div class="bom-preview-parsed" style="color:var(--danger);">Ошибка: ' + escapeHtml(r.error) +
            (r.detail ? ' · ' + escapeHtml(r.detail) : '') +
            (r.message ? ' · ' + escapeHtml(r.message) : '') +
          '</div>' +
        '</div>' +
      '</div>';
    } else {
      html += '<div class="bom-preview-row ok">' +
        '<i class="ti ti-check"></i>' +
        '<div class="bom-preview-main">' +
          '<div class="bom-preview-raw"><b>' + escapeHtml(r.node_name || '') + '</b> → ' +
            escapeHtml(r.model_name || ('#' + r.model_id)) + '</div>' +
          '<div class="bom-preview-parsed">' +
            'применено: <b>' + (r.applied || 0) + '</b> из ' + (r.total || 0) +
            (r.created_components ? ' · создано компонентов: <b>' + r.created_components + '</b>' : '') +
            (r.skipped ? ' · пропущено: ' + r.skipped : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }
  });
  html += '</div>' +
    '<div style="margin-top:14px;text-align:center;">' +
      '<button class="btn btn-secondary" onclick="document.getElementById(\'master-bom-modal\').classList.remove(\'visible\')">' +
        'Закрыть' +
      '</button>' +
    '</div>';
  document.getElementById('master-bom-preview').innerHTML = html;
}

// v2.41.7: помощник «Структура Климатики»
async function openClimateSetup() {
  let m = document.getElementById('climate-setup-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'climate-setup-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:900px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-snowflake"></i> Структура Климатического раздела</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'climate-setup-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:18px;max-height:75vh;overflow:auto;" id="climate-setup-body">' +
        '<div class="loading-block">Проверяем что есть сейчас…</div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/climate/structure-preview', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      document.getElementById('climate-setup-body').innerHTML =
        '<div class="empty-block"><i class="ti ti-alert-triangle"></i> ' +
        escapeHtml(e.message || e.error || 'Ошибка') + '</div>';
      return;
    }
    const d = await r.json();
    _renderClimateSetupPreview(d);
  } catch (e) {
    document.getElementById('climate-setup-body').innerHTML = '<div class="empty-block">Ошибка соединения</div>';
  }
}

function _renderClimateSetupPreview(p) {
  const wc = p.will_create_subgroups || [];
  const ex = p.existing_subgroups || [];
  const byGroup = p.by_group_preview || {};
  const choice = p.choice_models_to_split || [];
  const cbg = p.choice_by_group || {};
  const mpbg = p.missing_pair_by_group || {};
  const mp = p.missing_pair_models || [];
  let html =
    '<div class="autofix-banner">' +
      '<div class="autofix-banner-text">' +
        '<i class="ti ti-snowflake"></i>' +
        '<div>' +
          '<div class="autofix-banner-title">Привести структуру Климатики в порядок</div>' +
          '<div class="autofix-banner-sub">' +
            'Создаст подгруппы, разнесёт модели, раздвоит choice-модели и при необходимости достроит AISI-двойников для стандартных без пары.' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  // Подгруппы
  html += '<h4 style="margin:14px 0 6px;font-size:14px;color:var(--text);">Подгруппы</h4>';
  if (wc.length) {
    html += '<div style="margin-bottom:10px;color:var(--text-mid);font-size:13px;">Будут созданы:</div>';
    html += '<ul style="margin:0 0 10px 20px;color:var(--text);">';
    wc.forEach(s => { html += '<li>' + escapeHtml(s.name) + '</li>'; });
    html += '</ul>';
  }
  if (ex.length) {
    html += '<div style="color:var(--text-mid);font-size:13px;margin-bottom:6px;">Уже существуют:</div>';
    html += '<ul style="margin:0 0 14px 20px;color:var(--text);">';
    ex.forEach(s => { html += '<li>' + escapeHtml(s.name) + '</li>'; });
    html += '</ul>';
  }
  // Распределение моделей по подгруппам
  html += '<h4 style="margin:14px 0 6px;font-size:14px;color:var(--text);">Как будут распределены модели</h4>';
  const order = ['Наружные блоки', 'Воздухоохладители', 'Донагреватели', '(не определено)'];
  order.forEach(gname => {
    const arr = byGroup[gname] || [];
    if (!arr.length) return;
    html += '<div class="dup-group" style="margin-bottom:10px;">' +
      '<div class="dup-group-head">' +
        '<i class="ti ti-folder"></i> <b>' + escapeHtml(gname) + '</b> · ' +
        '<span class="dup-count">' + arr.length + '</span>' +
      '</div>' +
      '<div class="dup-group-items" style="padding:6px 0;">';
    arr.forEach(m => {
      let tag = '';
      if (m.is_choice) tag = '<span class="bom-exec-tag aisi" style="background:#FEF3C7;color:#92400E;border-color:#FCD34D;">Раздвоится</span>';
      else if (m.is_aisi) tag = '<span class="bom-exec-tag aisi">AISI</span>';
      else if (m.needs_aisi_pair) tag = '<span class="bom-exec-tag aisi" style="background:#E0F2FE;color:#0369A1;border-color:#BAE6FD;">Нужна AISI-пара</span>';
      html += '<div style="padding:4px 14px;font-size:13px;color:var(--text);">' +
        escapeHtml(m.name || '') +
        (m.article ? ' <span style="color:var(--text-light);font-size:11px;">' + escapeHtml(m.article) + '</span>' : '') +
        ' ' + tag +
      '</div>';
    });
    html += '</div></div>';
  });
  // Раздвоение — чекбоксы по подгруппам
  html += '<h4 style="margin:14px 0 6px;font-size:14px;color:var(--text);">Что сделать</h4>';
  html += '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">';
  // Блок 1: раздвоение choice-моделей
  if (choice.length) {
    html += '<div style="font-size:13px;color:var(--text-mid);margin-bottom:4px;">Раздвоить choice-модели (Стандарт + AISI):</div>' +
      '<label class="cl-split-opt">' +
        '<input type="checkbox" id="cl-split-outdoor" ' +
          ((cbg['Наружные блоки'] || 0) > 0 ? 'checked' : '') +
          ((cbg['Наружные блоки'] || 0) === 0 ? ' disabled' : '') + '>' +
        '<span><b>Наружные блоки</b> — раздвоится <b>' + (cbg['Наружные блоки'] || 0) + '</b></span>' +
      '</label>' +
      '<label class="cl-split-opt">' +
        '<input type="checkbox" id="cl-split-evaporator" ' +
          ((cbg['Воздухоохладители'] || 0) === 0 ? ' disabled' : '') + '>' +
        '<span><b>Воздухоохладители</b> — раздвоится <b>' + (cbg['Воздухоохладители'] || 0) + '</b>. ' +
          '<span style="color:var(--text-light);font-size:12px;">(не рекомендуется)</span></span>' +
      '</label>' +
      '<label class="cl-split-opt">' +
        '<input type="checkbox" id="cl-split-heater" ' +
          ((cbg['Донагреватели'] || 0) > 0 ? 'checked' : '') +
          ((cbg['Донагреватели'] || 0) === 0 ? ' disabled' : '') + '>' +
        '<span><b>Донагреватели</b> — раздвоится <b>' + (cbg['Донагреватели'] || 0) + '</b></span>' +
      '</label>';
  }
  // Блок 2: достроить AISI-пары для уже fixed-моделей без пары
  if (mp.length) {
    html += '<div style="font-size:13px;color:var(--text-mid);margin:10px 0 4px;">' +
      '<b>Достроить AISI-копии</b> (для стандартных без пары):' +
      '</div>' +
      '<label class="cl-split-opt">' +
        '<input type="checkbox" id="cl-pair-outdoor" ' +
          ((mpbg['Наружные блоки'] || 0) > 0 ? 'checked' : '') +
          ((mpbg['Наружные блоки'] || 0) === 0 ? ' disabled' : '') + '>' +
        '<span><b>Наружные блоки</b> — добавится <b>' + (mpbg['Наружные блоки'] || 0) + '</b> AISI</span>' +
      '</label>' +
      '<label class="cl-split-opt">' +
        '<input type="checkbox" id="cl-pair-evaporator" ' +
          ((mpbg['Воздухоохладители'] || 0) === 0 ? ' disabled' : '') + '>' +
        '<span><b>Воздухоохладители</b> — добавится <b>' + (mpbg['Воздухоохладители'] || 0) + '</b> AISI</span>' +
      '</label>' +
      '<label class="cl-split-opt">' +
        '<input type="checkbox" id="cl-pair-heater" ' +
          ((mpbg['Донагреватели'] || 0) > 0 ? 'checked' : '') +
          ((mpbg['Донагреватели'] || 0) === 0 ? ' disabled' : '') + '>' +
        '<span><b>Донагреватели</b> — добавится <b>' + (mpbg['Донагреватели'] || 0) + '</b> AISI</span>' +
      '</label>';
  }
  // Блок 3: AISI-only — choice превратить в fixed AISI без раздвоения
  if (choice.length) {
    html += '<div style="font-size:13px;color:var(--text-mid);margin:10px 0 4px;">' +
      '<b>Оставить только <span class="lbl-aisi">AISI</span></b> (выбор «Стандарт» уберётся, новых моделей не появится):' +
      '</div>' +
      '<label class="cl-split-opt">' +
        '<input type="checkbox" id="cl-aisi-outdoor" ' +
          ((cbg['Наружные блоки'] || 0) === 0 ? ' disabled' : '') + '>' +
        '<span><b>Наружные блоки</b> — станет AISI-only: <b>' + (cbg['Наружные блоки'] || 0) + '</b></span>' +
      '</label>' +
      '<label class="cl-split-opt">' +
        '<input type="checkbox" id="cl-aisi-evaporator" ' +
          ((cbg['Воздухоохладители'] || 0) > 0 ? 'checked' : '') +
          ((cbg['Воздухоохладители'] || 0) === 0 ? ' disabled' : '') + '>' +
        '<span><b>Воздухоохладители</b> — станет AISI-only: <b>' + (cbg['Воздухоохладители'] || 0) + '</b> ' +
          '<span style="color:var(--text-light);font-size:12px;">(рекомендуется — в производстве только AISI)</span></span>' +
      '</label>' +
      '<label class="cl-split-opt">' +
        '<input type="checkbox" id="cl-aisi-heater" ' +
          ((cbg['Донагреватели'] || 0) === 0 ? ' disabled' : '') + '>' +
        '<span><b>Донагреватели</b> — станет AISI-only: <b>' + (cbg['Донагреватели'] || 0) + '</b></span>' +
      '</label>';
  }
  if (!choice.length && !mp.length) {
    html += '<div style="color:var(--text-light);font-style:italic;">' +
      'Все модели уже корректно разбиты на пары — раздваивать или добавлять нечего.' +
      '</div>';
  }
  html += '</div>';
  if (choice.length || mp.length) {
    html += '<p style="color:var(--text-mid);font-size:12px;margin:8px 0 0;font-style:italic;">' +
      'BOM при создании AISI-моделей НЕ копируется — у новых он будет пустой, потом загрузишь через мастер-BOM.' +
    '</p>';
  }
  html += '<div style="margin-top:18px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">' +
    '<button class="btn btn-primary" onclick="runClimateSetup()">' +
      '<i class="ti ti-check"></i> Применить' +
    '</button>' +
  '</div>';
  document.getElementById('climate-setup-body').innerHTML = html;
}

// v2.41.15: помощник «Структура Щитов»
async function openPanelsSetup() {
  let m = document.getElementById('panels-setup-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'panels-setup-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:900px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-bolt"></i> Структура Щитов управления</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'panels-setup-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:18px;max-height:75vh;overflow:auto;" id="panels-setup-body">' +
        '<div class="loading-block">Проверяем что есть сейчас…</div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/panels/structure-preview', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      document.getElementById('panels-setup-body').innerHTML =
        '<div class="empty-block"><i class="ti ti-alert-triangle"></i> ' +
        escapeHtml(e.message || e.error || 'Ошибка') + '</div>';
      return;
    }
    const d = await r.json();
    _renderPanelsSetupPreview(d);
  } catch (e) {
    document.getElementById('panels-setup-body').innerHTML = '<div class="empty-block">Ошибка соединения</div>';
  }
}

function _renderPanelsSetupPreview(p) {
  const wc = p.will_create_subgroups || [];
  const ex = p.existing_subgroups || [];
  const tr = p.will_triple || [];
  const as = p.already_split || [];
  const nc = p.not_choice || [];
  let html =
    '<div class="autofix-banner">' +
      '<div class="autofix-banner-text">' +
        '<i class="ti ti-bolt"></i>' +
        '<div>' +
          '<div class="autofix-banner-title">Раздвоить Щиты на 3 исполнения</div>' +
          '<div class="autofix-banner-sub">' +
            'Каждая choice-модель станет ' + _highlightAisi('Стандарт + Нерж. AISI + IP') +
            '. <b>BOM копируется</b> во все три. Оригинал не удаляется — он становится «Стандарт».' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  // Подгруппы
  html += '<h4 style="margin:14px 0 6px;font-size:14px;">Подгруппы</h4>';
  if (wc.length) {
    html += '<div style="margin-bottom:8px;color:var(--text-mid);font-size:13px;">Будут созданы:</div>';
    html += '<ul style="margin:0 0 10px 20px;">';
    wc.forEach(s => { html += '<li>' + escapeHtml(s.name) + '</li>'; });
    html += '</ul>';
  } else if (ex.length) {
    html += '<div style="color:var(--text-mid);font-size:13px;margin-bottom:6px;">Уже существуют:</div>';
    html += '<ul style="margin:0 0 10px 20px;">';
    ex.forEach(s => { html += '<li>' + escapeHtml(s.name) + '</li>'; });
    html += '</ul>';
  }
  // Раздвоение
  html += '<h4 style="margin:14px 0 6px;font-size:14px;">Что произойдёт с моделями</h4>';
  html += '<div class="bom-preview-summary">' +
    '<span class="bom-pill ok"><i class="ti ti-arrows-split-2"></i> Раздвоятся: <b>' + tr.length + '</b></span>' +
    (as.length ? '<span class="bom-pill warn">Уже раздвоены: <b>' + as.length + '</b></span>' : '') +
    (nc.length ? '<span class="bom-pill">fixed (не трогаем): <b>' + nc.length + '</b></span>' : '') +
    '<span class="bom-pill">всего моделей: <b>' + (p.total_models || 0) + '</b></span>' +
  '</div>';
  if (tr.length) {
    html += '<p style="color:var(--text-mid);font-size:13px;margin:10px 0 6px;">' +
      'Будут раздвоены (создастся ' + (tr.length * 2) + ' новых моделей):</p>';
    html += '<div class="dup-group"><div class="dup-group-items" style="padding:6px 0;max-height:280px;overflow:auto;">';
    tr.forEach(m => {
      html += '<div style="padding:4px 14px;font-size:13px;color:var(--text);display:flex;justify-content:space-between;gap:8px;">' +
        '<span><b>' + escapeHtml(m.name) + '</b> ' +
          (m.article ? '<span style="color:var(--text-light);font-size:11px;">' + escapeHtml(m.article) + '</span>' : '') +
        '</span>' +
        '<span style="color:var(--text-light);font-size:11px;">→ Стандарт + AISI + IP</span>' +
      '</div>';
    });
    html += '</div></div>';
  }
  if (as.length) {
    html += '<details style="margin-top:10px;"><summary style="cursor:pointer;color:var(--text-mid);font-size:13px;">Уже AISI/IP — пропустим (' + as.length + ')</summary>' +
      '<ul style="margin:8px 0 0 20px;color:var(--text-light);font-size:12px;">';
    as.forEach(m => { html += '<li>' + escapeHtml(m.name) + '</li>'; });
    html += '</ul></details>';
  }
  if (!tr.length) {
    html += '<div style="margin-top:14px;text-align:center;padding:20px;color:var(--text-light);">' +
      '<i class="ti ti-circle-check" style="font-size:32px;color:#15803D;"></i><br>' +
      'Нечего раздваивать — все choice-модели уже разбиты на 3.</div>';
  }
  html += '<p style="color:var(--text-mid);font-size:12px;margin:14px 0 0;font-style:italic;">' +
    'BOM каждой модели копируется в две новые. После применения у тебя будут три полные копии BOM — поправь руками если для разных исполнений нужны разные комплектующие.' +
  '</p>';
  html += '<div style="margin-top:18px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">' +
    (tr.length ?
      '<button class="btn btn-primary" onclick="runPanelsSetup()">' +
        '<i class="ti ti-check"></i> Применить' +
      '</button>' : '') +
    '<button class="btn btn-secondary" onclick="document.getElementById(\'panels-setup-modal\').classList.remove(\'visible\')">Закрыть</button>' +
  '</div>';
  document.getElementById('panels-setup-body').innerHTML = html;
}

async function runPanelsSetup() {
  if (!confirm(
    'Раздвоить выбранные Щиты на 3 исполнения?\n\n' +
    '• Создадутся подгруппы Стандарт / Нерж AISI / Влагозащищ. (если их нет)\n' +
    '• Каждая choice-модель → 3 модели (Стандарт остаётся под старым id)\n' +
    '• BOM копируется во все три\n\n' +
    'Это безопасно: ничего не удаляется.'
  )) return;
  const body = document.getElementById('panels-setup-body');
  if (body) body.innerHTML = '<div class="loading-block">Раздваиваем модели и копируем BOM… Может занять минуту.</div>';
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/panels/structure-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      if (body) body.innerHTML = '<div class="empty-block">' + escapeHtml(e.message || e.detail || 'Ошибка') + '</div>';
      return;
    }
    const d = await r.json();
    _renderPanelsSetupResult(d);
    cache.models = null;
    if (typeof loadModels === 'function') {
      try { loadModels(); } catch (_) {}
    }
  } catch (e) {
    if (body) body.innerHTML = '<div class="empty-block">Ошибка соединения</div>';
  }
}

function _renderPanelsSetupResult(d) {
  const newModels = d.new_models || [];
  let html =
    '<div class="autofix-result">' +
      '<div class="autofix-result-title"><i class="ti ti-circle-check" style="color:#15803D;"></i> Щиты раздвоены</div>' +
      '<div class="autofix-result-grid">' +
        '<div><div class="afr-num">' + (d.converted_originals || 0) + '</div><div class="afr-lab">оригиналов → Стандарт</div></div>' +
        '<div><div class="afr-num">' + (d.created_aisi || 0) + '</div><div class="afr-lab">AISI создано</div></div>' +
        '<div><div class="afr-num">' + (d.created_ip || 0) + '</div><div class="afr-lab">IP создано</div></div>' +
        '<div><div class="afr-num">' + newModels.length + '</div><div class="afr-lab">новых всего</div></div>' +
      '</div>' +
    '</div>';
  if (newModels.length) {
    html += '<h4 style="margin:14px 0 6px;font-size:14px;">Созданы модели:</h4>' +
      '<ul style="margin:0 0 0 20px;color:var(--text);max-height:300px;overflow:auto;">';
    newModels.forEach(m => {
      html += '<li>' + _highlightAisi(m.new_name) + '</li>';
    });
    html += '</ul>';
  }
  if (d.failures && d.failures.length) {
    html += '<h4 style="margin:14px 0 6px;font-size:14px;color:var(--danger);">Ошибки:</h4>' +
      '<ul style="margin:0 0 0 20px;color:var(--text);">';
    d.failures.forEach(f => {
      html += '<li>' + escapeHtml(f.name || '') + ' — ' + escapeHtml(f.error || '') + ' (на этапе ' + escapeHtml(f.stage || '') + ')</li>';
    });
    html += '</ul>';
  }
  html += '<div style="margin-top:18px;text-align:center;">' +
    '<button class="btn btn-secondary" onclick="document.getElementById(\'panels-setup-modal\').classList.remove(\'visible\')">Закрыть</button>' +
  '</div>';
  document.getElementById('panels-setup-body').innerHTML = html;
}

// v2.41.13: раздвоение одной модели через кнопку в карточке
async function splitModelExecution(modelId) {
  // m из cache
  const m = ((cache.models && cache.models.models) || []).find(x => x.id === modelId);
  if (!m) {
    showToast('Модель не найдена в кэше — обнови страницу', 'error');
    return;
  }
  const labelSt = m.exec_label_st || 'Стандарт';
  const labelNe = m.exec_label_ne || 'Нерж. AISI';
  const newName = (m.name || '').endsWith(' AISI') ? m.name : (m.name + ' AISI');
  if (!confirm(
    'Раздвоить модель «' + m.name + '» на две?\n\n' +
    '• Текущая модель станет фиксированным исполнением: «' + labelSt + '»\n' +
    '• Будет создана новая модель: «' + newName + '» с исполнением «' + labelNe + '»\n\n' +
    'BOM при раздвоении НЕ копируется — у новой будет пустой. Заполнишь через «Импорт BOM» или «Загрузить мастер-BOM».'
  )) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/models/' + modelId + '/split-execution', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.message || e.detail || e.error || 'Не удалось', 'error');
      return;
    }
    const d = await r.json();
    if (d.error) {
      showToast(d.error + (d.detail ? ': ' + d.detail : ''), 'error');
      return;
    }
    if (d.skipped) {
      showToast('Пропущено: ' + (d.reason || ''), 'info');
      return;
    }
    showToast('Создана модель: ' + (d.new_name || ''), 'success');
    cache.models = null;
    closeModelDetail();
    if (typeof loadModels === 'function') {
      try { loadModels(); } catch (_) {}
    }
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function runClimateSetup() {
  const splitSubgroups = [];
  const ensurePairsSubgroups = [];
  const aisiOnlySubgroups = [];
  const map = [
    ['outdoor', 'Наружные блоки'],
    ['evaporator', 'Воздухоохладители'],
    ['heater', 'Донагреватели'],
  ];
  map.forEach(([slug, name]) => {
    const sb = document.getElementById('cl-split-' + slug);
    if (sb && sb.checked && !sb.disabled) splitSubgroups.push(name);
    const pb = document.getElementById('cl-pair-' + slug);
    if (pb && pb.checked && !pb.disabled) ensurePairsSubgroups.push(name);
    const ab = document.getElementById('cl-aisi-' + slug);
    if (ab && ab.checked && !ab.disabled) aisiOnlySubgroups.push(name);
  });
  // Защита от противоречий: нельзя одновременно раздваивать И делать AISI-only одну и ту же подгруппу
  const conflict = splitSubgroups.filter(n => aisiOnlySubgroups.includes(n));
  if (conflict.length) {
    showToast('Нельзя одновременно «Раздвоить» и «AISI-only» для: ' + conflict.join(', '), 'error');
    return;
  }
  if (!splitSubgroups.length && !ensurePairsSubgroups.length && !aisiOnlySubgroups.length) {
    showToast('Ничего не выбрано', 'info');
    return;
  }
  const lines = ['Применить настройку структуры Климатики?'];
  if (splitSubgroups.length) lines.push('• Раздвоить choice-модели: ' + splitSubgroups.join(', '));
  if (ensurePairsSubgroups.length) lines.push('• Достроить AISI-копии: ' + ensurePairsSubgroups.join(', '));
  if (aisiOnlySubgroups.length) lines.push('• Сделать AISI-only (убрать «Стандарт»-выбор): ' + aisiOnlySubgroups.join(', '));
  lines.push('\nЭто безопасно: модели не удаляются.');
  if (!confirm(lines.join('\n'))) return;
  const body = document.getElementById('climate-setup-body');
  if (body) body.innerHTML = '<div class="loading-block">Применяем структуру…</div>';
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/climate/structure-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        split_subgroups:        splitSubgroups,
        ensure_pairs_subgroups: ensurePairsSubgroups,
        aisi_only_subgroups:    aisiOnlySubgroups,
      }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      if (body) body.innerHTML = '<div class="empty-block">' + escapeHtml(e.message || e.detail || 'Ошибка') + '</div>';
      return;
    }
    const d = await r.json();
    _renderClimateSetupResult(d);
    cache.models = null;
    if (typeof loadModels === 'function') {
      try { loadModels(); } catch (_) {}
    }
  } catch (e) {
    if (body) body.innerHTML = '<div class="empty-block">Ошибка соединения</div>';
  }
}

function _renderClimateSetupResult(d) {
  const a = d.assignment || {};
  const s = d.split || {};
  const p = d.ensure_pairs || {};
  const ao = d.aisi_only || {};
  const splittedCount = s.splitted || 0;
  const createdPairs = p.created || 0;
  const aisiOnlyCount = ao.converted || 0;
  const allNew = (s.new_models || []).concat(p.new_models || []);
  let html =
    '<div class="autofix-result">' +
      '<div class="autofix-result-title"><i class="ti ti-circle-check" style="color:#15803D;"></i> Структура Климатики настроена</div>' +
      '<div class="autofix-result-grid">' +
        '<div><div class="afr-num">' + Object.keys(d.subgroups || {}).length + '</div><div class="afr-lab">подгруппы</div></div>' +
        '<div><div class="afr-num">' + (a.assigned || 0) + '</div><div class="afr-lab">моделей распределено</div></div>' +
        '<div><div class="afr-num">' + splittedCount + '</div><div class="afr-lab">моделей раздвоено</div></div>' +
        '<div><div class="afr-num">' + createdPairs + '</div><div class="afr-lab">AISI-пар достроено</div></div>' +
        '<div><div class="afr-num">' + aisiOnlyCount + '</div><div class="afr-lab">сделано AISI-only</div></div>' +
        '<div><div class="afr-num">' + allNew.length + '</div><div class="afr-lab">новых AISI всего</div></div>' +
      '</div>' +
    '</div>';
  if (allNew.length) {
    html += '<h4 style="margin:14px 0 6px;font-size:14px;">Созданы AISI-модели:</h4>' +
      '<ul style="margin:0 0 0 20px;color:var(--text);max-height:250px;overflow:auto;">';
    allNew.forEach(m => {
      html += '<li>' + escapeHtml(m.new_name) + '</li>';
    });
    html += '</ul>';
  }
  if (ao.models && ao.models.length) {
    html += '<h4 style="margin:14px 0 6px;font-size:14px;">Переведены в AISI-only:</h4>' +
      '<ul style="margin:0 0 0 20px;color:var(--text);max-height:200px;overflow:auto;">';
    ao.models.forEach(m => {
      html += '<li>' + escapeHtml(m.name) +
        ' <span style="color:var(--text-light);font-size:11px;">(' + escapeHtml(m.article || '') + ')</span></li>';
    });
    html += '</ul>';
  }
  const allFailures = (s.failures || []).concat(p.failures || []);
  if (allFailures.length) {
    html += '<h4 style="margin:14px 0 6px;font-size:14px;color:var(--danger);">Не удалось:</h4>' +
      '<ul style="margin:0 0 0 20px;color:var(--text);">';
    allFailures.forEach(f => {
      html += '<li>' + escapeHtml(f.name) + ' — ' + escapeHtml(f.error || '') + '</li>';
    });
    html += '</ul>';
  }
  html += '<div style="margin-top:18px;text-align:center;">' +
    '<button class="btn btn-secondary" onclick="document.getElementById(\'climate-setup-modal\').classList.remove(\'visible\')">Закрыть</button>' +
  '</div>';
  document.getElementById('climate-setup-body').innerHTML = html;
}

// v2.41.3: backfill артикулов в номенклатуре
async function runBackfillSku() {
  if (!confirm('Программа пройдёт по всем активным комплектующим с пустым артикулом и попытается извлечь артикул из их названий. Это не изменит названия — только заполнит поле «Артикул / SKU». Продолжить?')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/components/backfill-sku', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.message || 'Не удалось', 'error');
      return;
    }
    const d = await r.json();
    showToast('Просканировано: ' + d.scanned + ', обновлено: ' + d.updated, 'success');
    cache.components = null;
    // Перезагружаем диагностику чтобы увидеть новые сопоставления
    setTimeout(_reloadBomDiagnose, 300);
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function applyBomDiagFixes() {
  const acceptWrong = !!(document.getElementById('bom-diag-accept-wrong') || {}).checked;
  if (!confirm('Применить найденные привязки? Это изменит существующие записи в спецификациях договоров и BOM моделей.')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/bom/apply-fixes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ accept_wrong_execution: acceptWrong }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.message || 'Не удалось применить', 'error');
      return;
    }
    const d = await r.json();
    const parts = [];
    if (d.contract_items) parts.push('строк договоров: ' + d.contract_items);
    if (d.model_bom) parts.push('строк BOM моделей: ' + d.model_bom);
    showToast('Привязано: ' + (d.fixed || 0) + (parts.length ? ' (' + parts.join(', ') + ')' : ''), 'success');
    // Перезагружаем
    _reloadBomDiagnose();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// v2.41.2: поиск и слияние дублей в справочнике комплектующих
async function openComponentDuplicates() {
  let m = document.getElementById('comp-dups-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'comp-dups-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:880px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-copy-x"></i> Дубли в номенклатуре</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'comp-dups-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:18px;max-height:70vh;overflow:auto;" id="comp-dups-body">' +
        '<div class="loading-block">Ищем дубли…</div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/components/duplicates', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      document.getElementById('comp-dups-body').innerHTML =
        '<div class="empty-block">' + escapeHtml(e.message || 'Ошибка') + '</div>';
      return;
    }
    const d = await r.json();
    _renderComponentDuplicates(d);
  } catch (e) {
    document.getElementById('comp-dups-body').innerHTML = '<div class="empty-block">Ошибка соединения</div>';
  }
}

function _renderComponentDuplicates(data) {
  const groups = data.groups || [];
  const body = document.getElementById('comp-dups-body');
  if (!groups.length) {
    body.innerHTML =
      '<div style="text-align:center;padding:32px;color:var(--text-light);">' +
        '<i class="ti ti-circle-check" style="font-size:40px;color:#15803D;"></i>' +
        '<div style="margin-top:10px;">Дубли не найдены</div>' +
        '<div style="font-size:13px;margin-top:6px;">У каждого артикула в справочнике только одна запись</div>' +
      '</div>';
    return;
  }
  let html =
    '<p style="margin:0 0 14px;color:var(--text-mid);">' +
      'Найдено групп: <b>' + groups.length + '</b>. ' +
      'В каждой выбери запись, которую <b>оставить</b> — остальные склеятся в неё (остатки сложатся, все ссылки в BOM и договорах переведутся, дубли деактивируются).' +
    '</p>';
  groups.forEach((g, gi) => {
    const execLabel = g.execution_type === 'stainless' ? 'AISI' : 'Сталь';
    html += '<div class="dup-group">' +
      '<div class="dup-group-head">' +
        '<i class="ti ti-copy-x"></i> ' +
        '<b>' + escapeHtml(g.sku) + '</b> · ' + execLabel + ' · <span class="dup-count">' + g.count + ' дубля</span>' +
      '</div>' +
      '<div class="dup-group-items">';
    g.items.forEach((it, ii) => {
      const keepId = 'dup-keep-' + gi + '-' + ii;
      html += '<label class="dup-item">' +
        '<input type="radio" name="dup-keep-' + gi + '" value="' + it.id + '"' + (ii === 0 ? ' checked' : '') + '>' +
        '<div class="dup-item-info">' +
          '<div class="dup-item-name">' + escapeHtml(it.name || '—') + '</div>' +
          '<div class="dup-item-meta">' +
            'id=' + it.id + ' · ' +
            'категория: ' + escapeHtml(it.category_name || '—') + ' · ' +
            '<b>' + _fmtQty(it.qty_on_stock || 0) + ' ' + escapeHtml(it.unit || 'шт.') + '</b>' +
          '</div>' +
        '</div>' +
      '</label>';
    });
    html += '</div>' +
      '<div class="dup-group-actions">' +
        '<button class="btn btn-primary btn-small" onclick="mergeDuplicateGroup(' + gi + ')">' +
          '<i class="ti ti-merge"></i> Склеить группу' +
        '</button>' +
      '</div>' +
    '</div>';
  });
  body.innerHTML = html;
  // Сохраним сами группы в state — пригодится для confirmMerge
  state._dupGroups = groups;
}

async function mergeDuplicateGroup(gi) {
  const groups = state._dupGroups || [];
  const g = groups[gi];
  if (!g) return;
  const keepRadio = document.querySelector('input[name="dup-keep-' + gi + '"]:checked');
  if (!keepRadio) { showToast('Выбери запись которую оставить', 'error'); return; }
  const keepId = parseInt(keepRadio.value, 10);
  const mergeIds = g.items.map(it => it.id).filter(id => id !== keepId);
  if (!mergeIds.length) return;
  const keepItem = g.items.find(it => it.id === keepId);
  const lostNames = g.items.filter(it => it.id !== keepId).map(it => '• ' + it.name).join('\n');
  if (!confirm('Склеить дубли артикула ' + g.sku + '?\n\n' +
               'Оставится: ' + (keepItem ? keepItem.name : '#' + keepId) + '\n\n' +
               'Будут деактивированы:\n' + lostNames + '\n\n' +
               'Остатки сложатся, все ссылки в BOM и договорах будут перенесены на оставшуюся запись.')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/components/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ keep_id: keepId, merge_ids: mergeIds }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.message || e.detail || 'Не удалось слить', 'error');
      return;
    }
    const d = await r.json();
    let msg = 'Слито: ' + (d.merged_count || 0);
    if (d.updated) {
      const u = d.updated;
      const parts = [];
      if (u.model_bom_moved)  parts.push('BOM связей: ' + u.model_bom_moved);
      if (u.contract_items)   parts.push('строк договоров: ' + u.contract_items);
      if (u.movements)        parts.push('движений: ' + u.movements);
      if (parts.length) msg += ' (' + parts.join(', ') + ')';
    }
    showToast(msg, 'success');
    // Перезагрузим
    openComponentDuplicates();
    cache.components = null;
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function deleteComponent(componentId) {
  if (!confirm('Удалить комплектующее? Оно будет скрыто из списка (история движений сохранится).')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/components/' + componentId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) { showToast('Не удалось удалить', 'error'); return; }
    showToast('Удалено', 'success');
    closeComponentForm();
    cache.components = null;
    loadWarehouseComponents();
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

async function openComponentDetail(componentId) {
  // v2.45.256: карточку открывают и из других разделов («Что закупить») —
  // если справочник ещё не загружен, подтягиваем, иначе форма будет пустой.
  if (!(cache.components || []).find(x => x.id === componentId)) {
    try {
      const r = await apiGet('/api/components');
      cache.components = r.components || [];
    } catch (e) { /* откроем как есть */ }
  }
  if (!(cache.componentCategories || []).length) {
    try {
      const r = await apiGet('/api/components/categories');
      cache.componentCategories = r.categories || [];
    } catch (e) {}
  }
  // Открываем форму редактирования
  openComponentForm(componentId);
}

// ============ Приход ============

async function openComponentReceiveModal(preselectedId) {
  // Каталог комплектующих мог быть не загружен (напр. открыли из «Что закупить») —
  // подгружаем на лету, чтобы модалка прихода работала из любого раздела.
  if (!cache.components || !cache.components.length) {
    try {
      const r = await apiGet('/api/components');
      cache.components = (r && r.components) || [];
    } catch (e) { /* ниже покажем ошибку, если пусто */ }
  }
  const components = cache.components || [];
  if (!components.length) {
    showToast('Сначала добавь хотя бы одно комплектующее', 'error');
    return;
  }
  let m = document.getElementById('comp-receive-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'comp-receive-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) closeComponentReceiveModal(); };
    document.body.appendChild(m);
  }
  const opts = components.map(c =>
    '<option value="' + c.id + '"' + (preselectedId === c.id ? ' selected' : '') + '>' +
    escapeHtml(c.name) + (c.sku ? ' (' + escapeHtml(c.sku) + ')' : '') +
    ' — на складе: ' + _fmtQty(c.qty_on_stock) + ' ' + escapeHtml(c.unit || 'шт.') +
    '</option>'
  ).join('');
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:480px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-package-import"></i> Приход на склад</h3>' +
        '<button class="modal-close" onclick="closeComponentReceiveModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:18px;">' +
        '<label class="form-label">Комплектующее *</label>' +
        '<select id="recv-component" class="form-input" style="margin-bottom:14px;">' + opts + '</select>' +
        '<label class="form-label">Что пришло — марка и количество *</label>' +
        '<div style="font-size:12px;color:var(--text-light);margin-bottom:6px;">Можно несколько марок сразу (напр. 3 Hisense + 2 Royal). Марку выбери из номенклатуры или впиши; оставь пустой — без марки.</div>' +
        '<div id="recv-lines"></div>' +
        '<button type="button" class="btn btn-secondary btn-small" onclick="recvAddBrandRow()" style="margin:2px 0 14px;"><i class="ti ti-plus"></i> Добавить марку</button>' +
        '<datalist id="recv-brand-list">' +
          components.map(c => '<option value="' + escapeHtml(c.name) + '">').join('') +
        '</datalist>' +
        '<label class="form-label">Поставщик (опционально)</label>' +
        '<select id="recv-supplier" class="form-input" style="margin-bottom:14px;">' +
          '<option value="">— Не указан —</option>' +
          (cache.suppliers || []).map(s => '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>').join('') +
        '</select>' +
        '<label class="form-label">Комментарий</label>' +
        '<input type="text" id="recv-reason" class="form-input" placeholder="Например: Накладная №12 от 20.05" />' +
      '</div>' +
      '<div style="padding:14px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn btn-secondary" onclick="closeComponentReceiveModal()">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitComponentReceive()"><i class="ti ti-check"></i> Оприходовать</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  recvAddBrandRow();  // одна строка по умолчанию

  // Подгружаем поставщиков если ещё нет
  if (!cache.suppliers) {
    apiGet('/api/suppliers').then(r => {
      cache.suppliers = r.suppliers || [];
      // Перерисовать select поставщиков
      const sel = document.getElementById('recv-supplier');
      if (sel) {
        sel.innerHTML = '<option value="">— Не указан —</option>' +
          cache.suppliers.map(s => '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>').join('');
      }
    }).catch(() => {});
  }
}

function closeComponentReceiveModal() {
  const m = document.getElementById('comp-receive-modal');
  if (m) m.classList.remove('visible');
}

// Строка прихода «марка + количество» (можно несколько за один приход)
function recvAddBrandRow(brand, qty) {
  const box = document.getElementById('recv-lines');
  if (!box) return;
  const row = document.createElement('div');
  row.className = 'recv-line';
  row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center;';
  row.innerHTML =
    '<input type="text" class="form-input recv-line-brand" list="recv-brand-list" autocomplete="off" ' +
      'placeholder="Марка / модель (или пусто)" style="flex:1;margin:0;" value="' + (brand ? escapeHtml(brand) : '') + '">' +
    '<input type="number" class="form-input recv-line-qty" min="0" step="0.01" value="' + (qty != null ? qty : 1) + '" ' +
      'style="width:84px;margin:0;" title="Количество">' +
    '<button type="button" class="btn btn-secondary btn-small" title="Убрать строку" ' +
      'onclick="this.closest(\'.recv-line\').remove()"><i class="ti ti-x"></i></button>';
  box.appendChild(row);
}

async function submitComponentReceive() {
  const component_id = parseInt(document.getElementById('recv-component').value);
  const supplier_id = document.getElementById('recv-supplier').value || null;
  const reason = document.getElementById('recv-reason').value || '';
  const rows = Array.from(document.querySelectorAll('#recv-lines .recv-line'));
  const lines = rows.map(r => ({
    brand: (r.querySelector('.recv-line-brand').value || '').trim(),
    qty: parseFloat(r.querySelector('.recv-line-qty').value),
  })).filter(l => l.qty > 0);
  if (!component_id || !lines.length) {
    showToast('Укажи хотя бы одну марку с количеством > 0', 'error'); return;
  }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    let ok = 0;
    for (const l of lines) {
      const r = await fetch(API_BASE + '/api/components/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ component_id, qty: l.qty, supplier_id, reason, brand: l.brand }),
      });
      if (r.ok) ok++;
    }
    if (!ok) { showToast('Не удалось оприходовать', 'error'); return; }
    const total = lines.reduce((a, l) => a + l.qty, 0);
    showToast('Приход +' + _fmtQty(total) + (lines.length > 1 ? ' (' + lines.length + ' марок)' : ''), 'success');
    closeComponentReceiveModal();
    cache.components = null;
    loadWarehouseComponents();
    // обновим «Что закупить» — оприходованный компонент уйдёт из списка
    if (typeof loadSupplyShopping === 'function') { try { loadSupplyShopping(); } catch (e) {} }
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// ============ Списание ============

function openComponentWriteoffModal(componentId) {
  const c = (cache.components || []).find(x => x.id === componentId);
  if (!c) return;
  let m = document.getElementById('comp-writeoff-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'comp-writeoff-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) closeComponentWriteoffModal(); };
    document.body.appendChild(m);
  }
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:440px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-package-export"></i> Списать со склада</h3>' +
        '<button class="modal-close" onclick="closeComponentWriteoffModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:18px;">' +
        '<div style="font-size:14px;margin-bottom:14px;color:var(--text-light);">' +
          '<b style="color:var(--text);">' + escapeHtml(c.name) + '</b>' +
          (c.sku ? ' · ' + escapeHtml(c.sku) : '') +
          '<br>На складе: <b>' + _fmtQty(c.qty_on_stock) + '</b> ' + escapeHtml(c.unit || 'шт.') +
        '</div>' +
        '<label class="form-label">Количество к списанию *</label>' +
        '<input type="number" id="wo-qty" class="form-input" value="1" min="0.01" max="' + c.qty_on_stock + '" step="0.01" style="margin-bottom:14px;" />' +
        '<label class="form-label">Причина *</label>' +
        '<input type="text" id="wo-reason" class="form-input" placeholder="Например: Списано в брак / Использовано на сборку" />' +
      '</div>' +
      '<div style="padding:14px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn btn-secondary" onclick="closeComponentWriteoffModal()">Отмена</button>' +
        '<button class="btn btn-primary" onclick="submitComponentWriteoff(' + componentId + ')" style="background:var(--danger);"><i class="ti ti-check"></i> Списать</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

function closeComponentWriteoffModal() {
  const m = document.getElementById('comp-writeoff-modal');
  if (m) m.classList.remove('visible');
}

async function submitComponentWriteoff(componentId) {
  const qty = parseFloat(document.getElementById('wo-qty').value);
  const reason = (document.getElementById('wo-reason').value || '').trim();
  if (isNaN(qty) || qty <= 0) { showToast('Кол-во некорректно', 'error'); return; }
  if (!reason) { showToast('Укажи причину', 'error'); return; }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/components/writeoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ component_id: componentId, qty, reason }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось списать', 'error');
      return;
    }
    showToast('Списано −' + _fmtQty(qty), 'success');
    closeComponentWriteoffModal();
    cache.components = null;
    loadWarehouseComponents();
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

// ============ История движений ============

async function openComponentMovements(componentId) {
  const c = (cache.components || []).find(x => x.id === componentId);
  let m = document.getElementById('comp-movements-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'comp-movements-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }
  m.innerHTML =
    '<div class="modal modal-wide" onclick="event.stopPropagation()" style="max-width:680px;max-height:85vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-history"></i> История · ' + escapeHtml((c && c.name) || '') + '</h3>' +
        '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div id="cm-list" style="overflow-y:auto;flex:1;padding:8px 0;"><div class="loading-block">Загружаем…</div></div>' +
    '</div>';
  m.classList.add('visible');

  try {
    const r = await apiGet('/api/components/' + componentId + '/movements');
    const movs = r.movements || [];
    const el = document.getElementById('cm-list');
    if (!movs.length) {
      el.innerHTML = '<div class="empty-block"><i class="ti ti-inbox"></i>Движений пока нет</div>';
      return;
    }
    let html = '';
    movs.forEach(mv => {
      const isReceive = mv.movement_type === 'receive';
      const sign = isReceive ? '+' : (mv.movement_type === 'writeoff' ? '−' : '±');
      const color = isReceive ? '#15803D' : (mv.movement_type === 'writeoff' ? 'var(--danger)' : 'var(--text-light)');
      const icon = isReceive ? 'ti-package-import' : (mv.movement_type === 'writeoff' ? 'ti-package-export' : 'ti-arrow-bar-up');
      html += '<div style="padding:10px 18px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:flex-start;">' +
        '<div style="color:' + color + ';font-size:18px;"><i class="ti ' + icon + '"></i></div>' +
        '<div style="flex:1;">' +
          '<div style="font-weight:600;color:' + color + ';">' + sign + _fmtQty(mv.qty) + ' (было ' + _fmtQty(mv.qty_before) + ' → стало ' + _fmtQty(mv.qty_after) + ')</div>' +
          '<div style="font-size:12px;color:var(--text-light);margin-top:2px;">' +
            (mv.reason ? escapeHtml(mv.reason) : '') +
            (mv.supplier_name ? ' · ' + escapeHtml(mv.supplier_name) : '') +
            (mv.source_kind === 'assembly' ? ' · сборка #' + mv.source_id : '') +
          '</div>' +
          '<div style="font-size:11px;color:var(--text-light);margin-top:2px;">' +
            (mv.created_at ? String(mv.created_at).slice(0, 16).replace('T', ' ') : '') +
          '</div>' +
        '</div>' +
      '</div>';
    });
    el.innerHTML = html;
  } catch (e) {
    document.getElementById('cm-list').innerHTML = '<div class="empty-block">Ошибка загрузки</div>';
  }
}


// v2.45.58: скачать Excel-файл для инвентаризации (ГП + комплектующие).
async function downloadInventoryXlsx() {
  showToast('Формируем файл инвентаризации…', 'info');
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/warehouse/inventory-xlsx', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || ('HTTP ' + r.status), 'error');
      return;
    }
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition') || '';
    let filename = 'inventory.xlsx';
    const mm = cd.match(/filename="?([^";]+)"?/i);
    if (mm) filename = mm[1];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast('Файл готов · ' + filename, 'success');
  } catch (e) { showToast('Не удалось скачать', 'error'); }
}

// ============ ЭТАП 28.1: переключатель табов склада ============

const WH_TAB_ACTIONS = {
  // Кнопки в общей шапке, специфичные для каждого таба
  stock: [
    // v2.45.58: выгрузка в Excel для инвентаризации (две вкладки: ГП и компоненты)
    { label: 'Excel для инвентаризации', icon: 'ti-file-spreadsheet', cls: 'btn btn-secondary btn-small',
      onclick: 'downloadInventoryXlsx()' },
    { label: 'Произвести отгрузку', icon: 'ti-truck-delivery', cls: 'btn btn-primary btn-small',
      onclick: 'openShipmentEntry()' },
  ],
  components: [
    // v2.41.x: инструменты для разруливания дублей и битых связей
    { label: 'Загрузить мастер-BOM', icon: 'ti-file-upload', cls: 'btn btn-secondary btn-small',
      onclick: 'openMasterBomImport()' },
    { label: 'Диагностика', icon: 'ti-stethoscope', cls: 'btn btn-secondary btn-small',
      onclick: 'openBomDiagnose()' },
    { label: 'Дубли', icon: 'ti-copy-x', cls: 'btn btn-secondary btn-small',
      onclick: 'openComponentDuplicates()' },
    { label: 'Приход', icon: 'ti-package-import', cls: 'btn btn-secondary btn-small',
      onclick: 'openComponentReceiveModal()' },
    { label: 'Комплектующее', icon: 'ti-plus', cls: 'btn btn-primary btn-small',
      onclick: 'openComponentForm()' },
  ],
  movements: [],  // у журнала своих действий нет
};

function _renderWarehouseDashActions(tab) {
  const host = document.getElementById('wh-dash-actions');
  if (!host) return;
  const actions = WH_TAB_ACTIONS[tab] || [];
  host.innerHTML = actions.map(a =>
    '<button class="' + a.cls + '" onclick="' + a.onclick + '">' +
    '<i class="ti ' + a.icon + '"></i> ' + a.label +
    '</button>'
  ).join('');
}

function _updateWarehouseTabBadges(counts) {
  // counts = { stock, components, attention } — все опциональные
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (val == null) { el.textContent = '—'; el.classList.remove('warn'); return; }
    el.textContent = String(val);
  };
  if (counts && 'stock' in counts) set('wh-tab-badge-stock', counts.stock);
  if (counts && 'components' in counts) set('wh-tab-badge-components', counts.components);
}

function switchWarehouseTab(tab) {
  if (!['stock', 'components', 'movements'].includes(tab)) tab = 'stock';

  // Подсветка таба
  document.querySelectorAll('.wh-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.whTab === tab);
  });
  // Показ нужной панели
  document.querySelectorAll('.wh-tab-pane').forEach(p => {
    p.classList.toggle('active', p.dataset.whPane === tab);
  });
  // Кнопки в шапке под таб
  _renderWarehouseDashActions(tab);
  // Подсветка sidebar — соответствующий пункт активен
  document.querySelectorAll('.sidebar .nav-item[data-nav]').forEach(t => t.classList.remove('active'));
  const navName = 'warehouse-' + tab;
  document.querySelectorAll('.sidebar .nav-item[data-nav="' + navName + '"]')
    .forEach(t => t.classList.add('active'));

  // Сохраним последнюю вкладку
  state.activeWarehouseTab = tab;
  try { localStorage.setItem('wh_active_tab', tab); } catch (e) {}

  // Лениво грузим контент таба
  if (tab === 'stock')       loadFinishedProductsDashboard();
  if (tab === 'components')  loadPartsDashboard();
  if (tab === 'movements')   loadWarehouseMovements();
}


// ============ ЭТАП 28.2: ДАШБОРД ГОТОВОЙ ПРОДУКЦИИ ============

// Палитра сегментов для категорий (стек-бар + точки на чипах)
const FP_CATEGORY_COLORS = ['#2563EB', '#534AB7', '#1D9E75', '#BA7517', '#C44A91', '#0EA5E9', '#DC2626', '#16A34A'];

// state для фильтров/поиска/сортировки
state.fpData = null;
state.fpStatusFilter = 'all';     // all | free | reserved | dead90
state.fpCategoryFilter = null;    // direction_id или null
state.fpSearch = '';
state.fpSort = 'age';             // age | name | qty

async function loadFinishedProductsDashboard() {
  const container = document.getElementById('fp-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const d = await apiGet('/api/warehouse/dashboard/finished-products');
    state.fpData = d;
    renderFinishedProductsDashboard();
    // Бейдж в табе — реальные штуки, не моделей
    if (typeof _updateWarehouseTabBadges === 'function') {
      _updateWarehouseTabBadges({ stock: (d.kpis && d.kpis.total) || 0 });
    }
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderFinishedProductsDashboard() {
  const d = state.fpData || { kpis: {}, by_category: [], items: [] };
  _renderFpKpis(d.kpis);
  _renderFpCatbar(d.by_category, d.kpis.total || 0);
  _renderFpList();
}

function _renderFpKpis(k) {
  const host = document.getElementById('fp-kpis');
  if (!host) return;
  const kpis = [
    {
      label: 'Всего на складе',
      value: k.total || 0,
      hint: (k.models_total || 0) + ' ' + _plural(k.models_total || 0, ['модель', 'модели', 'моделей']),
      tone: '',
    },
    {
      label: 'Свободно',
      value: k.free || 0,
      hint: (k.free_models || 0) + ' ' + _plural(k.free_models || 0, ['модель', 'модели', 'моделей']),
      tone: 'tone-green',
    },
    {
      label: 'Зарезервировано',
      value: k.reserved || 0,
      hint: (k.reserved_contracts || 0) + ' ' + _plural(k.reserved_contracts || 0, ['договор', 'договора', 'договоров']),
      tone: 'tone-yellow',
    },
    {
      label: 'Лежит > 90 дней',
      value: k.dead90 || 0,
      hint: (k.dead90_models || 0) + ' ' + _plural(k.dead90_models || 0, ['модель', 'модели', 'моделей']),
      tone: 'tone-red',
      clickable: true,
      onclick: 'toggleFpDeadFilter()',
    },
  ];
  host.innerHTML = kpis.map(k =>
    '<div class="fp-kpi ' + k.tone + (k.clickable ? ' clickable' : '') + '"' +
      (k.onclick ? ' onclick="' + k.onclick + '"' : '') + '>' +
      '<div class="fp-kpi-label">' + escapeHtml(k.label) + '</div>' +
      '<div class="fp-kpi-value">' + k.value + '</div>' +
      '<div class="fp-kpi-hint">' + escapeHtml(k.hint) + '</div>' +
    '</div>'
  ).join('');
}

function _renderFpCatbar(categories, totalQty) {
  const wrap = document.getElementById('fp-catbar-wrap');
  const bar = document.getElementById('fp-catbar');
  const legend = document.getElementById('fp-catlegend');
  if (!wrap || !bar || !legend) return;
  if (!categories || categories.length === 0 || totalQty === 0) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  // Сегменты бара (пропорционально qty)
  let segs = '';
  let chips = '';
  // «Все» — сбросить фильтр
  chips += '<div class="fp-catchip ' + (state.fpCategoryFilter == null ? 'active' : '') + '" onclick="setFpCategoryFilter(null)">' +
    '<span class="fp-catchip-qty">Все</span></div>';
  categories.forEach((c, idx) => {
    const color = FP_CATEGORY_COLORS[idx % FP_CATEGORY_COLORS.length];
    const pct = totalQty > 0 ? (c.qty / totalQty * 100) : 0;
    segs += '<div class="fp-catbar-seg" style="width:' + pct.toFixed(2) + '%;background:' + color + ';" title="' +
      escapeHtml(c.direction_name) + ': ' + c.qty + '"></div>';
    const active = state.fpCategoryFilter === c.direction_id;
    chips += '<div class="fp-catchip ' + (active ? 'active' : '') + '" onclick="setFpCategoryFilter(' + c.direction_id + ')">' +
      (active ? '' : '<span class="fp-catchip-dot" style="background:' + color + ';"></span>') +
      '<span>' + escapeHtml(c.direction_name) + '</span>' +
      '<span class="fp-catchip-qty">' + c.qty + '</span>' +
      '</div>';
  });
  bar.innerHTML = segs;
  legend.innerHTML = chips;
}

function _renderFpList() {
  const host = document.getElementById('fp-list');
  if (!host || !state.fpData) return;
  let items = (state.fpData.items || []).slice();

  // Фильтр по статусу
  if (state.fpStatusFilter === 'free')     items = items.filter(it => it.free_qty > 0 && it.reserved_qty === 0);
  if (state.fpStatusFilter === 'reserved') items = items.filter(it => it.reserved_qty > 0);
  if (state.fpStatusFilter === 'dead90')   items = items.filter(it => it.age_category === 'dead');

  // Фильтр по категории
  if (state.fpCategoryFilter != null) {
    items = items.filter(it => it.direction_id === state.fpCategoryFilter);
  }

  // Поиск
  const q = (state.fpSearch || '').toLowerCase().trim();
  if (q) {
    items = items.filter(it => {
      if ((it.model_name || '').toLowerCase().includes(q)) return true;
      if ((it.model_article || '').toLowerCase().includes(q)) return true;
      // поиск по № договора в резервах
      return (it.reservations || []).some(r =>
        (r.contract_number || '').toLowerCase().includes(q) ||
        (r.contractor_name || '').toLowerCase().includes(q)
      );
    });
  }

  // Сортировка
  if (state.fpSort === 'age') {
    // Уже отсортировано на бэке (dead → warm → fresh), но при фильтрах нужно повторить
    const ageRank = { dead: 0, warm: 1, fresh: 2 };
    items.sort((a, b) => (ageRank[a.age_category] - ageRank[b.age_category])
                       || (b.oldest_age_days - a.oldest_age_days)
                       || (b.total_qty - a.total_qty));
  } else if (state.fpSort === 'name') {
    items.sort((a, b) => (a.model_name || '').localeCompare(b.model_name || ''));
  } else if (state.fpSort === 'qty') {
    items.sort((a, b) => b.total_qty - a.total_qty);
  }

  if (items.length === 0) {
    host.innerHTML = '<div class="empty-block"><i class="ti ti-package-off"></i>' +
      (state.fpStatusFilter !== 'all' || q || state.fpCategoryFilter != null
        ? 'По заданным фильтрам ничего не найдено'
        : 'На складе пока нет готовой продукции') +
      '</div>';
    return;
  }

  host.innerHTML = items.map(it => _renderFpRow(it)).join('');
}

function _renderFpRow(it) {
  const isReserved = it.reserved_qty > 0;
  const isFullyReserved = it.free_qty === 0 && it.reserved_qty > 0;
  const isMixed = it.free_qty > 0 && it.reserved_qty > 0;
  const isDead = it.age_category === 'dead';

  const rowTone = isDead ? 'tone-red' : (isReserved ? 'tone-yellow' : '');

  // Подстрока
  let subText = '';
  let subClass = '';
  if (isDead) {
    subClass = 'dead';
    subText = '<i class="ti ti-alert-triangle" style="font-size:12px;"></i>Лежит больше 90 дней — проверить актуальность';
  } else if (isReserved) {
    subClass = 'reserved';
    const r = (it.reservations || [])[0];
    if (r) {
      // v2.45.58: если в contract_number уже есть «№» в начале — не дублируем
      const _rawN = String(r.contract_number || '—');
      const _cleanN = _rawN.replace(/^№\s*/, '');
      let resTxt = '<i class="ti ti-lock" style="font-size:12px;"></i>Резерв: №' + escapeHtml(_cleanN);
      if (r.contractor_name) resTxt += ' · ' + escapeHtml(r.contractor_name);
      if ((it.reservations || []).length > 1) {
        resTxt += ' <span style="color:var(--text-light);">+' + ((it.reservations.length - 1)) + ' договор.</span>';
      }
      subText = resTxt;
    }
  } else {
    // обычная — категория + кол-во сборок
    const parts = [];
    if (it.direction_name) parts.push(escapeHtml(it.direction_name));
    parts.push(it.assemblies_count + ' ' + _plural(it.assemblies_count, ['сборка', 'сборки', 'сборок']));
    subText = parts.join(' · ');
  }

  // Количество: показываем X / Y если есть и резерв и свободно
  let qtyHtml;
  if (isMixed) {
    qtyHtml = '<div class="fp-row-qty">' + it.free_qty + ' <span class="fp-row-qty-sub">/ ' + it.total_qty + ' шт</span></div>';
  } else {
    qtyHtml = '<div class="fp-row-qty">' + it.total_qty + ' <span class="fp-row-qty-sub">шт</span></div>';
  }

  // Возраст
  const ageCls = it.age_category;
  const ageText = it.oldest_age_days + ' дн';

  // Бейдж
  let badgeHtml;
  if (isMixed)            badgeHtml = '<span class="fp-row-badge mixed">смешан</span>';
  else if (isFullyReserved) badgeHtml = '<span class="fp-row-badge reserved">резерв</span>';
  else                    badgeHtml = '<span class="fp-row-badge free">свободна</span>';

  return '<div class="fp-row ' + rowTone + '" onclick="openFpModelDetail(' + it.model_id + ')">' +
    '<span class="fp-row-dot ' + it.age_category + '"></span>' +
    '<div>' +
      '<div class="fp-row-name">' + escapeHtml(it.model_name) +
        (it.model_article ? '<span class="fp-row-article">' + escapeHtml(it.model_article) + '</span>' : '') +
      '</div>' +
      '<div class="fp-row-sub ' + subClass + '">' + subText + '</div>' +
    '</div>' +
    qtyHtml +
    '<div class="fp-row-age ' + ageCls + '">' + ageText + '</div>' +
    badgeHtml +
    '</div>';
}

// ---- Обработчики тулбара ----

function setFpStatusFilter(filter) {
  state.fpStatusFilter = filter;
  document.querySelectorAll('.filter-tab[data-fp-status]').forEach(b => {
    b.classList.toggle('active', b.dataset.fpStatus === filter);
  });
  _renderFpList();
}

function toggleFpDeadFilter() {
  // Клик на красный KPI «Лежит > 90 дней» — переключает фильтр
  if (state.fpStatusFilter === 'dead90') {
    setFpStatusFilter('all');
  } else {
    state.fpStatusFilter = 'dead90';
    document.querySelectorAll('.filter-tab[data-fp-status]').forEach(b => {
      b.classList.toggle('active', b.dataset.fpStatus === 'all');  // визуально выделяется красным kpi
    });
    _renderFpList();
  }
}

function setFpCategoryFilter(directionId) {
  state.fpCategoryFilter = directionId;
  // Перерисовать только список и легенду (KPIs не меняются)
  _renderFpCatbar((state.fpData && state.fpData.by_category) || [],
                  (state.fpData && state.fpData.kpis && state.fpData.kpis.total) || 0);
  _renderFpList();
}

let _fpSearchTimer = null;
function onFpSearchInput() {
  const v = (document.getElementById('fp-search') || {}).value || '';
  state.fpSearch = v;
  clearTimeout(_fpSearchTimer);
  _fpSearchTimer = setTimeout(_renderFpList, 120);
}

function toggleFpSort() {
  const order = ['age', 'qty', 'name'];
  const labels = { age: 'По возрасту', qty: 'По количеству', name: 'По названию' };
  const idx = order.indexOf(state.fpSort);
  state.fpSort = order[(idx + 1) % order.length];
  const lbl = document.getElementById('fp-sort-label');
  if (lbl) lbl.textContent = labels[state.fpSort];
  _renderFpList();
}

async function openFpModelDetail(modelId) {
  // v2.33.9: открываем модалку со списком всех сборок этой модели,
  // клик по конкретной сборке → openAssemblyStock (карточка с QR/сборщиками)
  let overlay = document.getElementById('fp-model-assemblies-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'fp-model-assemblies-modal';
    overlay.className = 'modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('visible'); };
    document.body.appendChild(overlay);
  }
  overlay.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:600px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-stack-2"></i> Сборки этой модели на складе</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'fp-model-assemblies-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body"><div class="loading-block">Загружаем…</div></div>' +
    '</div>';
  overlay.classList.add('visible');

  try {
    const d = await apiGet('/api/warehouse/stock?model_id=' + modelId);
    const stock = d.stock || [];
    const body = overlay.querySelector('.modal-body');
    if (!stock.length) {
      body.innerHTML = '<div class="empty-block"><i class="ti ti-package-off"></i>Сборок на складе не найдено</div>';
      return;
    }
    const modelName = stock[0].model_name || '';
    const modelArt  = stock[0].model_article || '';
    let html =
      '<div style="background:var(--brand-bg);padding:12px 14px;border-radius:10px;margin-bottom:14px;">' +
        '<div style="font-weight:600;font-size:15px;color:var(--text-dark);">' + escapeHtml(modelName) + '</div>' +
        (modelArt ? '<div style="font-size:12px;color:var(--text-light);margin-top:2px;">' + escapeHtml(modelArt) + '</div>' : '') +
        '<div style="font-size:13px;color:var(--brand);margin-top:6px;">Всего на складе: <b>' + stock.length + '</b> сборок</div>' +
      '</div>';
    html += '<div style="display:flex;flex-direction:column;gap:8px;">';
    stock.forEach(s => {
      const reservedBadge = s.contract_id
        ? '<span style="background:#FEF3C7;color:#854F0B;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;">резерв · ' + escapeHtml(s.contract_number || '') + '</span>'
        : '<span style="background:rgba(29,158,117,0.15);color:#0A5B41;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;">свободна</span>';
      const exec = [s.execution_label || s.execution, s.ip_class].filter(Boolean).join(' · ');
      html +=
        '<div class="modal-item" style="border:1px solid var(--border);border-radius:10px;border-bottom:1px solid var(--border);margin-bottom:0;" onclick="document.getElementById(\'fp-model-assemblies-modal\').classList.remove(\'visible\'); openAssemblyStock(' + s.id + ')">' +
          '<div class="mi-icon"><i class="ti ti-package"></i></div>' +
          '<div class="mi-text">' +
            '<div class="mi-title">Сборка #' + s.id + ' · ' + (s.stock_qty || 0) + ' шт.</div>' +
            '<div class="mi-meta">' +
              escapeHtml(s.assembly_date || '—') +
              (exec ? ' · ' + escapeHtml(exec) : '') +
              ' · ' + reservedBadge +
            '</div>' +
          '</div>' +
          '<i class="ti ti-chevron-right" style="color:var(--text-light);font-size:18px;"></i>' +
        '</div>';
    });
    html += '</div>';
    body.innerHTML = html;
  } catch (e) {
    const body = overlay.querySelector('.modal-body');
    if (body) body.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

// Plural helper: ((1, ['модель','модели','моделей']) → 'модель')
function _plural(n, forms) {
  n = Math.abs(parseInt(n, 10)) % 100;
  const n10 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n10 > 1 && n10 < 5) return forms[1];
  if (n10 === 1)         return forms[0];
  return forms[2];
}


// ============ ЭТАП 28.3: ДАШБОРД КОМПЛЕКТУЮЩИХ ============

state.ptData = null;
state.ptCategoryFilter = null;   // category_id или null
state.ptAttentionOnly = false;
state.ptInStockOnly = false;     // фильтр "только то что есть на складе"
state.ptSearch = '';

async function loadPartsDashboard() {
  const container = document.getElementById('pt-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const d = await apiGet('/api/warehouse/dashboard/parts');
    state.ptData = d;
    renderPartsDashboard();
    if (typeof _updateWarehouseTabBadges === 'function') {
      _updateWarehouseTabBadges({ components: (d.kpis && d.kpis.total) || 0 });
    }
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function _ptToggleBar() {
  return '<div class="sv2-toggle-bar">' +
      '<span><i class="ti ti-' + (window.PT_V2 ? 'sparkles' : 'history') + '"></i> ' + (window.PT_V2 ? 'Новый вид' : 'Старый вид') + '</span>' +
      '<button class="sv2-toggle-btn" onclick="togglePtV2()">' + (window.PT_V2 ? 'Вернуть старый' : 'Включить новый') + '</button>' +
    '</div>';
}

function togglePtV2() {
  window.PT_V2 = !window.PT_V2;
  try { localStorage.setItem('ptV2', window.PT_V2 ? '1' : '0'); } catch (_) {}
  renderPartsDashboard();
}

function renderPartsDashboard() {
  const d = state.ptData || { kpis: {}, categories: [], items: [] };
  window.PT_V2 = (localStorage.getItem('ptV2') !== '0');
  const pane = document.getElementById('pt-pane');
  if (pane) pane.classList.toggle('pt-v2', !!window.PT_V2);
  const tg = document.getElementById('pt-toggle');
  if (tg) tg.innerHTML = _ptToggleBar();
  _renderPtKpis(d.kpis);
  _renderPtAiHint(d);
  _renderPtChips(d.categories, d.kpis.total || 0);
  _renderPtAttentionBtn(d.kpis.attention_count || 0);
  _renderPtInStockBtn();
  _renderPtList();
}

function _renderPtKpis(k) {
  const host = document.getElementById('pt-kpis');
  if (!host) return;
  const kpis = [
    {
      label: 'Всего позиций',
      value: k.total || 0,
      hint: (k.categories_count || 0) + ' ' + _plural(k.categories_count || 0, ['категория', 'категории', 'категорий']),
      tone: '',
      icon: 'ti-packages',
    },
    {
      label: 'Ниже минимума',
      value: k.below_min || 0,
      hint: (k.below_min || 0) > 0 ? 'требуется закупка' : 'всё в норме',
      tone: 'tone-red',
      vcls: 'pk-low',
      icon: 'ti-trending-down',
      clickable: (k.below_min || 0) > 0,
      onclick: 'setPtCategoryFilter(null); togglePtAttention(true)',
    },
    {
      label: 'Нет в наличии',
      value: k.zero || 0,
      hint: (k.zero || 0) > 0 ? 'остаток 0' : 'не пусто нигде',
      tone: 'tone-yellow',
      vcls: 'pk-zero',
      icon: 'ti-circle-x',
    },
    {
      label: 'Ожидается приход',
      value: Math.round(k.incoming || 0),
      hint: (k.incoming_orders || 0) + ' ' + _plural(k.incoming_orders || 0, ['заказ', 'заказа', 'заказов']) + ' поставщикам',
      tone: 'tone-blue',
      vcls: 'pk-in',
      icon: 'ti-truck-delivery',
      clickable: (k.incoming_orders || 0) > 0,
      onclick: "selectSidebarItem('supply-orders')",
    },
  ];
  host.innerHTML = kpis.map(x =>
    '<div class="fp-kpi ' + x.tone + (x.vcls ? ' ' + x.vcls : '') + (x.clickable ? ' clickable' : '') + '"' +
      (x.onclick ? ' onclick="' + x.onclick + '"' : '') + '>' +
      '<div class="fp-kpi-ic"><i class="ti ' + (x.icon || 'ti-box') + '"></i></div>' +
      '<div class="fp-kpi-body">' +
        '<div class="fp-kpi-label">' + escapeHtml(x.label) + '</div>' +
        '<div class="fp-kpi-value">' + x.value + '</div>' +
        '<div class="fp-kpi-hint">' + escapeHtml(x.hint) + '</div>' +
      '</div>' +
    '</div>'
  ).join('');
}

function _renderPtAiHint(d) {
  // ЭТАП 28.4: реальный BOM-анализ нехватки под план производства
  const host = document.getElementById('pt-ai');
  const body = document.getElementById('pt-ai-body');
  if (!host || !body) return;

  const shortage = (d && d.production_shortage) || [];
  if (shortage.length === 0) {
    // Нет дефицита — показываем зелёное «всё ок» только если есть активный план
    // Иначе скрываем полосу
    host.style.display = 'none';
    return;
  }

  // Топ-3 по нехватке для подробного блока, остальные общим счётом
  const top = shortage.slice(0, 3);
  const rest = shortage.length - top.length;

  // v2.44.26: каждый дефицитный компонент — отдельной строкой
  // с пояснением «для каких моделей»
  const itemsHtml = top.map(s => {
    const unit = s.unit && s.unit !== 'шт.' ? ' ' + escapeHtml(s.unit) : ' шт';
    const models = (s.models || []).filter(Boolean);
    const modelsHtml = models.length
      ? '<div class="pt-ai-item-why"><i class="ti ti-arrow-right" style="font-size:11px;"></i>нужен для: <b>' +
          models.map(escapeHtml).join(', ') +
        '</b></div>'
      : '';
    const critIcon = s.is_critical
      ? '<i class="ti ti-alert-triangle" style="color:#DC2626;font-size:13px;margin-right:4px;" title="критичный компонент"></i>'
      : '';
    return '<div class="pt-ai-item">' +
        '<div class="pt-ai-item-head">' +
          critIcon +
          '<span class="pt-ai-item-name">' + escapeHtml(s.component_name) + '</span>' +
          '<span class="pt-ai-item-need">нужно <b>' + _fmtNum(s.need) + unit + '</b> · есть <b>' + _fmtNum(s.have) + '</b>' +
            ' · <span style="color:#DC2626;font-weight:600;">не хватает ' + _fmtNum(s.shortage) + unit + '</span>' +
          '</span>' +
        '</div>' +
        modelsHtml +
      '</div>';
  }).join('');

  // Сериализуем shortage в data-атрибут для batch-кнопки
  const shortagePayload = JSON.stringify(shortage).replace(/"/g, '&quot;');

  body.innerHTML =
    '<div class="pt-ai-title">' +
      '<i class="ti ti-alert-triangle" style="color:#D97706;"></i>' +
      '<span>Под текущий план производства не хватит <b>' + shortage.length + '</b> ' +
        _plural(shortage.length, ['позиции', 'позиций', 'позиций']) + '</span>' +
      '<button class="pt-ai-how" type="button" onclick="this.parentNode.nextElementSibling.classList.toggle(\'open\'); this.classList.toggle(\'open\');">' +
        '<i class="ti ti-help-circle"></i> Как считается?' +
      '</button>' +
    '</div>' +
    '<div class="pt-ai-explanation">' +
      '<div><b>Логика расчёта:</b></div>' +
      '<ol style="margin:6px 0 0 18px; padding:0; line-height:1.55;">' +
        '<li>Беру все договоры в статусах <i>в производстве / готов / частично отгружен</i>.</li>' +
        '<li>Для каждой позиции считаю «осталось произвести» = qty договора − уже собранные сборки (in_progress / ready / shipped).</li>' +
        '<li>Раскрываю по BOM модели: <code>осталось × qty_required</code> = потребность по каждому компоненту.</li>' +
        '<li>Считаю дефицит: <code>потребность − qty_on_stock</code>. Резервы под другие работы не учитываются (только физический склад).</li>' +
      '</ol>' +
    '</div>' +
    '<div class="pt-ai-items">' + itemsHtml +
      (rest > 0
        ? '<div class="pt-ai-rest">и ещё <b>' + rest + '</b> ' + _plural(rest, ['позиция', 'позиции', 'позиций']) + ' — раскрой кнопкой ниже</div>'
        : ''
      ) +
    '</div>' +
    '<button class="btn btn-secondary btn-small" ' +
            'onclick="openPtShortageBatchOrder(this)" ' +
            'data-shortage="' + shortagePayload + '">' +
      '<i class="ti ti-shopping-cart-plus"></i> Создать заявки на ' + shortage.length + ' ' +
      _plural(shortage.length, ['позицию', 'позиции', 'позиций']) +
    '</button>';
  host.style.display = '';
  host.classList.remove('empty');
}

// Открывает batch-просмотр дефицитов с возможностью создания заявок
function openPtShortageBatchOrder(btn) {
  let shortage;
  try {
    shortage = JSON.parse((btn.dataset.shortage || '').replace(/&quot;/g, '"'));
  } catch (e) { shortage = []; }
  if (!shortage.length) return;
  _showPtShortageModal(shortage);
}

function _showPtShortageModal(shortage) {
  let m = document.getElementById('pt-shortage-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'pt-shortage-modal';
    m.className = 'modal-overlay';
    m.onclick = (e) => { if (e.target === m) m.classList.remove('visible'); };
    document.body.appendChild(m);
  }

  const rowsHtml = shortage.map(s => {
    const linked = s.supply_item_id != null;
    const recommend = Math.max(1, Math.round(s.shortage * 1.2));  // запас 20%
    return '<div style="display:grid;grid-template-columns:1fr 90px 110px;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);">' +
      '<div>' +
        '<div style="font-weight:500;font-size:13px;">' + escapeHtml(s.component_name) +
          (s.sku ? '<span style="color:#9CA3AF;margin-left:6px;font-size:12px;">' + escapeHtml(s.sku) + '</span>' : '') +
        '</div>' +
        '<div style="font-size:11px;color:var(--text-light);margin-top:2px;">' +
          'нужно ' + _fmtNum(s.need) + ' ' + escapeHtml(s.unit || 'шт.') +
          ' · есть ' + _fmtNum(s.have) +
          ' · модели: ' + (s.models || []).map(escapeHtml).join(', ') +
        '</div>' +
      '</div>' +
      '<div style="font-size:13px;color:#8C2A2A;font-weight:600;text-align:right;">−' + _fmtNum(s.shortage) + ' ' + escapeHtml(s.unit || 'шт.') + '</div>' +
      '<button class="btn btn-primary btn-small" onclick="openPtOrderFromShortage(' + s.component_id + ',' + recommend + ',' + (linked ? s.supply_item_id : 'null') + ')" style="font-size:12px;">' +
        '<i class="ti ti-shopping-cart-plus"></i> ' + (linked ? 'Заказать' : 'Связать и заказать') +
      '</button>' +
    '</div>';
  }).join('');

  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:720px;max-height:85vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-sparkles" style="color:#534AB7;"></i> Нехватка под план производства</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'pt-shortage-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:10px 14px;background:#EEEDFE;color:#3C3489;font-size:12px;border-bottom:1px solid #CECBF6;">' +
        '<i class="ti ti-info-circle"></i> Расчёт по активным договорам в производстве и готовности. По каждой позиции можно создать отдельную заявку в Снабжение.' +
      '</div>' +
      '<div style="overflow-y:auto;flex:1;">' + rowsHtml + '</div>' +
      '<div style="padding:12px 14px;border-top:1px solid var(--border);background:var(--bg);display:flex;justify-content:flex-end;gap:8px;">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'pt-shortage-modal\').classList.remove(\'visible\')">Закрыть</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

function openPtOrderFromShortage(componentId, recommendedQty, supplyItemId) {
  // Закрываем модалку дефицитов
  const m = document.getElementById('pt-shortage-modal');
  if (m) m.classList.remove('visible');
  // Делегируем общей функции заказа
  _doPtOrder(componentId, recommendedQty, supplyItemId);
}

function _renderPtChips(categories, total) {
  const host = document.getElementById('pt-chips');
  if (!host) return;
  let html = '<button class="pt-chip ' + (state.ptCategoryFilter == null ? 'active' : '') +
    '" onclick="setPtCategoryFilter(null)">' +
    'Все <span class="pt-chip-qty">' + total + '</span></button>';
  (categories || []).forEach(c => {
    const active = state.ptCategoryFilter === c.id;
    html += '<button class="pt-chip ' + (active ? 'active' : '') +
      '" onclick="setPtCategoryFilter(' + c.id + ')">' +
      escapeHtml(c.name) + ' <span class="pt-chip-qty">' + c.count + '</span>' +
      '</button>';
  });
  // Кнопка создания нового раздела (после всех категорий, пунктирная)
  html += '<button class="pt-chip" style="border-style:dashed;color:var(--brand);" onclick="createComponentCategoryPrompt()">' +
    '<i class="ti ti-plus" style="font-size:12px;"></i> Раздел</button>';
  host.innerHTML = html;
}

function _renderPtAttentionBtn(n) {
  const btn = document.getElementById('pt-attn-btn');
  const cnt = document.getElementById('pt-attn-count');
  if (!btn || !cnt) return;
  cnt.textContent = n;
  btn.classList.toggle('zero', n === 0);  // спрятать если 0
  btn.classList.toggle('active', state.ptAttentionOnly && n > 0);
}

function _renderPtInStockBtn() {
  const btn = document.getElementById('pt-instock-btn');
  const cnt = document.getElementById('pt-instock-count');
  if (!btn || !cnt) return;
  // Сколько позиций имеет qty_on_stock > 0
  const items = (state.ptData && state.ptData.items) || [];
  const inStock = items.filter(it => (parseFloat(it.qty_on_stock) || 0) > 0).length;
  cnt.textContent = inStock;
  btn.classList.toggle('zero', inStock === 0);
  btn.classList.toggle('active', !!state.ptInStockOnly);
}

function _renderPtList() {
  const host = document.getElementById('pt-list');
  if (!host || !state.ptData) return;
  let items = (state.ptData.items || []).slice();

  if (state.ptAttentionOnly) {
    items = items.filter(it => it.status === 'critical' || it.status === 'zero');
  }
  if (state.ptInStockOnly) {
    items = items.filter(it => (parseFloat(it.qty_on_stock) || 0) > 0);
  }
  if (state.ptCategoryFilter != null) {
    items = items.filter(it => it.category_id === state.ptCategoryFilter);
  }
  const q = (state.ptSearch || '').toLowerCase().trim();
  if (q) {
    items = items.filter(it =>
      (it.name || '').toLowerCase().includes(q) ||
      (it.sku || '').toLowerCase().includes(q)
    );
  }

  if (items.length === 0) {
    host.innerHTML = '<div class="empty-block"><i class="ti ti-package-off"></i>' +
      (state.ptCategoryFilter != null || q || state.ptAttentionOnly || state.ptInStockOnly
        ? 'По заданным фильтрам ничего не найдено'
        : 'Каталог комплектующих пуст') +
      '</div>';
    return;
  }

  host.innerHTML = items.map(it => _renderPtRow(it)).join('');
}

function _renderPtRow(it) {
  const st = it.status;  // zero | critical | excess | normal
  const unit = it.unit || 'шт.';
  const defectQty = parseFloat(it.qty_defective || 0);
  const defectBadge = defectQty > 0
    ? '<div class="pt-defect-pill" onclick="event.stopPropagation();openPtDefectsForComponent(' + it.id + ')" title="Заявки по этому комплектующему в Сервисе"><i class="ti ti-alert-triangle"></i>брак ' + _fmtNum(defectQty) + '</div>'
    : '';

  // Stock колонка
  let stockHtml;
  if (it.min_stock > 0) {
    stockHtml = '<div class="pt-row-stock ' + st + '">' +
      _fmtNum(it.qty_on_stock) +
      ' <span class="pt-row-stock-sub">/ ' + _fmtNum(it.min_stock) + ' ' + escapeHtml(unit) + '</span>' +
      defectBadge +
      '</div>';
  } else {
    stockHtml = '<div class="pt-row-stock ' + st + '">' +
      _fmtNum(it.qty_on_stock) + ' <span class="pt-row-stock-sub">' + escapeHtml(unit) + '</span>' +
      defectBadge +
      '</div>';
  }

  // Consumption
  const consumeHtml = '<div class="pt-row-consume">' +
    (it.consumption_30d > 0 ? '~' + _fmtNum(it.consumption_30d) + ' / мес' : '—') +
    '</div>';

  // Badge
  const labels = { zero: 'нет в наличии', critical: 'критично', excess: 'избыток', normal: 'в норме' };
  const badgeHtml = '<span class="pt-row-badge ' + st + '">' + labels[st] + '</span>';

  // Action
  // v2.44.65: кнопка «Брак» рядом с основным действием — текст + иконка-бинт
  const safeName = escapeHtml((it.name || '').replace(/\\\\/g, '\\\\\\\\').replace(/\'/g, "\\\\'"));
  const defectBtn = (it.qty_on_stock || 0) > 0
    ? '<button class="btn-defect-small" title="Пометить брак" onclick="event.stopPropagation();openMarkDefectiveModal(' + it.id + ',\'' + safeName + '\',' + (parseFloat(it.qty_on_stock) || 0) + ',\'' + escapeHtml(unit) + '\')"><i class="ti ti-bandage"></i><span>Брак</span></button>'
    : '';
  let mainBtn;
  if (st === 'zero' || st === 'critical') {
    const recommend = Math.max(1, Math.round((it.min_stock || 1) * 2 - (it.qty_on_stock || 0)));
    mainBtn = '<button class="btn-order" onclick="event.stopPropagation();openPtOrder(' + it.id + ',' + recommend + ')">' +
      '<i class="ti ti-shopping-cart-plus"></i><span>Заказать</span></button>';
  } else {
    mainBtn = '<button class="btn-writeoff" onclick="event.stopPropagation();openPtWriteoff(' + it.id + ')">' +
      '<i class="ti ti-minus"></i><span>Расход</span></button>';
  }
  const actionHtml = '<div class="pt-row-action">' + mainBtn + defectBtn + '</div>';

  return '<div class="pt-row s-' + st + '" onclick="openPtItemDetail(' + it.id + ')">' +
    '<span class="pt-row-cat-ic"><i class="ti ' + _nvIconFor(it.category_name) + '"></i></span>' +
    '<span class="pt-row-dot ' + st + '"></span>' +
    '<div>' +
      '<div class="pt-row-name">' + escapeHtml(it.name) +
        (it.sku ? '<span class="pt-row-sku">' + escapeHtml(it.sku) + '</span>' : '') +
      '</div>' +
      '<div class="pt-row-sub">' + escapeHtml(it.category_name || '—') + '</div>' +
    '</div>' +
    stockHtml +
    consumeHtml +
    badgeHtml +
    actionHtml +
    '</div>';
}

function _fmtNum(n) {
  // Целое — без дробной, иначе одна цифра после точки
  if (Math.abs(n - Math.round(n)) < 0.001) return String(Math.round(n));
  return n.toFixed(1).replace(/\.0$/, '');
}

// ---- Обработчики ----

function setPtCategoryFilter(catId) {
  state.ptCategoryFilter = catId;
  if (state.ptData) {
    _renderPtChips(state.ptData.categories, state.ptData.kpis.total || 0);
  }
  _renderPtList();
}

function togglePtAttention(forceOn) {
  if (forceOn === true) {
    state.ptAttentionOnly = true;
  } else {
    state.ptAttentionOnly = !state.ptAttentionOnly;
  }
  if (state.ptData) {
    _renderPtAttentionBtn(state.ptData.kpis.attention_count || 0);
  }
  _renderPtList();
}

function togglePtInStock() {
  state.ptInStockOnly = !state.ptInStockOnly;
  _renderPtInStockBtn();
  _renderPtList();
}

let _ptSearchTimer = null;
function onPtSearchInput() {
  const v = (document.getElementById('pt-search') || {}).value || '';
  state.ptSearch = v;
  clearTimeout(_ptSearchTimer);
  _ptSearchTimer = setTimeout(_renderPtList, 120);
}

function openPtItemDetail(id) {
  // Открыть существующую модалку редактирования компонента, если есть
  if (typeof openComponentForm === 'function') {
    openComponentForm(id);
  }
}

function openPtOrder(componentId, recommendedQty) {
  // ЭТАП 28.3.1: если у компонента есть связь — заказываем прозрачно
  const item = (state.ptData && state.ptData.items || []).find(i => i.id === componentId);
  if (!item) { showToast('Позиция не найдена', 'error'); return; }
  _doPtOrder(componentId, recommendedQty, item.supply_item_id);
}

function _doPtOrder(componentId, recommendedQty, supplyItemId) {
  const item = (state.ptData && state.ptData.items || []).find(i => i.id === componentId);
  const compName = item ? item.name : ('#' + componentId);
  const unit = item ? (item.unit || 'шт.') : 'шт.';

  if (supplyItemId) {
    // Связь есть — открываем форму заявки с предзаполнением
    if (typeof showSupplyRequestModal === 'function') {
      Promise.resolve(showSupplyRequestModal(null)).then(() => {
        // После рендера модалки выставим предзаполненные поля
        setTimeout(() => {
          const sel = document.getElementById('sr-item');
          const qty = document.getElementById('sr-qty');
          const cmt = document.getElementById('sr-comment');
          if (sel) sel.value = String(supplyItemId);
          if (qty) qty.value = String(recommendedQty);
          if (cmt) cmt.value = 'Автозаявка по дефициту: ' + compName;
        }, 80);
      });
      showToast('Заявка предзаполнена: ' + compName + ' × ' + recommendedQty + ' ' + unit, 'success');
      return;
    }
    // Fallback — обычный мастер
    if (typeof openNewSupplyRequest === 'function') openNewSupplyRequest();
    else selectSidebarItem('supply-requests');
    return;
  }

  // Связи нет — предлагаем создать
  if (!confirm(
    'У компонента «' + compName + '» нет связанной позиции в каталоге Снабжения.\n\n' +
    'Создать позицию автоматически и оформить заявку?\n\n' +
    '(Нажми OK для авто-создания, Отмена — чтобы привязать вручную в карточке комплектующего)'
  )) {
    if (typeof openComponentForm === 'function') openComponentForm(componentId);
    return;
  }

  // Авто-создание supply_item + привязка
  _autoLinkAndOrder(componentId, compName, unit, recommendedQty);
}

async function _autoLinkAndOrder(componentId, compName, unit, recommendedQty) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    // 1. Создаём supply_item
    const r1 = await fetch(API_BASE + '/api/supply-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ name: compName, kind: 'material', unit: unit }),
    });
    if (!r1.ok) {
      const e = await r1.json().catch(() => ({}));
      showToast(e.message || 'Не удалось создать позицию снабжения', 'error');
      return;
    }
    const supplyItem = await r1.json();
    const supplyItemId = supplyItem.id || (supplyItem.item && supplyItem.item.id);
    if (!supplyItemId) {
      showToast('Не удалось получить id новой позиции', 'error');
      return;
    }
    // 2. Привязываем к компоненту
    await fetch(API_BASE + '/api/components/' + componentId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ supply_item_id: supplyItemId }),
    });
    showToast('Создана связанная позиция «' + compName + '»', 'success');
    // 3. Обновляем кэш и открываем мастер заявки
    if (state.ptData && state.ptData.items) {
      const it = state.ptData.items.find(i => i.id === componentId);
      if (it) it.supply_item_id = supplyItemId;
    }
    if (cache.supplyCatalog) {
      cache.supplyCatalog.push({ id: supplyItemId, name: compName, unit: unit, kind: 'material', is_active: 1 });
    }
    _doPtOrder(componentId, recommendedQty, supplyItemId);
  } catch (e) {
    showToast('Ошибка при автосвязывании: ' + String(e), 'error');
  }
}

function openPtWriteoff(componentId) {
  // Используем существующую модалку списания, если есть
  if (typeof openComponentWriteoffModal === 'function') {
    openComponentWriteoffModal(componentId);
    return;
  }
  // Fallback: открыть карточку компонента
  if (typeof openComponentForm === 'function') {
    openComponentForm(componentId);
  }
}


async function loadWarehouseStock() {
  const container = document.getElementById('wh-stock-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-block">Загружаем остатки…</div>';

  try {
    const params = new URLSearchParams();
    if (state.warehouseFilter === 'free')     params.set('contract_id', 'free');
    if (state.warehouseFilter === 'reserved') params.set('contract_id', 'reserved');
    if (state.warehouseSearch)                params.set('search', state.warehouseSearch);
    const d = await apiGet('/api/warehouse/stock' + (params.toString() ? '?' + params.toString() : ''));
    cache.warehouseStock = d;
    renderWarehouseStock(d);
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить остатки: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderWarehouseStock(d) {
  const container = document.getElementById('wh-stock-list');
  if (!container) return;

  const list = d.stock || [];
  document.getElementById('wh-stock-counter').textContent = list.length;
  // ЭТАП 28.1: обновим бейдж таба
  if (typeof _updateWarehouseTabBadges === 'function') {
    _updateWarehouseTabBadges({ stock: list.length });
  }

  // ЭТАП 42.5 (v2.20.0): KPI считаем по реальным штукам, а не по числу записей.
  // Бэкенд возвращает summary.total/free/reserved как количество записей assemblies,
  // но визуально нужно показывать штуки — сумма stock_qty по статусу резерва.
  let totalQty = 0, freeQty = 0, reservedQty = 0;
  list.forEach(s => {
    const q = Number(s.stock_qty) || 0;
    totalQty += q;
    if (s.contract_id) reservedQty += q;
    else freeQty += q;
  });
  document.getElementById('wh-sum-total').textContent    = totalQty;
  document.getElementById('wh-sum-free').textContent     = freeQty;
  document.getElementById('wh-sum-reserved').textContent = reservedQty;

  if (!list.length) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-package-off"></i>Под выбранный фильтр сборок нет</div>';
    return;
  }

  // ЭТАП 42.3 (v2.20.0): группировка одинаковых сборок (модель + исполнение + IP + резерв)
  // Сохраняет порядок — первая встреченная сборка задаёт позицию группы в списке.
  if (!state.warehouseExpanded) state.warehouseExpanded = new Set();
  const groups = new Map(); // key → { items: [], total_qty, first }
  list.forEach(s => {
    const key = [
      s.model_id || 0,
      (s.execution || '').toLowerCase(),
      (s.ip_class || '').toLowerCase(),
      s.contract_id ? ('c' + s.contract_id) : 'free',
    ].join('|');
    if (!groups.has(key)) {
      groups.set(key, { key, items: [], total_qty: 0, first: s });
    }
    const g = groups.get(key);
    g.items.push(s);
    g.total_qty += Number(s.stock_qty) || 0;
  });

  // ЭТАП 42.4 (v2.20.0): сводка по модели — если у одной модели есть несколько групп
  // (свободные + под разные договоры), показываем заголовок-разделитель.
  const modelStats = new Map(); // model_id → { name, article, total, free, reserved, byContract: Map }
  for (const g of groups.values()) {
    const s = g.first;
    const mid = s.model_id || 0;
    if (!modelStats.has(mid)) {
      modelStats.set(mid, {
        name: s.model_name || '',
        article: s.model_article || '',
        total: 0, free: 0, reserved: 0,
        byContract: new Map(),
        groupCount: 0,
      });
    }
    const m = modelStats.get(mid);
    m.total += g.total_qty;
    m.groupCount += 1;
    if (s.contract_id) {
      m.reserved += g.total_qty;
      const cn = s.contract_number || '#' + s.contract_id;
      m.byContract.set(cn, (m.byContract.get(cn) || 0) + g.total_qty);
    } else {
      m.free += g.total_qty;
    }
  }

  let html = '';
  let prevModelId = null;
  for (const g of groups.values()) {
    const curModelId = g.first.model_id || 0;
    // Заголовок-сводка по модели, если у неё >1 группы (т.е. есть смешанные состояния)
    if (curModelId !== prevModelId) {
      const m = modelStats.get(curModelId);
      if (m && m.groupCount > 1) {
        let breakdown = '';
        if (m.free > 0) breakdown += '<span style="color:var(--success);">свободно: ' + m.free + '</span>';
        for (const [cn, qty] of m.byContract.entries()) {
          if (breakdown) breakdown += ' · ';
          breakdown += '<span style="color:var(--brand);">' + escapeHtml(cn) + ': ' + qty + '</span>';
        }
        html += '<div class="wh-model-summary">' +
          '<i class="ti ti-package"></i> ' +
          '<b>' + escapeHtml(m.name) + '</b> ' +
          (m.article ? '<span class="wh-code">' + escapeHtml(m.article) + '</span>' : '') +
          ' · всего ' + m.total + ' шт. · ' + breakdown +
          '</div>';
      }
      prevModelId = curModelId;
    }

    if (g.items.length === 1) {
      html += renderStockRow(g.items[0]);
    } else {
      html += renderStockGroup(g);
    }
  }
  container.innerHTML = html;
}

function renderStockGroup(g) {
  const s = g.first;
  const isExpanded = state.warehouseExpanded.has(g.key);
  const reserved = !!s.contract_id;
  const label = (s.execution || '') + (s.execution && s.ip_class ? ' · ' : '') + (s.ip_class || '');

  let badge = '';
  if (reserved) {
    const archived = !s.contract_is_active;
    badge = '<span class="wh-reserve-badge' + (archived ? ' archived' : '') +
            '" onclick="event.stopPropagation(); openContractFromWarehouse(' + s.contract_id + ')" title="' +
            escapeHtml(archived ? 'Договор в архиве' : 'Перейти в договор') + '">' +
            '<i class="ti ti-link"></i>' + escapeHtml(s.contract_number || '') +
            (s.contractor_name ? ' · ' + escapeHtml(s.contractor_name) : '') +
            '</span>';
  } else {
    badge = '<span class="wh-free-badge"><i class="ti ti-unlink"></i>свободна</span>';
  }

  // Развёрнутые подстроки — компактный вид с датой и кол-вом
  let detailsHtml = '';
  if (isExpanded) {
    detailsHtml = '<div class="wh-stock-group-details">';
    g.items.forEach(it => {
      detailsHtml +=
        '<div class="wh-stock-row compact" onclick="event.stopPropagation(); openAssemblyStock(' + it.id + ')">' +
          '<div class="wh-stock-icon" style="width:32px;height:32px;"><i class="ti ti-package"></i></div>' +
          '<div class="wh-stock-body">' +
            '<div class="wh-stock-meta">' +
              '<span><i class="ti ti-calendar"></i>' + escapeHtml(it.assembly_date || '') + '</span>' +
              '<span style="color:var(--text-light);">сборка #' + it.id + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="wh-stock-qty" style="font-size:14px;">' + it.stock_qty + ' шт.</div>' +
        '</div>';
    });
    detailsHtml += '</div>';
  }

  const chevron = '<i class="ti ti-chevron-' + (isExpanded ? 'down' : 'right') + ' wh-group-chevron"></i>';

  return '<div class="wh-stock-group' + (isExpanded ? ' expanded' : '') + '">' +
    '<div class="wh-stock-row wh-stock-group-header" onclick="toggleWarehouseGroup(\'' + g.key.replace(/'/g, "\\'") + '\')">' +
      '<div class="wh-stock-icon"><i class="ti ti-stack-2"></i></div>' +
      '<div class="wh-stock-body">' +
        '<div class="wh-stock-title">' + escapeHtml(s.model_name || '') +
          (s.model_article ? ' <span class="wh-code">' + escapeHtml(s.model_article) + '</span>' : '') +
        '</div>' +
        '<div class="wh-stock-meta">' +
          (label ? '<span><i class="ti ti-tag"></i>' + escapeHtml(label) + '</span>' : '') +
          '<span style="color:var(--text-light);"><i class="ti ti-package"></i>' + g.items.length + ' сборок</span>' +
          badge +
        '</div>' +
      '</div>' +
      '<div class="wh-stock-qty">' + g.total_qty + ' шт.</div>' +
      '<div class="wh-stock-actions">' + chevron + '</div>' +
    '</div>' +
    detailsHtml +
    '</div>';
}

function toggleWarehouseGroup(key) {
  if (!state.warehouseExpanded) state.warehouseExpanded = new Set();
  if (state.warehouseExpanded.has(key)) {
    state.warehouseExpanded.delete(key);
  } else {
    state.warehouseExpanded.add(key);
  }
  // Перерисовываем из кэша
  if (cache.warehouseStock) renderWarehouseStock(cache.warehouseStock);
}

function renderStockRow(s) {
  const reserved = !!s.contract_id;
  const label = (s.execution || '') + (s.execution && s.ip_class ? ' · ' : '') + (s.ip_class || '');
  const stateCanManage = canManageAssemblies();

  let badge = '';
  if (reserved) {
    const archived = !s.contract_is_active;
    badge = '<span class="wh-reserve-badge' + (archived ? ' archived' : '') +
            '" onclick="event.stopPropagation(); openContractFromWarehouse(' + s.contract_id + ')" title="' +
            escapeHtml(archived ? 'Договор в архиве' : 'Перейти в договор') + '">' +
            '<i class="ti ti-link"></i>' + escapeHtml(s.contract_number) +
            (s.contractor_name ? ' · ' + escapeHtml(s.contractor_name) : '') +
            '</span>';
  } else {
    badge = '<span class="wh-free-badge"><i class="ti ti-unlink"></i>свободна</span>';
  }

  // Действия — список зависит от прав и резерва
  let actions = '';
  if (stateCanManage) {
    actions += '<button class="btn-icon-warning" onclick="event.stopPropagation(); promptWriteOff(' + s.id + ', ' + s.stock_qty + ')" title="Списать">' +
               '<i class="ti ti-trash"></i></button>';
  }

  // ЭТАП 21: чекбокс выбора для массовой печати наклеек
  const isChecked = state.warehouseSelected && state.warehouseSelected.has(s.id);
  const checkboxHtml = '<div class="wh-select-cell" onclick="event.stopPropagation()">' +
    '<input type="checkbox" ' + (isChecked ? 'checked' : '') +
    ' onchange="toggleWarehouseSelect(' + s.id + ', this.checked)"></div>';

  return '<div class="wh-stock-row" onclick="openAssemblyStock(' + s.id + ')">' +
    checkboxHtml +
    '<div class="wh-stock-icon"><i class="ti ti-package"></i></div>' +
    '<div class="wh-stock-body">' +
      '<div class="wh-stock-title">' + escapeHtml(s.model_name) +
        (s.model_article ? ' <span class="wh-code">' + escapeHtml(s.model_article) + '</span>' : '') +
      '</div>' +
      '<div class="wh-stock-meta">' +
        (label ? '<span><i class="ti ti-tag"></i>' + escapeHtml(label) + '</span>' : '') +
        '<span><i class="ti ti-calendar"></i>' + escapeHtml(s.assembly_date || '') + '</span>' +
        badge +
      '</div>' +
    '</div>' +
    '<div class="wh-stock-qty">' + s.stock_qty + ' шт.</div>' +
    (actions ? '<div class="wh-stock-actions">' + actions + '</div>' : '') +
    '</div>';
}

function setWarehouseFilter(f) {
  state.warehouseFilter = f;
  document.querySelectorAll('[data-wh-filter]').forEach(b => {
    b.classList.toggle('active', b.dataset.whFilter === f);
  });
  // ЭТАП 21: очищаем выбор при смене фильтра
  if (state.warehouseSelected) state.warehouseSelected.clear();
  updateBulkActionBar();
  loadWarehouseStock();
}

function onWarehouseSearchInput() {
  const input = document.getElementById('wh-search');
  if (!input) return;
  clearTimeout(state.warehouseSearchTimer);
  state.warehouseSearchTimer = setTimeout(() => {
    state.warehouseSearch = input.value.trim();
    loadWarehouseStock();
  }, 300);
}

// Право управлять складом: мастер + директор (по аналогии с require_master_or_director)
function canManageAssemblies() {
  if (!state.user) return false;
  const roles = state.user.roles || [];
  return roles.includes('master') || roles.includes('director');
}

// --- Журнал движений ---

async function loadWarehouseMovements() {
  const container = document.getElementById('wh-movements-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-block">Загружаем журнал…</div>';

  try {
    const params = new URLSearchParams();
    if (state.movementsFilter !== 'all') params.set('direction', state.movementsFilter);
    const d = await apiGet('/api/warehouse/movements' + (params.toString() ? '?' + params.toString() : ''));
    cache.warehouseMovements = d;
    renderWarehouseMovements(d);
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить журнал: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderWarehouseMovements(d) {
  const container = document.getElementById('wh-movements-list');
  if (!container) return;
  const list = d.movements || [];
  if (!list.length) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-history"></i>Под этот фильтр движений нет</div>';
    return;
  }
  let html = '';
  list.forEach(m => { html += renderMovementRow(m); });
  container.innerHTML = html;
}

function renderMovementRow(m) {
  const sign = m.direction === 'in' ? '+' : '−';
  const cls = m.direction;
  const ico = m.direction === 'in'        ? 'ti-arrow-down-right'
           : m.direction === 'out'       ? 'ti-arrow-up-right'
           : 'ti-trash';
  const label = (m.a_execution || '') + (m.a_execution && m.a_ip_class ? ' · ' : '') + (m.a_ip_class || '');

  return '<div class="wh-mov-row mov-' + cls + '" onclick="openAssemblyStock(' + m.assembly_id + ')">' +
    '<div class="wh-mov-icon"><i class="ti ' + ico + '"></i></div>' +
    '<div class="wh-mov-body">' +
      '<div class="wh-mov-title">' + escapeHtml(m.model_name) +
        (m.model_article ? ' <span class="wh-code">' + escapeHtml(m.model_article) + '</span>' : '') +
      '</div>' +
      '<div class="wh-mov-meta">' +
        '<span class="wh-mov-dir-pill ' + cls + '">' + escapeHtml(m.direction_label) + '</span>' +
        (label ? '<span><i class="ti ti-tag"></i>' + escapeHtml(label) + '</span>' : '') +
        (m.contract_id ? '<span class="wh-reserve-badge" onclick="event.stopPropagation(); openContractFromWarehouse(' + m.contract_id + ')"><i class="ti ti-link"></i>' + escapeHtml(m.contract_number || '') + (m.contractor_name ? ' · ' + escapeHtml(m.contractor_name) : '') + '</span>' : '') +
        (m.reason ? '<span><i class="ti ti-info-circle"></i>' + escapeHtml(m.reason) + '</span>' : '') +
        '<span><i class="ti ti-clock"></i>' + escapeHtml((m.created_at || '').replace('T', ' ').substring(0, 16)) + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="wh-mov-qty ' + cls + '">' + sign + m.qty + '</div>' +
    '</div>';
}

function setMovementsFilter(f) {
  state.movementsFilter = f;
  document.querySelectorAll('[data-wh-mov]').forEach(b => {
    b.classList.toggle('active', b.dataset.whMov === f);
  });
  loadWarehouseMovements();
}

// --- Действия со склада ---

function openContractFromWarehouse(contractId) {
  if (!contractId) return;
  state.currentContractId = contractId;
  selectSection('sales');
  selectSidebarItem('sales-contract-detail');
}

async function openAssemblyStock(assemblyId) {
  // Открываем модалку с историей движений (минималистично, без отдельного экрана)
  try {
    const d = await apiGet('/api/assemblies/' + assemblyId + '/stock');
    showAssemblyStockModal(d);
  } catch (e) {
    showToast('Не удалось загрузить карточку сборки', 'error');
  }
}

function showAssemblyStockModal(d) {
  const a = d.assembly;
  const movs = d.movements || [];
  const stateCanManage = canManageAssemblies();

  let movsHtml = '';
  if (!movs.length) {
    movsHtml = '<div class="empty-block" style="padding: 16px;"><i class="ti ti-history"></i>История пуста</div>';
  } else {
    movs.forEach(m => {
      const sign = m.direction === 'in' ? '+' : '−';
      movsHtml += '<div class="mov-mini mov-' + m.direction + '">' +
        '<div class="mov-mini-sign">' + sign + m.qty + '</div>' +
        '<div class="mov-mini-body">' +
          '<div class="mov-mini-title">' + escapeHtml(m.direction_label) +
            (m.contract_number ? ' · договор ' + escapeHtml(m.contract_number) : '') +
          '</div>' +
          '<div class="mov-mini-meta">' +
            (m.reason ? escapeHtml(m.reason) + ' · ' : '') +
            escapeHtml((m.created_at || '').replace('T', ' ').substring(0, 16)) +
          '</div>' +
        '</div></div>';
    });
  }

  let actionsHtml = '';
  if (stateCanManage) {
    // Переключение статуса: показываем кнопки в зависимости от текущего состояния
    if (a.status === 'in_progress') {
      actionsHtml += '<button class="btn btn-primary" onclick="changeAssemblyStatus(' + a.id + ', \'ready\')"><i class="ti ti-check"></i> Перевести в «Готово» (на склад)</button>';
    }
    const _isAsm = (a.work_type === 'assembly' || !a.work_type);
    // Назначить свободную сборку в изделие (договор) → уйдёт в резерв
    if (_isAsm && !a.contract_id && a.stock_qty > 0) {
      actionsHtml += '<button class="btn btn-secondary" onclick="openReserveAssemblyPicker(' + a.id + ')"><i class="ti ti-link"></i> Назначить в изделие</button>';
    }
    // Снять резерв (вернуть в свободный остаток)
    if (_isAsm && a.contract_id && a.status !== 'shipped') {
      actionsHtml += '<button class="btn btn-secondary" onclick="unreserveAssembly(' + a.id + ')"><i class="ti ti-unlink"></i> Снять резерв</button>';
    }
    if (a.stock_qty > 0) {
      actionsHtml += '<button class="btn btn-danger btn-secondary" onclick="promptWriteOff(' + a.id + ', ' + a.stock_qty + ')"><i class="ti ti-trash"></i> Списать</button>';
    }
  }

  const m = document.getElementById('assembly-stock-modal');
  // ЭТАП 21: данные для QR (экранируем для inline JS)
  const qrModelName = JSON.stringify(a.model_name || '').replace(/"/g, '&quot;');
  const qrArticle   = JSON.stringify(a.model_article || '').replace(/"/g, '&quot;');
  const qrDate      = JSON.stringify(a.assembly_date || '').replace(/"/g, '&quot;');
  m.innerHTML =
    
    '<div class="modal" onclick="event.stopPropagation()">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-package"></i> ' + escapeHtml(a.model_name || (a.work_type && a.work_type !== 'assembly' ? ({repair:'Ремонт',commissioning:'Пусконаладка',installation:'Монтаж',diagnostics:'Диагностика',design:'Проектирование',maintenance:'ТО',other:'Прочее'}[a.work_type] || 'Работа') : 'Работа')) +
          (a.work_type && a.work_type !== 'assembly'
            ? ' <span class="work-type-badge wt-' + a.work_type + '" style="margin-left: 6px;">' + escapeHtml({repair:'Ремонт',commissioning:'Пусконаладка',installation:'Монтаж',diagnostics:'Диагностика',design:'Проектирование',maintenance:'ТО',other:'Прочее'}[a.work_type] || a.work_type) + '</span>'
            : '') +
        '</h3>' +
        '<div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">' +
          '<button class="btn-icon-qr" onclick="showAssemblyQr(' + a.id + ', ' + qrModelName + ', ' + qrArticle + ', ' + qrDate + ')" title="QR-код сборки">' +
            '<i class="ti ti-qrcode"></i> QR' +
          '</button>' +
          '<button class="btn-icon-qr" style="background: #FFF4E6; color: #B25E00;" onclick="openDefectFormForAssembly(' + a.id + ')" title="Добавить замечание">' +
            '<i class="ti ti-alert-circle"></i> Доработка' +
          '</button>' +
          '<button class="btn-icon-qr" style="background: #E8F5E9; color: #15803D;" onclick="openShareWithInstaller(' + a.id + ', \'assembly\')" title="Отправить ссылку монтажнику">' +
            '<i class="ti ti-send"></i> Монтажнику' +
          '</button>' +
          '<button class="modal-close" onclick="closeAssemblyStockModal()"><i class="ti ti-x"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="modal-content">' +
        // ЭТАП 23: блок описания работы (для не-сборок) — крупно, заметно
        (a.work_type && a.work_type !== 'assembly' && a.description
          ? '<div style="background: #FFF4E6; border-left: 3px solid #B25E00; padding: 12px 14px; border-radius: 8px; margin-bottom: 14px;">' +
              '<div style="font-size: 11px; color: #B25E00; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px;">Что было сделано</div>' +
              '<div style="font-size: 14px; color: var(--text); line-height: 1.5; white-space: pre-wrap;">' + escapeHtml(a.description) + '</div>' +
            '</div>'
          : '') +
        '<div class="as-info-grid">' +
          '<div><span class="as-lbl">№ сборки:</span> <strong>#' + a.id + '</strong></div>' +
          '<div><span class="as-lbl">Статус:</span> <span class="status-pill st-' + a.status + '">' + escapeHtml(a.status_label) + '</span></div>' +
          (a.work_type === 'assembly' || !a.work_type
            ? '<div><span class="as-lbl">Остаток:</span> <strong>' + (a.stock_qty || 0) + ' шт.</strong></div>'
            : '') +
          (a.execution ? '<div><span class="as-lbl">Исполнение:</span> ' + escapeHtml(a.execution_label || a.execution) + '</div>' : '') +
          (a.ip_class ? '<div><span class="as-lbl">IP-класс:</span> ' + escapeHtml(a.ip_class) + '</div>' : '') +
          '<div><span class="as-lbl">Дата сборки:</span> ' + escapeHtml(a.assembly_date || '—') + '</div>' +
          (a.created_at ? '<div><span class="as-lbl">Внесена:</span> ' + escapeHtml((a.created_at || '').replace('T', ' ').substring(0, 16)) + '</div>' : '') +
          (a.location ? '<div><span class="as-lbl">Где:</span> ' + escapeHtml(a.location) + '</div>' : '') +
          (a.hours_spent ? '<div><span class="as-lbl">Часов:</span> <strong>' + a.hours_spent + ' ч</strong></div>' : '') +
          (a.contract_id
            ? '<div><span class="as-lbl">Договор:</span> <a href="#" onclick="event.preventDefault(); closeAssemblyStockModal(); openContractFromWarehouse(' + a.contract_id + ')" class="contract-link">' + escapeHtml(a.contract_number) + (a.contractor_name ? ' · ' + escapeHtml(a.contractor_name) : '') + '</a></div>'
            : (a.work_type === 'assembly' || !a.work_type ? '<div><span class="as-lbl">Договор:</span> <em>не привязан</em></div>' : '')) +
          (a.contract_item_name ? '<div><span class="as-lbl">Изделие:</span> <strong>' + escapeHtml(a.contract_item_name) + '</strong></div>' : '') +
        '</div>' +
        // v2.33.8: блок «Кто собирал»
        (a.workers && a.workers.length
          ? '<div class="as-workers-block">' +
              '<div class="as-workers-title"><i class="ti ti-users"></i> Кто собирал</div>' +
              '<div class="as-workers-list">' +
                a.workers.map(w =>
                  '<div class="as-worker-chip">' +
                    '<div class="as-worker-avatar">' + escapeHtml(getInitials(w.short_name || w.full_name)) + '</div>' +
                    '<div class="as-worker-body">' +
                      '<div class="as-worker-name">' + escapeHtml(w.short_name || w.full_name) + '</div>' +
                      (w.position ? '<div class="as-worker-pos">' + escapeHtml(w.position) + '</div>' : '') +
                    '</div>' +
                  '</div>'
                ).join('') +
              '</div>' +
            '</div>'
          : '') +
        // Комментарий к сборке
        (a.comment
          ? '<div style="background: var(--bg); border-radius: 8px; padding: 10px 12px; margin-top: 14px; font-size: 13px; color: var(--text-dark); white-space: pre-wrap;">' +
              '<div style="font-size:11px;color:var(--text-light);text-transform:uppercase;letter-spacing:0.4px;font-weight:600;margin-bottom:4px;">Комментарий</div>' +
              escapeHtml(a.comment) +
            '</div>'
          : '') +
        (actionsHtml ? '<div class="as-actions">' + actionsHtml + '</div>' : '') +
        '<div class="as-history-title">История движений</div>' +
        '<div class="as-history-list">' + movsHtml + '</div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

function closeAssemblyStockModal() {
  document.getElementById('assembly-stock-modal').classList.remove('visible');
}

async function changeAssemblyStatus(assemblyId, newStatus) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/assemblies/' + assemblyId + '/status', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось изменить статус', 'error');
      return;
    }
    showToast('Статус изменён', 'success');
    closeAssemblyStockModal();
    cache.warehouseStock = null;
    cache.warehouseMovements = null;
    // ЭТАП 28.1: экран теперь warehouse-dashboard, активный таб — в state.activeWarehouseTab
    if (state.currentScreen === 'warehouse-dashboard') {
      if (state.activeWarehouseTab === 'stock')     loadFinishedProductsDashboard();
      if (state.activeWarehouseTab === 'movements') loadWarehouseMovements();
    }
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function promptWriteOff(assemblyId, currentStock) {
  const reason = prompt('Укажите причину списания (брак, бой и т.п.):');
  if (reason === null) return;
  if (!reason.trim()) {
    showToast('Без причины списать нельзя', 'error');
    return;
  }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/warehouse/movements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({
        assembly_id: assemblyId,
        direction:   'write_off',
        qty:         currentStock,
        reason:      reason.trim(),
      }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось списать', 'error');
      return;
    }
    showToast('Списано', 'success');
    closeAssemblyStockModal();
    cache.warehouseStock = null;
    cache.warehouseMovements = null;
    // ЭТАП 28.1: экран теперь warehouse-dashboard, активный таб — в state.activeWarehouseTab
    if (state.currentScreen === 'warehouse-dashboard') {
      if (state.activeWarehouseTab === 'stock')     loadFinishedProductsDashboard();
      if (state.activeWarehouseTab === 'movements') loadWarehouseMovements();
    }
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// --- Кнопка "Отгрузить по договору" — вызывается из карточки договора ---

async function shipByContract(contractId) {
  // v2.45.146: массовая отгрузка под личным паролём
  const password = await _promptPasswordForAction(
    'Отгрузить все готовые сборки по договору?',
    'Подтверди отгрузку личным паролём.'
  );
  if (password === null) return;   // отменили
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/contracts/' + contractId + '/ship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ password: password }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 && d.error === 'password_required') { showToast('Нужно подтвердить паролем', 'error'); return; }
      if (r.status === 403 && d.error === 'wrong_password') {
        if (typeof _clearCachedPassword === 'function') _clearCachedPassword();
        showToast('Неверный пароль — отгрузка не выполнена', 'error'); return;
      }
      showToast(d.message || 'Не удалось отгрузить', 'error');
      return;
    }
    const result = await r.json();
    if (result.shipped > 0) {
      showToast('Отгружено: ' + result.shipped + ' шт.' + (result.skipped > 0 ? ' (пропущено ' + result.skipped + ')' : ''), 'success');
    } else {
      showToast('На складе по этому договору ничего нет', 'info');
    }
    // Инвалидация всех связанных кешей и перерисовка
    cache.warehouseStock = null;
    cache.warehouseMovements = null;
    if (cache.contractAssemblies) cache.contractAssemblies = {};
    if (state.currentContractId) loadCurrentContract();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

// ============================================================
// ============ ЭТАП 19: СНАБЖЕНИЕ ============
// ============================================================

cache.suppliers = null;
cache.supplyCatalog = null;
cache.supplyRequests = null;
cache.supplyOrders = null;
cache.supplyReceipts = null;
cache.currentSupplyOrder = null;

state.supplyReqFilter = 'open';        // open | new | ordered | received | all
state.supplyOrdFilter = 'open';        // open | draft | sent | partial | received | all
state.supplyCatKindFilter = 'all';     // all | material | product
state.supplyCatSearch = '';
state.supplyCatSearchTimer = null;
state.supplierSearch = '';
state.supplierSearchTimer = null;
state.currentSupplyOrderId = null;

const SUPPLY_ITEM_KIND_LABELS = {
  material: 'Комплектующее',
  product:  'Товар для перепродажи',
};

const SUPPLY_REQUEST_STATUS_LABELS = {
  new:       'новая',
  ordered:   'в заказе',
  received:  'получена',
  cancelled: 'отменена',
};

const SUPPLY_ORDER_STATUS_LABELS = {
  draft:     'черновик',
  sent:      'отправлен',
  partial:   'частично',
  received:  'получен',
  cancelled: 'отменён',
};

function canManageSupply() {
  if (!state.user) return false;
  const roles = state.user.roles || [];
  return roles.includes('director') || roles.includes('zam') || roles.includes('manager');
}

// ========== ПОСТАВЩИКИ ==========

async function loadSuppliers() {
  const container = document.getElementById('sup-sup-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-block">Загружаем поставщиков…</div>';
  try {
    // v2.45.x: грузим всех, поиск (в т.ч. по продукции) — на клиенте, мгновенно
    const d = await apiGet('/api/suppliers');
    cache.suppliers = d.suppliers || [];
    renderSuppliers();
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить: ' + escapeHtml(String(e)) + '</div>';
  }
}

// v2.45.x: «Поставщики» — карточки с аватарами, кликабельными контактами, продукцией
function _splInitials(name) {
  let s = String(name || '').replace(/[«»"'()]/g, ' ').replace(/-/g, ' ')
    .replace(/\b(ООО|ОАО|ЗАО|ПАО|АО|ИП|ТД|ТПК|завод|компания)\b/gi, ' ').trim();
  const w = s.split(/\s+/).filter(Boolean);
  if (!w.length) { const t = String(name || '').replace(/\s/g, ''); return t.slice(0, 2).toUpperCase() || '—'; }
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[1][0]).toUpperCase();
}
function _splColorIdx(name) {
  let h = 0; const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 6;
}
function _splFilter(list) {
  const q = (state.supplierSearch || '').toLowerCase().trim();
  if (!q) return list;
  return list.filter(s => {
    const hay = [s.name, s.inn, s.comment, s.contact_person, s.phone, s.email].filter(Boolean).join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  });
}
function _splCard(s, canManage) {
  const chips = [];
  if (s.contact_person) chips.push('<span class="spl-chip person"><span class="em">👤</span> ' + escapeHtml(s.contact_person) + '</span>');
  if (s.phone) {
    const isWa = /whats\s?app|ватсап/i.test(s.phone);
    const tel = String(s.phone).replace(/[^\d+]/g, '');
    chips.push('<a class="spl-chip ' + (isWa ? 'wa' : 'phone') + '" href="tel:' + escapeHtml(tel) + '" onclick="event.stopPropagation();"><span class="em">' + (isWa ? '💬' : '📞') + '</span> ' + escapeHtml(s.phone) + '</a>');
  }
  if (s.email) chips.push('<a class="spl-chip mail" href="mailto:' + escapeHtml(s.email) + '" onclick="event.stopPropagation();"><span class="em">✉</span> ' + escapeHtml(s.email) + '</a>');
  const contactsHtml = chips.length
    ? '<div class="spl-contacts">' + chips.join('') + '</div>'
    : '<div class="spl-empty">Контакты не заполнены — нажми, чтобы добавить</div>';
  const prod = s.comment ? '<div class="spl-prod"><span class="em">📦</span><span><b>Возит:</b> ' + escapeHtml(s.comment) + '</span></div>' : '';
  const innRow = s.inn ? '<div class="spl-inn">ИНН ' + escapeHtml(s.inn) + '</div>' : '';
  const actions = canManage
    ? '<div class="spl-card-actions">' +
        '<button class="spl-iact" title="Карточка поставщика" onclick="event.stopPropagation();openEditSupplier(' + s.id + ')"><span class="em">✏️</span></button>' +
        '<button class="spl-iact del" title="Удалить" onclick="event.stopPropagation();deleteSupplier(' + s.id + ')"><span class="em">🗑</span></button>' +
      '</div>'
    : '';
  return '<div class="spl-card" onclick="openEditSupplier(' + s.id + ')">' +
    actions +
    '<div class="spl-card-top"><div class="spl-ava a' + _splColorIdx(s.name) + '">' + escapeHtml(_splInitials(s.name)) + '</div>' +
      '<div class="spl-name-wrap"><div class="spl-name">' + escapeHtml(s.name) + '</div>' + innRow + '</div></div>' +
    contactsHtml + prod +
  '</div>';
}
function toggleSupV2() {
  window.SUP_V2 = !window.SUP_V2;
  try { localStorage.setItem('supV2', window.SUP_V2 ? '1' : '0'); } catch (_) {}
  renderSuppliers();
}

function renderSuppliers() {
  const container = document.getElementById('sup-sup-list');
  if (!container) return;
  const all = cache.suppliers || [];
  const counter = document.getElementById('sup-sup-counter');
  if (counter) counter.textContent = all.length;
  window.SUP_V2 = localStorage.getItem('supV2') !== '0';
  const toggle = '<div class="sv2-toggle-bar">' +
      '<span><i class="ti ti-' + (window.SUP_V2 ? 'sparkles' : 'history') + '"></i> ' + (window.SUP_V2 ? 'Новый вид' : 'Старый вид') + '</span>' +
      '<button class="sv2-toggle-btn" onclick="toggleSupV2()">' + (window.SUP_V2 ? 'Вернуть старый' : 'Включить новый') + '</button>' +
    '</div>';
  if (!all.length) {
    container.innerHTML = toggle + '<div class="empty-block"><i class="ti ti-truck-loading"></i>Поставщиков пока нет</div>';
    return;
  }
  const list = _splFilter(all);
  const canManage = canManageSupply();
  if (!window.SUP_V2) { container.innerHTML = toggle + _renderSuppliersOld(list, canManage); return; }
  if (!list.length) {
    container.innerHTML = toggle + '<div class="empty-block" style="padding:28px;"><i class="ti ti-search-off"></i>Ничего не найдено по «' + escapeHtml(state.supplierSearch) + '»</div>';
    return;
  }
  let html = toggle + '<div class="spl-grid">';
  list.forEach(s => { html += _splCard(s, canManage); });
  html += '</div>';
  container.innerHTML = html;
}

// Старый вид (для отката) — прежний плоский список строк
function _renderSuppliersOld(list, canManage) {
  let html = '';
  list.forEach(s => {
    const lines = [];
    if (s.contact_person) lines.push('<i class="ti ti-user"></i>' + escapeHtml(s.contact_person));
    if (s.phone)          lines.push('<i class="ti ti-phone"></i>' + escapeHtml(s.phone));
    if (s.email)          lines.push('<i class="ti ti-mail"></i>' + escapeHtml(s.email));
    if (s.inn)            lines.push('<i class="ti ti-id"></i>ИНН ' + escapeHtml(s.inn));
    html += '<div class="sup-row" onclick="openEditSupplier(' + s.id + ')">' +
      '<div class="sup-row-icon"><i class="ti ti-truck-loading"></i></div>' +
      '<div class="sup-row-body">' +
        '<div class="sup-row-title">' + escapeHtml(s.name) + '</div>' +
        (lines.length ? '<div class="sup-row-meta">' + lines.map(l => '<span>' + l + '</span>').join('') + '</div>' : '') +
        (s.comment ? '<div class="sup-row-comment">' + escapeHtml(s.comment) + '</div>' : '') +
      '</div>' +
      (canManage ? '<div class="sup-row-actions"><button class="btn-icon-warning" onclick="event.stopPropagation(); deleteSupplier(' + s.id + ')" title="Удалить"><i class="ti ti-trash"></i></button></div>' : '') +
      '</div>';
  });
  return html;
}

function onSupplierSearchInput() {
  const input = document.getElementById('sup-sup-search');
  // v2.45.x: фильтрация на клиенте — мгновенно, по названию/ИНН/продукции/контактам
  state.supplierSearch = (input.value || '').trim();
  renderSuppliers();
}

function openNewSupplier() {
  if (!canManageSupply()) { showToast('Доступно директору, заму, менеджеру', 'error'); return; }
  showSupplierModal(null);
}

async function openEditSupplier(supplierId) {
  try {
    const s = await apiGet('/api/suppliers/' + supplierId);
    showSupplierModal(s);
  } catch (e) {
    showToast('Не удалось загрузить', 'error');
  }
}

function showSupplierModal(s) {
  const isEdit = !!s;
  const canManage = canManageSupply();
  const m = document.getElementById('supply-modal');
  m.innerHTML =
    
    '<div class="modal" onclick="event.stopPropagation()">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-truck-loading"></i> ' + (isEdit ? 'Редактировать поставщика' : 'Новый поставщик') + '</h3>' +
        '<button class="modal-close" onclick="closeSupplyModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        '<div class="form-group"><label>Название *</label><input type="text" id="sm-name" value="' + escapeHtml(isEdit ? s.name : '') + '" ' + (canManage ? '' : 'disabled') + '></div>' +
        // ЭТАП 34.2: ИНН + кнопка выбора из контрагентов (762 шт. из 1С)
        '<div class="form-group">' +
          '<label>ИНН</label>' +
          '<div style="display:flex;gap:8px;">' +
            '<input type="text" id="sm-inn" value="' + escapeHtml(isEdit ? (s.inn || '') : '') + '" placeholder="Введи ИНН или выбери →" style="flex:1;" ' + (canManage ? '' : 'disabled') + '>' +
            (canManage ? '<button type="button" class="btn btn-secondary" onclick="openSupplierContractorPicker()" title="Выбрать из контрагентов"><i class="ti ti-users"></i> Из контрагентов</button>' : '') +
          '</div>' +
        '</div>' +
        '<div class="form-group"><label>Контактное лицо</label><input type="text" id="sm-contact" value="' + escapeHtml(isEdit ? s.contact_person : '') + '" ' + (canManage ? '' : 'disabled') + '></div>' +
        '<div class="form-group form-row-2">' +
          '<div><label>Телефон</label><input type="text" id="sm-phone" value="' + escapeHtml(isEdit ? s.phone : '') + '" ' + (canManage ? '' : 'disabled') + '></div>' +
          '<div><label>Email</label><input type="email" id="sm-email" value="' + escapeHtml(isEdit ? s.email : '') + '" ' + (canManage ? '' : 'disabled') + '></div>' +
        '</div>' +
        '<div class="form-group"><label>Комментарий</label><textarea id="sm-comment" rows="3" ' + (canManage ? '' : 'disabled') + '>' + escapeHtml(isEdit ? s.comment : '') + '</textarea></div>' +
        // v2.45.239: прайс поставщика — его номенклатура для сопоставления в заявках
        (isEdit && canManage ?
          '<div class="form-group">' +
            '<label>Прайс поставщика <span style="text-transform:none;font-weight:400;color:var(--text-light);">— его названия для подстановки в заявки</span></label>' +
            '<div id="sm-price-count" style="font-size:12px;color:var(--text-light);margin:2px 0 8px;">Загружаем…</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
              '<label class="btn btn-secondary" style="cursor:pointer;margin:0;">' +
                '<i class="ti ti-file-spreadsheet"></i> Загрузить из Excel' +
                '<input type="file" accept=".xlsx,.xlsm,.xls" style="display:none;" onchange="uploadSupplierPriceExcel(' + s.id + ', this)">' +
              '</label>' +
              '<button type="button" class="btn btn-secondary" onclick="openSupplierPriceEditor(' + s.id + ')"><i class="ti ti-list"></i> Посмотреть / править</button>' +
            '</div>' +
          '</div>'
        : '') +
        // Переписка с поставщиком — входящие письма (из IMAP-инбокса)
        (isEdit ?
          '<div class="form-group">' +
            '<label>Переписка <span style="text-transform:none;font-weight:400;color:var(--text-light);">— входящие письма от поставщика</span></label>' +
            '<div id="sm-correspondence" style="margin-top:6px;">' +
              '<div style="font-size:12px;color:var(--text-light);">Загружаем…</div>' +
            '</div>' +
          '</div>'
        : '') +
        (canManage ? '<div class="modal-actions"><button class="btn btn-primary" onclick="saveSupplier(' + (isEdit ? s.id : 'null') + ')"><i class="ti ti-check"></i> Сохранить</button></div>' : '') +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  if (isEdit && canManage) _refreshSupplierPriceCount(s.id);
  if (isEdit) _loadSupplierCorrespondence(s.id);
}

async function _loadSupplierCorrespondence(supplierId) {
  const el = document.getElementById('sm-correspondence');
  if (!el) return;
  let items = [];
  let supEmail = '';
  try {
    const d = await apiGet('/api/suppliers/' + supplierId + '/correspondence');
    items = (d && d.items) || [];
    supEmail = (d && d.supplier_email) || '';
  } catch (e) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-light);">Не удалось загрузить переписку</div>';
    return;
  }
  if (!items.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-light);">' +
      (supEmail ? 'Писем от ' + escapeHtml(supEmail) + ' пока нет.' : 'У поставщика не указан email — письма не сматчить. Заполни email выше.') +
      '</div>';
    return;
  }
  let html = '<div style="display:flex;flex-direction:column;gap:8px;max-height:340px;overflow-y:auto;padding-right:2px;">';
  items.forEach(m => {
    const dt = _supCorrDate(m.received_at);
    const who = escapeHtml(m.from_name || m.from_addr || 'Поставщик');
    const subj = escapeHtml(m.subject || '(без темы)');
    const ord = m.order_label ? ('<span style="font-size:11px;background:var(--brand-bg,#eef2ff);color:var(--brand,#2563eb);border-radius:6px;padding:1px 6px;margin-left:6px;">' + escapeHtml(m.order_label) + '</span>') : '';
    const body = (m.body_text || '').trim();
    const bodyShort = body.length > 320 ? (escapeHtml(body.slice(0, 320)) + '…') : escapeHtml(body);
    let atts = '';
    if (m.attachments && m.attachments.length) {
      atts = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">' +
        m.attachments.map(a =>
          '<button class="btn btn-secondary btn-small" onclick="downloadInboxAttachmentDirect(' + m.id + ',' + a.idx + ',\'' + escapeHtml((a.name || '').replace(/'/g, "\\'")) + '\')" title="Скачать">' +
            '<i class="ti ti-paperclip"></i> ' + escapeHtml(a.name || ('файл ' + (a.idx + 1))) +
          '</button>'
        ).join('') +
      '</div>';
    }
    html += '<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:#fff;">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">' +
        '<div style="font-weight:600;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + who + ord + '</div>' +
        '<div style="font-size:11px;color:var(--text-light);white-space:nowrap;">' + escapeHtml(dt) + '</div>' +
      '</div>' +
      '<div style="font-size:13px;font-weight:500;margin-top:3px;">' + subj + '</div>' +
      (bodyShort ? '<div style="font-size:12.5px;color:var(--text);margin-top:5px;white-space:pre-wrap;word-break:break-word;">' + bodyShort + '</div>' : '') +
      atts +
    '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

function _supCorrDate(s) {
  if (!s) return '';
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(s).slice(0, 16).replace('T', ' ');
    const pad = (n) => String(n).padStart(2, '0');
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + String(d.getFullYear()).slice(2) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  } catch (e) { return String(s).slice(0, 16).replace('T', ' '); }
}

function closeSupplyModal() {
  document.getElementById('supply-modal').classList.remove('visible');
}

// ============ v2.45.239: прайс поставщика (номенклатура для заявок) ============

async function _refreshSupplierPriceCount(supplierId) {
  const el = document.getElementById('sm-price-count');
  if (!el) return;
  try {
    const d = await apiGet('/api/suppliers/' + supplierId + '/price-items');
    el.textContent = d.count
      ? ('В прайсе: ' + d.count + ' позиций — подсказываются в поле «У поставщика» при заявке')
      : 'Прайс пока пуст. Загрузи Excel — названия будут подсказываться при сопоставлении в заявке.';
  } catch (e) {
    el.textContent = '';
  }
}

async function uploadSupplierPriceExcel(supplierId, inputEl, sheetName) {
  // v2.45.241: файл может прийти из input или из повтора с выбранным листом
  let file = null;
  if (inputEl && inputEl.files && inputEl.files[0]) {
    file = inputEl.files[0];
    state._supPriceFile = file;     // запоминаем для повтора с листом
    inputEl.value = '';
  } else {
    file = state._supPriceFile;
  }
  if (!file) return;
  showToast('Читаем прайс…', 'info');
  const fd = new FormData();
  fd.append('file', file);
  if (sheetName) fd.append('sheet', sheetName);
  try {
    const r = await fetch(API_BASE + '/api/suppliers/' + supplierId + '/price-items/excel', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
      body: fd,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(j.message || 'Не удалось прочитать Excel', 'error'); return; }
    // Несколько листов — даём выбрать нужный (например «ПОЛУПРОМ On-Off»)
    if (j.sheets && j.sheets.length) {
      _showSupplierPriceSheetPicker(supplierId, j.sheets);
      return;
    }
    // v2.45.254: окно с галочками убрано — файл уже сохранён на сервере,
    // сразу открываем его таблицей «как в Excel». Выбор позиций — кликом по строке.
    state._supPriceSelSource = j.label || '';
    showToast('Прайс сохранён: ' + (j.label || ''), 'success');
    const pickerOpen = document.getElementById('op-alias-picker-modal') && state._opAliasPickerItemId;
    if (pickerOpen) {
      await openOpAliasPicker(state._opAliasPickerItemId);  // перечитать список прайсов
      if (j.price_file_id) _opOpenPriceFile(j.price_file_id);
    } else if (document.getElementById('sm-price-count')) {
      _refreshSupplierPriceCount(supplierId);
    }
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

// v2.45.241: выбор листа Excel-прайса (Скидка / РАСПРОДАЖА / ПОЛУПРОМ On-Off …)
function _showSupplierPriceSheetPicker(supplierId, sheets) {
  let m = document.getElementById('sup-price-sheet-modal');
  if (m) m.remove();
  m = document.createElement('div');
  m.id = 'sup-price-sheet-modal';
  m.className = 'modal-overlay visible';
  m.style.zIndex = '10002';
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:480px;max-height:80vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-table"></i> Какой лист прайса взять?</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'sup-price-sheet-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content" style="overflow-y:auto;">' +
        '<div style="font-size:12.5px;color:var(--text-light);margin-bottom:10px;">В файле несколько листов — выбери нужный (например «ПОЛУПРОМ On-Off»). Остальные не тронем.</div>' +
        sheets.map(sn =>
          '<button type="button" class="btn btn-secondary" style="display:block;width:100%;text-align:left;margin-bottom:6px;" ' +
            'onclick="document.getElementById(\'sup-price-sheet-modal\').remove(); uploadSupplierPriceExcel(' + supplierId + ', null, ' + JSON.stringify(sn).replace(/"/g, '&quot;') + ')">' +
            '<i class="ti ti-file-spreadsheet"></i> ' + escapeHtml(sn) +
          '</button>'
        ).join('') +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
}

async function openSupplierPriceEditor(supplierId) {
  try {
    const d = await apiGet('/api/suppliers/' + supplierId + '/price-items');
    _showSupplierPriceReview(supplierId, d.items || [], true);
  } catch (e) {
    showToast('Не удалось загрузить прайс', 'error');
  }
}

// ============ v2.45.242: выбор позиций из Excel галочками ============
// «Открыл прайс, полистал, тыкнул — ушло в каталог (и сразу в позицию заявки)».

state._supPriceSelLines = [];
state._supPriceSelSet = null;

function _showSupplierPriceSelect(supplierId, lines) {
  state._supPriceSelLines = lines;
  state._supPriceSelSet = new Set();
  let m = document.getElementById('sup-price-select-modal');
  if (m) m.remove();
  m = document.createElement('div');
  m.id = 'sup-price-select-modal';
  m.className = 'modal-overlay visible';
  m.style.zIndex = '10002';
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  const fromPicker = !!state._opAliasPickerItemId && !!document.getElementById('op-alias-picker-modal');
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:720px;max-height:92vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-list-check"></i> Прайс: выбери позиции (' + lines.length + ')</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'sup-price-select-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:10px 18px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
        '<div class="search-box" style="flex:1;min-width:200px;">' +
          '<i class="ti ti-search"></i>' +
          '<input type="text" id="sps-search" placeholder="Поиск по прайсу…" oninput="_renderSupPriceSelectList()">' +
        '</div>' +
        '<button type="button" class="btn btn-secondary" onclick="_supPriceSelectAll(true)">Выбрать видимое</button>' +
        '<button type="button" class="btn btn-secondary" onclick="_supPriceSelectAll(false)">Снять</button>' +
      '</div>' +
      '<div id="sps-list" style="overflow-y:auto;flex:1;padding:8px 18px;"></div>' +
      '<div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border);flex-wrap:wrap;">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'sup-price-select-modal\').remove()">Отмена</button>' +
        (fromPicker ?
          '<button class="btn btn-primary" id="sps-add-assign-btn" disabled onclick="_supPriceSelectSave(' + supplierId + ', true)">' +
            '<i class="ti ti-arrow-bar-to-down"></i> Добавить и подставить в позицию</button>' : '') +
        '<button class="btn btn-primary" id="sps-add-btn" disabled onclick="_supPriceSelectSave(' + supplierId + ', false)">' +
          '<i class="ti ti-check"></i> Добавить в каталог (<span id="sps-count">0</span>)</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
  _renderSupPriceSelectList();
  setTimeout(() => { const i = document.getElementById('sps-search'); if (i) i.focus(); }, 50);
}

function _spsVisibleIdx() {
  const q = ((document.getElementById('sps-search') || {}).value || '').toLowerCase().trim();
  const out = [];
  (state._supPriceSelLines || []).forEach((n, i) => {
    if (!q || n.toLowerCase().includes(q)) out.push(i);
  });
  return out;
}

function _renderSupPriceSelectList() {
  const box = document.getElementById('sps-list');
  if (!box) return;
  const sel = state._supPriceSelSet || new Set();
  const idxs = _spsVisibleIdx();
  if (!idxs.length) {
    box.innerHTML = '<div class="empty-block" style="padding:24px 10px;color:var(--text-light);">Ничего не нашлось</div>';
  } else {
    box.innerHTML = idxs.slice(0, 400).map(i => {
      const n = state._supPriceSelLines[i];
      const on = sel.has(i);
      return '<div onclick="_spsToggle(' + i + ')" ' +
        'style="display:flex;align-items:center;gap:10px;padding:7px 8px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px;' +
          (on ? 'background:rgba(45,95,139,0.08);' : '') + '">' +
        '<i class="ti ' + (on ? 'ti-square-check-filled' : 'ti-square') + '" style="font-size:17px;color:' + (on ? 'var(--brand)' : 'var(--text-light)') + ';flex-shrink:0;"></i>' +
        '<span>' + escapeHtml(n) + '</span>' +
      '</div>';
    }).join('') + (idxs.length > 400 ? '<div style="padding:8px 10px;color:var(--text-light);font-size:12px;">…показаны первые 400, уточни поиск</div>' : '');
  }
  _spsUpdateButtons();
}

function _spsToggle(i) {
  const sel = state._supPriceSelSet;
  if (sel.has(i)) sel.delete(i); else sel.add(i);
  _renderSupPriceSelectList();
}

function _supPriceSelectAll(on) {
  const sel = state._supPriceSelSet;
  _spsVisibleIdx().forEach(i => { if (on) sel.add(i); else sel.delete(i); });
  _renderSupPriceSelectList();
}

function _spsUpdateButtons() {
  const n = (state._supPriceSelSet || new Set()).size;
  const cnt = document.getElementById('sps-count');
  if (cnt) cnt.textContent = n;
  const addBtn = document.getElementById('sps-add-btn');
  if (addBtn) addBtn.disabled = !n;
  const aaBtn = document.getElementById('sps-add-assign-btn');
  if (aaBtn) aaBtn.disabled = (n !== 1);  // подставить можно ровно одну
}

async function _supPriceSelectSave(supplierId, assignToItem) {
  const names = Array.from(state._supPriceSelSet || []).map(i => state._supPriceSelLines[i]).filter(Boolean);
  if (!names.length) return;
  try {
    const r = await fetch(API_BASE + '/api/suppliers/' + supplierId + '/price-items/import', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ names, source: state._supPriceSelSource || '' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(j.message || 'Не удалось сохранить', 'error'); return; }
    const m = document.getElementById('sup-price-select-modal');
    if (m) m.remove();
    showToast('В каталог: +' + j.added + ' (всего ' + j.total + ')', 'success');
    // Подставить выбранную позицию прямо в строку заявки
    if (assignToItem && names.length === 1 && state._opAliasPickerItemId) {
      const itemId = state._opAliasPickerItemId;
      const pm = document.getElementById('op-alias-picker-modal');
      if (pm) pm.remove();
      const input = document.querySelector('[data-op-alias-id="' + itemId + '"]');
      if (input) input.value = names[0];
      await _opUpdateItemAlias(itemId, names[0]);
      showToast('Сопоставлено: ' + names[0], 'success');
    } else if (document.getElementById('op-alias-picker-modal') && state._opAliasPickerItemId) {
      openOpAliasPicker(state._opAliasPickerItemId);  // обновить каталог
    }
    if (typeof _opCurrentDraft !== 'undefined' && _opCurrentDraft && _opCurrentDraft.supplier_id === supplierId) {
      _opFillAliasDatalist(supplierId);
    }
    if (document.getElementById('sm-price-count')) _refreshSupplierPriceCount(supplierId);
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

// Окно проверки: текстовый редактор прайса (используется из «Посмотреть / править»
// в карточке поставщика — для массовой чистки).
function _showSupplierPriceReview(supplierId, lines, isEditMode) {
  let m = document.getElementById('sup-price-review-modal');
  if (m) m.remove();
  m = document.createElement('div');
  m.id = 'sup-price-review-modal';
  m.className = 'modal-overlay visible';
  m.style.zIndex = '10002';
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:680px;max-height:90vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-list-check"></i> ' + (isEditMode ? 'Прайс поставщика' : 'Проверка прайса') + '</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'sup-price-review-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content" style="display:flex;flex-direction:column;flex:1;overflow:hidden;">' +
        '<div style="font-size:12.5px;color:var(--text-light);margin-bottom:8px;">' +
          (isEditMode
            ? 'Одна строка — одна позиция. Правь и сохраняй (список заменится целиком).'
            : 'Нашлось <b>' + lines.length + '</b> строк. <b>Удали лишнее</b> (заголовки, ненужные серии — оставь, например, только полупром) и сохрани. Одна строка — одна позиция.') +
        '</div>' +
        '<textarea id="sup-price-review-ta" style="flex:1;min-height:300px;font-family:ui-monospace,Consolas,monospace;font-size:12px;white-space:pre;overflow:auto;">' +
          escapeHtml(lines.join('\n')) +
        '</textarea>' +
      '</div>' +
      '<div class="modal-footer" style="display:flex;justify-content:space-between;gap:8px;padding:12px 16px;border-top:1px solid var(--border);">' +
        '<button class="btn btn-secondary" style="color:#B91C1C;" onclick="_clearSupplierPrice(' + supplierId + ')"><i class="ti ti-trash"></i> Очистить прайс</button>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="btn btn-secondary" onclick="document.getElementById(\'sup-price-review-modal\').remove()">Отмена</button>' +
          '<button class="btn btn-primary" onclick="_saveSupplierPrice(' + supplierId + ', ' + (isEditMode ? 'true' : 'false') + ')"><i class="ti ti-check"></i> Сохранить</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
}

async function _saveSupplierPrice(supplierId, replace) {
  const ta = document.getElementById('sup-price-review-ta');
  const names = (ta ? ta.value : '').split('\n').map(s => s.trim()).filter(s => s.length >= 3);
  if (!names.length && !replace) { showToast('Список пуст', 'error'); return; }
  try {
    const r = await fetch(API_BASE + '/api/suppliers/' + supplierId + '/price-items/import', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ names, replace: !!replace }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(j.message || 'Не удалось сохранить', 'error'); return; }
    showToast('Сохранено: +' + j.added + ' (всего в прайсе ' + j.total + ')', 'success');
    const m = document.getElementById('sup-price-review-modal');
    if (m) m.remove();
    _refreshSupplierPriceCount(supplierId);
    // v2.45.240: если прайс грузили из окна выбора в заявке — обновляем каталог
    if (document.getElementById('op-alias-picker-modal') && state._opAliasPickerItemId) {
      openOpAliasPicker(state._opAliasPickerItemId);
    }
    // и подсказки datalist в превью заявки
    if (typeof _opCurrentDraft !== 'undefined' && _opCurrentDraft && _opCurrentDraft.supplier_id === supplierId) {
      _opFillAliasDatalist(supplierId);
    }
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

async function _clearSupplierPrice(supplierId) {
  if (!confirm('Удалить весь прайс этого поставщика? Сопоставления «у поставщика» в позициях не пострадают.')) return;
  try {
    await apiDelete('/api/suppliers/' + supplierId + '/price-items');
    showToast('Прайс очищен', 'success');
    const m = document.getElementById('sup-price-review-modal');
    if (m) m.remove();
    _refreshSupplierPriceCount(supplierId);
  } catch (e) {
    showToast('Не удалось очистить', 'error');
  }
}

// ============ ЭТАП 34.2: Picker контрагентов в форме поставщика ============

async function openSupplierContractorPicker() {
  // Подгружаем контрагентов если ещё нет
  if (!cache.contractors) {
    try {
      const r = await apiGet('/api/contractors?type=legal');
      cache.contractors = r.contractors || [];
    } catch (e) {
      cache.contractors = [];
    }
  }
  if (!cache.contractors.length) {
    showToast('Контрагентов пока нет в базе', 'error');
    return;
  }
  state._supContractorPickerSearch = '';

  let m = document.getElementById('sup-contractor-picker-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'sup-contractor-picker-modal';
    m.className = 'modal-overlay';
    m.style.zIndex = '10001';
    m.onclick = (e) => { if (e.target === m) closeSupplierContractorPicker(); };
    document.body.appendChild(m);
  }
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:560px;max-height:85vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-users"></i> Выбрать из контрагентов</h3>' +
        '<button class="modal-close" onclick="closeSupplierContractorPicker()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:14px 18px 0;">' +
        '<div class="search-box">' +
          '<i class="ti ti-search"></i>' +
          '<input type="text" id="sup-cp-search" placeholder="Поиск по названию или ИНН…" oninput="renderSupplierContractorPicker()" />' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-light);padding:8px 0 0;">' +
          'Всего: <b>' + cache.contractors.length + '</b>. Введи 2+ символа чтобы найти.' +
        '</div>' +
      '</div>' +
      '<div id="sup-cp-list" style="overflow-y:auto;flex:1;padding:10px 18px 18px;">' +
        '<div class="empty-block" style="padding:30px 0;color:var(--text-light);">' +
          '<i class="ti ti-search"></i>Начни вводить название или ИНН' +
        '</div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  setTimeout(() => {
    const inp = document.getElementById('sup-cp-search');
    if (inp) inp.focus();
  }, 50);
}

function closeSupplierContractorPicker() {
  const m = document.getElementById('sup-contractor-picker-modal');
  if (m) m.classList.remove('visible');
}

function renderSupplierContractorPicker() {
  const container = document.getElementById('sup-cp-list');
  if (!container) return;
  const q = ((document.getElementById('sup-cp-search') || {}).value || '').toLowerCase().trim();
  if (q.length < 2) {
    container.innerHTML = '<div class="empty-block" style="padding:30px 0;color:var(--text-light);">' +
      '<i class="ti ti-search"></i>Начни вводить название или ИНН (минимум 2 символа)' +
    '</div>';
    return;
  }
  const list = (cache.contractors || []).filter(c =>
    (c.name || '').toLowerCase().includes(q) ||
    (c.inn || '').includes(q)
  ).slice(0, 50); // Показываем максимум 50

  if (!list.length) {
    container.innerHTML = '<div class="empty-block" style="padding:30px 0;">' +
      '<i class="ti ti-search-off"></i>Ничего не найдено' +
    '</div>';
    return;
  }
  let html = '';
  list.forEach(c => {
    const safeName = (c.name || '').replace(/'/g, "\\'");
    const safeInn = (c.inn || '').replace(/'/g, "\\'");
    html += '<button type="button" class="bom-picker-item" ' +
      'onclick="selectSupplierContractor(\'' + safeName + '\', \'' + safeInn + '\')">' +
      '<div class="bom-picker-item-name">' + escapeHtml(c.name || '—') + '</div>' +
      '<div class="bom-picker-item-meta">' +
        'ИНН: <b>' + escapeHtml(c.inn || '—') + '</b>' +
      '</div>' +
    '</button>';
  });
  if ((cache.contractors || []).filter(c =>
    (c.name || '').toLowerCase().includes(q) || (c.inn || '').includes(q)
  ).length > 50) {
    html += '<div style="text-align:center;padding:10px;color:var(--text-light);font-size:12px;">' +
      'Показано первые 50. Уточни запрос.' +
    '</div>';
  }
  container.innerHTML = html;
}

function selectSupplierContractor(name, inn) {
  const nameInput = document.getElementById('sm-name');
  const innInput = document.getElementById('sm-inn');
  if (nameInput && !nameInput.value.trim()) {
    nameInput.value = name;
  } else if (nameInput) {
    // Если уже есть имя — спросим что делать
    if (confirm('Заменить название "' + nameInput.value + '" на "' + name + '"?')) {
      nameInput.value = name;
    }
  }
  if (innInput) innInput.value = inn;
  closeSupplierContractorPicker();
  showToast('Подставлены данные: ' + name, 'success');
}

async function saveSupplier(supplierId) {
  const payload = {
    name:           document.getElementById('sm-name').value.trim(),
    inn:            document.getElementById('sm-inn').value.trim(),
    contact_person: document.getElementById('sm-contact').value.trim(),
    phone:          document.getElementById('sm-phone').value.trim(),
    email:          document.getElementById('sm-email').value.trim(),
    comment:        document.getElementById('sm-comment').value.trim(),
  };
  if (!payload.name) { showToast('Укажите название', 'error'); return; }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const url = supplierId ? '/api/suppliers/' + supplierId : '/api/suppliers';
    const method = supplierId ? 'PATCH' : 'POST';
    const r = await fetch(API_BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось сохранить', 'error');
      return;
    }
    showToast(supplierId ? 'Сохранено' : 'Поставщик добавлен', 'success');
    closeSupplyModal();
    cache.suppliers = null;
    if (state.currentScreen === 'supply-suppliers') loadSuppliers();
  } catch (e) {
    showToast('Ошибка соединения', 'error');
  }
}

async function deleteSupplier(supplierId) {
  if (!confirm('Архивировать этого поставщика?')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/suppliers/' + supplierId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) { showToast('Не удалось', 'error'); return; }
    showToast('Архивирован', 'success');
    cache.suppliers = null;
    if (state.currentScreen === 'supply-suppliers') loadSuppliers();
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

// ========== КАТАЛОГ ЗАКУПОК ==========

async function loadSupplyCatalog() {
  const container = document.getElementById('sup-cat-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-block">Загружаем каталог…</div>';
  try {
    const params = new URLSearchParams();
    if (state.supplyCatKindFilter !== 'all') params.set('kind', state.supplyCatKindFilter);
    if (state.supplyCatSearch)               params.set('search', state.supplyCatSearch);
    const d = await apiGet('/api/supply-items' + (params.toString() ? '?' + params.toString() : ''));
    cache.supplyCatalog = d.items || [];
    renderSupplyCatalog();
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderSupplyCatalog() {
  const container = document.getElementById('sup-cat-list');
  const list = cache.supplyCatalog || [];
  document.getElementById('sup-cat-counter').textContent = list.length;
  if (!list.length) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-list-details"></i>Под этот фильтр позиций нет</div>';
    return;
  }
  const canManage = canManageSupply();
  let html = '';
  list.forEach(i => {
    const kindCls = i.kind === 'product' ? 'kind-product' : 'kind-material';
    html += '<div class="sup-row" onclick="openEditSupplyItem(' + i.id + ')">' +
      '<div class="sup-row-icon"><i class="ti ti-package"></i></div>' +
      '<div class="sup-row-body">' +
        '<div class="sup-row-title">' + escapeHtml(i.name) + '</div>' +
        '<div class="sup-row-meta">' +
          '<span class="sup-kind-pill ' + kindCls + '">' + escapeHtml(i.kind_label) + '</span>' +
          '<span><i class="ti ti-ruler"></i>' + escapeHtml(i.unit) + '</span>' +
        '</div>' +
        // v2.45.152: убрали «россыпь» (НС-код · категория · подкатегория из comment)
        // из списка — захламляла. Комментарий по-прежнему виден в карточке позиции.
      '</div>' +
      (canManage ? '<div class="sup-row-actions"><button class="btn-icon-warning" onclick="event.stopPropagation(); deleteSupplyItem(' + i.id + ')" title="Удалить"><i class="ti ti-trash"></i></button></div>' : '') +
      '</div>';
  });
  container.innerHTML = html;
}

function setSupplyCatKindFilter(f) {
  state.supplyCatKindFilter = f;
  document.querySelectorAll('[data-sup-cat]').forEach(b => b.classList.toggle('active', b.dataset.supCat === f));
  loadSupplyCatalog();
}

function onSupplyCatSearchInput() {
  const input = document.getElementById('sup-cat-search');
  clearTimeout(state.supplyCatSearchTimer);
  state.supplyCatSearchTimer = setTimeout(() => {
    state.supplyCatSearch = input.value.trim();
    loadSupplyCatalog();
  }, 300);
}

function openNewSupplyItem() {
  if (!canManageSupply()) { showToast('Доступно директору, заму, менеджеру', 'error'); return; }
  showSupplyItemModal(null);
}

async function openEditSupplyItem(itemId) {
  try {
    const i = await apiGet('/api/supply-items/' + itemId);
    showSupplyItemModal(i);
  } catch (e) {
    showToast('Не удалось загрузить', 'error');
  }
}

function showSupplyItemModal(i) {
  const isEdit = !!i;
  const canManage = canManageSupply();
  const m = document.getElementById('supply-modal');
  m.innerHTML =
    
    '<div class="modal" onclick="event.stopPropagation()">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-package"></i> ' + (isEdit ? 'Редактировать позицию' : 'Новая позиция каталога') + '</h3>' +
        '<button class="modal-close" onclick="closeSupplyModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        '<div class="form-group"><label>Название *</label><input type="text" id="si-name" value="' + escapeHtml(isEdit ? i.name : '') + '" ' + (canManage ? '' : 'disabled') + '></div>' +
        '<div class="form-group form-row-2">' +
          '<div><label>Тип *</label>' +
            '<select id="si-kind" ' + (canManage ? '' : 'disabled') + '>' +
              '<option value="material"' + (isEdit && i.kind === 'material' ? ' selected' : '') + '>Комплектующее для сборки</option>' +
              '<option value="product"'  + (isEdit && i.kind === 'product'  ? ' selected' : '') + '>Товар для перепродажи</option>' +
            '</select>' +
          '</div>' +
          '<div><label>Ед. изм.</label><input type="text" id="si-unit" value="' + escapeHtml(isEdit ? i.unit : 'шт.') + '" ' + (canManage ? '' : 'disabled') + '></div>' +
        '</div>' +
        '<div class="form-group"><label>Комментарий</label><textarea id="si-comment" rows="3" ' + (canManage ? '' : 'disabled') + '>' + escapeHtml(isEdit ? i.comment : '') + '</textarea></div>' +
        (canManage ? '<div class="modal-actions"><button class="btn btn-primary" onclick="saveSupplyItem(' + (isEdit ? i.id : 'null') + ')"><i class="ti ti-check"></i> Сохранить</button></div>' : '') +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

async function saveSupplyItem(itemId) {
  const payload = {
    name:    document.getElementById('si-name').value.trim(),
    kind:    document.getElementById('si-kind').value,
    unit:    document.getElementById('si-unit').value.trim() || 'шт.',
    comment: document.getElementById('si-comment').value.trim(),
  };
  if (!payload.name) { showToast('Укажите название', 'error'); return; }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const url = itemId ? '/api/supply-items/' + itemId : '/api/supply-items';
    const method = itemId ? 'PATCH' : 'POST';
    const r = await fetch(API_BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось сохранить', 'error');
      return;
    }
    showToast(itemId ? 'Сохранено' : 'Позиция добавлена', 'success');
    closeSupplyModal();
    cache.supplyCatalog = null;
    if (state.currentScreen === 'supply-catalog') loadSupplyCatalog();
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

async function deleteSupplyItem(itemId) {
  if (!confirm('Архивировать эту позицию?')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-items/' + itemId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) { showToast('Не удалось', 'error'); return; }
    showToast('Архивирована', 'success');
    cache.supplyCatalog = null;
    if (state.currentScreen === 'supply-catalog') loadSupplyCatalog();
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

// ========== ЗАЯВКИ ==========

// v2.44.33: «Что закупить» — список к закупке по поставщикам
async function loadSupplyShopping() {
  const container = document.getElementById('sup-shop-content');
  if (!container) return;
  container.innerHTML = '<div class="loading-block">Считаем что нужно закупить…</div>';
  try {
    const d = await apiGet('/api/supply/shopping-list');
    // v2.45.233: покупные позиции договоров («К заказу») — отдельный блок сверху
    try {
      const cp = await apiGet('/api/supply/contract-purchases');
      d._contract_purchases = (cp && cp.items) || [];
    } catch (e2) { d._contract_purchases = []; }
    const counter = document.getElementById('sup-shop-counter');
    if (counter) counter.textContent = (d.items_count || 0) + (d._contract_purchases.length || 0);
    renderSupplyShopping(d);
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e && e.message || e)) + '</div>';
  }
}

// v2.45.233/235: блок «Покупные позиции по договорам» — галочки, назначение
// поставщика (в т.ч. сразу нескольким), группировка по поставщикам.
// v2.45.257: живой статус связанного заказа снабжения вместо вечного «Заказано»
const _CP_ORDER_STATUS_RU = {
  draft:            ['Заказ создан',          '#1E40AF', '#DBEAFE'],
  sent:             ['Счёт запрошен',         '#92400E', '#FEF3C7'],
  awaiting_invoice: ['Счёт запрошен',         '#92400E', '#FEF3C7'],
  invoice_received: ['Счёт получен',          '#3730A3', '#E0E7FF'],
  to_pay:           ['На оплате',             '#9A3412', '#FFEDD5'],
  paid:             ['Оплачен',                '#065F46', '#D1FAE5'],
  partial:          ['Доставка частично',     '#065F46', '#D1FAE5'],
  received:         ['Получено',              '#15803D', '#DCFCE7'],
  cancelled:        ['Заказ отменён',         '#7F1D1D', '#FEE2E2'],
};

// Количество для показа в «Что закупить»: для ЗАКАЗАННЫХ позиций — фактически
// заказанное (ordered_qty из позиции заказа, кол-во могли изменить в превью письма),
// для «К заказу» — потребность (qty). Так «Ждём поставку» показывает то, что в счёте.
function _cpDisplayQty(it) {
  if (it.purchase_status === 'ordered' && it.ordered_qty != null && it.ordered_qty !== '') {
    return it.ordered_qty;
  }
  return it.qty || 0;
}

function _cpRowHtml(it) {
  // v2.45.443: новый вид (карточка buy-item с галочкой/«К заказу») — под переключателем
  if (window.SUPPLY_SHOP_V2) {
    let st2;
    if (it.purchase_status === 'ordered') {
      const s2 = _CP_ORDER_STATUS_RU[it.order_status];
      st2 = '<span class="sv2-buy-status ordered">' + escapeHtml(s2 ? s2[0] : 'Заказано') + '</span>';
    } else {
      st2 = '<span class="sv2-buy-status todo">К заказу</span>';
    }
    const sName2 = JSON.stringify(it.item_name || '').replace(/"/g, '&quot;');
    return '<div class="sv2-buy">' +
      '<input type="checkbox" class="cp-check sv2-buy-check" data-cpid="' + it.id + '" onchange="_cpBulkUpdate()" onclick="event.stopPropagation();">' +
      '<div class="sv2-buy-body" onclick="state.currentContractId=' + it.contract_id + ';selectSection(\'sales\');selectSidebarItem(\'sales-contract-detail\');" title="Открыть договор">' +
        '<div class="sv2-buy-title">' + escapeHtml(it.item_name || '—') + '</div>' +
        '<div class="sv2-buy-meta">договор ' + escapeHtml(it.contract_number || ('#' + it.contract_id)) + '</div>' +
      '</div>' +
      '<span class="sv2-buy-qty">' + _fmtQty(_cpDisplayQty(it)) + ' ' + escapeHtml(it.unit || 'шт.') + '</span>' +
      st2 +
      '<button type="button" class="sv2-buy-x" title="Отметить, что пришло (получено)" style="color:#15803D;" onclick="event.stopPropagation();_cpMarkReceived(' + it.id + ',' + sName2 + ')"><i class="ti ti-check"></i></button>' +
      '<button type="button" class="sv2-buy-x" title="Убрать из закупки (в договоре останется)" onclick="event.stopPropagation();_cpSkipItem(' + it.id + ',' + sName2 + ')"><i class="ti ti-x"></i></button>' +
    '</div>';
  }
  let stBadge;
  if (it.purchase_status === 'ordered') {
    const st = _CP_ORDER_STATUS_RU[it.order_status];
    const label = st ? st[0] : 'Заказано';
    const fg = st ? st[1] : '#78350F';
    const bg = st ? st[2] : '#FEF3C7';
    stBadge = '<span class="ssp-badge" style="color:' + fg + ';background:' + bg + ';" ' +
      'title="' + escapeHtml((it.order_label ? 'Заказ ' + it.order_label + ' · ' : '') + 'статус обновляется по заказу в «Заказах»') + '">' +
      escapeHtml(label) + (it.order_label ? ' <span style="font-weight:400;opacity:0.75;">' + escapeHtml(it.order_label) + '</span>' : '') +
    '</span>';
  } else {
    stBadge = '<span class="ssp-badge" style="color:#7F1D1D;background:#FEE2E2;">К заказу</span>';
  }
  return '<div style="display:flex;align-items:center;gap:10px;padding:7px 14px;border-bottom:1px dashed var(--border);">' +
    '<input type="checkbox" class="cp-check" data-cpid="' + it.id + '" onchange="_cpBulkUpdate()" onclick="event.stopPropagation();">' +
    '<span style="flex:1;font-size:13px;color:var(--text-dark);cursor:pointer;" ' +
      'onclick="state.currentContractId=' + it.contract_id + ';selectSection(\'sales\');selectSidebarItem(\'sales-contract-detail\');" ' +
      'title="Открыть договор ' + escapeHtml(it.contract_number || '') + '">' +
      escapeHtml(it.item_name || '—') +
      (it.nc_code ? ' <span style="font-family:monospace;font-size:11px;color:var(--text-light);">' + escapeHtml(it.nc_code) + '</span>' : '') +
      ' <span style="font-size:11px;color:var(--text-light);">· дог. ' + escapeHtml(it.contract_number || ('#' + it.contract_id)) + '</span>' +
    '</span>' +
    '<span style="font-size:13px;font-weight:700;color:#2563EB;white-space:nowrap;">' + _fmtQty(_cpDisplayQty(it)) + ' ' + escapeHtml(it.unit || 'шт.') + '</span>' +
    stBadge +
    // Отметить, что пришло (получено) — уйдёт из «Что закупить»
    '<button type="button" title="Отметить, что пришло (получено)" ' +
      'onclick="event.stopPropagation();_cpMarkReceived(' + it.id + ', ' + JSON.stringify(it.item_name || '').replace(/"/g, '&quot;') + ')" ' +
      'style="border:none;background:none;cursor:pointer;color:#15803D;padding:2px 4px;font-size:14px;display:flex;align-items:center;" title="Пришло">' +
      '<i class="ti ti-check"></i></button>' +
    // v2.45.260: убрать из закупки (позиция в договоре остаётся)
    '<button type="button" title="Убрать из закупки (в договоре останется)" ' +
      'onclick="event.stopPropagation();_cpSkipItem(' + it.id + ', ' + JSON.stringify(it.item_name || '').replace(/"/g, '&quot;') + ')" ' +
      'style="border:none;background:none;cursor:pointer;color:var(--text-light);padding:2px 4px;font-size:14px;display:flex;align-items:center;" ' +
      'onmouseover="this.style.color=\'#B91C1C\'" onmouseout="this.style.color=\'var(--text-light)\'">' +
      '<i class="ti ti-x"></i></button>' +
  '</div>';
}

// v2.45.260: «не закупать» — позиция уходит из «Что закупить», в договоре остаётся
async function _cpSkipItem(itemId, name) {
  if (!confirm('Убрать «' + name + '» из закупки?\n\nПозиция в договоре останется, но в «Что закупить» больше не появится.')) return;
  try {
    const r = await fetch(API_BASE + '/api/supply/contract-purchases/skip', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''), 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_ids: [itemId] }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showToast(j.message || 'Не удалось убрать', 'error');
      return;
    }
    showToast('Позиция убрана из закупки', 'success');
    loadSupplyShopping();
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

async function _cpMarkReceived(itemId, name) {
  if (!confirm('Отметить «' + (name || '') + '» как пришедшее (получено)?\nПозиция уйдёт из «Что закупить».')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/contracts/items/' + itemId + '/purchase-status', {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'received' }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showToast(j.message || 'Не удалось отметить', 'error');
      return;
    }
    showToast('✓ Отмечено как пришедшее', 'success');
    loadSupplyShopping();
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

function _contractPurchasesBlockHtml(items) {
  if (!items || !items.length) return '';
  state._cpItems = items;
  // v2.45.427: «К заказу» (pending) и «Ждём поставку» (ordered) — раздельно.
  // Уже заказанные/оплаченные больше не предлагаются к закупке, а уезжают в
  // отдельную таблицу-трекинг (статус, сколько дней ждём, связь с поставщиком).
  const pending = items.filter(x => x.purchase_status !== 'ordered');
  const ordered = items.filter(x => x.purchase_status === 'ordered');
  let out = '';

  if (pending.length) {
    // Группируем по поставщику (не назначен — первым, по нему и работаем)
    const bySup = {};
    pending.forEach(it => {
      const k = it.supplier_id || 0;
      if (!bySup[k]) bySup[k] = { id: it.supplier_id, name: it.supplier_name, email: it.supplier_email, phone: it.supplier_phone, contact: it.supplier_contact, items: [] };
      bySup[k].items.push(it);
    });
    let h = '<div class="sup-shop-group cp-block">' +
      '<div class="sup-shop-group-head">' +
        '<div class="sup-shop-group-name"><i class="ti ti-shopping-cart"></i> Покупные позиции по договорам' +
          '<span class="sup-shop-group-count">' + pending.length + ' ' + (pending.length === 1 ? 'позиция' : (pending.length < 5 ? 'позиции' : 'позиций')) + '</span>' +
        '</div>' +
        '<button class="btn btn-secondary btn-sm" id="cp-assign-btn" style="display:none;" onclick="openCpSupplierPicker()">' +
          '<i class="ti ti-truck"></i> Назначить поставщика (<span id="cp-assign-count">0</span>)</button>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text-light);padding:0 14px 8px;">Отметь позиции галочками → «Назначить поставщика» — для запроса счёта. Клик по названию откроет договор.</div>';
    const keys = Object.keys(bySup).sort((a, b) => (a === '0' ? -1 : b === '0' ? 1 : 0));
    keys.forEach(k => {
      const g = bySup[k];
      if (k === '0') {
        h += '<div style="font-size:12.5px;font-weight:700;color:#7F1D1D;padding:6px 14px 2px;"><i class="ti ti-alert-triangle"></i> Поставщик не назначен</div>';
      } else {
        const contacts = [g.contact, g.email, g.phone].filter(Boolean).map(escapeHtml).join(' · ');
        const pendingIds = g.items.map(x => x.id);
        h += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 14px 2px;">' +
          '<span style="flex:1;font-size:12.5px;font-weight:700;color:var(--text-dark);"><i class="ti ti-truck" style="color:var(--brand);"></i> ' +
          escapeHtml(g.name || '—') +
          (contacts ? ' <span style="font-weight:400;color:var(--text-light);">· ' + contacts + '</span>' : '') + '</span>' +
          (pendingIds.length ? '<button class="btn btn-primary btn-sm" onclick="createCpOrder(' + g.id + ')">' +
            '<i class="ti ti-mail-send"></i> Сформировать заказ (' + pendingIds.length + ')</button>' : '') +
        '</div>';
      }
      g.items.forEach(it => { h += _cpRowHtml(it); });
    });
    h += '</div>';
    out += h;
  }

  // Трекинг «Ждём поставку» рисуется централизованно в renderSupplyShopping
  // (объединяет заказанное по договорам и заказанные комплектующие).
  return out;
}

// v2.45.428: общий блок «Ждём поставку» — заказанные/оплаченные покупные позиции
// по договорам И комплектующие. Принимает уже нормализованные элементы (CP-формат).
function _waitingDeliveryBlockHtml(orderedItems) {
  return _cpTrackingBlockHtml(orderedItems);
}

// Нормализует заказанное комплектующее (из shopping-list) к формату трекинга.
function _componentToTracking(it, group) {
  const projects = Array.isArray(it.plan_contracts) && it.plan_contracts.length
    ? it.plan_contracts.map(n => '№' + n).join(', ')
    : (it.reason || '');
  return {
    item_name: it.component_name,
    contract_number: projects,
    contract_id: null,
    // «Ждём поставку» = уже заказано: показываем фактически ЗАКАЗАННОЕ кол-во
    // (ordered_qty из позиции заказа, его меняют в превью письма), а не потребность
    // recommended_qty. Фолбэк на потребность, если связи с заказом нет.
    qty: (it.ordered_qty != null && it.ordered_qty !== '' ? it.ordered_qty : it.recommended_qty),
    unit: it.unit,
    order_status: it.order_status,
    order_label: it.order_label,
    ordered_at: it.ordered_at || null,
    supplier_id: group ? group.supplier_id : null,
    supplier_name: group ? group.supplier_name : '',
    supplier_email: group ? group.supplier_email : '',
    supplier_phone: group ? group.supplier_phone : '',
    supplier_contact: group ? group.supplier_contact : '',
    _is_component: true,
    order_id: it.order_id || null,
    order_item_id: it.order_item_id || null,
    order_expected: it.order_expected || null,
    order_place: it.order_place || null,
    order_label_short: it.order_label,
  };
}

// v2.45.427: «Ждём поставку» — трекинг уже заказанных/оплаченных покупных позиций.
// Показывает статус заказа, сколько дней ждём и кнопки связи с поставщиком.
function _cpTrackingBlockHtml(ordered) {
  if (!ordered || !ordered.length) return '';
  // группируем по поставщику
  const bySup = {};
  ordered.forEach(it => {
    const k = it.supplier_id || 0;
    if (!bySup[k]) bySup[k] = { id: it.supplier_id, name: it.supplier_name, email: it.supplier_email, phone: it.supplier_phone, contact: it.supplier_contact, items: [] };
    bySup[k].items.push(it);
  });
  let h = '<div class="sup-shop-group cp-block" style="margin-top:14px;">' +
    '<div class="sup-shop-group-head">' +
      '<div class="sup-shop-group-name"><i class="ti ti-truck-delivery"></i> Ждём поставку' +
        '<span class="sup-shop-group-count">' + ordered.length + ' ' + (ordered.length === 1 ? 'позиция' : (ordered.length < 5 ? 'позиции' : 'позиций')) + '</span>' +
      '</div>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--text-light);padding:0 14px 8px;">Уже заказано/оплачено — едет. К закупке больше не предлагается. Долго нет поставки — свяжись с поставщиком.</div>';
  const keys = Object.keys(bySup).sort((a, b) => (a === '0' ? 1 : b === '0' ? -1 : 0));
  keys.forEach(k => {
    const g = bySup[k];
    const contactBtns = [];
    if (g.email) contactBtns.push('<a href="mailto:' + escapeHtml(g.email) + '" class="btn btn-secondary btn-sm" style="text-decoration:none;"><i class="ti ti-mail"></i> Написать</a>');
    // v2.45.429: вместо tel: — показываем сам номер, тап открывает карточку поставщика
    if (g.phone) contactBtns.push('<button type="button" class="btn btn-secondary btn-sm" ' +
      (g.id ? 'onclick="openEditSupplier(' + g.id + ')" title="Открыть карточку поставщика"' : 'disabled') +
      '><i class="ti ti-phone"></i> ' + escapeHtml(g.phone) + '</button>');
    h += '<div class="sup-track-head" style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:10px 14px 4px;">' +
      _supAvatarHtml(g.name, !g.id) +
      '<span style="flex:1;font-size:13.5px;font-weight:800;color:var(--text-dark);min-width:120px;">' +
      escapeHtml(g.name || '(поставщик не назначен)') + '</span>' +
      contactBtns.join('') +
    '</div>';
    g.items.forEach(it => { h += _cpTrackingRowHtml(it); });
  });
  h += '</div>';
  return h;
}

function _cpTrackingRowHtml(it) {
  const st = _CP_ORDER_STATUS_RU[it.order_status];
  const label = st ? st[0] : 'Заказано';
  const fg = st ? st[1] : '#78350F';
  const bg = st ? st[2] : '#FEF3C7';
  const stBadge = '<span class="ssp-badge" style="color:' + fg + ';background:' + bg + ';">' +
    escapeHtml(label) + (it.order_label ? ' <span style="font-weight:400;opacity:0.75;">' + escapeHtml(it.order_label) + '</span>' : '') + '</span>';
  const days = _daysSince(it.ordered_at);
  // v2.45.432: «сколько ждём» — цветной чип-акцент, чтобы было видно сразу.
  // Градация: сегодня — спокойный, 1-6 дней — синий, 7-13 — оранжевый (ждём
  // уже неделю+), 14+ — красный с ⚠ (засиделось, пора теребить поставщика).
  let ageBadge = '';
  if (days !== null) {
    let fg, bg, bold = false;
    let txt = (days === 0) ? 'сегодня' : (days + ' ' + _plural(days, ['день', 'дня', 'дней']));
    if (days >= 14)      { fg = '#7F1D1D'; bg = '#FEE2E2'; bold = true; txt += ' ⚠'; }
    else if (days >= 7)  { fg = '#9A3412'; bg = '#FFEDD5'; bold = true; }
    else if (days >= 1)  { fg = '#1E40AF'; bg = '#DBEAFE'; }
    else                 { fg = '#475569'; bg = '#F1F5F9'; }
    ageBadge = '<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;' +
      'white-space:nowrap;font-weight:' + (bold ? '700' : '600') + ';color:' + fg +
      ';background:' + bg + ';padding:2px 8px;border-radius:999px;">' +
      '<i class="ti ti-clock-hour-4" style="font-size:12px;"></i>' + txt + '</span>';
  }
  // v2.45.431: двухстрочная раскладка для мобилы — название отдельной строкой,
  // под ним чипсы (кол-во · дни · статус · кнопка) с переносом, чтобы ничего не
  // обрезалось за правый край экрана.
  // У покупных по договору есть contract_id (тап → договор); у комплектующих —
  // нет, показываем причину/проекты текстом без клика.
  let nameCell;
  if (it.contract_id) {
    nameCell = '<div style="font-size:13.5px;font-weight:600;line-height:1.3;color:var(--text-dark);cursor:pointer;word-break:break-word;" ' +
      'onclick="state.currentContractId=' + it.contract_id + ';selectSection(\'sales\');selectSidebarItem(\'sales-contract-detail\');" ' +
      'title="Открыть договор ' + escapeHtml(it.contract_number || '') + '">' +
      escapeHtml(it.item_name || '—') +
      ' <span style="font-size:11px;font-weight:400;color:var(--text-light);">· дог. ' + escapeHtml(it.contract_number || ('#' + it.contract_id)) + '</span>' +
    '</div>';
  } else {
    nameCell = '<div style="font-size:13.5px;font-weight:600;line-height:1.3;color:var(--text-dark);word-break:break-word;">' +
      escapeHtml(it.item_name || '—') +
      (it.contract_number ? ' <span style="font-size:11px;font-weight:400;color:var(--text-light);">· ' + escapeHtml(it.contract_number) + '</span>' : '') +
    '</div>';
  }
  const qtyChip = '<span style="font-size:13px;font-weight:700;color:#2563EB;white-space:nowrap;">' +
    _fmtQty(it.qty || 0) + ' ' + escapeHtml(it.unit || 'шт.') + '</span>';
  // v2.45.430: «вернуть к закупке» — только для комплектующего в ЧЕРНОВИКЕ заказа
  // (нельзя дёргать позицию из отправленного/оплаченного). Убирает строку из
  // заказа → позиция снова попадает в «к закупке», можно собрать в другой заказ.
  let returnBtn = '';
  if (it._is_component && it.order_status === 'draft' && it.order_item_id) {
    returnBtn = '<button type="button" onclick="shopReturnToBuy(' + it.order_item_id +
      ', \'' + escapeHtml(String(it.item_name || '')).replace(/'/g, '&#39;') + '\')" ' +
      'title="Убрать из черновика заказа и вернуть в список к закупке" ' +
      'style="background:none;border:1px solid #FCA5A5;color:#B91C1C;border-radius:8px;' +
      'padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">' +
      '<i class="ti ti-arrow-back-up"></i> вернуть к закупке</button>';
  }
  // v2.45.433: ожидаемая дата поставки («когда придёт»). Ставится на заказ (ORD),
  // показывается у каждой позиции этого заказа. Если просрочена — красным с ⚠.
  // v2.45.434: + куда придёт — «к нам» / «к ним на склад».
  let etaChip = '';
  if (it.order_id) {
    const lbl = escapeHtml(String(it.order_label || '')).replace(/'/g, '&#39;');
    const place = (it.order_place === 'us' || it.order_place === 'supplier') ? it.order_place : '';
    const placeRu = place === 'us' ? ' · к нам' : (place === 'supplier' ? ' · к ним на склад' : '');
    if (it.order_expected) {
      const iso = String(it.order_expected).slice(0, 10);
      const overdue = iso < new Date().toISOString().slice(0, 10);
      etaChip = '<button type="button" onclick="openEtaPicker(' + it.order_id + ',\'' + lbl + '\',\'' + iso + '\',\'' + place + '\')" ' +
        'title="Ожидаемая дата и место поставки — нажми, чтобы изменить" ' +
        'style="display:inline-flex;align-items:center;gap:3px;border:none;cursor:pointer;font-size:11px;font-weight:700;' +
        'color:' + (overdue ? '#7F1D1D' : '#065F46') + ';background:' + (overdue ? '#FEE2E2' : '#D1FAE5') + ';padding:2px 8px;border-radius:999px;">' +
        '<i class="ti ti-calendar-check" style="font-size:12px;"></i>придёт ' + _fmtDateRuShort(iso) + placeRu + (overdue ? ' ⚠' : '') + '</button>';
    } else {
      etaChip = '<button type="button" onclick="openEtaPicker(' + it.order_id + ',\'' + lbl + '\',\'\',\'' + place + '\')" ' +
        'title="Указать ожидаемую дату и место поставки" ' +
        'style="display:inline-flex;align-items:center;gap:3px;border:1px dashed #94A3B8;cursor:pointer;font-size:11px;font-weight:600;' +
        'color:#475569;background:none;padding:2px 8px;border-radius:999px;">' +
        '<i class="ti ti-calendar-plus" style="font-size:12px;"></i>когда придёт?' + (placeRu ? placeRu.replace(' · ', ' ') : '') + '</button>';
    }
  }
  // Кнопка «получено» — товар пришёл, закрываем позицию заказа (для уже
  // отправленных/оплаченных, не черновик). Закрытый заказ уходит из «Ждём поставку».
  let receivedBtn = '';
  if (it._is_component && it.order_item_id && it.order_status !== 'draft') {
    receivedBtn = '<button type="button" onclick="shopMarkReceived(' + it.order_item_id +
      ', \'' + escapeHtml(String(it.item_name || '')).replace(/'/g, '&#39;') + '\')" ' +
      'title="Товар пришёл — нажмите, чтобы отметить позицию полученной (заказ закроется)" ' +
      'style="display:inline-flex;align-items:center;gap:4px;background:#fff;border:1px solid #34D399;color:#047857;border-radius:8px;' +
      'padding:4px 11px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">' +
      '<i class="ti ti-circle-check"></i> Отметить, что пришло</button>';
  }
  return '<div class="sup-track-row" style="padding:11px 14px;border-bottom:1px dashed var(--border);">' +
    nameCell +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:7px;">' +
      qtyChip +
      ageBadge +
      stBadge +
      etaChip +
      receivedBtn +
      returnBtn +
    '</div>' +
    _supDeliveryStepperHtml(it.order_status) +
  '</div>';
}

// v2.45.433: «15 июл» из ISO YYYY-MM-DD (короткий русский формат для чипа).
function _fmtDateRuShort(iso) {
  if (!iso) return '';
  const p = String(iso).slice(0, 10).split('-');
  if (p.length < 3) return iso;
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const d = parseInt(p[2], 10), mo = parseInt(p[1], 10) - 1;
  if (isNaN(d) || mo < 0 || mo > 11) return iso;
  return d + ' ' + months[mo];
}

// v2.45.433: окошко «когда придёт» — ожидаемая дата поставки по заказу (ORD).
// v2.45.434: + куда придёт — «к нам» / «к ним на склад».
function openEtaPicker(orderId, orderLabel, currentIso, currentPlace) {
  if (!orderId) return;
  window._etaPlace = (currentPlace === 'us' || currentPlace === 'supplier') ? currentPlace : '';
  let m = document.getElementById('eta-picker-modal');
  if (m) m.remove();
  m = document.createElement('div');
  m.id = 'eta-picker-modal';
  m.className = 'modal-overlay visible';
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  const placeBtn = (val, label, icon) =>
    '<button type="button" id="eta-place-' + val + '" onclick="setEtaPlace(\'' + val + '\')" ' +
      'style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:9px 8px;font-size:12.5px;font-weight:600;cursor:pointer;' +
      'border-radius:8px;border:1.5px solid ' + (window._etaPlace === val ? '#2563EB' : 'var(--border)') + ';' +
      'background:' + (window._etaPlace === val ? '#EFF6FF' : '#fff') + ';color:' + (window._etaPlace === val ? '#1E40AF' : 'var(--text-mid)') + ';">' +
      '<i class="ti ' + icon + '"></i>' + label + '</button>';
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:400px;">' +
      '<div class="modal-header"><h3><i class="ti ti-calendar-event"></i> Когда придёт' + (orderLabel ? ' · ' + escapeHtml(orderLabel) : '') + '</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'eta-picker-modal\').remove()"><i class="ti ti-x"></i></button></div>' +
      '<div class="modal-body" style="padding:16px;">' +
        '<div style="font-size:12.5px;color:var(--text-light);margin-bottom:10px;">Ожидаемая дата поставки по заказу' + (orderLabel ? ' ' + escapeHtml(orderLabel) : '') + '. Менеджер назвал срок — поставь его здесь, будешь видеть в «Ждём поставку» у всех позиций этого заказа.</div>' +
        '<input type="date" id="eta-date-input" value="' + escapeHtml(currentIso || '') + '" style="width:100%;padding:9px 10px;font-size:14px;border:1px solid var(--border);border-radius:8px;box-sizing:border-box;">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-mid);margin:14px 0 6px;">Куда придёт?</div>' +
        '<div style="display:flex;gap:8px;" id="eta-place-row">' +
          placeBtn('us', 'К нам', 'ti-building-warehouse') +
          placeBtn('supplier', 'К ним на склад', 'ti-truck') +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:16px;">' +
          '<button class="btn btn-primary" style="flex:1;" onclick="saveEta(' + orderId + ',false)"><i class="ti ti-check"></i> Сохранить</button>' +
          (currentIso ? '<button class="btn btn-secondary" onclick="saveEta(' + orderId + ',true)"><i class="ti ti-eraser"></i> Убрать</button>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
  setTimeout(() => { const f = document.getElementById('eta-date-input'); if (f) f.focus(); }, 80);
}

// Переключение «куда придёт» в окошке (toggle — повторный тап снимает выбор).
function setEtaPlace(val) {
  window._etaPlace = (window._etaPlace === val) ? '' : val;
  ['us', 'supplier'].forEach(v => {
    const b = document.getElementById('eta-place-' + v);
    if (!b) return;
    const on = window._etaPlace === v;
    b.style.border = '1.5px solid ' + (on ? '#2563EB' : 'var(--border)');
    b.style.background = on ? '#EFF6FF' : '#fff';
    b.style.color = on ? '#1E40AF' : 'var(--text-mid)';
  });
}

async function saveEta(orderId, clear) {
  const inp = document.getElementById('eta-date-input');
  const iso = clear ? '' : (inp ? inp.value : '');
  const place = clear ? '' : (window._etaPlace || '');
  if (!clear && !iso) { showToast('Выбери дату', 'error'); return; }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-orders/' + orderId, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_date: iso || null, expected_place: place || null }),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); showToast(j.message || 'Не удалось сохранить', 'error'); return; }
    showToast(clear ? 'Дата убрана' : 'Дата поставки сохранена', 'success');
    const mm = document.getElementById('eta-picker-modal'); if (mm) mm.remove();
    if (typeof cache !== 'undefined') { cache.supplyOrders = null; }
    if (typeof loadSupplyShopping === 'function') loadSupplyShopping();
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

// v2.45.430: убрать позицию из черновика заказа → вернуть в список «к закупке».
async function shopMarkReceived(orderItemId, name) {
  if (!orderItemId) return;
  if (!confirm('Отметить «' + (name || 'позицию') + '» полученной?\n\nЗаказ закроется (статус «получен»), позиция уйдёт из «Ждём поставку».')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-orders/items/' + orderItemId + '/received', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showToast(j.message || 'Не удалось отметить полученным', 'error');
      return;
    }
    showToast('Отмечено полученным', 'success');
    if (typeof cache !== 'undefined') { cache.supplyOrders = null; cache.supplyRequests = null; }
    if (typeof loadSupplyShopping === 'function') loadSupplyShopping();
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

async function shopReturnToBuy(orderItemId, name) {
  if (!orderItemId) return;
  if (!confirm('Вернуть «' + (name || 'позицию') + '» в список к закупке?\n\nПозиция будет убрана из черновика заказа — потом сможешь собрать её в другой заказ. (Доступно только для черновика «Заказ создан».)')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-orders/items/' + orderItemId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showToast(j.message || 'Не удалось вернуть позицию', 'error');
      return;
    }
    showToast('Позиция возвращена в список к закупке', 'success');
    if (typeof cache !== 'undefined') { cache.supplyOrders = null; cache.supplyRequests = null; }
    if (typeof loadSupplyShopping === 'function') loadSupplyShopping();
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

// Сколько дней прошло с даты (ISO/SQLite). null если нет даты.
function _daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(String(dateStr).replace(' ', 'T') + (String(dateStr).includes('Z') ? '' : 'Z'));
  if (isNaN(d.getTime())) return null;
  const ms = Date.now() - d.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / 86400000);
}


function _cpBulkUpdate() {
  const n = document.querySelectorAll('.cp-check:checked').length;
  const btn = document.getElementById('cp-assign-btn');
  const cnt = document.getElementById('cp-assign-count');
  if (cnt) cnt.textContent = n;
  if (btn) btn.style.display = n > 0 ? '' : 'none';
}

// v2.45.235: пикер поставщика для выбранных покупных позиций
async function openCpSupplierPicker() {
  const ids = [...document.querySelectorAll('.cp-check:checked')].map(c => parseInt(c.getAttribute('data-cpid')));
  if (!ids.length) return;
  let suppliers = [];
  try {
    const d = await apiGet('/api/suppliers');
    suppliers = d.suppliers || d.items || [];
  } catch (e) { showToast('Не удалось загрузить поставщиков', 'error'); return; }
  let m = document.getElementById('cp-supplier-modal');
  if (m) m.remove();
  m = document.createElement('div');
  m.id = 'cp-supplier-modal';
  m.className = 'modal-overlay visible';
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  const rows = suppliers.map(s =>
    '<div class="modal-item" onclick="assignCpSupplier(' + s.id + ')">' +
      '<div class="mi-icon"><i class="ti ti-truck"></i></div>' +
      '<div class="mi-text"><div class="mi-title">' + escapeHtml(s.name || '—') + '</div>' +
        '<div class="mi-meta">' + [s.contact_person, s.email, s.phone].filter(Boolean).map(escapeHtml).join(' · ') + '</div>' +
      '</div></div>'
  ).join('');
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:540px;max-height:88vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header"><h3><i class="ti ti-truck"></i> Поставщик для ' + ids.length + ' позиций</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'cp-supplier-modal\').remove()"><i class="ti ti-x"></i></button></div>' +
      '<div class="modal-search"><input type="text" id="cp-sup-search" placeholder="Поиск поставщика…" ' +
        'oninput="[...document.querySelectorAll(\'#cp-sup-list .modal-item\')].forEach(r=>{r.style.display=r.textContent.toLowerCase().includes(this.value.toLowerCase())?\'\':\'none\';})"></div>' +
      '<div class="modal-body" id="cp-sup-list" style="overflow-y:auto;">' + (rows || '<div class="empty-block">Поставщиков нет</div>') + '</div>' +
    '</div>';
  document.body.appendChild(m);
  window._cpAssignIds = ids;
  setTimeout(() => { const f = document.getElementById('cp-sup-search'); if (f) f.focus(); }, 80);
}

// v2.45.236: сформировать заказ снабжения из покупных позиций поставщика
async function createCpOrder(supplierId) {
  const items = (state._cpItems || []).filter(x => x.supplier_id === supplierId && x.purchase_status !== 'ordered');
  if (!items.length) { showToast('Нет позиций «К заказу» у этого поставщика', 'error'); return; }
  if (!confirm('Сформировать заказ поставщику из ' + items.length + ' позиций?\n\nПозиции станут «Заказано», заказ появится в «Заказах» и пойдёт по статусам (счёт, оплата, приёмка).')) return;
  try {
    const resp = await fetch(API_BASE + '/api/supply/contract-purchases/create-order', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''), 'Content-Type': 'application/json' },
      body: JSON.stringify({ supplier_id: supplierId, item_ids: items.map(x => x.id) }),
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      showToast(j.message || 'Не удалось создать заказ', 'error');
      return;
    }
    const draft = await resp.json();
    showToast('Заказ ' + (draft.order_label || ('#' + draft.id)) + ' создан', 'success');
    // То же превью письма, что у обычных заказов снабжения
    if (typeof _renderOrderPreviewModal === 'function') _renderOrderPreviewModal(draft);
    loadSupplyShopping();
  } catch (e) { showToast('Сеть: ' + (e.message || e), 'error'); }
}

async function assignCpSupplier(supplierId) {
  const ids = window._cpAssignIds || [];
  if (!ids.length) return;
  try {
    const r = await apiPost('/api/supply/contract-purchases/assign-supplier', { item_ids: ids, supplier_id: supplierId });
    if (!r || !r.ok) { showToast((r && r.data && r.data.message) || 'Не удалось назначить', 'error'); return; }
    const m = document.getElementById('cp-supplier-modal');
    if (m) m.remove();
    showToast('Поставщик назначен: ' + ids.length + ' поз.', 'success');
    loadSupplyShopping();
  } catch (e) { showToast('Ошибка', 'error'); }
}

// v2.45.286: локальное состояние пользователя по «Что закупить» —
// скрытые позиции и переопределение количества. Хранится в localStorage
// и применяется и в рендере, и при создании заказа / скачивании DOCX.
const SHOP_HIDDEN_KEY = 'atomus_shop_hidden_ids';
const SHOP_QTY_KEY    = 'atomus_shop_qty_overrides';
function _shopGetHidden() {
  try { return new Set(JSON.parse(localStorage.getItem(SHOP_HIDDEN_KEY) || '[]')); }
  catch (e) { return new Set(); }
}
function _shopSaveHidden(set) {
  try { localStorage.setItem(SHOP_HIDDEN_KEY, JSON.stringify([...set])); } catch (e) {}
}
function _shopGetQtyMap() {
  try { return JSON.parse(localStorage.getItem(SHOP_QTY_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}
function _shopSaveQtyMap(map) {
  try { localStorage.setItem(SHOP_QTY_KEY, JSON.stringify(map)); } catch (e) {}
}
async function shopHideItem(componentId, name) {
  if (!confirm('Убрать «' + (name || '') + '» из «Что закупить»?\n\nПозиция перестанет показываться и не попадёт в новый заказ. Это локально (только на этом устройстве). Можно вернуть кнопкой «Показать скрытые».')) return;
  const set = _shopGetHidden();
  set.add(componentId);
  _shopSaveHidden(set);
  if (typeof loadSupplyShopping === 'function') loadSupplyShopping();
}
function shopUnhideAll() {
  _shopSaveHidden(new Set());
  if (typeof loadSupplyShopping === 'function') loadSupplyShopping();
}
function shopEditQty(componentId, currentQty, unit) {
  const v = prompt('Сколько ' + (unit || 'шт.') + ' заказать?\n\nПусто — вернуть рекомендованное количество.', String(currentQty));
  if (v === null) return;
  const map = _shopGetQtyMap();
  const trimmed = String(v).trim();
  if (!trimmed) {
    delete map[componentId];
  } else {
    const n = Number(trimmed.replace(',', '.'));
    if (!isFinite(n) || n < 0) {
      showToast('Введите неотрицательное число', 'error');
      return;
    }
    map[componentId] = n;
  }
  _shopSaveQtyMap(map);
  if (typeof loadSupplyShopping === 'function') loadSupplyShopping();
}
// v2.45.442: степпер количества в новом виде — меняет число и сохраняет, без полной перезагрузки
function sv2StepQty(componentId, delta) {
  const span = document.getElementById('sv2-qty-' + componentId);
  let n = (span ? (parseFloat(span.textContent) || 0) : 0) + delta;
  if (n < 0) n = 0;
  if (span) span.textContent = String(n);
  const map = _shopGetQtyMap();
  map[componentId] = n;
  _shopSaveQtyMap(map);
}
// v2.45.442: переключение нового/старого вида «Что закупить» (для отката)
function toggleSupplyShopV2() {
  const cur = localStorage.getItem('supplyShopV2') !== '0';
  localStorage.setItem('supplyShopV2', cur ? '0' : '1');
  if (typeof loadSupplyShopping === 'function') loadSupplyShopping();
}
// Применяет скрытие/переопределения к items группы — возвращает {items, hiddenCount}
function _shopApplyLocal(items) {
  const hidden = _shopGetHidden();
  const qtyMap = _shopGetQtyMap();
  let hiddenCount = 0;
  const out = (items || []).filter(it => {
    // v2.45.428: уже заказанные/оплаченные — не «к закупке», а «ждём поставку».
    // Исключаем из групп и из формирования заказа (чтобы не заказывать повторно).
    if (it.order_status) return false;
    if (hidden.has(it.component_id)) { hiddenCount++; return false; }
    return true;
  }).map(it => {
    if (qtyMap[it.component_id] != null) {
      return Object.assign({}, it, { recommended_qty: qtyMap[it.component_id], _qty_overridden: true });
    }
    return it;
  });
  return { items: out, hiddenCount };
}

// v2.45.x: редизайн «Что закупить» — KPI-строка, табы, аватары поставщиков, степпер доставки
function _supInitials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '—';
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[1][0]).toUpperCase();
}
function _supAvatarHtml(name, warn) {
  if (warn) return '<span class="sup-ava warn">?</span>';
  return '<span class="sup-ava">' + escapeHtml(_supInitials(name)) + '</span>';
}
function _supKpiCard(icon, cls, num, lbl, onclick) {
  // v2.45.x: карточка-счётчик может быть кликабельной — открывает список.
  const clickAttrs = onclick
    ? ' sup-kpi-click" role="button" tabindex="0" title="Нажмите, чтобы открыть список" style="cursor:pointer;" onclick="' + onclick + '"'
    : '"';
  return '<div class="sup-kpi ' + cls + clickAttrs + '><div class="sup-kpi-ic"><i class="ti ti-' + icon + '"></i></div>' +
    '<div><div class="sup-kpi-num">' + num + '</div><div class="sup-kpi-lbl">' + escapeHtml(lbl) + '</div></div></div>';
}
function supSwitchTab(t) {
  window._supTab = t;
  document.querySelectorAll('#sup-shop-content .sup-pane').forEach(p => { p.hidden = (p.dataset.pane !== t); });
  document.querySelectorAll('#sup-shop-content .sup-seg button').forEach(b => { b.classList.toggle('on', b.getAttribute('data-tab') === t); });
}

// v2.45.x: клик по карточке-счётчику наверху «Что закупить».
// «К закупке» → вкладка закупки; «Ждём поставку» → вся вкладка ожидания;
// «Долго ждём» / «Сегодня на складе» → вкладка ожидания, отфильтрованная.
function supKpiClick(kind) {
  if (kind === 'buy') { window._supWaitFilter = 'all'; supSwitchTab('buy'); return; }
  window._supWaitFilter = (kind === 'long' || kind === 'today') ? kind : 'all';
  _supRenderWaitPane();
  supSwitchTab('wait');
}

// Перерисовывает содержимое вкладки «Ждём поставку» согласно активному фильтру.
function _supRenderWaitPane() {
  const pane = document.querySelector('#sup-shop-content .sup-pane[data-pane="wait"]');
  if (!pane) return;
  const all = window._supWaitingItems || [];
  const filter = window._supWaitFilter || 'all';
  const today = new Date().toISOString().slice(0, 10);
  let items = all, bannerTxt = '';
  if (filter === 'long') {
    items = all.filter(it => { const dd = _daysSince(it.ordered_at); return dd !== null && dd >= 14; });
    bannerTxt = 'Показаны только те, что ждём дольше 14 дней';
  } else if (filter === 'today') {
    items = all.filter(it => it.order_expected && String(it.order_expected).slice(0, 10) === today);
    bannerTxt = 'Показаны только те, что должны прийти сегодня';
  }
  const banner = bannerTxt
    ? '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0 2px;padding:8px 12px;' +
        'background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;font-size:13px;color:#92400E;">' +
        '<i class="ti ti-filter"></i><span style="flex:1;min-width:120px;">' + escapeHtml(bannerTxt) + '</span>' +
        '<button type="button" class="btn btn-secondary btn-sm" onclick="supKpiClick(\'wait\')"><i class="ti ti-x"></i> показать все</button>' +
      '</div>'
    : '';
  const inner = items.length
    ? _cpTrackingBlockHtml(items)
    : '<div class="empty-block" style="padding:28px 16px;"><i class="ti ti-mood-smile" style="color:#16A34A;font-size:26px;"></i>' +
      '<div style="margin-top:8px;font-size:14px;color:var(--text-mid);">Здесь пусто — ничего под этот фильтр.</div></div>';
  pane.innerHTML = banner + inner;
}
// Степпер доставки: Заказан → Оплачен → В пути → На складе (по статусу заказа)
function _supDeliveryStepperHtml(orderStatus) {
  let done = 1, now = 1, lbl0 = 'Заказан';
  switch (orderStatus) {
    case 'draft': done = 0; now = 0; lbl0 = 'Заказ создан'; break;
    case 'sent': case 'awaiting_invoice': case 'invoice_received': case 'to_pay': done = 1; now = 1; break;
    case 'paid': case 'partial': done = 2; now = 2; break;
    case 'received': done = 4; now = 4; break;
  }
  const labels = [lbl0, 'Оплачен', 'В пути', 'На складе'];
  let h = '<div class="sup-steps">';
  for (let i = 0; i < 4; i++) {
    if (i > 0) h += '<span class="sup-step-line' + (i <= done ? ' done' : '') + '"></span>';
    const cls = i < done ? 'done' : (i === now ? 'now' : '');
    h += '<span class="sup-step ' + cls + '"><span class="dot">' + (i < done ? '✓' : '') + '</span>' + escapeHtml(labels[i]) + '</span>';
  }
  return h + '</div>';
}

function renderSupplyShopping(d) {
  const container = document.getElementById('sup-shop-content');
  if (!container) return;
  // v2.45.443: флаг нового вида ставим ДО сборки блоков (cpBlock использует его в _cpRowHtml)
  window.SUPPLY_SHOP_V2 = localStorage.getItem('supplyShopV2') !== '0';
  const groups = (d && d.groups) || [];
  const cpItems = (d && d._contract_purchases) || [];
  const cpBlock = _contractPurchasesBlockHtml(cpItems);
  // v2.45.428: «Ждём поставку» — заказанные покупные по договорам + заказанные
  // комплектующие (их убираем из групп «к закупке», чтобы не предлагались снова).
  const waitingItems = cpItems.filter(x => x.purchase_status === 'ordered');
  // v2.45.286: применяем локальные скрытие/переопределения к каждой группе
  let totalHidden = 0;
  groups.forEach(g => {
    // заказанные комплектующие → в «Ждём поставку» (из исходных, до фильтра)
    (g.items || []).forEach(it => {
      if (it.order_status) waitingItems.push(_componentToTracking(it, g));
    });
    const r = _shopApplyLocal(g.items);   // исключает заказанные + скрытые
    g.items = r.items;
    g.items_count = r.items.length;
    totalHidden += r.hiddenCount;
  });
  const waitingBlock = _waitingDeliveryBlockHtml(waitingItems);
  // Группы, в которых не осталось позиций после фильтра — выкидываем
  const visibleGroups = groups.filter(g => (g.items || []).length > 0);
  // v2.45.286: тулбар с кол-вом скрытых + кнопкой «Показать»
  const hiddenToolbar = totalHidden > 0
    ? '<div class="sup-shop-hidden-bar">' +
        '<i class="ti ti-eye-off"></i>' +
        '<span>Скрыто ' + totalHidden + ' ' + _plural(totalHidden, ['позиция', 'позиции', 'позиций']) + ' (только на этом устройстве)</span>' +
        '<button class="btn btn-secondary btn-sm" onclick="shopUnhideAll()"><i class="ti ti-eye"></i>Показать все</button>' +
      '</div>'
    : '';
  // v2.45.x: KPI-строка одним взглядом
  const _pendCp = cpItems.filter(x => x.purchase_status !== 'ordered').length;
  const _lowCnt = visibleGroups.reduce((s, g) => s + (g.items_count || 0), 0);
  const buyCount = _pendCp + _lowCnt;
  const waitCount = waitingItems.length;
  const _today = new Date().toISOString().slice(0, 10);
  const longWait = waitingItems.filter(it => { const dd = _daysSince(it.ordered_at); return dd !== null && dd >= 14; }).length;
  const arriveToday = waitingItems.filter(it => it.order_expected && String(it.order_expected).slice(0, 10) === _today).length;
  // v2.45.x: запоминаем список «ждём поставку», чтобы перерисовывать вкладку по
  // клику на карточку-счётчик (Долго ждём / Сегодня на складе).
  window._supWaitingItems = waitingItems;
  const kpiStrip = '<div class="sup-kpis">' +
    _supKpiCard('shopping-cart', 'brand', buyCount, 'К закупке', "supKpiClick('buy')") +
    _supKpiCard('truck-delivery', 'blue', waitCount, 'Ждём поставку', "supKpiClick('wait')") +
    _supKpiCard('clock-exclamation', 'red', longWait, 'Долго ждём (&gt;14дн)', "supKpiClick('long')") +
    _supKpiCard('calendar-check', 'green', arriveToday, 'Сегодня на складе', "supKpiClick('today')") +
  '</div>';
  // Табы: К закупке / Ждём поставку
  const tab = (window._supTab === 'wait') ? 'wait' : 'buy';
  const segTabs = '<div class="sup-seg">' +
    '<button data-tab="buy" class="' + (tab === 'buy' ? 'on' : '') + '" onclick="supSwitchTab(\'buy\')"><i class="ti ti-shopping-cart"></i> К закупке <span class="cnt">' + buyCount + '</span></button>' +
    '<button data-tab="wait" class="' + (tab === 'wait' ? 'on' : '') + '" onclick="supSwitchTab(\'wait\')"><i class="ti ti-truck-delivery"></i> Ждём поставку <span class="cnt">' + waitCount + '</span></button>' +
  '</div>';
  // v2.45.442: переключатель нового/старого вида «Что закупить» (для отката)
  const v2Toggle = '<div class="sv2-toggle-bar">' +
      '<span><i class="ti ti-' + (window.SUPPLY_SHOP_V2 ? 'sparkles' : 'history') + '"></i> ' +
        (window.SUPPLY_SHOP_V2 ? 'Новый вид' : 'Старый вид') + '</span>' +
      '<button class="sv2-toggle-btn" onclick="toggleSupplyShopV2()">' +
        (window.SUPPLY_SHOP_V2 ? 'Вернуть старый' : 'Включить новый') +
      '</button>' +
    '</div>';
  let groupsHtml = '';
  // v2.44.35: selection state для bulk-assign в группе «не назначен»
  if (!window._noSupSelected) window._noSupSelected = new Set();
  // Чистим невалидные id (если строка ушла после прошлого назначения)
  const allNoSupIds = new Set();
  visibleGroups.forEach(g => {
    if (!g.supplier_id) (g.items || []).forEach(it => allNoSupIds.add(it.component_id));
  });
  Array.from(window._noSupSelected).forEach(id => {
    if (!allNoSupIds.has(id)) window._noSupSelected.delete(id);
  });

  visibleGroups.forEach((g, idx) => {
    const supName = g.supplier_name || '(поставщик не назначен)';
    const noSupplier = !g.supplier_id;
    const itemRows = (g.items || []).map(it => {
      // v2.45.335: показываем «под какой проект» (договоры) или «на склад»
      const planContracts = Array.isArray(it.plan_contracts) ? it.plan_contracts : [];
      let reasonBadge = it.reason
        ? '<span class="sup-shop-reason' + (it.reason.indexOf('низкий остаток') !== -1 ? ' is-warn' : '') + '">' + escapeHtml(it.reason) + '</span>'
        : '';
      if (planContracts.length) {
        const shown = planContracts.slice(0, 3).map(n => '№' + n).join(', ');
        const more = planContracts.length > 3 ? ' +' + (planContracts.length - 3) : '';
        reasonBadge += '<span class="ssp-badge ssp-badge-proj" title="Нужно для этих договоров">' +
          '<i class="ti ti-briefcase"></i> под проект: ' + escapeHtml(shown) + more + '</span>';
      } else if (it.reason && it.reason.indexOf('низкий остаток') !== -1) {
        reasonBadge += '<span class="ssp-badge ssp-badge-stock" title="Пополнение склада до минимума">' +
          '<i class="ti ti-building-warehouse"></i> на склад</span>';
      }
      // v2.45.274: живой статус заказа по этой позиции (счёт запрошен / оплачен …)
      let orderBadge = '';
      if (it.order_status && typeof _CP_ORDER_STATUS_RU !== 'undefined') {
        const s = _CP_ORDER_STATUS_RU[it.order_status];
        if (s) {
          orderBadge = '<span class="ssp-badge" style="color:' + s[1] + ';background:' + s[2] + ';" ' +
            'title="Статус обновляется по заказу в «Заказах»">' +
            escapeHtml(s[0]) + (it.order_label ? ' <span style="font-weight:400;opacity:0.75;">' + escapeHtml(it.order_label) + '</span>' : '') +
          '</span>';
        }
      }
      const critBadge = it.is_critical
        ? '<i class="ti ti-alert-triangle" style="color:#DC2626;font-size:13px;margin-right:4px;" title="критичный компонент"></i>'
        : '';
      // v2.44.34: в группе «не назначен» — кнопка «Назначить поставщика» + чекбокс
      // v2.44.37: рендерим чекбоксы как полноценный input в видимой обёртке
      const isCheckedAttr = noSupplier && window._noSupSelected.has(it.component_id) ? ' checked' : '';
      const checkCell = noSupplier
        ? '<td class="ns-check-cell"><label class="ns-check-label">' +
            '<input type="checkbox" class="ns-row-check" data-cid="' + it.component_id + '"' +
            isCheckedAttr +
            ' onchange="onNoSupRowCheck(this)">' +
          '</label></td>'
        : '';
      const assignCell = noSupplier
        ? '<td class="ssp-action"><button class="btn btn-secondary btn-sm" onclick="assignSupplierTo(' + it.component_id + ')">' +
            '<i class="ti ti-truck"></i>Поставщик</button></td>'
        : '';
      // v2.45.286: qty можно менять кликом, рядом — крестик «скрыть позицию»
      const safeName = JSON.stringify(it.component_name || '').replace(/"/g, '&quot;');
      const qtyOverridden = !!it._qty_overridden;
      const qtyCell =
        '<td class="ssp-qty ssp-qty-edit' + (qtyOverridden ? ' is-overridden' : '') + '" ' +
            'onclick="shopEditQty(' + it.component_id + ', ' + Number(it.recommended_qty) + ', ' + JSON.stringify(it.unit || 'шт.').replace(/"/g, '&quot;') + ')" ' +
            'title="' + (qtyOverridden ? 'Изменено вручную · ' : '') + 'Тап чтобы изменить количество">' +
          '<span class="ssp-qty-chip">' +
            escapeHtml(String(it.recommended_qty)) + ' ' + escapeHtml(it.unit || 'шт.') +
            ' <i class="ti ti-pencil ssp-qty-pencil"></i>' +
          '</span>' +
        '</td>';
      const removeCell =
        '<td class="ssp-remove-cell">' +
          '<button type="button" class="ssp-remove-btn" style="color:#15803D;" ' +
            'title="Приход на склад (оприходовать)" ' +
            'onclick="event.stopPropagation();openComponentReceiveModal(' + it.component_id + ')">' +
            '<i class="ti ti-package-import"></i>' +
          '</button>' +
          '<button type="button" class="ssp-remove-btn" ' +
            'title="Убрать из «Что закупить» (локально)" ' +
            'onclick="event.stopPropagation();shopHideItem(' + it.component_id + ', ' + safeName + ')">' +
            '<i class="ti ti-x"></i>' +
          '</button>' +
        '</td>';
      return '<tr>' + checkCell +
        // v2.45.256: клик по названию — открыть карточку комплектующего
        '<td class="ssp-name">' + critBadge +
          '<span onclick="openComponentDetail(' + it.component_id + ')" ' +
            'style="cursor:pointer;" title="Открыть карточку комплектующего" ' +
            'onmouseover="this.style.color=\'var(--brand)\';this.style.textDecoration=\'underline\'" ' +
            'onmouseout="this.style.color=\'\';this.style.textDecoration=\'\'">' +
            escapeHtml(it.component_name) +
          '</span>' +
          (it.sku ? '<span class="ssp-sku" style="color:var(--text-light);margin-left:6px;font-size:11.5px;">' + escapeHtml(it.sku) + '</span>' : '') +
        '</td>' +
        '<td class="ssp-stock" style="text-align:right;color:var(--text-light);font-size:12px;">' +
          '<span class="ssp-meta-label">остаток/мин: </span>' +
          escapeHtml(String(it.qty_on_stock)) + ' / ' + escapeHtml(String(it.min_stock)) +
        '</td>' +
        qtyCell +
        '<td class="ssp-reason-cell"><div class="ssp-reason-wrap">' + reasonBadge + orderBadge + '</div></td>' +
        assignCell +
        removeCell +
      '</tr>';
    }).join('');

    // v2.45.442 (редизайн Снабжения, под переключателем): позиции карточками sv2 + степпер
    const itemCardsV2 = (g.items || []).map(it => {
      const crit = it.is_critical ? '<i class="ti ti-alert-triangle" style="color:#DC2626;font-size:13px;margin-right:4px;" title="критичный компонент"></i>' : '';
      const low = !!(it.reason && it.reason.indexOf('низкий остаток') !== -1);
      const plan = Array.isArray(it.plan_contracts) ? it.plan_contracts : [];
      let tags = '';
      if (low) tags += '<span class="sv2-tag warn"><i class="ti ti-arrow-down"></i>низкий остаток</span>';
      if (plan.length) {
        const shown = plan.slice(0, 3).map(n => '№' + n).join(', ') + (plan.length > 3 ? ' +' + (plan.length - 3) : '');
        tags += '<span class="sv2-tag proj"><i class="ti ti-briefcase"></i>' + escapeHtml(shown) + '</span>';
      } else if (low) {
        tags += '<span class="sv2-tag neutral"><i class="ti ti-building-warehouse"></i>на склад</span>';
      }
      const sName = JSON.stringify(it.component_name || '').replace(/"/g, '&quot;');
      const q = Number(it.recommended_qty) || 0;
      return '<div class="sv2-item">' +
        '<div class="sv2-item-top">' +
          '<div class="sv2-item-body" onclick="openComponentDetail(' + it.component_id + ')">' +
            '<div class="sv2-item-name">' + crit + escapeHtml(it.component_name || '') +
              (it.sku ? ' <span class="sv2-sku">' + escapeHtml(it.sku) + '</span>' : '') + '</div>' +
            '<div class="sv2-item-stock">остаток / мин: <b>' + escapeHtml(String(it.qty_on_stock)) + ' / ' + escapeHtml(String(it.min_stock)) + '</b></div>' +
          '</div>' +
          '<button class="sv2-item-x" title="Приход на склад (оприходовать)" style="color:#15803D;" onclick="event.stopPropagation();openComponentReceiveModal(' + it.component_id + ')"><i class="ti ti-package-import"></i></button>' +
          '<button class="sv2-item-x" title="Убрать из заказа" onclick="event.stopPropagation();shopHideItem(' + it.component_id + ',' + sName + ')"><i class="ti ti-x"></i></button>' +
        '</div>' +
        '<div class="sv2-item-bottom">' +
          '<div class="sv2-tags">' + tags + '</div>' +
          '<div class="sv2-stepper">' +
            '<button type="button" onclick="sv2StepQty(' + it.component_id + ',-1)">−</button>' +
            '<span class="val" id="sv2-qty-' + it.component_id + '">' + escapeHtml(String(q)) + '</span>' +
            '<button type="button" class="plus" onclick="sv2StepQty(' + it.component_id + ',1)">+</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    groupsHtml += '<div class="sup-shop-group' + (noSupplier ? ' no-supplier' : '') + '">' +
      '<div class="sup-shop-group-head">' +
        '<div class="sup-shop-group-name">' +
          _supAvatarHtml(supName, noSupplier) + escapeHtml(supName) +
          '<span class="sup-shop-group-count">' + (g.items_count || 0) + ' ' +
            (g.items_count === 1 ? 'позиция' : (g.items_count < 5 ? 'позиции' : 'позиций')) +
          '</span>' +
        '</div>' +
        '<div class="sup-shop-group-actions">' +
          (g.supplier_id
            ? (
                // Скачать DOCX — просто файл, без отправки и без создания заказа
                '<button class="btn btn-secondary btn-sm" onclick="downloadShoppingGroupDocx(' + g.supplier_id + ')" title="Скачать заявку для поставщика в DOCX (без отправки)">' +
                  '<i class="ti ti-file-text"></i>Скачать DOCX</button>' +
                // Сформировать заказ — превью письма + отправка
                ' <button class="btn btn-primary btn-sm" ' +
                  (g.supplier_email
                    ? 'onclick="openCreateOrderPreview(' + g.supplier_id + ')" title="Создать заказ и отправить письмо поставщику"'
                    : 'disabled title="У поставщика не указан email — заполни его в карточке поставщика"'
                  ) + '>' +
                  '<i class="ti ti-mail-send"></i>Сформировать заказ</button>' +
                // v2.45.337: оформить вручную — заказ уже сделан/оплачен по телефону, без письма
                ' <button class="btn btn-secondary btn-sm" onclick="openManualOrderDialog(' + g.supplier_id + ')" ' +
                  'title="Уже заказал/оплатил по телефону — записать заказ без письма и сразу поставить статус">' +
                  '<i class="ti ti-clipboard-check"></i>Оформить вручную</button>'
              )
            : '<span style="color:var(--text-light);font-size:12px;">Сначала назначь поставщика — без этого не отправить заказ</span>'
          ) +
        '</div>' +
      '</div>' +
      (g.supplier_email || g.supplier_phone || g.supplier_inn || g.supplier_contact
        ? '<div class="sup-shop-group-contact">' +
            (g.supplier_inn ? '<span>ИНН ' + escapeHtml(g.supplier_inn) + '</span>' : '') +
            (g.supplier_contact ? '<span><i class="ti ti-user"></i>' + escapeHtml(g.supplier_contact) + '</span>' : '') +
            (g.supplier_email ? '<span><i class="ti ti-mail"></i>' + escapeHtml(g.supplier_email) + '</span>' : '') +
            (g.supplier_phone ? '<span><i class="ti ti-phone"></i>' + escapeHtml(g.supplier_phone) + '</span>' : '') +
          '</div>'
        : ''
      ) +
      // v2.44.35: bulk-action bar для группы без поставщика
      (noSupplier
        ? '<div class="ns-hint">' +
            '<i class="ti ti-info-circle"></i>' +
            'Поставьте галочки на позиции — можно назначить одного поставщика сразу нескольким' +
          '</div>' +
          '<div class="ns-bulk-bar" id="ns-bulk-bar" style="' +
            (window._noSupSelected && window._noSupSelected.size > 0 ? '' : 'display:none;') + '">' +
            '<span class="ns-bulk-info">Выбрано <b id="ns-bulk-count">' +
              (window._noSupSelected ? window._noSupSelected.size : 0) + '</b> ' +
              '<span id="ns-bulk-word">' + _plural(window._noSupSelected ? window._noSupSelected.size : 0, ['позиция','позиции','позиций']) + '</span>' +
            '</span>' +
            '<button class="btn btn-primary btn-sm" onclick="bulkAssignSupplier()">' +
              '<i class="ti ti-truck"></i>Назначить поставщика всем</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="clearNoSupSelection()">' +
              '<i class="ti ti-x"></i>Снять выбор</button>' +
          '</div>'
        : ''
      ) +
      // v2.45.442: новый вид (карточки sv2) для групп с поставщиком — под переключателем; старый (таблица) — для отката
      ((window.SUPPLY_SHOP_V2 && !noSupplier)
        ? ('<div class="sv2-list">' + itemCardsV2 + '</div>')
        : ('<table class="sup-shop-table">' +
        '<thead><tr>' +
          (noSupplier
            ? '<th class="ns-check-cell"><label class="ns-check-label"><input type="checkbox" id="ns-check-all" onchange="onNoSupCheckAll(this)" title="Выбрать все"></label></th>'
            : ''
          ) +
          '<th>Позиция</th>' +
          '<th style="text-align:right;width:120px;">остаток / мин.</th>' +
          '<th style="text-align:right;width:140px;">Заказать</th>' +
          '<th style="width:160px;">Причина</th>' +
          (noSupplier ? '<th style="width:150px;">Действие</th>' : '') +
          '<th style="width:40px;"></th>' +
        '</tr></thead>' +
        '<tbody>' + itemRows + '</tbody>' +
      '</table>')
      ) +
    '</div>';
  });
  // Собираем две вкладки: «К закупке» (покупные + низкий остаток) и «Ждём поставку»
  const buyInner = (cpBlock + groupsHtml + hiddenToolbar) ||
    '<div class="empty-block" style="padding:32px 16px;"><i class="ti ti-check" style="color:#16A34A;font-size:28px;"></i>' +
    '<div style="margin-top:8px;font-size:14px;color:var(--text-mid);">Всё в норме — закупать нечего.</div></div>';
  const waitInner = waitingBlock ||
    '<div class="empty-block" style="padding:32px 16px;"><i class="ti ti-truck-off" style="color:var(--text-faint);font-size:28px;"></i>' +
    '<div style="margin-top:8px;font-size:14px;color:var(--text-mid);">Пока ничего не ждём — заказы поедут сюда.</div></div>';
  const buyPane  = '<div class="sup-pane" data-pane="buy"'  + (tab === 'buy'  ? '' : ' hidden') + '>' + buyInner  + '</div>';
  const waitPane = '<div class="sup-pane" data-pane="wait"' + (tab === 'wait' ? '' : ' hidden') + '>' + waitInner + '</div>';
  container.innerHTML = kpiStrip + segTabs + v2Toggle + buyPane + waitPane;
  // v2.45.444: кардинальный новый вид — класс на контейнере перекрывает стили групп/шапок
  container.classList.toggle('sv2-mode', !!window.SUPPLY_SHOP_V2);
}

/* ============ ЭТАП 52 (v2.44.73): заказ из shopping-list с превью ============ */

// «Скачать DOCX» — создаём черновик заказа, скачиваем DOCX, и всё.
// Черновик остаётся в Заказах для аудита. Письмо НЕ отправляем.
async function downloadShoppingGroupDocx(supplierId) {
  const d = await apiGet('/api/supply/shopping-list');
  const group = (d.groups || []).find(g => g.supplier_id === supplierId);
  // v2.45.286: проверяем после применения локального скрытия
  const visible = group ? _shopApplyLocal(group.items).items : [];
  if (!group || !visible.length) {
    showToast('Нет позиций для экспорта', 'warning');
    return;
  }
  try {
    const resp = await fetch(API_BASE + '/api/supply-orders/draft-from-shopping', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        supplier_id: supplierId,
        // v2.45.286: убираем локально скрытые и применяем переопределённые qty
        items: _shopApplyLocal(group.items).items.map(it => ({ component_id: it.component_id, qty: it.recommended_qty })),
      }),
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      showToast(j.message || 'Не удалось создать заявку', 'error');
      return;
    }
    const draft = await resp.json();
    // Скачиваем DOCX по созданному черновику
    const docResp = await fetch(API_BASE + '/api/supply-orders/' + draft.id + '/docx', {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!docResp.ok) {
      showToast('Не удалось скачать DOCX', 'error');
      return;
    }
    const blob = await docResp.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = 'order_' + (draft.order_label || ('ORD-' + draft.id)) + '.docx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    showToast('Заявка ' + (draft.order_label || ('#' + draft.id)) + ' создана. Файл скачан.', 'success');
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

// «Сформировать заказ» — создаём черновик, открываем модалку превью письма
async function openCreateOrderPreview(supplierId) {
  const d = await apiGet('/api/supply/shopping-list');
  const group = (d.groups || []).find(g => g.supplier_id === supplierId);
  // v2.45.286: проверяем после применения локального скрытия
  const visible = group ? _shopApplyLocal(group.items).items : [];
  if (!group || !visible.length) {
    showToast('Нет позиций для экспорта', 'warning');
    return;
  }
  if (!group.supplier_email) {
    showToast('У поставщика не указан email', 'error');
    return;
  }
  // Создаём draft + получаем превью
  let draft;
  try {
    const resp = await fetch(API_BASE + '/api/supply-orders/draft-from-shopping', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        supplier_id: supplierId,
        // v2.45.286: убираем локально скрытые и применяем переопределённые qty
        items: _shopApplyLocal(group.items).items.map(it => ({ component_id: it.component_id, qty: it.recommended_qty })),
      }),
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      showToast(j.message || 'Не удалось создать заявку', 'error');
      return;
    }
    draft = await resp.json();
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
    return;
  }
  _renderOrderPreviewModal(draft);
}

// v2.45.337: «Оформить вручную» — заказ оформлен по телефону (счёт запросили/
// оплатили вне системы). Создаём заказ по позициям группы БЕЗ письма и сразу
// ставим выбранный статус. Открываем диалог выбора статуса.
async function openManualOrderDialog(supplierId) {
  const d = await apiGet('/api/supply/shopping-list');
  const group = (d.groups || []).find(g => g.supplier_id === supplierId);
  const visible = group ? _shopApplyLocal(group.items).items : [];
  if (!group || !visible.length) {
    showToast('Нет позиций для заказа', 'warning');
    return;
  }
  const opts = [
    ['awaiting_invoice', 'Счёт запрошен', 'Запросили счёт у поставщика, ещё не оплатили'],
    ['invoice_received', 'Счёт получен',  'Счёт от поставщика уже на руках'],
    ['to_pay',           'На оплате',     'Счёт передан на оплату'],
    ['paid',             'Оплачен',       'Уже оплатили — ждём поставку'],
  ];
  const itemsLine = visible.map(it =>
    escapeHtml(it.component_name) + ' — ' + escapeHtml(String(it.recommended_qty)) + ' ' + escapeHtml(it.unit || 'шт.')
  ).join('<br>');
  const m = document.getElementById('supply-modal');
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:480px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-clipboard-check"></i> Оформить вручную</h3>' +
        '<button class="modal-close" onclick="closeSupplyModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        '<div style="font-size:13px;color:var(--text-mid);margin-bottom:6px;">Поставщик: <b>' + escapeHtml(group.supplier_name || '') + '</b></div>' +
        '<div style="font-size:12px;color:var(--text-light);background:#F8FAFC;border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:12px;max-height:120px;overflow:auto;">' + itemsLine + '</div>' +
        '<div style="font-size:12px;color:var(--text-mid);margin-bottom:8px;">Создадим заказ <b>без письма поставщику</b> и поставим статус:</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;">' +
          opts.map(o =>
            '<button class="btn btn-secondary" style="justify-content:flex-start;text-align:left;padding:10px 12px;" ' +
              'onclick="submitManualOrder(' + supplierId + ', \'' + o[0] + '\')">' +
              '<span><b>' + escapeHtml(o[1]) + '</b><br>' +
                '<span style="font-size:11.5px;color:var(--text-light);font-weight:400;">' + escapeHtml(o[2]) + '</span>' +
              '</span>' +
            '</button>'
          ).join('') +
        '</div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

async function submitManualOrder(supplierId, status) {
  const d = await apiGet('/api/supply/shopping-list');
  const group = (d.groups || []).find(g => g.supplier_id === supplierId);
  const visible = group ? _shopApplyLocal(group.items).items : [];
  if (!group || !visible.length) {
    showToast('Нет позиций для заказа', 'warning');
    return;
  }
  try {
    const resp = await fetch(API_BASE + '/api/supply-orders/manual-from-shopping', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        supplier_id: supplierId,
        status: status,
        items: visible.map(it => ({ component_id: it.component_id, qty: it.recommended_qty })),
      }),
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok || !j.ok) {
      showToast(j.message || 'Не удалось оформить заказ', 'error');
      return;
    }
    closeSupplyModal();
    showToast('Заказ ' + (j.order_label || ('#' + j.id)) + ' оформлен: ' + (j.status_label || status), 'success');
    loadSupplyShopping();
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

// v2.44.76: проверка DOCX из превью — fetch с авторизацией, открываем blob в новой вкладке
async function downloadOrderDraftDocx(orderId, label) {
  try {
    const resp = await fetch(API_BASE + '/api/supply-orders/' + orderId + '/docx', {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      showToast('Не удалось открыть: ' + (e.message || ('HTTP ' + resp.status)), 'error');
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    // Word-документ из blob браузер не покажет inline — даём «скачать»,
    // пользователь откроет в Word на своей стороне.
    const a = document.createElement('a');
    a.href = url;
    a.download = 'order_' + (label || ('ORD-' + orderId)) + '.docx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

// Состояние превью-модалки. Храним последний draft, чтобы при изменении qty
// поднимать только секцию позиций и тело письма (без сноса полей to/subject).
let _opCurrentDraft = null;
let _opBodyDirty = false;   // юзер вручную правил textarea — не перезаписываем
let _opSubjectDirty = false;

function _renderOrderPreviewModal(draft) {
  _opCurrentDraft = draft;
  _opBodyDirty = false;
  _opSubjectDirty = false;
  const overlayId = 'order-preview-modal';
  let m = document.getElementById(overlayId);
  if (m) m.remove();
  m = document.createElement('div');
  m.id = overlayId;
  m.className = 'modal-overlay order-preview-modal';
  m.innerHTML =
    '<div class="modal" style="max-width:760px;max-height:92vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h2><i class="ti ti-mail-send"></i> Заявка ' + escapeHtml(draft.order_label || ('#' + draft.id)) + ' · превью письма</h2>' +
        '<button class="icon-btn" onclick="document.getElementById(\'' + overlayId + '\').remove()">' +
          '<i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content" style="overflow-y:auto;display:flex;flex-direction:column;gap:10px;">' +
        '<div class="op-field">' +
          '<label>Кому (email поставщика)</label>' +
          '<input type="email" id="op-to" value="' + escapeHtml(draft.preview.to || '') + '">' +
        '</div>' +
        '<div class="op-field">' +
          '<label>Тема письма <span style="color:var(--text-light);font-weight:400;font-size:11px;">— метка в квадратных скобках нужна для авто-приёмки счёта, лучше её не удалять</span></label>' +
          '<input type="text" id="op-subject" oninput="_opSubjectDirty=true" value="' + escapeHtml(draft.preview.subject || '') + '">' +
        '</div>' +
        '<div class="op-field">' +
          '<label>Позиции <span style="color:var(--text-light);font-weight:400;font-size:11px;">— меняй кол-во прямо здесь, текст письма и DOCX обновятся автоматически</span></label>' +
          '<div id="op-items-wrap">' + _opBuildItemsHTML(draft.items || []) + '</div>' +
          // v2.45.239: подсказки из прайса поставщика для поля «У поставщика»
          '<datalist id="op-alias-dl"></datalist>' +
        '</div>' +
        '<div class="op-field" style="flex:1;display:flex;flex-direction:column;">' +
          '<label>Текст письма</label>' +
          '<textarea id="op-body" oninput="_opBodyDirty=true" style="min-height:220px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px;">' + escapeHtml(draft.preview.body || '') + '</textarea>' +
        '</div>' +
        '<div class="op-attachment">' +
          '<i class="ti ti-paperclip"></i>' +
          '<span>Вложение: <b>order_' + escapeHtml(draft.order_label || ('ORD-' + draft.id)) + '.docx</b> · <span id="op-items-count">' + draft.items_count + '</span> позиций</span>' +
          '<button type="button" class="op-attachment-link" onclick="downloadOrderDraftDocx(' + draft.id + ',\'' + escapeHtml(draft.order_label || ('ORD-' + draft.id)) + '\')">Открыть для проверки</button>' +
        '</div>' +
        '<div id="op-status" class="op-status" style="display:none;"></div>' +
      '</div>' +
      '<div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border);">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'' + overlayId + '\').remove()">Отмена</button>' +
        '<button class="btn btn-primary" id="op-send-btn" onclick="submitOrderPreview(' + draft.id + ')">' +
          '<i class="ti ti-send"></i> Отправить' +
        '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  m.classList.add('visible');
  // v2.45.239: подгружаем прайс поставщика в datalist (подсказки «У поставщика»)
  if (draft.supplier_id) _opFillAliasDatalist(draft.supplier_id);
}

async function _opFillAliasDatalist(supplierId) {
  try {
    const d = await apiGet('/api/suppliers/' + supplierId + '/price-items');
    const dl = document.getElementById('op-alias-dl');
    if (!dl || !(d.items || []).length) return;
    dl.innerHTML = d.items.map(n => '<option value="' + escapeHtml(n) + '"></option>').join('');
  } catch (e) { /* подсказки опциональны */ }
}

// ============ v2.45.240: выбор из каталога поставщика (кнопка 📋 в заявке) ============

state._opAliasPickerItemId = null;
state._opAliasPickerItems = [];

async function openOpAliasPicker(orderItemId) {
  if (!_opCurrentDraft || !_opCurrentDraft.supplier_id) {
    showToast('Не определён поставщик заявки', 'error');
    return;
  }
  state._opAliasPickerItemId = orderItemId;
  let items = [], detailed = [], files = [];
  try {
    const d = await apiGet('/api/suppliers/' + _opCurrentDraft.supplier_id + '/price-items');
    items = d.items || [];
    detailed = d.detailed || items.map(n => ({ name: n, source: null }));
    files = d.files || [];
  } catch (e) { items = []; detailed = []; files = []; }
  state._opAliasPickerItems = items;
  state._opAliasPickerDetailed = detailed;   // v2.45.243: с источником (вкладки)
  state._opAliasPickerFiles = files;
  state._opAliasPickerTab = '';              // '' = Все
  state._opApFileHtmlCache = {};             // v2.45.249: всегда свежая отрисовка таблиц

  let m = document.getElementById('op-alias-picker-modal');
  if (m) m.remove();
  m = document.createElement('div');
  m.id = 'op-alias-picker-modal';
  m.className = 'modal-overlay visible';
  m.style.zIndex = '10001';
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  // v2.45.247: режим «во весь экран» (запоминается)
  const apFull = localStorage.getItem('atomus_ap_full') === '1';
  m.innerHTML =
    '<div class="modal" id="op-ap-modal" onclick="event.stopPropagation()" style="display:flex;flex-direction:column;' +
      (apFull ? 'max-width:98vw;width:98vw;max-height:96vh;height:96vh;' : 'max-width:620px;max-height:88vh;') + '">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-list-search"></i> Каталог: ' + escapeHtml(_opCurrentDraft.supplier_name || 'поставщик') + '</h3>' +
        '<div style="display:flex;gap:4px;align-items:center;">' +
          '<button class="modal-close" title="Развернуть / свернуть" onclick="_opApToggleFull()">' +
            '<i class="ti ' + (apFull ? 'ti-arrows-minimize' : 'ti-arrows-maximize') + '" id="op-ap-full-icon"></i></button>' +
          '<button class="modal-close" onclick="document.getElementById(\'op-alias-picker-modal\').remove()"><i class="ti ti-x"></i></button>' +
        '</div>' +
      '</div>' +
      '<div style="padding:12px 18px 0;display:flex;gap:8px;align-items:center;">' +
        '<div class="search-box" style="flex:1;">' +
          '<i class="ti ti-search"></i>' +
          '<input type="text" id="op-ap-search" placeholder="Поиск по прайсу…" oninput="_renderOpAliasPickerList()">' +
        '</div>' +
        '<label class="btn btn-secondary" style="cursor:pointer;margin:0;white-space:nowrap;" title="Догрузить прайс-лист этого поставщика (XIGMA, Royal Clima и т.д.)">' +
          '<i class="ti ti-file-spreadsheet"></i> Прайс из Excel' +
          '<input type="file" accept=".xlsx,.xlsm,.xls" style="display:none;" onchange="uploadSupplierPriceExcel(' + _opCurrentDraft.supplier_id + ', this)">' +
        '</label>' +
      '</div>' +
      // v2.45.243: вкладки по прайсам (если их несколько) + открыть оригинал Excel
      '<div id="op-ap-tabs" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 18px 0;"></div>' +
      '<div id="op-ap-list" style="overflow-y:auto;flex:1;padding:10px 18px 18px;"></div>' +
    '</div>';
  document.body.appendChild(m);
  _renderOpAliasPickerList();
  setTimeout(() => { const i = document.getElementById('op-ap-search'); if (i) i.focus(); }, 50);
}

// v2.45.247: развернуть каталог во весь экран (и обратно)
function _opApToggleFull() {
  const full = localStorage.getItem('atomus_ap_full') === '1' ? '0' : '1';
  localStorage.setItem('atomus_ap_full', full);
  const md = document.getElementById('op-ap-modal');
  if (md) {
    if (full === '1') {
      md.style.maxWidth = '98vw'; md.style.width = '98vw';
      md.style.maxHeight = '96vh'; md.style.height = '96vh';
    } else {
      md.style.maxWidth = '620px'; md.style.width = '';
      md.style.maxHeight = '88vh'; md.style.height = '';
    }
  }
  const ic = document.getElementById('op-ap-full-icon');
  if (ic) ic.className = 'ti ' + (full === '1' ? 'ti-arrows-minimize' : 'ti-arrows-maximize');
}

// v2.45.243: вкладки прайсов в каталоге
function _opApSetTab(src) {
  state._opAliasPickerTab = src || '';
  _renderOpAliasPickerList();
}

function _renderOpApTabs() {
  const box = document.getElementById('op-ap-tabs');
  if (!box) return;
  const detailed = state._opAliasPickerDetailed || [];
  const sources = [];
  detailed.forEach(r => {
    const s = r.source || '';
    if (!sources.includes(s)) sources.push(s);
  });
  const files = state._opAliasPickerFiles || [];
  if (sources.length <= 1 && !files.length) { box.innerHTML = ''; return; }
  const cur = state._opAliasPickerTab || '';
  const chip = (src, label) => {
    const on = cur === src;
    return '<button type="button" onclick="_opApSetTab(' + JSON.stringify(src).replace(/"/g, '&quot;') + ')" ' +
      'style="border:1px solid ' + (on ? 'var(--brand)' : 'var(--border)') + ';background:' + (on ? 'var(--brand)' : 'var(--bg)') + ';' +
      'color:' + (on ? '#fff' : 'var(--text)') + ';border-radius:14px;padding:3px 12px;font-size:12px;cursor:pointer;">' +
      escapeHtml(label) + '</button>';
  };
  let html = chip('', 'Все');
  sources.forEach(s => { if (s) html += chip(s, s); });
  if (sources.includes('')) html += sources.length > 1 ? chip('__none__', 'Прочее') : '';
  // v2.45.244: клик по прайсу — открывает его позиции прямо здесь (листай и
  // выбирай). Маленькая ⬇ рядом — скачать Excel-оригинал.
  files.forEach(f => {
    const on = cur === ('__file__' + f.id);
    html += '<span style="display:inline-flex;align-items:center;border:1px ' + (on ? 'solid var(--brand)' : 'dashed var(--border)') + ';border-radius:14px;overflow:hidden;' +
        (on ? 'background:var(--brand);' : '') + '">' +
      '<button type="button" title="Открыть прайс: ' + escapeHtml(f.file_name || '') + '" onclick="_opOpenPriceFile(' + f.id + ')" ' +
        'style="border:none;background:none;padding:3px 4px 3px 10px;font-size:12px;cursor:pointer;color:' + (on ? '#fff' : 'var(--brand)') + ';">' +
        '<i class="ti ti-file-spreadsheet"></i> ' + escapeHtml(f.label || f.file_name || ('#' + f.id)) +
      '</button>' +
      '<button type="button" title="Скачать Excel-оригинал" onclick="downloadSupplierPriceFile(' + f.id + ')" ' +
        'style="border:none;background:none;padding:3px 4px;font-size:12px;cursor:pointer;color:' + (on ? '#fff' : 'var(--text-light)') + ';">' +
        '<i class="ti ti-download"></i>' +
      '</button>' +
      // v2.45.252: удалить прайс (файл + его позиции из каталога)
      '<button type="button" title="Удалить прайс" onclick="_opDeletePriceFile(' + f.id + ')" ' +
        'style="border:none;background:none;padding:3px 8px 3px 2px;font-size:12px;cursor:pointer;color:' + (on ? '#fff' : 'var(--text-light)') + ';">' +
        '<i class="ti ti-trash"></i>' +
      '</button>' +
    '</span>';
  });
  box.innerHTML = html;
}

async function downloadSupplierPriceFile(fileId) {
  if (!_opCurrentDraft || !_opCurrentDraft.supplier_id) return;
  try {
    const r = await fetch(API_BASE + '/api/suppliers/' + _opCurrentDraft.supplier_id + '/price-files/' + fileId, {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!r.ok) { showToast('Файл не найден', 'error'); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cd = r.headers.get('Content-Disposition') || '';
    const mm = cd.match(/filename="?([^";]+)"?/);
    a.download = mm ? mm[1] : 'price.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

// v2.45.244: открыть сохранённый прайс по клику на вкладку-файл
// v2.45.252: сразу таблицей «как в Excel»; метку берём из списка файлов
async function _opOpenPriceFile(fileId) {
  state._opAliasPickerTab = '__file__' + fileId;
  const f = (state._opAliasPickerFiles || []).find(x => x.id === fileId);
  state._opAliasPickerFileLabel = f ? (f.label || f.file_name || '') : '';
  _renderOpAliasPickerList();
}

// v2.45.252: удалить прайс-файл (и его позиции из каталога)
async function _opDeletePriceFile(fileId) {
  if (!_opCurrentDraft || !_opCurrentDraft.supplier_id) return;
  const f = (state._opAliasPickerFiles || []).find(x => x.id === fileId);
  const nm = f ? (f.label || f.file_name || ('#' + fileId)) : ('#' + fileId);
  if (!confirm('Удалить прайс «' + nm + '»?\nЕго позиции тоже уйдут из каталога. Новый можно загрузить кнопкой «Прайс из Excel».')) return;
  try {
    await apiDelete('/api/suppliers/' + _opCurrentDraft.supplier_id + '/price-files/' + fileId);
    showToast('Прайс удалён', 'success');
    // Перезагружаем каталог целиком (вкладки, datalist, список)
    openOpAliasPicker(state._opAliasPickerItemId);
  } catch (e) {
    showToast('Не удалось удалить прайс', 'error');
  }
}

// v2.45.245: клик по строке Excel-таблицы (делегирование на обёртке)
function _opXlsRowClick(e) {
  const tr = e.target && e.target.closest ? e.target.closest('tr.xls-pick') : null;
  if (!tr) return;
  const name = tr.getAttribute('data-pick') || '';
  if (name) _opPriceNameChoose(name);
}

// Клик по строке открытого прайса: добавляем в каталог (тихо) + подставляем в позицию
async function _opPriceLineChoose(el) {
  const name = el.getAttribute('data-name') || '';
  if (!name) return;
  await _opPriceNameChoose(name);
}

async function _opPriceNameChoose(name) {
  const sid = _opCurrentDraft && _opCurrentDraft.supplier_id;
  const itemId = state._opAliasPickerItemId;
  try {
    await fetch(API_BASE + '/api/suppliers/' + sid + '/price-items/import', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ names: [name], source: state._opAliasPickerFileLabel || '' }),
    });
  } catch (e) { /* каталог — приятный бонус, не блокируем выбор */ }
  const m = document.getElementById('op-alias-picker-modal');
  if (m) m.remove();
  if (!itemId) return;
  const input = document.querySelector('[data-op-alias-id="' + itemId + '"]');
  if (input) input.value = name;
  await _opUpdateItemAlias(itemId, name);
  showToast('Сопоставлено: ' + name, 'success');
}

// v2.45.435: грузим превью прайса с понятной причиной ошибки (файл потерян /
// не открылся Excel), а не глухим «Не удалось отрисовать таблицу».
async function _opLoadPriceView(sid, fid) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const resp = await fetch(API_BASE + '/api/suppliers/' + sid + '/price-files/' + fid + '/view', {
      headers: { 'Authorization': 'Bearer ' + token }, cache: 'no-store',
    });
    if (resp.ok) {
      const d = await resp.json();
      return d.html || '<div class="empty-block">Пусто</div>';
    }
    const j = await resp.json().catch(() => ({}));
    const msg = j.message || j.error || ('HTTP ' + resp.status);
    const lost = resp.status === 404;
    return '<div class="empty-block" style="padding:24px 12px;text-align:center;color:var(--text-light);">' +
      '<i class="ti ti-' + (lost ? 'file-x' : 'alert-triangle') + '" style="font-size:30px;color:#B91C1C;"></i><br>' +
      '<div style="margin-top:8px;font-weight:700;color:var(--text-dark);">' +
        (lost ? 'Файл прайса не найден в хранилище' : 'Не удалось открыть прайс') + '</div>' +
      '<div style="margin-top:4px;font-size:12px;">' + escapeHtml(msg) + '</div>' +
      '<div style="margin-top:10px;font-size:12px;line-height:1.45;">Загрузи прайс заново кнопкой <b>«Прайс из Excel»</b> выше' +
        (lost ? ', либо удали этот файл корзинкой 🗑 и добавь новый.' : '.') + '</div>' +
    '</div>';
  } catch (e) {
    return '<div class="empty-block" style="padding:24px 12px;text-align:center;color:var(--text-light);">' +
      'Сеть недоступна: ' + escapeHtml(e.message || String(e)) + '<br>Попробуй открыть ещё раз.</div>';
  }
}

function _renderOpAliasPickerList() {
  _renderOpApTabs();   // v2.45.243
  const box = document.getElementById('op-ap-list');
  if (!box) return;
  // v2.45.244: режим «открыт прайс-файл» — листаем его позиции
  const tab = state._opAliasPickerTab || '';
  if (tab.indexOf('__file__') === 0) {
    const fid = parseInt(tab.slice(8), 10);
    // v2.45.252: всегда «как в Excel» — переключатель «Список» убран
    const cache = state._opApFileHtmlCache || (state._opApFileHtmlCache = {});
    if (!cache[fid]) {
      box.innerHTML = '<div class="loading-block">Рисуем таблицу с картинками…</div>';
      if (cache['_loading_' + fid]) return;
      cache['_loading_' + fid] = true;
      _opLoadPriceView(_opCurrentDraft.supplier_id, fid)
        .then(html => { cache[fid] = html; })
        .finally(() => { delete cache['_loading_' + fid]; _renderOpAliasPickerList(); });
      return;
    }
    box.innerHTML =
      '<div style="font-size:11.5px;color:var(--text-light);padding:0 0 6px;">Нажми на строку товара — он подставится в заявку. Таблицу можно листать вбок</div>' +
      '<div class="xls-wrap" onclick="_opXlsRowClick(event)">' + cache[fid] + '</div>';
    return;
  }
  const detailed = state._opAliasPickerDetailed || (state._opAliasPickerItems || []).map(n => ({ name: n, source: null }));
  if (!detailed.length) {
    const hasFiles = (state._opAliasPickerFiles || []).length > 0;
    box.innerHTML = '<div class="empty-block" style="padding:30px 10px;color:var(--text-light);text-align:center;">' +
      '<i class="ti ti-file-spreadsheet" style="font-size:28px;"></i><br>' +
      (hasFiles
        ? 'Каталог пока пуст, но прайсы загружены.<br><b>Нажми на прайс выше</b> — откроются его позиции, выбирай из них.'
        : 'Прайс этого поставщика ещё не загружен.<br>Нажми <b>«Прайс из Excel»</b> выше и выбери файл прайс-листа (XIGMA, Royal Clima…).') +
    '</div>';
    return;
  }
  // фильтр по вкладке-прайсу (tab объявлен выше)
  let scoped = detailed;
  if (tab === '__none__') scoped = detailed.filter(r => !r.source);
  else if (tab) scoped = detailed.filter(r => (r.source || '') === tab);
  const all = scoped.map(r => r.name);
  const q = ((document.getElementById('op-ap-search') || {}).value || '').toLowerCase().trim();
  const list = q ? all.filter(n => n.toLowerCase().includes(q)) : all;
  if (!list.length) {
    box.innerHTML = '<div class="empty-block" style="padding:24px 10px;color:var(--text-light);">Ничего не нашлось по «' + escapeHtml(q) + '»</div>';
    return;
  }
  box.innerHTML = list.slice(0, 300).map(n =>
    '<div style="display:flex;align-items:center;border-bottom:1px solid var(--border);">' +
      '<div onclick="_opAliasPickerChoose(this)" data-name="' + escapeHtml(n) + '" ' +
        'style="flex:1;padding:8px 10px;cursor:pointer;font-size:13px;" ' +
        'onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'">' +
        escapeHtml(n) +
      '</div>' +
      // v2.45.241: убрать мусорную строку из прайса навсегда
      '<button type="button" data-name="' + escapeHtml(n) + '" title="Удалить из прайса" ' +
        'onclick="_opAliasPickerDelete(this)" ' +
        'style="border:none;background:none;cursor:pointer;color:var(--text-light);padding:6px 10px;font-size:14px;" ' +
        'onmouseover="this.style.color=\'#B91C1C\'" onmouseout="this.style.color=\'var(--text-light)\'">' +
        '<i class="ti ti-x"></i></button>' +
    '</div>'
  ).join('') + (list.length > 300 ? '<div style="padding:8px 10px;color:var(--text-light);font-size:12px;">…показаны первые 300, уточни поиск</div>' : '');
}

// v2.45.241: удалить строку из прайса поставщика прямо из каталога
async function _opAliasPickerDelete(btn) {
  const name = btn.getAttribute('data-name') || '';
  if (!name || !_opCurrentDraft || !_opCurrentDraft.supplier_id) return;
  try {
    const r = await fetch(API_BASE + '/api/suppliers/' + _opCurrentDraft.supplier_id + '/price-items/delete', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ names: [name] }),
    });
    if (!r.ok) { showToast('Не удалось удалить', 'error'); return; }
    state._opAliasPickerItems = (state._opAliasPickerItems || []).filter(n => n !== name);
    state._opAliasPickerDetailed = (state._opAliasPickerDetailed || []).filter(r => r.name !== name);
    _renderOpAliasPickerList();
    showToast('Удалено из прайса', 'success');
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

async function _opAliasPickerChoose(el) {
  const name = el.getAttribute('data-name') || '';
  const itemId = state._opAliasPickerItemId;
  const m = document.getElementById('op-alias-picker-modal');
  if (m) m.remove();
  if (!itemId || !name) return;
  const input = document.querySelector('[data-op-alias-id="' + itemId + '"]');
  if (input) input.value = name;
  await _opUpdateItemAlias(itemId, name);  // сам перегенерит письмо
  showToast('Сопоставлено: ' + name, 'success');
}

function _opBuildItemsHTML(items) {
  if (!items || !items.length) return '<div style="color:var(--text-light);font-size:13px;padding:8px 4px;">(позиций нет)</div>';
  let html = '<div style="display:flex;flex-direction:column;gap:6px;border:1px solid var(--border);border-radius:8px;padding:8px;">';
  items.forEach((it, idx) => {
    const unit = it.item_unit || 'шт.';
    html += '<div style="display:grid;grid-template-columns:24px 1fr 130px 30px;gap:8px;align-items:center;font-size:13px;">' +
      '<span style="color:var(--text-light);text-align:right;">' + (idx + 1) + '.</span>' +
      '<div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(it.item_name || '') + '">' +
        escapeHtml(it.item_name || '—') +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;">' +
        '<input type="number" step="any" min="0.001" inputmode="decimal" ' +
          'data-op-item-id="' + it.id + '" ' +
          'value="' + (it.qty || 0) + '" ' +
          'style="width:80px;padding:4px 6px;text-align:right;border:1px solid var(--border);border-radius:6px;font-size:13px;" ' +
          'oninput="_opScheduleItemQty(' + it.id + ', this)" ' +
          'onblur="_opFlushItemQty(' + it.id + ', this)">' +
        '<span style="color:var(--text-light);min-width:30px;">' + escapeHtml(unit) + '</span>' +
        '<span class="op-item-saving" data-op-saving-id="' + it.id + '" style="width:14px;color:var(--text-light);font-size:11px;display:inline-flex;align-items:center;justify-content:center;"></span>' +
      '</div>' +
      '<button type="button" title="Убрать позицию из заказа" onclick="_opDeleteItem(' + it.id + ')" ' +
        'style="border:none;background:none;cursor:pointer;color:var(--text-light);padding:2px;display:flex;align-items:center;justify-content:center;font-size:15px;" ' +
        'onmouseover="this.style.color=\'#B91C1C\'" onmouseout="this.style.color=\'var(--text-light)\'">' +
        '<i class="ti ti-trash"></i></button>' +
    '</div>' +
    // v2.45.238: «у поставщика» — название из его прайса, оно уйдёт в письмо и DOCX.
    // Запоминается на пару (позиция, поставщик) — в следующей заявке подставится само.
    // v2.45.240: кнопка 📋 — выбрать из каталога (загруженных прайсов поставщика).
    '<div style="display:grid;grid-template-columns:24px 1fr 30px;gap:8px;align-items:center;margin-top:-2px;">' +
      '<span></span>' +
      '<div style="display:flex;gap:6px;align-items:center;">' +
        '<input type="text" data-op-alias-id="' + it.id + '" list="op-alias-dl" ' +
          'value="' + escapeHtml(it.supplier_item_name || '') + '" ' +
          'placeholder="У поставщика: выбери из каталога → или впиши вручную" ' +
          'style="flex:1;padding:3px 6px;border:1px dashed var(--border);border-radius:6px;font-size:12px;color:var(--brand);" ' +
          'oninput="_opScheduleItemAlias(' + it.id + ', this)" ' +
          'onblur="_opFlushItemAlias(' + it.id + ', this)">' +
        '<button type="button" title="Выбрать из каталога поставщика" onclick="openOpAliasPicker(' + it.id + ')" ' +
          'style="border:1px solid var(--border);background:var(--bg);border-radius:6px;cursor:pointer;color:var(--brand);padding:3px 8px;display:flex;align-items:center;justify-content:center;font-size:14px;">' +
          '<i class="ti ti-list-search"></i></button>' +
      '</div>' +
      '<span></span>' +
    '</div>';
  });
  html += '</div>';
  return html;
}

// v2.45.238: дебаунс-сохранение «названия у поставщика»
const _opItemAliasTimers = {};

function _opScheduleItemAlias(itemId, inputEl) {
  if (_opItemAliasTimers[itemId]) clearTimeout(_opItemAliasTimers[itemId]);
  _opItemAliasTimers[itemId] = setTimeout(() => {
    _opItemAliasTimers[itemId] = null;
    _opUpdateItemAlias(itemId, inputEl && inputEl.value);
  }, 900);
}

function _opFlushItemAlias(itemId, inputEl) {
  if (_opItemAliasTimers[itemId]) {
    clearTimeout(_opItemAliasTimers[itemId]);
    _opItemAliasTimers[itemId] = null;
    _opUpdateItemAlias(itemId, inputEl && inputEl.value);
  }
}

async function _opUpdateItemAlias(itemId, value) {
  if (!_opCurrentDraft) return;
  try {
    const r = await fetch(API_BASE + '/api/supply-orders/items/' + itemId, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ supplier_name: (value || '').trim() }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showToast(j.message || 'Не удалось сохранить название', 'error');
      return;
    }
    // Перегенерируем письмо, но не сносим инпут, если пользователь ещё печатает в нём
    const active = document.activeElement;
    const stillTyping = active && active.dataset && active.dataset.opAliasId == itemId;
    if (!stillTyping) await _opReloadDraft();
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

// Дебаунсы по итему — чтобы не дёргать PATCH на каждый символ.
const _opItemQtyTimers = {};

function _opScheduleItemQty(itemId, inputEl) {
  if (_opItemQtyTimers[itemId]) clearTimeout(_opItemQtyTimers[itemId]);
  const saveIndicator = document.querySelector('[data-op-saving-id="' + itemId + '"]');
  if (saveIndicator) saveIndicator.textContent = '…';
  _opItemQtyTimers[itemId] = setTimeout(() => {
    _opItemQtyTimers[itemId] = null;
    _opUpdateItemQty(itemId, inputEl && inputEl.value, inputEl);
  }, 600);
}

function _opFlushItemQty(itemId, inputEl) {
  // На blur — немедленно (если ждали дебаунс)
  if (_opItemQtyTimers[itemId]) {
    clearTimeout(_opItemQtyTimers[itemId]);
    _opItemQtyTimers[itemId] = null;
    _opUpdateItemQty(itemId, inputEl && inputEl.value, inputEl);
  }
}

async function _opUpdateItemQty(itemId, value, inputEl) {
  if (!_opCurrentDraft) return;
  const qty = parseFloat(String(value || '').replace(',', '.'));
  const saveIndicator = document.querySelector('[data-op-saving-id="' + itemId + '"]');
  if (!isFinite(qty) || qty <= 0) {
    if (saveIndicator) { saveIndicator.textContent = '!'; saveIndicator.style.color = '#B91C1C'; }
    return;
  }
  if (saveIndicator) { saveIndicator.textContent = '…'; saveIndicator.style.color = 'var(--text-light)'; }
  try {
    const r = await fetch(API_BASE + '/api/supply-orders/items/' + itemId, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ qty }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showToast(j.message || ('Не удалось сохранить кол-во (HTTP ' + r.status + ')'), 'error');
      if (saveIndicator) { saveIndicator.textContent = '!'; saveIndicator.style.color = '#B91C1C'; }
      return;
    }
    // Освежаем превью с сервера (он пересоберёт текст письма)
    await _opReloadDraft();
    // Восстановим фокус — пользователь может продолжить править ту же ячейку
    const fresh = document.querySelector('[data-op-item-id="' + itemId + '"]');
    if (fresh && document.activeElement !== fresh && inputEl && document.activeElement === inputEl) {
      // не трогаем — пользователь ещё в инпуте, _opReloadDraft переписал HTML
    } else if (fresh) {
      // если был фокус на старом инпуте — переносим на новый
      if (inputEl && inputEl.dataset && inputEl.dataset.opItemId == itemId && document.activeElement === inputEl) {
        fresh.focus();
        const v = fresh.value;
        fresh.setSelectionRange(v.length, v.length);
      }
    }
    const freshIndicator = document.querySelector('[data-op-saving-id="' + itemId + '"]');
    if (freshIndicator) { freshIndicator.textContent = '✓'; freshIndicator.style.color = '#0A5B41'; setTimeout(() => { freshIndicator.textContent = ''; }, 1200); }
  } catch (e) {
    showToast('Сеть: не удалось сохранить кол-во', 'error');
    if (saveIndicator) { saveIndicator.textContent = '!'; saveIndicator.style.color = '#B91C1C'; }
  }
}

// v2.45.135: удаление позиции прямо в превью заказа (например, заказываем
// только часть позиций группы). Бэкенд: DELETE /api/supply-orders/items/{id}.
async function _opDeleteItem(itemId) {
  if (!_opCurrentDraft) return;
  const items = _opCurrentDraft.items || [];
  if (items.length <= 1) {
    showToast('Это последняя позиция — нажми «Отмена», чтобы не формировать заказ', 'warning');
    return;
  }
  const it = items.find(x => x.id === itemId);
  const nm = (it && it.item_name) || 'позицию';
  if (!confirm('Убрать из заказа:\n' + nm + ' ?')) return;
  try {
    const r = await fetch(API_BASE + '/api/supply-orders/items/' + itemId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showToast(j.message || ('Не удалось удалить (HTTP ' + r.status + ')'), 'error');
      return;
    }
    // Освежаем превью с сервера (пересоберёт текст письма и список позиций)
    await _opReloadDraft();
    // Перерисовываем список позиций — строка удалена
    const wrap = document.getElementById('op-items-wrap');
    if (wrap) wrap.innerHTML = _opBuildItemsHTML((_opCurrentDraft && _opCurrentDraft.items) || []);
    showToast('Позиция убрана из заказа', 'success');
  } catch (e) {
    showToast('Сеть: не удалось удалить позицию', 'error');
  }
}

async function _opReloadDraft() {
  if (!_opCurrentDraft) return;
  try {
    const r = await fetch(API_BASE + '/api/supply-orders/' + _opCurrentDraft.id + '/preview', {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!r.ok) return;
    const fresh = await r.json();
    _opCurrentDraft = fresh;
    // Items HTML НЕ перерисовываем — это убьёт фокус в инпуте кол-ва пока юзер
    // ещё печатает. Значения qty уже корректны в state, сервер их подтвердил.
    const cnt = document.getElementById('op-items-count');
    if (cnt) cnt.textContent = fresh.items_count;
    if (!_opSubjectDirty) {
      const s = document.getElementById('op-subject');
      if (s && fresh.preview && fresh.preview.subject) s.value = fresh.preview.subject;
    }
    if (!_opBodyDirty) {
      const b = document.getElementById('op-body');
      if (b && fresh.preview && fresh.preview.body) b.value = fresh.preview.body;
    }
  } catch (_) {}
}

async function submitOrderPreview(orderId) {
  const to = (document.getElementById('op-to')?.value || '').trim();
  const subject = (document.getElementById('op-subject')?.value || '').trim();
  const body = (document.getElementById('op-body')?.value || '').trim();
  if (!to) { showToast('Заполни email поставщика', 'error'); return; }
  if (!subject) { showToast('Заполни тему', 'error'); return; }
  if (!body) { showToast('Заполни текст письма', 'error'); return; }
  const btn = document.getElementById('op-send-btn');
  const status = document.getElementById('op-status');
  const setStatus = (cls, text) => {
    if (!status) return;
    status.className = 'op-status ' + cls;
    status.innerHTML = (cls === 'sending'
      ? '<i class="ti ti-loader-2" style="animation:spin 1.2s linear infinite;"></i>'
      : cls === 'ok' ? '<i class="ti ti-check"></i>'
      : '<i class="ti ti-alert-triangle"></i>') + ' ' + text;
    status.style.display = '';
  };
  const origLabel = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1.2s linear infinite;"></i> Отправляем…';
  }
  setStatus('sending', 'Соединяемся с SMTP-сервером и отправляем письмо… (до 30 секунд)');

  // Клиентский таймаут 40с — на всякий случай, обычно бэк отдаст быстрее
  const ctrl = new AbortController();
  const timeoutTimer = setTimeout(() => ctrl.abort(), 40000);

  try {
    const resp = await fetch(API_BASE + '/api/supply-orders/' + orderId + '/send-email', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: to, subject, body }),
      signal: ctrl.signal,
    });
    clearTimeout(timeoutTimer);
    let j = {};
    try { j = await resp.json(); } catch (_) {}
    if (!resp.ok || j.success === false) {
      const msg = j.message || j.error || ('HTTP ' + resp.status);
      setStatus('err', 'Не отправлено: ' + msg);
      showToast('Не удалось отправить: ' + msg, 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
      return;
    }
    setStatus('ok', j.message || 'Заявка отправлена');
    showToast(j.message || 'Заявка отправлена', 'success');
    // Не закрываем модалку моментально — даём пользователю прочитать «Отправлено»
    setTimeout(() => {
      document.getElementById('order-preview-modal')?.remove();
      cache.supplyOrders = null;
      if (typeof loadSupplyOrders === 'function') loadSupplyOrders();
      if (typeof loadSupplyShopping === 'function') loadSupplyShopping();
    }, 1200);
  } catch (e) {
    clearTimeout(timeoutTimer);
    const msg = (e && e.name === 'AbortError')
      ? 'Бэкенд не ответил за 40 сек. Проверь Railway → Logs.'
      : ('Сеть: ' + (e.message || e));
    setStatus('err', msg);
    showToast(msg, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
  }
}

// ===== Функции для работы с готовыми заказами =====

async function downloadSupplyOrderDocx(orderId) {
  try {
    const url = API_BASE + `/api/supply-orders/${orderId}/docx`;
    const resp = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      showToast('Ошибка: ' + (e.message || 'Не удалось скачать'), 'error');
      return;
    }
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `order_${orderId}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    showToast('Заказ скачан', 'success');
  } catch (e) {
    showToast('Ошибка при скачивании: ' + String(e), 'error');
  }
}

async function sendSupplyOrderByEmail(orderId) {
  try {
    const url = API_BASE + `/api/supply-orders/${orderId}/send-email`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({})
    });
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      showToast('Ошибка: ' + (e.message || 'Не удалось отправить'), 'error');
      return;
    }
    const result = await resp.json();
    if (result.success) {
      showToast(result.message, 'success');
      // Обновим список заказов
      loadSupplyOrders();
    } else {
      showToast(result.message || 'Ошибка при отправке', 'error');
    }
  } catch (e) {
    showToast('Ошибка: ' + String(e), 'error');
  }
}

// v2.44.35: bulk-выбор и назначение поставщика на N позиций сразу
function onNoSupRowCheck(checkbox) {
  if (!window._noSupSelected) window._noSupSelected = new Set();
  const cid = parseInt(checkbox.dataset.cid, 10);
  if (checkbox.checked) window._noSupSelected.add(cid);
  else window._noSupSelected.delete(cid);
  _refreshNoSupBulkBar();
}

function onNoSupCheckAll(headerCheck) {
  if (!window._noSupSelected) window._noSupSelected = new Set();
  const visible = document.querySelectorAll('.ns-row-check');
  visible.forEach(cb => {
    cb.checked = headerCheck.checked;
    const cid = parseInt(cb.dataset.cid, 10);
    if (headerCheck.checked) window._noSupSelected.add(cid);
    else window._noSupSelected.delete(cid);
  });
  _refreshNoSupBulkBar();
}

function _refreshNoSupBulkBar() {
  const bar = document.getElementById('ns-bulk-bar');
  const count = window._noSupSelected ? window._noSupSelected.size : 0;
  if (!bar) return;
  bar.style.display = count > 0 ? '' : 'none';
  const cntEl = document.getElementById('ns-bulk-count');
  if (cntEl) cntEl.textContent = count;
  const wrdEl = document.getElementById('ns-bulk-word');
  if (wrdEl) wrdEl.textContent = _plural(count, ['позиция','позиции','позиций']);
}

function clearNoSupSelection() {
  if (window._noSupSelected) window._noSupSelected.clear();
  document.querySelectorAll('.ns-row-check').forEach(cb => { cb.checked = false; });
  const headerCheck = document.getElementById('ns-check-all');
  if (headerCheck) headerCheck.checked = false;
  _refreshNoSupBulkBar();
}

async function bulkAssignSupplier() {
  const ids = Array.from(window._noSupSelected || []);
  if (!ids.length) return;

  if (!cache.suppliers || !cache.suppliers.length) {
    try {
      const r = await apiGet('/api/suppliers');
      cache.suppliers = r.suppliers || [];
    } catch (e) { cache.suppliers = []; }
  }
  const suppliers = (cache.suppliers || []).filter(s => s.is_active !== 0);

  let modal = document.getElementById('bulk-assign-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'bulk-assign-modal';
    modal.className = 'modal-overlay';
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('visible'); };
    modal.innerHTML = '<div class="modal" style="max-width:520px;max-height:80vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-truck"></i> Назначить поставщика <span id="bulk-assign-count" style="color:var(--text-light);font-weight:400;font-size:13px;"></span></h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'bulk-assign-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:14px 16px;">' +
        '<input type="text" id="bulk-asgn-search" class="form-input" placeholder="Поиск по названию…" autocomplete="off" oninput="filterBulkAssignList(this.value)">' +
      '</div>' +
      '<div id="bulk-asgn-list" style="flex:1;overflow-y:auto;padding:0 8px 8px;"></div>' +
    '</div>';
    document.body.appendChild(modal);
  }
  document.getElementById('bulk-assign-count').textContent = '— ' + ids.length + ' ' + _plural(ids.length, ['позиции','позициям','позициям']);
  window._bulkAssignAll = suppliers;
  filterBulkAssignList('');
  modal.classList.add('visible');
  setTimeout(() => {
    const s = document.getElementById('bulk-asgn-search');
    if (s) { s.value = ''; s.focus(); }
  }, 50);
}

function filterBulkAssignList(query) {
  const list = document.getElementById('bulk-asgn-list');
  if (!list) return;
  const q = (query || '').trim().toLowerCase();
  const all = window._bulkAssignAll || [];
  const filtered = q ? all.filter(s => (s.name || '').toLowerCase().includes(q)) : all;
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-block" style="padding:18px;text-align:center;color:var(--text-light);">' +
      (q ? 'Ничего не нашлось' : 'Список поставщиков пуст') + '</div>';
    return;
  }
  list.innerHTML = filtered.map(s =>
    '<button type="button" class="sup-pick-row" onclick="doBulkAssign(' + s.id + ')">' +
      '<i class="ti ti-truck"></i>' +
      '<span class="sup-pick-name">' + escapeHtml(s.name || '—') + '</span>' +
      (s.inn ? '<span class="sup-pick-inn">ИНН ' + escapeHtml(s.inn) + '</span>' : '') +
    '</button>'
  ).join('');
}

async function doBulkAssign(supplierId) {
  const ids = Array.from(window._noSupSelected || []);
  if (!ids.length) return;
  const modal = document.getElementById('bulk-assign-modal');
  if (modal) modal.classList.remove('visible');

  const token = localStorage.getItem(TOKEN_KEY);
  let ok = 0, fail = 0;
  for (const cid of ids) {
    try {
      const r = await fetch(API_BASE + '/api/components/' + cid, {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_supplier_id: supplierId }),
      });
      if (r.ok) ok++;
      else fail++;
    } catch (_) { fail++; }
  }
  showToast(
    'Поставщик назначен на ' + ok + ' ' + _plural(ok, ['позицию','позиции','позиций']) +
    (fail ? ' (ошибок ' + fail + ')' : ''),
    fail ? 'error' : 'success'
  );
  window._noSupSelected.clear();
  loadSupplyShopping();
}

// v2.44.34: назначить поставщика компоненту прямо из «Что закупить»
async function assignSupplierTo(componentId) {
  if (!cache.suppliers || !cache.suppliers.length) {
    try {
      const r = await apiGet('/api/suppliers');
      cache.suppliers = r.suppliers || [];
    } catch (e) { cache.suppliers = []; }
  }
  const suppliers = (cache.suppliers || []).filter(s => s.is_active !== 0);

  let modal = document.getElementById('assign-supplier-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'assign-supplier-modal';
    modal.className = 'modal-overlay';
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('visible'); };
    modal.innerHTML = '<div class="modal" style="max-width:520px;max-height:80vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-truck"></i> Назначить поставщика</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'assign-supplier-modal\').classList.remove(\'visible\')"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="padding:14px 16px;">' +
        '<input type="text" id="asgn-sup-search" class="form-input" placeholder="Поиск по названию…" autocomplete="off" oninput="filterAssignSupplierList(this.value)">' +
      '</div>' +
      '<div id="asgn-sup-list" style="flex:1;overflow-y:auto;padding:0 8px 8px;"></div>' +
    '</div>';
    document.body.appendChild(modal);
  }
  window._assignSupplierAll = suppliers;
  window._assignSupplierComponentId = componentId;
  filterAssignSupplierList('');
  modal.classList.add('visible');
  setTimeout(() => {
    const s = document.getElementById('asgn-sup-search');
    if (s) { s.value = ''; s.focus(); }
  }, 50);
}

function filterAssignSupplierList(query) {
  const list = document.getElementById('asgn-sup-list');
  if (!list) return;
  const q = (query || '').trim().toLowerCase();
  const all = window._assignSupplierAll || [];
  const filtered = q
    ? all.filter(s => (s.name || '').toLowerCase().includes(q))
    : all;
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-block" style="padding:18px;text-align:center;color:var(--text-light);">' +
      (q ? 'Ничего не нашлось' : 'Список поставщиков пуст') + '</div>';
    return;
  }
  list.innerHTML = filtered.map(s =>
    '<button type="button" class="sup-pick-row" onclick="doAssignSupplier(' + s.id + ')">' +
      '<i class="ti ti-truck"></i>' +
      '<span class="sup-pick-name">' + escapeHtml(s.name || '—') + '</span>' +
      (s.inn ? '<span class="sup-pick-inn">ИНН ' + escapeHtml(s.inn) + '</span>' : '') +
    '</button>'
  ).join('');
}

async function doAssignSupplier(supplierId) {
  const cid = window._assignSupplierComponentId;
  if (!cid) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/components/' + cid, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ default_supplier_id: supplierId }),
    });
    if (!r.ok) {
      let msg = 'HTTP ' + r.status;
      try { const d = await r.json(); if (d.message) msg = d.message; } catch (_) {}
      throw new Error(msg);
    }
    const modal = document.getElementById('assign-supplier-modal');
    if (modal) modal.classList.remove('visible');
    showToast('Поставщик назначен', 'success');
    loadSupplyShopping();
  } catch (e) {
    showToast('Не удалось: ' + (e.message || e), 'error');
  }
}

async function loadSupplyRequests() {
  const container = document.getElementById('sup-req-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-block">Загружаем заявки…</div>';
  try {
    const params = new URLSearchParams();
    if (state.supplyReqFilter !== 'all') params.set('status', state.supplyReqFilter);
    const d = await apiGet('/api/supply-requests' + (params.toString() ? '?' + params.toString() : ''));
    cache.supplyRequests = d.requests || [];
    renderSupplyRequests();
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderSupplyRequests() {
  const container = document.getElementById('sup-req-list');
  const list = cache.supplyRequests || [];
  document.getElementById('sup-req-counter').textContent = list.length;
  if (!list.length) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-clipboard-list"></i>Под этот фильтр заявок нет</div>';
    return;
  }
  const canManage = canManageSupply();
  let html = '';
  list.forEach(r => { html += renderSupplyRequestRow(r, canManage); });
  container.innerHTML = html;
}

function renderSupplyRequestRow(r, canManage) {
  const meta = [];
  meta.push('<span class="sup-status-pill st-' + r.status + '">' + escapeHtml(r.status_label) + '</span>');
  if (r.needed_by) {
    const d = new Date(r.needed_by);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / (1000 * 60 * 60 * 24));
    let cls = '';
    let txt = 'к ' + r.needed_by;
    if (r.status === 'new' || r.status === 'ordered') {
      if (diff < 0) { cls = 'urgent'; txt = 'просрочена ' + Math.abs(diff) + ' дн.'; }
      else if (diff <= 3) cls = 'soon';
    }
    meta.push('<span class="sup-req-deadline ' + cls + '"><i class="ti ti-calendar"></i>' + escapeHtml(txt) + '</span>');
  }
  if (r.contract_id && r.contract_number) {
    meta.push('<span class="sup-contract-badge" onclick="event.stopPropagation(); openContractFromSupply(' + r.contract_id + ')"><i class="ti ti-link"></i>' +
      escapeHtml(r.contract_number) + (r.contractor_name ? ' · ' + escapeHtml(r.contractor_name) : '') + '</span>');
  }
  const actions = canManage && r.status !== 'received'
    ? '<div class="sup-row-actions"><button class="btn-icon-warning" onclick="event.stopPropagation(); deleteSupplyRequest(' + r.id + ')" title="Удалить"><i class="ti ti-trash"></i></button></div>'
    : '';
  return '<div class="sup-row" onclick="openEditSupplyRequest(' + r.id + ')">' +
    '<div class="sup-row-icon"><i class="ti ti-clipboard-list"></i></div>' +
    '<div class="sup-row-body">' +
      '<div class="sup-row-title">' + escapeHtml(r.item_name) + ' — <strong>' + r.qty + ' ' + escapeHtml(r.item_unit) + '</strong></div>' +
      '<div class="sup-row-meta">' + meta.join('') + '</div>' +
      (r.comment ? '<div class="sup-row-comment">' + escapeHtml(r.comment) + '</div>' : '') +
    '</div>' + actions + '</div>';
}

function setSupplyReqFilter(f) {
  state.supplyReqFilter = f;
  document.querySelectorAll('[data-sup-req]').forEach(b => b.classList.toggle('active', b.dataset.supReq === f));
  loadSupplyRequests();
}

function openNewSupplyRequest() {
  if (!canManageSupply()) { showToast('Доступно директору, заму, менеджеру', 'error'); return; }
  showSupplyRequestModal(null);
}

async function openEditSupplyRequest(rid) {
  try {
    const r = await apiGet('/api/supply-requests/' + rid);
    showSupplyRequestModal(r);
  } catch (e) {
    showToast('Не удалось загрузить', 'error');
  }
}

async function showSupplyRequestModal(r) {
  const isEdit = !!r;
  const canManage = canManageSupply();
  // v2.45.34: источник позиций — «Номенклатура комплектующих» (components),
  // живой каталог CRM. Старая supply_items больше не используется на создание;
  // если заявка-старая (source==='item'), показываем её имя как «закреплённое».
  if (!cache.components) {
    try {
      const d = await apiGet('/api/components');
      cache.components = d.components || d.items || [];
    } catch (e) { cache.components = []; }
  }
  const comps = (cache.components || []).filter(c => c.is_active !== false && c.is_active !== 0);
  // Группируем по категориям — список длинный, иначе скроллить замучаешься.
  const byCat = {};
  comps.forEach(c => {
    const cat = c.category_name || '— Без категории —';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(c);
  });
  const sortedCats = Object.keys(byCat).sort((a, b) => a.localeCompare(b, 'ru'));
  const m = document.getElementById('supply-modal');
  // Если редактируем legacy-заявку с item_id (но без component_id) — показываем
  // имя как readonly. Поменять можно, тогда фронт пришлёт component_id.
  const isLegacyItem = isEdit && r.source === 'item';
  let positionBlock;
  if (isLegacyItem) {
    positionBlock =
      '<div class="form-group"><label>Позиция (старая)</label>' +
        '<div class="picker-display"><div class="picker-display-value"><i class="ti ti-archive"></i> ' +
          escapeHtml(r.item_name || '—') + ' (' + escapeHtml(r.item_unit || 'шт.') + ')' +
        '</div></div>' +
        '<div style="font-size:11.5px;color:var(--text-light);margin-top:4px;">Заявка создана из устаревшего каталога. Чтобы перевести на нашу номенклатуру — выбери комплектующее ниже.</div>' +
      '</div>' +
      '<div class="form-group"><label>Перевести на комплектующее</label>' +
        '<select id="sr-component" ' + (canManage ? '' : 'disabled') + '>' +
          '<option value="">— оставить как есть —</option>' +
          sortedCats.map(cat =>
            '<optgroup label="' + escapeHtml(cat) + '">' +
              byCat[cat].map(c =>
                '<option value="' + c.id + '">' + escapeHtml(c.name) +
                (c.sku ? ' · ' + escapeHtml(c.sku) : '') +
                ' (' + escapeHtml(c.unit || 'шт.') + ')</option>'
              ).join('') +
            '</optgroup>'
          ).join('') +
        '</select>' +
      '</div>';
  } else {
    const selCompId = isEdit ? (r.component_id || 0) : 0;
    positionBlock =
      '<div class="form-group"><label>Комплектующее *</label>' +
        '<select id="sr-component" ' + (canManage ? '' : 'disabled') + '>' +
          '<option value="">— выбрать —</option>' +
          sortedCats.map(cat =>
            '<optgroup label="' + escapeHtml(cat) + '">' +
              byCat[cat].map(c =>
                '<option value="' + c.id + '"' + (selCompId === c.id ? ' selected' : '') + '>' +
                escapeHtml(c.name) +
                (c.sku ? ' · ' + escapeHtml(c.sku) : '') +
                ' (' + escapeHtml(c.unit || 'шт.') + ')</option>'
              ).join('') +
            '</optgroup>'
          ).join('') +
        '</select>' +
        '<div style="font-size:11.5px;color:var(--text-light);margin-top:4px;">Источник — «Номенклатура комплектующих» (Справочники → Снабжение).</div>' +
      '</div>';
  }
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-clipboard-list"></i> ' + (isEdit ? 'Заявка #' + r.id : 'Новая заявка на закупку') + '</h3>' +
        '<button class="modal-close" onclick="closeSupplyModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        positionBlock +
        '<div class="form-group form-row-2">' +
          '<div><label>Количество *</label><input type="number" id="sr-qty" min="0.001" step="any" value="' + (isEdit ? r.qty : '1') + '" ' + (canManage ? '' : 'disabled') + '></div>' +
          '<div><label>Нужно к дате</label><input type="date" id="sr-needed-by" value="' + escapeHtml(isEdit ? (r.needed_by || '') : '') + '" ' + (canManage ? '' : 'disabled') + '></div>' +
        '</div>' +
        (isEdit && r.contract_number
          ? '<div class="form-group"><label>Договор</label><div class="picker-display"><div class="picker-display-value"><i class="ti ti-file-text"></i> ' + escapeHtml(r.contract_number) + (r.contractor_name ? ' · ' + escapeHtml(r.contractor_name) : '') + '</div></div></div>'
          : '') +
        '<div class="form-group"><label>Комментарий</label><textarea id="sr-comment" rows="3" ' + (canManage ? '' : 'disabled') + '>' + escapeHtml(isEdit ? r.comment : '') + '</textarea></div>' +
        (isEdit
          ? '<div class="form-group"><label>Статус</label><div><span class="sup-status-pill st-' + r.status + '">' + escapeHtml(r.status_label) + '</span></div></div>'
          : '') +
        (canManage
          ? '<div class="modal-actions"><button class="btn btn-primary" onclick="saveSupplyRequest(' + (isEdit ? r.id : 'null') + ')"><i class="ti ti-check"></i> Сохранить</button></div>'
          : '') +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

async function saveSupplyRequest(requestId) {
  // v2.45.34: только component_id (наша номенклатура); item_id больше не шлём
  const compEl = document.getElementById('sr-component');
  const component_id = compEl ? (parseInt(compEl.value || '0') || null) : null;
  const payload = {
    qty:       parseFloat(document.getElementById('sr-qty').value || '0'),
    needed_by: document.getElementById('sr-needed-by').value || null,
    comment:   document.getElementById('sr-comment').value.trim(),
  };
  if (component_id) {
    payload.component_id = component_id;
  } else if (!requestId) {
    // create-form: позиция обязательна
    showToast('Выбери комплектующее', 'error'); return;
  }
  if (!payload.qty || payload.qty <= 0) { showToast('Укажите количество', 'error'); return; }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const url = requestId ? '/api/supply-requests/' + requestId : '/api/supply-requests';
    const method = requestId ? 'PATCH' : 'POST';
    const r = await fetch(API_BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось', 'error');
      return;
    }
    showToast(requestId ? 'Сохранено' : 'Заявка создана', 'success');
    closeSupplyModal();
    cache.supplyRequests = null;
    if (state.currentScreen === 'supply-requests') loadSupplyRequests();
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

async function deleteSupplyRequest(rid) {
  if (!confirm('Удалить эту заявку?')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-requests/' + rid, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) { showToast('Не удалось', 'error'); return; }
    showToast('Удалено', 'success');
    cache.supplyRequests = null;
    if (state.currentScreen === 'supply-requests') loadSupplyRequests();
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

function openContractFromSupply(contractId) {
  if (!contractId) return;
  state.currentContractId = contractId;
  selectSection('sales');
  selectSidebarItem('sales-contract-detail');
}

// ========== ЗАКАЗЫ (список) ==========

async function loadSupplyOrders() {
  const container = document.getElementById('sup-ord-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-block">Загружаем заказы…</div>';
  try {
    const params = new URLSearchParams();
    if (state.supplyOrdFilter !== 'all') params.set('status', state.supplyOrdFilter);
    const d = await apiGet('/api/supply-orders' + (params.toString() ? '?' + params.toString() : ''));
    cache.supplyOrders = d.orders || [];
    cache.supplyOrdersCounts = d.counts || {};
    _renderSupplyOrdTabCounts();
    renderSupplyOrders();
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

// v2.45.5: множественный выбор заказов для удаления одним действием.
state.supplyOrdersSelected = state.supplyOrdersSelected || new Set();

// v2.45.151: бейджи-счётчики на вкладках статусов заказов
function _renderSupplyOrdTabCounts() {
  const counts = cache.supplyOrdersCounts || {};
  document.querySelectorAll('[data-sup-ord]').forEach(btn => {
    const key = btn.getAttribute('data-sup-ord');
    const n = Number(counts[key] || 0);
    let badge = btn.querySelector('.sup-ord-tab-count');
    if (n > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'sup-ord-tab-count';
        btn.appendChild(badge);
      }
      badge.textContent = n;
    } else if (badge) {
      badge.remove();
    }
  });
}

function renderSupplyOrders() {
  const container = document.getElementById('sup-ord-list');
  const list = cache.supplyOrders || [];
  if (typeof _renderSupplyOrdDesc === 'function') _renderSupplyOrdDesc();  // v2.45.615: пояснение к разделу
  document.getElementById('sup-ord-counter').textContent = list.length;
  // Подчистим выбранные id, которых уже нет в текущем списке
  const visibleIds = new Set(list.map(o => o.id));
  Array.from(state.supplyOrdersSelected).forEach(id => {
    if (!visibleIds.has(id)) state.supplyOrdersSelected.delete(id);
  });

  if (!list.length) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-file-invoice"></i>Под этот фильтр заказов нет</div>';
    _renderSupplyOrdersActionBar();
    return;
  }
  const canDelete = canManageSupply();

  let html = '';
  // Шапка-выделить-всё
  if (canDelete) {
    const allChecked = list.length > 0 && state.supplyOrdersSelected.size === list.length;
    html += '<div class="sup-ord-head">' +
      '<label class="sup-check-wrap" title="Выделить все" onclick="event.stopPropagation();">' +
        '<input type="checkbox" id="sup-ord-check-all" ' + (allChecked ? 'checked' : '') +
          ' onchange="toggleAllSupplyOrders(this.checked)">' +
        '<span class="sup-check-box"></span>' +
      '</label>' +
      '<span class="sup-ord-head-hint">Отметь заказы — кнопка «Удалить выбранные» появится снизу</span>' +
    '</div>';
  }

  list.forEach(o => {
    // v2.45.607: у заказов «на оплату» позиций часто нет (total_amount=0),
    // но сумма к оплате есть в распознанном счёте → берём invoice_total как фолбэк.
    const totalNum = o.total_amount || o.invoice_total || 0;
    const total = totalNum ? Math.round(totalNum).toLocaleString('ru-RU') + ' ₽' : '';
    const label = o.order_label || ('#' + o.id);
    const hasNew = !!o.has_new_invoice;
    const hasInvoice = !!o.invoice_file_key;
    const isSel = state.supplyOrdersSelected.has(o.id);
    const entColor = _entityBorderColor(o.invoice_payer_tag);
    let rowStyle = '';
    if (isSel) {
      rowStyle = 'style="border-color:#2563EB;background:rgba(37,99,235,0.05);"';
    } else if (hasNew) {
      rowStyle = 'style="border-left:4px solid #2563EB;background:linear-gradient(90deg,rgba(37,99,235,0.06),transparent 50%);"';
    } else if (entColor) {
      rowStyle = 'style="border-left:4px solid ' + entColor + ';"';
    }
    const newPill = hasNew
      ? '<span class="sup-status-pill" style="background:linear-gradient(135deg,#2563EB,#7C3AED);color:#fff;font-weight:600;">📄 НОВЫЙ СЧЁТ</span>'
      : (hasInvoice
          ? '<span class="sup-status-pill" style="background:#E0E7FF;color:#3730A3;"><i class="ti ti-file-check"></i> счёт привязан</span>'
          : '');

    const itemsWord = (typeof _plural === 'function') ? _plural(o.items_count, ['позиция', 'позиции', 'позиций']) : 'позиций';
    html += '<div class="sup-row sup-ord-card" ' + rowStyle + ' onclick="openSupplyOrder(' + o.id + ')">';
    if (canDelete) {
      html += '<label class="sup-check-wrap" onclick="event.stopPropagation();">' +
        '<input type="checkbox" ' + (isSel ? 'checked' : '') +
          ' onchange="toggleSupplyOrderSelected(' + o.id + ', this.checked)">' +
        '<span class="sup-check-box"></span>' +
      '</label>';
    }
    html += '<div class="sup-row-icon"><i class="ti ti-file-invoice"></i></div>' +
      '<div class="sup-row-body">' +
        // v2.45.288: ORD-N — компактным чипом слева, имя поставщика — основным заголовком
        '<div class="sup-row-title">' +
          '<span class="sup-ord-label">' + escapeHtml(label) + '</span>' +
          '<span class="sup-ord-supplier">' + escapeHtml(o.supplier_name || '—') + '</span>' +
        '</div>' +
        '<div class="sup-row-meta">' +
          '<span class="sup-status-pill ord-' + o.status + '">' + escapeHtml(o.status_label) + '</span>' +
          newPill +
          payerEntityPill({ tag: o.invoice_payer_tag, short_name: o.invoice_payer_name }, false) +
          '<span class="sup-ord-meta-num"><i class="ti ti-list"></i>' + o.items_count + ' ' + itemsWord + '</span>' +
          (total ? '<span class="sup-ord-meta-num"><i class="ti ti-currency-rubel"></i>' + total + '</span>' : '') +
          (o.expected_date ? '<span class="sup-ord-meta-num"><i class="ti ti-calendar"></i>' + escapeHtml(o.expected_date) + '</span>' : '') +
        '</div>' +
      '</div>' +
      (canDelete
        ? '<button class="sup-row-delete" title="Удалить заказ" onclick="event.stopPropagation();deleteSupplyOrder(' + o.id + ',\'' + escapeHtml(label) + '\')"><i class="ti ti-trash"></i></button>'
        : '') +
    '</div>';
  });
  container.innerHTML = html;
  _renderSupplyOrdersActionBar();
}

function toggleSupplyOrderSelected(id, checked) {
  if (checked) state.supplyOrdersSelected.add(id);
  else state.supplyOrdersSelected.delete(id);
  _renderSupplyOrdersActionBar();
  // Подсветить/снять подсветку строки
  renderSupplyOrders();
}

function toggleAllSupplyOrders(checked) {
  const list = cache.supplyOrders || [];
  if (checked) {
    list.forEach(o => state.supplyOrdersSelected.add(o.id));
  } else {
    state.supplyOrdersSelected.clear();
  }
  renderSupplyOrders();
}

function _renderSupplyOrdersActionBar() {
  let bar = document.getElementById('sup-ord-action-bar');
  const count = state.supplyOrdersSelected.size;
  if (count === 0) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'sup-ord-action-bar';
    bar.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);' +
      'background:linear-gradient(135deg,#2563EB,#7C3AED);color:#fff;border-radius:14px;' +
      'padding:10px 16px;display:flex;align-items:center;gap:12px;' +
      'box-shadow:0 8px 24px rgba(37,99,235,0.3);z-index:9999;max-width:92vw;';
    document.body.appendChild(bar);
  }
  bar.innerHTML =
    '<span style="font-weight:600;font-size:14px;">Выбрано: ' + count + '</span>' +
    '<button class="btn btn-secondary" style="background:rgba(255,255,255,0.15);color:#fff;border-color:rgba(255,255,255,0.3);" onclick="clearSupplyOrdersSelection()">Снять</button>' +
    '<button class="btn btn-primary" style="background:#fff;color:#B91C1C;border-color:#fff;" onclick="bulkDeleteSupplyOrders()"><i class="ti ti-trash"></i> Удалить выбранные</button>';
}

function clearSupplyOrdersSelection() {
  state.supplyOrdersSelected.clear();
  renderSupplyOrders();
}

async function bulkDeleteSupplyOrders() {
  const ids = Array.from(state.supplyOrdersSelected);
  if (!ids.length) return;
  if (!confirm('Удалить выбранные заказы (' + ids.length + ')?\n\nЗаказы будут скрыты из списков. Привязанные счета и история переписки сохранятся. Позиции договоров вернутся в «К заказу».')) return;
  // v2.45.258: удаление — под пароль
  if (typeof _satPromptPassword === 'function') {
    const ok = await _satPromptPassword();
    if (!ok) return;
  }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-orders/bulk-delete', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (r.status === 401 || r.status === 403) {
      showToast('Сессия истекла — обнови страницу (F5) и попробуй снова', 'error');
      return;
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showToast(j.message || ('Не удалось удалить (HTTP ' + r.status + ')'), 'error');
      return;
    }
    const j = await r.json();
    showToast('Удалено: ' + (j.count || 0) + (j.failed && j.failed.length ? ' (ошибок: ' + j.failed.length + ')' : ''), 'success');
    state.supplyOrdersSelected.clear();
    cache.supplyOrders = null;
    loadSupplyOrders();
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

async function deleteSupplyOrder(orderId, label) {
  if (!confirm('Удалить заказ ' + label + '?\n\nЗаказ будет скрыт из списков. Привязанные счета и история переписки сохранятся. Позиции договоров по этому заказу вернутся в «К заказу».')) return;
  // v2.45.258: удаление заказа — под пароль (тот же, что вход в CRM)
  if (typeof _satPromptPassword === 'function') {
    const ok = await _satPromptPassword();
    if (!ok) return;
  }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-orders/' + orderId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (r.status === 401 || r.status === 403) {
      showToast('Сессия истекла — обнови страницу (F5) и попробуй снова', 'error');
      return;
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showToast(j.message || ('Не удалось удалить (HTTP ' + r.status + ')'), 'error');
      return;
    }
    showToast('Заказ ' + label + ' удалён', 'success');
    cache.supplyOrders = null;
    loadSupplyOrders();
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

// v2.45.615: пояснение к каждому статусу-разделу заказов поставщикам —
// что это за раздел и почему заказ сюда попал. Один источник и для строки-описания
// под фильтрами, и для всплывающих подсказок (title) на самих чипах.
const SUP_ORD_DESC = {
  open:             'В работе — активные заказы в процессе: черновики, отправленные, ждущие счёт, оплату или поставку. Без оплаченных и полностью полученных.',
  draft:            'Черновик — заказ создан, но ещё не отправлен поставщику. Дополняете позициями и отправляете.',
  sent:             'Отправлен — заказ ушёл поставщику, ждём ответ и счёт на оплату.',
  awaiting_invoice: 'Ждут счёт — заказ отправлен, ждём от поставщика счёт, чтобы поставить на оплату.',
  invoice_received: 'Счёт пришёл — поставщик прислал счёт, его можно отправлять на оплату.',
  to_pay:           'К оплате — счёт привязан и готов к оплате: очередь бухгалтеру. Тот же список открывает раздел «На оплату» слева.',
  paid:             'Оплачены — счёт оплачен, ждём поставку от поставщика.',
  partial:          'Частично — пришла часть позиций заказа, ждём остаток.',
  received:         'Получены — заказ полностью поставлен и оприходован на склад.',
  all:              'Все — все заказы поставщикам, в любом статусе.',
};

function _renderSupplyOrdDesc() {
  const f = state.supplyOrdFilter || 'open';
  const text = SUP_ORD_DESC[f] || '';
  const el = document.getElementById('sup-ord-desc');
  if (el) {
    el.innerHTML = text ? '<i class="ti ti-info-circle"></i> ' + escapeHtml(text) : '';
    el.style.display = text ? '' : 'none';
  }
  // Всплывающая подсказка на каждом чипе-статусе
  document.querySelectorAll('[data-sup-ord]').forEach(b => {
    const d = SUP_ORD_DESC[b.dataset.supOrd];
    if (d) b.title = d;
  });
}

function setSupplyOrdFilter(f) {
  state.supplyOrdFilter = f;
  document.querySelectorAll('[data-sup-ord]').forEach(b => b.classList.toggle('active', b.dataset.supOrd === f));
  _renderSupplyOrdDesc();
  loadSupplyOrders();
}

// ============ v2.45.265: ПРИЁМ УПД ИЗ 1С-ЭДО ============

// Выделение для массового удаления УПД из ЭДО
let _edoSel = new Set();

function _edoToggle(id, checked) {
  if (checked) _edoSel.add(id); else _edoSel.delete(id);
  // синхронизируем «Выбрать все»
  const all = document.querySelectorAll('#edo-upd-list .edo-cb');
  const selAll = document.getElementById('edo-selall-cb');
  if (selAll) selAll.checked = all.length > 0 && _edoSel.size === all.length;
  _edoUpdateBar();
}

function _edoToggleAll(checked) {
  _edoSel = new Set();
  document.querySelectorAll('#edo-upd-list .edo-cb').forEach(cb => {
    cb.checked = checked;
    if (checked) _edoSel.add(parseInt(cb.getAttribute('data-id'), 10));
  });
  _edoUpdateBar();
}

function _edoUpdateBar() {
  const cnt = document.getElementById('edo-sel-count');
  const btn = document.getElementById('edo-del-btn');
  const n = _edoSel.size;
  if (cnt) cnt.textContent = n ? ('Выбрано: ' + n) : '';
  if (btn) btn.disabled = !n;
}

async function _edoDeleteSelected() {
  const ids = Array.from(_edoSel);
  if (!ids.length) return;
  if (!confirm('Удалить выбранные документы (' + ids.length + ')?\nОни исчезнут из списка приёма УПД.')) return;
  try {
    const r = await apiPost('/api/edo/upd/delete', { ids });
    if (r.ok) {
      showToast('Удалено: ' + ((r.data && r.data.deleted) || ids.length), 'success');
      _edoSel = new Set();
      loadEdoUpd();
    } else {
      showToast((r.data && r.data.message) || 'Не удалось удалить', 'error');
    }
  } catch (e) { showToast('Ошибка', 'error'); }
}

// v2.45.x: «Приём УПД от ЭДО» — группировка (нужно оприходовать / в приёмке) + карточки
function _edoKpi(cls, emoji, num, lbl) {
  return '<div class="edo-kpi ' + cls + '"><div class="edo-kpi-ic"><span class="em">' + emoji + '</span></div>' +
    '<div><div class="edo-kpi-num">' + num + '</div><div class="edo-kpi-lbl">' + escapeHtml(lbl) + '</div></div></div>';
}
function _edoSec(emoji, title, count) {
  return '<div class="edo-sec"><span class="em">' + emoji + '</span> ' + escapeHtml(title) + ' <span class="cnt">' + count + '</span></div>';
}
function _edoInitials(name) {
  return (typeof _updSupInitials === 'function') ? _updSupInitials(name) : (typeof _supInitials === 'function' ? _supInitials(name) : '—');
}
function _edoCard(u, inIntake) {
  const total = (u.total_with_vat != null && Number(u.total_with_vat) > 0)
    ? Number(u.total_with_vat).toLocaleString('ru-RU', { minimumFractionDigits: 2 }) : '';
  const num = 'УПД № ' + escapeHtml(u.number || 'б/н') + (u.doc_date ? ' от ' + escapeHtml(_edoDateRu(u.doc_date)) : '');
  const supplier = u.seller_name || '—';
  const ava = '<div class="edo-ava">' + escapeHtml(_edoInitials(supplier)) + '</div>';
  const typeChip = u.function ? '<span class="edo-chip type">' + escapeHtml(u.function) + '</span>' : '';
  const linkChip = u.matched_order_id
    ? '<span class="edo-chip link"><span class="em">✅</span> привязан → ' + escapeHtml(u.order_label || ('#' + u.matched_order_id)) + '</span>'
    : '<span class="edo-chip nolink"><span class="em">🔗</span> не привязан</span>';
  const intakeChip = inIntake ? '<span class="edo-chip intake"><span class="em">📦</span> в приёмке</span>' : '';
  const subParts = ['<b>' + escapeHtml(supplier) + '</b>'];
  if (u.seller_inn) subParts.push('ИНН ' + escapeHtml(u.seller_inn));
  let acts;
  if (inIntake) {
    acts = '<button class="btn" onclick="event.stopPropagation();selectSidebarItem(\'supply-invoice-intake\')"><span class="em">➡</span> Открыть приёмку</button>';
  } else {
    acts = '<button class="btn btn-primary" onclick="event.stopPropagation();edoUpdToIntake(' + u.id + ')"><span class="em">📦</span> Оприходовать</button>';
    if (!u.matched_order_id) acts += '<button class="btn edo-link-btn" onclick="event.stopPropagation();openEdoUpdOrderPicker(' + u.id + ')"><span class="em">🔗</span> Привязать</button>';
  }
  acts += '<button class="btn edo-icon" title="Открыть карточку" onclick="event.stopPropagation();openEdoUpdDetail(' + u.id + ')"><span class="em">👁</span></button>';
  return '<div class="edo-upd' + (inIntake ? ' ok' : '') + '" onclick="openEdoUpdDetail(' + u.id + ')">' +
    '<input type="checkbox" class="edo-cb" data-id="' + u.id + '" title="Выбрать" onclick="event.stopPropagation();_edoToggle(' + u.id + ',this.checked)">' +
    ava +
    '<div class="edo-body">' +
      '<div class="edo-top"><span class="edo-num">' + num + '</span>' + typeChip + intakeChip + linkChip + '</div>' +
      '<div class="edo-sub">' + subParts.join(' · ') + '</div>' +
    '</div>' +
    (total ? '<div class="edo-sum">' + total + ' ₽<small>с НДС</small></div>' : '') +
    '<div class="edo-acts">' + acts + '</div>' +
  '</div>';
}
function toggleEdoV2() {
  window.EDO_V2 = !window.EDO_V2;
  try { localStorage.setItem('edoV2', window.EDO_V2 ? '1' : '0'); } catch (_) {}
  loadEdoUpd();
}

async function loadEdoUpd() {
  const box = document.getElementById('edo-upd-list');
  if (!box) return;
  box.innerHTML = '<div class="loading-block">Загружаем УПД из ЭДО…</div>';
  try {
    const d = await apiGet('/api/edo/upd');
    const items = d.items || [];
    const counter = document.getElementById('edo-upd-counter');
    if (counter) counter.textContent = items.length;
    const badge = document.getElementById('edo-upd-badge');
    const fresh = items.filter(u => u.status === 'new').length;
    if (badge) {
      badge.textContent = fresh;
      badge.style.display = fresh ? '' : 'none';
    }
    window.EDO_V2 = localStorage.getItem('edoV2') !== '0';
    if (!items.length) {
      box.innerHTML = '<div class="empty-block"><i class="ti ti-cloud-download"></i>УПД из ЭДО пока не приходили.<br>' +
        '<span style="font-size:12px;color:var(--text-light);">Как только 1С отправит документ — он появится здесь и придёт пуш.</span></div>';
      return;
    }
    _edoSel = new Set();   // сброс выделения при каждой загрузке списка
    const bulkBar = '<div class="edo-bulkbar">' +
        '<label class="edo-selall"><input type="checkbox" id="edo-selall-cb" onclick="_edoToggleAll(this.checked)"> Выбрать все</label>' +
        '<span class="edo-sel-count" id="edo-sel-count"></span>' +
        '<button class="btn btn-small edo-del-btn" id="edo-del-btn" onclick="_edoDeleteSelected()" disabled>' +
          '<i class="ti ti-trash"></i> Удалить выбранные</button>' +
      '</div>';
    const toggle = '<div class="sv2-toggle-bar">' +
        '<span><i class="ti ti-' + (window.EDO_V2 ? 'sparkles' : 'history') + '"></i> ' + (window.EDO_V2 ? 'Новый вид' : 'Старый вид') + '</span>' +
        '<button class="sv2-toggle-btn" onclick="toggleEdoV2()">' + (window.EDO_V2 ? 'Вернуть старый' : 'Включить новый') + '</button>' +
      '</div>';
    if (!window.EDO_V2) { box.innerHTML = toggle + bulkBar + _renderEdoOld(items); _edoUpdateBar(); return; }
    // Группировка: ещё не в приёмке (нужно оприходовать) / уже в приёмке
    const need = [], inIntake = [];
    items.forEach(u => { (u.intake_invoice_id ? inIntake : need).push(u); });
    const noLink = items.filter(u => !u.matched_order_id).length;
    let html = toggle + bulkBar;
    html += '<div class="edo-kpis">' +
      _edoKpi('act', '📥', need.length, 'Нужно оприходовать') +
      _edoKpi('link', '🔗', noLink, 'Не привязаны к заказу') +
      _edoKpi('ok', '📦', inIntake.length, 'В приёмке') +
      _edoKpi('tot', '📄', items.length, 'Всего за период') +
    '</div>';
    if (need.length) {
      html += _edoSec('📥', 'Нужно оприходовать', need.length) +
        '<div class="edo-hint">Документы из ЭДО, ещё не отправленные на склад. Привяжи к заказу и оприходуй.</div>';
      need.forEach(u => { html += _edoCard(u, false); });
    }
    if (inIntake.length) {
      html += _edoSec('📦', 'В приёмке', inIntake.length) +
        '<div class="edo-hint">Уже отправлены в «Приёмку УПД» — оприходование идёт там.</div>';
      inIntake.forEach(u => { html += _edoCard(u, true); });
    }
    box.innerHTML = html;
    _edoUpdateBar();
  } catch (e) {
    box.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e && e.message || e)) + '</div>';
  }
}

// Старый вид (для отката) — прежний плоский список
function _renderEdoOld(items) {
  return items.map(u => {
    const total = u.total_with_vat
      ? Number(u.total_with_vat).toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + ' ₽' : '';
    const st = u.matched_order_id
      ? '<span style="font-size:11px;font-weight:700;color:#065F46;background:#D1FAE5;padding:1px 8px;border-radius:6px;">Привязан ' + escapeHtml(u.order_label || ('#' + u.matched_order_id)) + '</span>'
      : '<span style="font-size:11px;font-weight:700;color:#7F1D1D;background:#FEE2E2;padding:1px 8px;border-radius:6px;">Не привязан</span>';
    const intakeBadge = u.intake_invoice_id
      ? ' <span style="font-size:11px;font-weight:700;color:#1E40AF;background:#DBEAFE;padding:1px 8px;border-radius:6px;"><i class="ti ti-package-import" style="font-size:11px;"></i> В приёмке</span>'
      : '';
    return '<div class="sup-row edo-row" onclick="openEdoUpdDetail(' + u.id + ')" style="cursor:pointer;">' +
      '<input type="checkbox" class="edo-cb" data-id="' + u.id + '" title="Выбрать" onclick="event.stopPropagation();_edoToggle(' + u.id + ',this.checked)">' +
      '<div class="sup-row-icon"><i class="ti ti-file-text"></i></div>' +
      '<div class="sup-row-body">' +
        '<div class="sup-row-title">УПД № ' + escapeHtml(u.number || 'б/н') +
          (u.doc_date ? ' от ' + escapeHtml(_edoDateRu(u.doc_date)) : '') + '</div>' +
        '<div class="sup-row-meta" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
          '<span>' + escapeHtml(u.seller_name || '—') + '</span>' +
          (total ? '<span style="font-weight:700;color:var(--text-dark);">' + total + '</span>' : '') +
          (u.function ? '<span style="color:var(--text-light);">' + escapeHtml(u.function) + '</span>' : '') +
          st + intakeBadge +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function _edoDateRu(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[3] + '.' + m[2] + '.' + m[1]) : String(iso || '');
}

async function openEdoUpdDetail(updId) {
  let u;
  try {
    u = await apiGet('/api/edo/upd/' + updId);
  } catch (e) { showToast('Не удалось загрузить УПД', 'error'); return; }
  let m = document.getElementById('edo-upd-modal');
  if (m) m.remove();
  m = document.createElement('div');
  m.id = 'edo-upd-modal';
  m.className = 'modal-overlay visible';
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  const total = u.total_with_vat ? Number(u.total_with_vat).toLocaleString('ru-RU', { minimumFractionDigits: 2 }) : '';
  const rows = (u.items || []).map((it, i) =>
    '<tr><td style="text-align:right;color:var(--text-light);">' + (i + 1) + '</td>' +
    '<td>' + escapeHtml(it.name || '—') + '</td>' +
    '<td style="text-align:right;">' + (it.qty !== null && it.qty !== undefined ? it.qty : '') + ' ' + escapeHtml(it.unit || '') + '</td>' +
    '<td style="text-align:right;">' + (it.price !== null && it.price !== undefined ? Number(it.price).toLocaleString('ru-RU') : '') + '</td>' +
    '<td style="text-align:right;font-weight:600;">' + (it.sum !== null && it.sum !== undefined ? Number(it.sum).toLocaleString('ru-RU') : '') + '</td></tr>'
  ).join('');
  const fileBtns = (u.files || []).map((f, i) =>
    '<button class="btn btn-secondary btn-small" onclick="downloadEdoUpdFile(' + u.id + ',' + i + ')">' +
      '<i class="ti ti-download"></i> ' + escapeHtml(f.name || ('файл ' + (i + 1))) + '</button>'
  ).join(' ');
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:760px;max-height:92vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-file-text"></i> УПД № ' + escapeHtml(u.number || 'б/н') + (u.doc_date ? ' от ' + escapeHtml(_edoDateRu(u.doc_date)) : '') + '</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'edo-upd-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content" style="overflow-y:auto;">' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;font-size:13px;">' +
          '<span><b>' + escapeHtml(u.seller_name || '—') + '</b>' + (u.seller_inn ? ' · ИНН ' + escapeHtml(u.seller_inn) : '') + '</span>' +
          (u.function ? '<span style="color:var(--text-light);">' + escapeHtml(u.function) + '</span>' : '') +
          (total ? '<span style="font-weight:700;">' + total + ' ₽</span>' : '') +
        '</div>' +
        (u.linked_doc ? '<div style="font-size:12px;color:var(--text-light);margin-bottom:8px;">1С: ' + escapeHtml(u.linked_doc) + '</div>' : '') +
        '<div style="margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">' +
          (u.matched_order_id
            ? '<span style="font-size:12px;font-weight:700;color:#065F46;background:#D1FAE5;padding:2px 10px;border-radius:6px;">Привязан к заказу ' + escapeHtml(u.order_label || ('#' + u.matched_order_id)) + '</span> ' +
              '<button class="btn btn-secondary btn-small" onclick="state.currentSupplyOrderId=' + u.matched_order_id + ';document.getElementById(\'edo-upd-modal\').remove();selectSidebarItem(\'supply-order-detail\');">Открыть заказ</button> ' +
              '<button class="btn btn-secondary btn-small" onclick="attachEdoUpd(' + u.id + ', null)">Отвязать</button>'
            : '<span style="font-size:12px;font-weight:700;color:#7F1D1D;background:#FEE2E2;padding:2px 10px;border-radius:6px;">Не привязан</span> ' +
              '<button class="btn btn-secondary btn-small" onclick="openEdoUpdOrderPicker(' + u.id + ')"><i class="ti ti-link"></i> Привязать к заказу</button>') +
          // v2.45.267: оприходование — в конвейер «Приёмка УПД» → склад
          (u.intake_invoice_id
            ? '<span style="font-size:12px;font-weight:700;color:#1E40AF;background:#DBEAFE;padding:2px 10px;border-radius:6px;">Отправлен в приёмку</span> ' +
              '<button class="btn btn-secondary btn-small" onclick="document.getElementById(\'edo-upd-modal\').remove();selectSidebarItem(\'supply-invoice-intake\');"><i class="ti ti-arrow-right"></i> Открыть приёмку</button>'
            : '<button class="btn btn-primary btn-small" id="edo-intake-btn-' + u.id + '" onclick="edoUpdToIntake(' + u.id + ')"><i class="ti ti-package-import"></i> Оприходовать (на склад)</button>') +
        '</div>' +
        (rows
          ? '<div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;font-size:12.5px;" class="xls-tbl">' +
              '<tr style="font-weight:700;background:var(--bg);"><td>№</td><td>Наименование</td><td style="text-align:right;">Кол-во</td><td style="text-align:right;">Цена</td><td style="text-align:right;">Сумма</td></tr>' +
              rows +
            '</table></div>'
          : '<div class="empty-block" style="padding:18px;">Строк из XML не извлеклось</div>') +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">' + fileBtns + '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
}

async function downloadEdoUpdFile(updId, idx) {
  try {
    const r = await fetch(API_BASE + '/api/edo/upd/' + updId + '/file/' + idx, {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!r.ok) { showToast('Файл не найден', 'error'); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cd = r.headers.get('Content-Disposition') || '';
    const mm = cd.match(/filename="?([^";]+)"?/);
    a.href = url; a.download = mm ? mm[1] : 'upd.bin';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { showToast('Сеть: ' + (e.message || e), 'error'); }
}

async function openEdoUpdOrderPicker(updId) {
  let orders = [];
  try {
    const d = await apiGet('/api/supply-orders?status=open');
    orders = d.orders || d.items || [];
  } catch (e) { orders = []; }
  if (!orders.length) {
    try {
      const d2 = await apiGet('/api/supply-orders');
      orders = d2.orders || d2.items || [];
    } catch (e) {}
  }
  let m = document.getElementById('edo-upd-pick-modal');
  if (m) m.remove();
  m = document.createElement('div');
  m.id = 'edo-upd-pick-modal';
  m.className = 'modal-overlay visible';
  m.style.zIndex = '10001';
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  m.innerHTML =
    '<div class="modal" onclick="event.stopPropagation()" style="max-width:520px;max-height:85vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header"><h3><i class="ti ti-link"></i> К какому заказу привязать?</h3>' +
        '<button class="modal-close" onclick="document.getElementById(\'edo-upd-pick-modal\').remove()"><i class="ti ti-x"></i></button></div>' +
      '<div class="modal-body" style="overflow-y:auto;">' +
        (orders.length ? orders.map(o =>
          '<div class="modal-item" onclick="attachEdoUpd(' + updId + ',' + o.id + ')">' +
            '<div class="mi-icon"><i class="ti ti-file-invoice"></i></div>' +
            '<div class="mi-text"><div class="mi-title">' + escapeHtml(o.order_label || ('#' + o.id)) + ' · ' + escapeHtml(o.supplier_name || '—') + '</div>' +
              '<div class="mi-meta">' + escapeHtml(o.status_label || o.status || '') + (o.total_amount ? ' · ' + Math.round(o.total_amount).toLocaleString('ru-RU') + ' ₽' : '') + '</div>' +
            '</div></div>'
        ).join('') : '<div class="empty-block">Заказов нет</div>') +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
}

// v2.45.267: оприходовать УПД из ЭДО — создаёт приёмку (конвейер «Приёмка УПД»),
// дальше обычный путь: проверка сопоставления → подтверждение → приход на склад
async function edoUpdToIntake(updId) {
  if (!confirm('Оприходовать УПД?\n\nПозиции уйдут в «Приёмку УПД»: система сопоставит их с номенклатурой, после твоего подтверждения комплектующие лягут на склад.')) return;
  const btn = document.getElementById('edo-intake-btn-' + updId);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Создаём приёмку…'; }
  try {
    const r = await fetch(API_BASE + '/api/edo/upd/' + updId + '/to-intake', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(j.message || 'Не удалось создать приёмку', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-package-import"></i> Оприходовать (на склад)'; }
      return;
    }
    showToast('Приёмка создана — сопоставляем номенклатуру…', 'success');
    const dm = document.getElementById('edo-upd-modal');
    if (dm) dm.remove();
    loadEdoUpd();
    selectSidebarItem('supply-invoice-intake');
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-package-import"></i> Оприходовать (на склад)'; }
  }
}

async function attachEdoUpd(updId, orderId) {
  try {
    const r = await fetch(API_BASE + '/api/edo/upd/' + updId + '/attach', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''), 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showToast(j.message || 'Не удалось', 'error');
      return;
    }
    showToast(orderId ? 'УПД привязан к заказу' : 'УПД отвязан', 'success');
    const pm = document.getElementById('edo-upd-pick-modal');
    if (pm) pm.remove();
    const dm = document.getElementById('edo-upd-modal');
    if (dm) dm.remove();
    loadEdoUpd();
    openEdoUpdDetail(updId);
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

// ============ ЭТАП 52.3 (v2.45.0): ВХОДЯЩИЕ СЧЕТА (IMAP) ============

state.supplyInboxFilter = state.supplyInboxFilter || 'unmatched';

async function loadSupplyInbox() {
  const list = document.getElementById('sup-inbox-list');
  const counter = document.getElementById('sup-inbox-counter');
  if (!list) return;
  list.innerHTML = '<div class="loading-block">Загружаем входящие письма…</div>';
  const filter = state.supplyInboxFilter || 'unmatched';
  try {
    // Параллельно тянем список + статус робота
    const [d, st] = await Promise.all([
      apiGet('/api/supply-inbox?status=' + encodeURIComponent(filter)),
      apiGet('/api/supply-inbox/status').catch(() => null),
    ]);
    cache.supplyInbox = d.items || [];
    cache.supplyInboxStatus = st || null;
    if (counter) counter.textContent = cache.supplyInbox.length;
    // Бейдж "новые счета" на вкладке "Привязаны"
    const matchedBadge = document.getElementById('sup-inbox-matched-badge');
    const newCnt = (st && st.new_matched_count) || 0;
    if (matchedBadge) {
      if (newCnt > 0) {
        matchedBadge.textContent = newCnt;
        matchedBadge.style.display = '';
      } else {
        matchedBadge.style.display = 'none';
      }
    }
    renderSupplyInbox();
    refreshSupplyInboxBadge();
    // Если зашли на вкладку "Привязаны" — гасим "новые" бейджи на бэке
    // (бейдж в шапке экрана + в сайдбаре пересчитаются при следующей загрузке)
    if (filter === 'matched' && newCnt > 0) {
      fetch(API_BASE + '/api/supply-inbox/mark-viewed', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
      }).catch(() => {});
    }
  } catch (e) {
    list.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Не удалось загрузить (' + escapeHtml(String(e.message || e)) + ')</div>';
  }
}

function _supplyInboxStatusHTML() {
  const st = cache.supplyInboxStatus;
  if (!st || !st.state) return '';
  const s = st.state;
  const cfg = st.config || {};
  // Не настроен — красная панель с инструкцией
  if (!s.configured) {
    return '<div style="background:#FEE2E2;border:1px solid #FCA5A5;color:#7F1D1D;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<i class="ti ti-alert-triangle" style="font-size:18px;"></i>' +
      '<div>IMAP-робот не настроен. Добавь в Railway переменные <b>IMAP_USER</b> и <b>IMAP_PASSWORD</b>.</div>' +
    '</div>';
  }
  let icon, color, bg, border;
  if (s.ok === true) {
    icon = 'ti-check'; color = '#0A5B41'; bg = 'rgba(34,197,94,0.08)'; border = 'rgba(34,197,94,0.25)';
  } else if (s.ok === false) {
    icon = 'ti-alert-triangle'; color = '#7F1D1D'; bg = '#FEE2E2'; border = '#FCA5A5';
  } else {
    icon = 'ti-loader'; color = 'var(--text-mid)'; bg = 'var(--bg)'; border = 'var(--border)';
  }
  let line2;
  if (s.ok === false) {
    line2 = 'Этап «' + escapeHtml(s.stage || 'unknown') + '»: ' + escapeHtml(s.error || 'неизвестная ошибка');
  } else if (s.ok === true) {
    const parts = [];
    parts.push('Найдено в ящике: ' + (s.found_uids || 0));
    parts.push('обработано новых: ' + (s.new_processed || 0));
    if (s.matched)   parts.push('привязано к заказам: ' + s.matched);
    if (s.unmatched) parts.push('требуют привязки: ' + s.unmatched);
    if (s.ignored)   parts.push('служебных: ' + s.ignored);
    if (s.errors)    parts.push('ошибок: ' + s.errors);
    line2 = parts.join(' · ');
  } else {
    line2 = 'Робот ещё не запускался — подождите ' + (cfg.interval_sec || 60) + ' секунд или нажмите «Проверить»';
  }
  const ts = s.at ? escapeHtml(String(s.at).replace('T', ' ').substring(0, 16)) : '—';
  return '<div style="background:' + bg + ';border:1px solid ' + border + ';color:' + color + ';border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px;display:flex;align-items:flex-start;gap:10px;">' +
    '<i class="ti ' + icon + '" style="font-size:18px;flex-shrink:0;margin-top:1px;"></i>' +
    '<div style="flex:1;min-width:0;">' +
      '<div style="font-weight:600;">Последняя проверка: ' + ts +
        ' <span style="font-weight:400;opacity:0.8;">· сервер ' + escapeHtml(cfg.server || '?') + ', интервал ' + (cfg.interval_sec || 60) + 'с</span>' +
      '</div>' +
      '<div style="margin-top:2px;opacity:0.9;">' + line2 + '</div>' +
    '</div>' +
  '</div>';
}

async function refreshSupplyInboxBadge() {
  try {
    const d = await apiGet('/api/supply-inbox?status=unmatched');
    const cnt = (d.items || []).length;
    const badge = document.getElementById('supply-inbox-badge');
    if (badge) {
      if (cnt > 0) {
        badge.textContent = cnt;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (_) {}
}

// v2.45.607: цвет левой границы карточки по юрлицу-плательщику (АГ/ТД).
// Те же цвета, что у текста чипа payerEntityPill, чтобы граница и метка совпадали.
function _entityBorderColor(tag) {
  return tag === 'ТД' ? '#5B21B6' : (tag === 'АГ' ? '#3730A3' : '');
}

// Чип «наше юрлицо-плательщик» (АГ / ТД) — чтобы бухгалтер видел, на кого счёт.
// pe — объект {tag, short_name} (из ai_data.payer_entity) или {tag, short_name}
// собранный из полей заказа. withName=true показывает и название юрлица.
function payerEntityPill(pe, withName) {
  if (!pe) return '';
  const tag = (pe.tag || '').trim();
  if (!tag) return '';
  const name = pe.short_name || '';
  const isTD = tag === 'ТД';
  const bg = isTD ? '#EDE9FE' : '#E0E7FF';
  const fg = isTD ? '#5B21B6' : '#3730A3';
  const label = (withName && name) ? (tag + ' · ' + name) : tag;
  return '<span class="sup-status-pill" style="background:' + bg + ';color:' + fg +
    ';font-weight:700;" title="Счёт на наше юрлицо: ' + escapeHtml(name || tag) + '">🏢 ' +
    escapeHtml(label) + '</span>';
}

// Заметный бейдж «MAX» для счетов, пришедших через мессенджер MAX (а не почту).
// Источник бэкенд помечает from_addr="max:<id>" + folder="MAX" + ai_data.source="max".
function isFromMax(m) {
  m = m || {};
  return /^max:/i.test(m.from_addr || '') || m.folder === 'MAX' ||
    ((m.ai_data || {}).source === 'max');
}
function maxSourcePill(m) {
  if (!isFromMax(m)) return '';
  return '<span class="sup-status-pill" style="background:linear-gradient(135deg,#6D28D9,#4F46E5);' +
    'color:#fff;font-weight:700;letter-spacing:.3px;box-shadow:0 1px 4px rgba(79,70,229,.45);" ' +
    'title="Счёт пришёл через мессенджер MAX"><i class="ti ti-message-2"></i> MAX</span>';
}

// Чип стадии ОПЛАТЫ привязанного заказа — чтобы во «Входящих» сразу было видно:
// Новый (счёт пришёл, ещё не на оплате) / На оплате / Оплачен.
function orderPayStatusPill(m) {
  if (!m || !m.matched_order_id) return '';
  var s = m.matched_order_status || '';
  var label, bg, fg, ic;
  if (s === 'paid' || s === 'received' || s === 'partial') { label = 'Оплачен'; bg = '#DCFCE7'; fg = '#166534'; ic = '✅'; }
  else if (s === 'to_pay') { label = 'На оплате'; bg = '#FFEDD5'; fg = '#C2410C'; ic = '💸'; }
  else if (s === 'cancelled') { label = 'Отменён'; bg = '#F1F5F9'; fg = '#64748B'; ic = '✖'; }
  else { label = 'Новый'; bg = '#DBEAFE'; fg = '#1E40AF'; ic = '🆕'; }
  return '<span class="sup-status-pill" style="background:' + bg + ';color:' + fg + ';font-weight:700;">' + ic + ' ' + label + '</span>';
}

// v2.45.x: документ-вложение (счёт) — pdf/excel/word/изображение; аудио/видео/архив — нет
function _inboxDocIndex(m) {
  const atts = (m && m.attachments) || [];
  for (let i = 0; i < atts.length; i++) {
    const n = String(atts[i].name || '').toLowerCase();
    if (/\.(pdf|xlsx?|docx?|odt|rtf|jpe?g|png|heic|heif|tiff?|bmp|webp)$/.test(n)) return i;
  }
  return -1;
}
function _inboxInitials(m) {
  const nm = (m.from_name || '').trim();
  if (nm) return _supInitials(nm);
  const addr = String(m.from_addr || '');
  const dom = (addr.split('@')[1] || addr).replace(/^www\./, '').split('.')[0];
  return _supInitials(dom || '?');
}
function _inboxAvatarHtml(m) {
  return '<div class="ibx-ava' + (isFromMax(m) ? ' max' : '') + '">' + escapeHtml(_inboxInitials(m)) + '</div>';
}
function _ibxDelBtn(m) {
  return (state.user && (state.user.roles || []).includes('director'))
    ? '<button class="btn ibx-icon" title="Удалить письмо" onclick="deleteInboxMessage(' + m.id + ')"><span class="em">🗑</span></button>'
    : '';
}
function _ibxSumCard(cls, emoji, num, lbl) {
  return '<div class="ibx-sum-card ' + cls + '"><div class="ibx-sum-ic"><span class="em">' + emoji + '</span></div>' +
    '<div><div class="ibx-sum-num">' + num + '</div><div class="ibx-sum-lbl">' + escapeHtml(lbl) + '</div></div></div>';
}
function _ibxSecTitle(emoji, title, count) {
  return '<div class="ibx-sec"><span class="em">' + emoji + '</span> ' + escapeHtml(title) + ' <span class="cnt">' + count + '</span></div>';
}

function _ibxInvoiceCard(m, isMatched) {
  const di = (m._docIdx != null) ? m._docIdx : _inboxDocIndex(m);
  const atts = m.attachments || [];
  const received = (m.received_at || '').replace('T', ' ').substring(0, 16);
  let chips = '';
  if (isMatched) {
    chips += '<span class="ibx-chip ok"><span class="em">✅</span> привязан → ' + escapeHtml(m.matched_order_label || ('#' + m.matched_order_id)) + '</span>';
    chips += orderPayStatusPill(m);
  } else {
    chips += '<span class="ibx-chip need"><span class="em">🔗</span> нужна привязка</span>';
  }
  chips += maxSourcePill(m);
  if (m.detected_label && !isMatched) chips += '<span class="ibx-chip ord">' + escapeHtml(m.detected_label) + '</span>';
  chips += payerEntityPill((m.ai_data || {}).payer_entity, false);
  let attBlock = '';
  if (di >= 0) {
    const a = atts[di];
    const kb = Math.round((a.size || 0) / 1024);
    const nm = escapeHtml(a.name || 'файл');
    attBlock = '<div class="ibx-att">' +
      '<div class="ibx-att-ic"><span class="em">📄</span></div>' +
      '<div class="ibx-att-name" title="' + nm + '">' + nm + '</div>' +
      '<div class="ibx-att-size">' + kb + ' КБ</div>' +
      '<button class="btn btn-sm" onclick="downloadInboxAttachmentDirect(' + m.id + ',' + di + ',null)"><span class="em">👁</span> Открыть</button>' +
    '</div>';
  } else if (isMatched && atts.length) {
    attBlock = '<div class="ibx-att-mini"><span class="em">📎</span> ' + atts.length + ' вложени' + (atts.length > 1 ? 'й' : 'е') + '</div>';
  }
  let acts = '';
  if (isMatched) {
    // v2.45.598: «Оплатить» прямо на карточке привязанного счёта — переводит
    // САМ заказ в «На оплату» (без задвоения: счёт уже привязан к этому заказу,
    // УПД потом его и закроет). Скрываем, если заказ уже оплачивается/оплачен/отменён.
    const _payable = m.matched_order_id &&
      ['to_pay', 'paid', 'received', 'partial', 'cancelled'].indexOf(m.matched_order_status || '') < 0;
    acts = (_payable
        ? '<button class="btn ibx-grow" style="background:#16a34a;border-color:#16a34a;color:#fff;" onclick="payInboxOrderToPay(' + m.matched_order_id + ',\'' + escapeHtml(m.matched_order_label || '').replace(/'/g, "\\'") + '\')"><span class="em">💳</span> Оплатить</button>'
        : '') +
      (m.matched_order_id ? '<button class="btn" onclick="openSupplyOrder(' + m.matched_order_id + ')"><span class="em">📦</span> Открыть заказ ' + escapeHtml(m.matched_order_label || '') + '</button>' : '') +
      '<button class="btn" onclick="openInboxMessage(' + m.id + ')"><span class="em">✉</span> Письмо</button>';
  } else {
    // v2.45.596: «На оплату» прямо на карточке (раньше — только внутри «Письмо»).
    // Создаёт позицию в разделе «На оплату» из распознанных реквизитов, минуя
    // привязку к заказу. Показываем только если есть документ-вложение (счёт).
    const payBtn = (di >= 0)
      ? '<button class="btn ibx-grow" style="background:#16a34a;border-color:#16a34a;color:#fff;" onclick="sendInboxToPay(' + m.id + ',null)"><span class="em">💳</span> На оплату</button>'
      : '';
    acts = '<button class="btn btn-primary ibx-grow" onclick="openAttachInboxToOrder(' + m.id + ')"><span class="em">🔗</span> Привязать к заказу</button>' +
      payBtn +
      '<button class="btn" onclick="openInboxMessage(' + m.id + ')"><span class="em">✉</span> Письмо</button>' +
      _ibxDelBtn(m);
  }
  const _cb = (state.user && (state.user.roles || []).includes('director'))
    ? '<input type="checkbox" class="ibx-cb" data-id="' + m.id + '" title="Выбрать" onclick="event.stopPropagation();_ibxToggle(' + m.id + ',this.checked)">'
    : '';
  return '<div class="ibx-card' + (isMatched ? ' matched' : '') + '"><div class="ibx-card-top">' +
    _cb +
    _inboxAvatarHtml(m) +
    '<div class="ibx-card-body">' +
      '<div class="ibx-chips">' + chips + '</div>' +
      '<div class="ibx-subj">' + escapeHtml(m.subject || '(без темы)') + '</div>' +
      '<div class="ibx-from">' + escapeHtml(m.from_name || m.from_addr || '—') + ' · ' + escapeHtml(received) + '</div>' +
      attBlock +
      '<div class="ibx-acts">' + acts + '</div>' +
    '</div>' +
  '</div></div>';
}

function _ibxNoiseRow(m) {
  const received = (m.received_at || '').replace('T', ' ').substring(0, 16);
  const atts = m.attachments || [];
  let reason = 'без вложений';
  if (atts.length) reason = 'вложение не документ';
  const ordChip = m.detected_label ? ' <span class="ibx-chip ord mini">' + escapeHtml(m.detected_label) + '</span>' : '';
  const ico = m.detected_label ? '📨' : (isFromMax(m) ? '💬' : '📢');
  const _cb = (state.user && (state.user.roles || []).includes('director'))
    ? '<input type="checkbox" class="ibx-cb" data-id="' + m.id + '" title="Выбрать" onclick="event.stopPropagation();_ibxToggle(' + m.id + ',this.checked)">'
    : '';
  return '<div class="ibx-noise">' +
    _cb +
    '<div class="ibx-noise-ava"><span class="em">' + ico + '</span></div>' +
    '<div class="ibx-noise-body">' +
      '<div class="ibx-noise-subj">' + escapeHtml(m.subject || '(без темы)') + ordChip + '</div>' +
      '<div class="ibx-noise-from">' + escapeHtml(m.from_name || m.from_addr || '—') + ' · ' + escapeHtml(received) + ' · ' + reason + '</div>' +
    '</div>' +
    '<div class="ibx-noise-acts"><button class="btn btn-sm" onclick="openInboxMessage(' + m.id + ')">Открыть</button>' + _ibxDelBtn(m) + '</div>' +
  '</div>';
}

function toggleInboxV2() {
  window.INBOX_V2 = !window.INBOX_V2;
  try { localStorage.setItem('inboxV2', window.INBOX_V2 ? '1' : '0'); } catch (_) {}
  renderSupplyInbox();
}
function toggleInboxNoise() {
  window._ibxNoiseOpen = !window._ibxNoiseOpen;
  const w = document.getElementById('ibx-noise-wrap'); if (w) w.style.display = window._ibxNoiseOpen ? '' : 'none';
  const c = document.getElementById('ibx-noise-cnt'); if (c) c.textContent = c.textContent.replace(/[▾▴]/, window._ibxNoiseOpen ? '▴' : '▾');
}

function renderSupplyInbox() {
  const list = document.getElementById('sup-inbox-list');
  if (!list) return;
  const items = cache.supplyInbox || [];
  _ibxSel = new Set();   // сброс выделения при перерисовке
  const _ibxCanDel = state.user && (state.user.roles || []).includes('director');
  const ibxBulk = _ibxCanDel ? (
    '<div class="edo-bulkbar">' +
      '<label class="edo-selall"><input type="checkbox" id="ibx-selall-cb" onclick="_ibxToggleAll(this.checked)"> Выбрать все</label>' +
      '<span class="edo-sel-count" id="ibx-sel-count"></span>' +
      '<button class="btn btn-small edo-del-btn" id="ibx-del-btn" onclick="_ibxDeleteSelected()" disabled>' +
        '<i class="ti ti-trash"></i> Удалить выбранные</button>' +
    '</div>') : '';
  window.INBOX_V2 = localStorage.getItem('inboxV2') !== '0';
  const statusHtml = _supplyInboxStatusHTML();
  const toggle = '<div class="sv2-toggle-bar">' +
      '<span><i class="ti ti-' + (window.INBOX_V2 ? 'sparkles' : 'history') + '"></i> ' + (window.INBOX_V2 ? 'Новый вид' : 'Старый вид') + '</span>' +
      '<button class="sv2-toggle-btn" onclick="toggleInboxV2()">' + (window.INBOX_V2 ? 'Вернуть старый' : 'Включить новый') + '</button>' +
    '</div>';
  if (!items.length) {
    list.innerHTML = toggle + statusHtml +
      '<div class="empty-block"><i class="ti ti-mailbox-off"></i>Писем нет. Робот проверяет почту orders@atomus-group.ru раз в минуту.</div>';
    return;
  }
  if (!window.INBOX_V2) { list.innerHTML = toggle + statusHtml + _renderInboxOldRows(items); return; }

  // Классификация: счёт (есть документ-вложение, не привязан) / привязано / не счёт
  const invoices = [], matched = [], noise = [];
  items.forEach(m => {
    m._docIdx = _inboxDocIndex(m);
    if (m.status === 'matched' || m.matched_order_id) matched.push(m);
    else if (m._docIdx >= 0) invoices.push(m);
    else noise.push(m);
  });
  let html = toggle + statusHtml + ibxBulk;
  html += '<div class="ibx-sum">' +
    _ibxSumCard('act', '🧾', invoices.length, 'Счета — нужна привязка') +
    _ibxSumCard('ok', '✅', matched.length, 'Привязано к заказам') +
    _ibxSumCard('mut', '📭', noise.length, 'Не счёт (рассылки)') +
  '</div>';
  if (invoices.length) {
    html += _ibxSecTitle('🧾', 'Счета — нужна привязка', invoices.length);
    html += '<div class="ibx-hint">Письма с вложением-документом от поставщика. Проверь и привяжи к заказу — уйдёт в оплату.</div>';
    invoices.forEach(m => { html += _ibxInvoiceCard(m, false); });
  }
  if (matched.length) {
    html += _ibxSecTitle('✅', 'Привязанные счета', matched.length);
    matched.forEach(m => { html += _ibxInvoiceCard(m, true); });
  }
  if (noise.length) {
    html += _ibxSecTitle('📭', 'Не похоже на счёт', noise.length);
    html += '<div class="ibx-hint">Рассылки, уведомления и письма без вложений. Свёрнуто, чтобы не мешали — разверни, если нужно.</div>';
    html += '<div class="ibx-noise-head" onclick="toggleInboxNoise()"><span class="em">📭</span> Письма без вложений — рассылки и уведомления' +
      '<span class="cnt" id="ibx-noise-cnt">' + noise.length + ' писем ' + (window._ibxNoiseOpen ? '▴' : '▾') + '</span></div>';
    html += '<div class="ibx-noise-wrap" id="ibx-noise-wrap"' + (window._ibxNoiseOpen ? '' : ' style="display:none;"') + '>';
    noise.forEach(m => { html += _ibxNoiseRow(m); });
    html += '</div>';
  }
  list.innerHTML = html;
  _ibxUpdateBar();
}

// Старый вид (для отката) — прежний плоский список строк
function _renderInboxOldRows(items) {
  let html = '<div class="sup-list-rows">';
  items.forEach(m => {
    const labelHtml = m.detected_label
      ? '<span class="sup-status-pill" style="background:var(--brand-bg);color:var(--brand);font-family:ui-monospace,Consolas,monospace;">' + escapeHtml(m.detected_label) + '</span>'
      : '<span class="sup-status-pill" style="background:#FEF3C7;color:#92400E;">без метки</span>';
    const newPill = m.is_new
      ? '<span class="sup-status-pill" style="background:linear-gradient(135deg,#2563EB,#7C3AED);color:#fff;font-weight:600;">НОВЫЙ СЧЁТ</span>'
      : '';
    const statusHtml = m.status === 'matched'
      ? newPill + '<span class="sup-status-pill" style="background:#DCFCE7;color:#0A5B41;">привязано к ' + escapeHtml(m.matched_order_label || ('#' + m.matched_order_id)) + '</span>'
      : m.status === 'unmatched'
        ? '<span class="sup-status-pill" style="background:#FEE2E2;color:#8C2A2A;">требует привязки</span>'
        : m.status === 'error'
          ? '<span class="sup-status-pill" style="background:#FEE2E2;color:#8C2A2A;">ошибка</span>'
          : '<span class="sup-status-pill" style="background:var(--bg);color:var(--text-mid);">' + escapeHtml(m.status || '—') + '</span>';
    const attCount = (m.attachments || []).length;
    const attText = attCount > 0 ? attCount + ' вложение' + (attCount > 1 ? 'й' : '') : 'без вложений';
    const received = (m.received_at || '').replace('T', ' ').substring(0, 16);
    html += '<div class="sup-row">' +
      '<div class="sup-row-main">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">' +
          maxSourcePill(m) + labelHtml + statusHtml + orderPayStatusPill(m) + payerEntityPill((m.ai_data || {}).payer_entity, false) +
        '</div>' +
        '<div style="font-weight:600;color:var(--text-dark);font-size:14px;">' + escapeHtml(m.subject || '(без темы)') + '</div>' +
        '<div style="font-size:12px;color:var(--text-light);margin-top:2px;">' +
          escapeHtml(m.from_name || m.from_addr || '—') +
          (m.from_addr && m.from_name ? ' &lt;' + escapeHtml(m.from_addr) + '&gt;' : '') +
          ' · ' + escapeHtml(received) + ' · ' + attText +
        '</div>' +
      '</div>' +
      // v2.45.36: ровные кнопки — иконочные с явным классом sup-row-icon
      '<div class="sup-row-actions">' +
        '<button class="btn btn-secondary" onclick="openInboxMessage(' + m.id + ')" title="Открыть письмо"><i class="ti ti-mail-opened"></i> Открыть</button>' +
        (attCount > 0 ? '<button class="btn btn-secondary sup-row-icon" onclick="downloadInboxAttachmentDirect(' + m.id + ', 0, null)" title="Скачать первое вложение"><i class="ti ti-download"></i></button>' : '') +
        (m.status === 'unmatched'
          ? '<button class="btn btn-primary" onclick="openAttachInboxToOrder(' + m.id + ')"><i class="ti ti-link"></i> Привязать</button>'
          : (m.matched_order_id
              ? '<button class="btn btn-secondary" onclick="openSupplyOrder(' + m.matched_order_id + ')">Открыть заказ</button>'
              : '')) +
        // v2.45.33: удаление письма из inbox — только директору
        ((state.user && (state.user.roles || []).includes('director'))
          ? '<button class="btn btn-secondary sup-row-icon sup-row-trash" onclick="deleteInboxMessage(' + m.id + ')" title="Удалить письмо"><i class="ti ti-trash"></i></button>'
          : '') +
      '</div>' +
    '</div>';
  });
  html += '</div>';
  return html;
}

function setSupplyInboxFilter(f) {
  state.supplyInboxFilter = f;
  document.querySelectorAll('[data-sup-inbox]').forEach(b => b.classList.toggle('active', b.dataset.supInbox === f));
  loadSupplyInbox();
}

// v2.45.17: модалка просмотра письма из inbox (тело + метаданные + вложения).
// Нужна когда поставщик прислал ответ БЕЗ счёта (просто текстом) и юзеру
// надо это увидеть прежде чем что-то делать.
async function openInboxMessage(inboxId) {
  // Если письмо уже есть в кэше — берём оттуда, нет — тянем с бэка
  let msg = (cache.supplyInbox || []).find(x => x.id === inboxId);
  if (!msg || !('body_text' in msg)) {
    // нужен свежий запрос — body_text может быть не в списке
    try {
      const list = await apiGet('/api/supply-inbox?status=all');
      cache.supplyInbox = list.items || [];
      msg = cache.supplyInbox.find(x => x.id === inboxId);
    } catch (e) {
      showToast('Не удалось загрузить письмо', 'error');
      return;
    }
  }
  if (!msg) { showToast('Письмо не найдено', 'error'); return; }

  const overlayId = 'inbox-msg-modal';
  let m = document.getElementById(overlayId); if (m) m.remove();
  m = document.createElement('div');
  m.id = overlayId;
  m.className = 'modal-overlay';

  const fromLine = (msg.from_name ? escapeHtml(msg.from_name) + ' ' : '') +
    '<span style="color:var(--text-light);">&lt;' + escapeHtml(msg.from_addr || '—') + '&gt;</span>';
  const received = (msg.received_at || '').replace('T', ' ').substring(0, 16);
  const labelPill = msg.detected_label
    ? '<span class="sup-status-pill" style="background:var(--brand-bg);color:var(--brand);font-family:ui-monospace,Consolas,monospace;">' + escapeHtml(msg.detected_label) + '</span>'
    : '';
  const statusPill = msg.status === 'matched'
    ? '<span class="sup-status-pill" style="background:#DCFCE7;color:#0A5B41;">привязано к ' + escapeHtml(msg.matched_order_label || ('#' + msg.matched_order_id)) + '</span>'
    : msg.status === 'unmatched'
      ? '<span class="sup-status-pill" style="background:#FEE2E2;color:#8C2A2A;">требует привязки</span>'
      : msg.status === 'ignored'
        ? '<span class="sup-status-pill" style="background:#F4F4F5;color:#6B7280;">служебное</span>'
        : '';

  const bodyText = (msg.body_text || '').trim();
  const bodyHtml = bodyText
    ? '<pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:13.5px;line-height:1.5;color:var(--text-dark);margin:0;background:var(--bg);padding:14px;border-radius:8px;max-height:400px;overflow-y:auto;">' + escapeHtml(bodyText) + '</pre>'
    : '<div style="color:var(--text-light);font-style:italic;padding:10px 0;">(тело письма пустое или не было сохранено)</div>';

  // v2.45.37: если письмо привязано к заказу, рядом с каждым вложением даём
  // кнопку «Использовать как счёт» — для ручного выбора если автоматика ошиблась.
  const canReassign = !!msg.matched_order_id;
  const reassignHint = (canReassign && msg.attachments && msg.attachments.length > 1)
    ? '<div style="margin-top:8px;padding:8px 10px;background:#FFF7E6;border-left:3px solid #F59E0B;border-radius:6px;font-size:12px;color:#92400E;line-height:1.45;">' +
        '<i class="ti ti-info-circle"></i> В письме несколько вложений. Робот привязал самое свежее по дате счёта. Если выбор неверный — жми «Использовать как счёт» рядом с нужным файлом.' +
      '</div>'
    : '';
  const attsHtml = (msg.attachments && msg.attachments.length)
    ? '<div style="margin-top:12px;">' +
        '<div style="font-size:12px;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-light);font-weight:600;margin-bottom:6px;">Вложения (' + msg.attachments.length + ')</div>' +
        msg.attachments.map((a, i) =>
          '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg);border-radius:6px;margin-bottom:4px;font-size:13px;">' +
            '<i class="ti ti-paperclip" style="color:var(--text-light);"></i>' +
            '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(a.name || '') + '">' + escapeHtml(a.name || '—') + '</span>' +
            '<span style="color:var(--text-light);font-size:11.5px;">' + Math.round((a.size || 0) / 1024) + ' КБ</span>' +
            '<button class="btn btn-secondary btn-small" onclick="downloadInboxAttachmentDirect(' + msg.id + ',' + i + ',\'' + escapeHtml(a.name || '').replace(/'/g, "\\'") + '\')" title="Скачать"><i class="ti ti-download"></i></button>' +
            (canReassign
              ? '<button class="btn btn-primary btn-small" onclick="useInboxAttachmentAsInvoice(' + msg.id + ',' + i + ')" title="Привязать этот файл как счёт заказа"><i class="ti ti-receipt-2"></i> Как счёт</button>'
              : '') +
          '</div>'
        ).join('') +
        reassignHint +
      '</div>'
    : '<div style="margin-top:10px;color:var(--text-light);font-size:13px;font-style:italic;">Без вложений</div>';

  m.innerHTML =
    '<div class="modal" style="max-width:720px;max-height:90vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h2><i class="ti ti-mail-opened"></i> Письмо #' + msg.id + '</h2>' +
        '<button class="icon-btn" onclick="document.getElementById(\'' + overlayId + '\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content" style="overflow-y:auto;">' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">' + maxSourcePill(msg) + labelPill + statusPill + orderPayStatusPill(msg) + payerEntityPill((msg.ai_data || {}).payer_entity, true) + '</div>' +
        '<div style="display:grid;grid-template-columns:max-content 1fr;gap:6px 12px;font-size:13px;margin-bottom:12px;">' +
          '<div style="color:var(--text-light);">От:</div><div>' + fromLine + '</div>' +
          '<div style="color:var(--text-light);">Получено:</div><div style="font-variant-numeric:tabular-nums;">' + escapeHtml(received) + '</div>' +
          '<div style="color:var(--text-light);">Тема:</div><div style="font-weight:600;">' + escapeHtml(msg.subject || '(без темы)') + '</div>' +
        '</div>' +
        bodyHtml +
        attsHtml +
      '</div>' +
      '<div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border);">' +
        (msg.status === 'unmatched'
          ? '<button class="btn btn-primary" style="background:#16a34a;border-color:#16a34a;" onclick="sendInboxToPay(' + msg.id + ',\'' + overlayId + '\')"><i class="ti ti-wallet"></i> На оплату</button>' +
            '<button class="btn btn-secondary" onclick="document.getElementById(\'' + overlayId + '\').remove();openAttachInboxToOrder(' + msg.id + ')"><i class="ti ti-link"></i> Привязать к заказу</button>'
          : '') +
        (msg.matched_order_id
          ? '<button class="btn btn-secondary" onclick="document.getElementById(\'' + overlayId + '\').remove();openSupplyOrder(' + msg.matched_order_id + ')">Открыть заказ</button>'
          : '') +
        ((msg.from_addr && String(msg.from_addr).indexOf('@') >= 0)
          ? '<button class="btn btn-primary" onclick="openInboxReply(' + msg.id + ')"><i class="ti ti-corner-up-left"></i> Ответить</button>'
          : '') +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'' + overlayId + '\').remove()">Закрыть</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
  m.classList.add('visible');
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
}

async function forcePollSupplyInbox() {
  showToast('Проверяем почту…', 'info');
  try {
    const r = await fetch(API_BASE + '/api/supply-inbox/poll', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(j.message || 'Ошибка опроса (HTTP ' + r.status + ')', 'error');
      return;
    }
    const result = j.result || j;
    const state = j.state || {};
    if (result.skipped) {
      const reason = result.reason || 'неизвестно';
      const err = result.error ? ': ' + result.error : '';
      showToast('Робот пропустил (' + reason + ')' + err, 'error');
    } else if (state.ok === false) {
      showToast('Ошибка на этапе «' + (state.stage || '?') + '»: ' + (state.error || 'неизвестно'), 'error');
    } else {
      const found = result.found_uids || 0;
      const processed = result.processed || 0;
      if (found === 0) {
        showToast('Почта пустая (за последние 14 дней писем нет)', 'warning');
      } else if (processed === 0) {
        showToast('Найдено ' + found + ' писем, все уже обработаны ранее', 'success');
      } else {
        const m = state.matched || 0;
        const u = state.unmatched || 0;
        const i = state.ignored || 0;
        const bits = [];
        if (m) bits.push(m + ' привязано к заказу');
        if (u) bits.push(u + ' требует привязки');
        if (i) bits.push(i + ' служебных');
        showToast('Обработано ' + processed + ' новых: ' + (bits.join(', ') || ''), 'success');
      }
    }
    await loadSupplyInbox();
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

// Счёт из входящих (MAX/почта) — сразу «На оплату»: создаёт заказ в статусе
// to_pay из распознанных реквизитов и уведомляет бухгалтера.
async function sendInboxToPay(inboxId, overlayId) {
  if (!confirm('Отправить счёт на оплату?\nБудет создана позиция в разделе «На оплату» с распознанными реквизитами (поставщик, сумма, № счёта), бухгалтер получит уведомление.')) return;
  try {
    const r = await fetch(API_BASE + '/api/supply-inbox/' + inboxId + '/to-pay', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(j.message || ('Ошибка (HTTP ' + r.status + ')'), 'error');
      return;
    }
    if (overlayId) { const ov = document.getElementById(overlayId); if (ov) ov.remove(); }
    showToast('Счёт отправлен на оплату' + (j.order_label ? ' · ' + j.order_label : ''), 'success');
    await loadSupplyInbox();
    if (j.order_id && confirm('Открыть заказ в разделе «На оплату»?')) openSupplyOrder(j.order_id);
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

// v2.45.598: оплата ПРИВЯЗАННОГО счёта — переводит сам заказ в «На оплату».
// Счёт уже привязан к этому заказу, поэтому задвоения нет: бухгалтер платит,
// а пришедшая позже УПД закроет именно этот заказ.
async function payInboxOrderToPay(orderId, orderLabel) {
  if (!orderId) return;
  if (!confirm('Передать счёт на оплату?\nЗаказ ' + (orderLabel || ('#' + orderId)) +
      ' перейдёт в раздел «На оплату», бухгалтер получит уведомление.')) return;
  try {
    // supplyOrderTransitionConfirmed (app-1.js) при необходимости спросит пароль.
    const res = await supplyOrderTransitionConfirmed(orderId, 'to_pay');
    if (res.cancelled) return;
    if (!res.ok) {
      showToast(res.message || ('Не удалось (HTTP ' + res.status + ')'), 'error');
      return;
    }
    showToast('Счёт передан на оплату · ' + (orderLabel || ('#' + orderId)), 'success');
    cache.supplyOrders = null;
    await loadSupplyInbox();
  } catch (e) {
    showToast('Сеть: не удалось передать на оплату', 'error');
  }
}

// v2.45.595: ответ поставщику прямо из карточки письма (например «пришлите счёт»).
// Тема уходит как «Re: <исходная>» — метка [Заявка ORD-N] остаётся, поэтому
// будущий счёт-ответ снова сам привяжется к заказу. Подпись и цитата исходного
// письма добавляются на бэкенде.
window._inboxReplyTpls = [
  'Здравствуйте!\n\nПришлите, пожалуйста, счёт на эту заявку.',
  'Здравствуйте!\n\nПодскажите, пожалуйста, срок поставки по этой заявке.',
  'Здравствуйте!\n\nПришлите, пожалуйста, счёт и укажите срок поставки по этой заявке.',
];
function openInboxReply(inboxId) {
  const msg = (cache.supplyInbox || []).find(x => x.id === inboxId) || {};
  const toName = (msg.from_name || '').trim();
  const toAddr = (msg.from_addr || '').trim();
  const toLine = (toName ? toName + ' <' + toAddr + '>' : toAddr) || '—';
  let subj = (msg.subject || 'Ваша заявка').trim();
  const reSubj = /^re:/i.test(subj) ? subj : ('Re: ' + subj);

  const overlayId = 'inbox-reply-modal';
  let m = document.getElementById(overlayId); if (m) m.remove();
  m = document.createElement('div');
  m.id = overlayId;
  m.className = 'modal-overlay';
  const tplBtn = (i, label) =>
    '<button type="button" class="btn btn-secondary btn-small" ' +
      'onclick="var t=document.getElementById(\'inbox-reply-text\');t.value=window._inboxReplyTpls[' + i + '];t.focus();">' +
      escapeHtml(label) + '</button>';
  m.innerHTML =
    '<div class="modal" style="max-width:560px;max-height:90vh;display:flex;flex-direction:column;">' +
      '<div class="modal-header">' +
        '<h2><i class="ti ti-corner-up-left"></i> Ответить поставщику</h2>' +
        '<button class="icon-btn" onclick="document.getElementById(\'' + overlayId + '\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content" style="overflow-y:auto;">' +
        '<div style="display:grid;grid-template-columns:max-content 1fr;gap:6px 12px;font-size:13px;margin-bottom:12px;">' +
          '<div style="color:var(--text-light);">Кому:</div><div>' + escapeHtml(toLine) + '</div>' +
          '<div style="color:var(--text-light);">Тема:</div><div style="font-weight:600;">' + escapeHtml(reSubj) + '</div>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">' +
          tplBtn(0, 'Пришлите счёт') + tplBtn(1, 'Уточните срок') + tplBtn(2, 'Счёт + срок') +
        '</div>' +
        '<textarea id="inbox-reply-text" rows="6" style="width:100%;box-sizing:border-box;font:inherit;padding:10px;border:1px solid var(--border);border-radius:8px;resize:vertical;">' +
          escapeHtml(window._inboxReplyTpls[0]) +
        '</textarea>' +
        '<div style="margin-top:8px;color:var(--text-light);font-size:12px;line-height:1.4;">' +
          '<i class="ti ti-info-circle"></i> Подпись и цитата исходного письма добавятся автоматически. ' +
          'Письмо уйдёт в ту же переписку — когда поставщик пришлёт счёт ответом, он сам привяжется к заказу.' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border);">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'' + overlayId + '\').remove()">Отмена</button>' +
        '<button class="btn btn-primary" id="inbox-reply-send" onclick="sendInboxReply(' + inboxId + ',\'' + overlayId + '\')"><i class="ti ti-send"></i> Отправить</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
  m.classList.add('visible');
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  setTimeout(() => { const t = document.getElementById('inbox-reply-text'); if (t) t.focus(); }, 50);
}

async function sendInboxReply(inboxId, overlayId) {
  const ta = document.getElementById('inbox-reply-text');
  const text = (ta && ta.value || '').trim();
  if (!text) { showToast('Напишите текст ответа', 'warning'); if (ta) ta.focus(); return; }
  const btn = document.getElementById('inbox-reply-send');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i> Отправляем…'; }
  try {
    const r = await fetch(API_BASE + '/api/supply-inbox/' + inboxId + '/reply', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: text }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(j.message || ('Ошибка (HTTP ' + r.status + ')'), 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-send"></i> Отправить'; }
      return;
    }
    const ov = document.getElementById(overlayId); if (ov) ov.remove();
    // Закрываем и саму карточку письма, если открыта
    const letterOv = document.getElementById('inbox-msg-modal'); if (letterOv) letterOv.remove();
    showToast('Ответ отправлен поставщику', 'success');
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-send"></i> Отправить'; }
  }
}

async function openAttachInboxToOrder(inboxId) {
  // v2.45.438: берём ВСЕ заказы (не только open) — чтобы ничего не скрыть
  let orders = [];
  try {
    const d = await apiGet('/api/supply-orders');
    orders = d.items || d.orders || (Array.isArray(d) ? d : []) || [];
    if (!Array.isArray(orders)) orders = orders.items || [];
  } catch (_) { orders = []; }

  // Поставщик счёта (из отправителя письма) — для сопоставления и подсказки
  const inb = (cache.supplyInbox || []).find(x => x.id === inboxId) || {};
  const senderName = (inb.from_name || inb.from_addr || '').trim();
  const senderKey = ((inb.from_name || '') + (inb.from_addr || '')).toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
  const senderDom = ((inb.from_addr || '').split('@')[1] || '').toLowerCase();
  const _ordMatch = (o) => {
    const sk = (o.supplier_name || '').toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
    if (sk && sk.length >= 3 && senderKey && (senderKey.indexOf(sk) >= 0 || sk.indexOf(senderKey) >= 0)) return true;
    const ed = ((o.supplier_email || '').split('@')[1] || '').toLowerCase();
    return !!(senderDom && ed && senderDom === ed);
  };
  // Совпадающего поставщика — наверх
  orders.sort((a, b) => (_ordMatch(b) ? 1 : 0) - (_ordMatch(a) ? 1 : 0));

  const overlayId = 'inbox-attach-modal';
  let m = document.getElementById(overlayId); if (m) m.remove();
  m = document.createElement('div');
  m.id = overlayId;
  m.className = 'modal-overlay';
  const opts = orders.map(o =>
    '<option value="' + o.id + '">' +
      (_ordMatch(o) ? '✓ ' : '') +
      escapeHtml((o.order_label || ('#' + o.id))) + ' · ' +
      escapeHtml(o.supplier_name || '—') + ' · ' +
      escapeHtml(o.status_label || o.status || '—') +
    '</option>'
  ).join('');
  const senderHtml = senderName
    ? '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:9px 11px;font-size:13px;">Счёт от: <b>' + escapeHtml(senderName) + '</b>' +
        (inb.from_addr && inb.from_name ? ' <span style="color:var(--text-light);">&lt;' + escapeHtml(inb.from_addr) + '&gt;</span>' : '') +
        '<div style="color:var(--text-light);font-size:12px;margin-top:3px;">Заказы этого поставщика отмечены ✓ и подняты вверх. Если его заказа нет — создайте новый из этого счёта.</div></div>'
    : '';
  const selectOrEmpty = orders.length
    ? '<select id="inbox-attach-order-select" class="form-input" style="width:100%;">' + opts + '</select>' +
      '<button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="submitAttachInboxToOrder(' + inboxId + ')"><i class="ti ti-check"></i> Привязать к выбранному</button>' +
      '<div style="text-align:center;color:var(--text-light);font-size:12px;">— или —</div>'
    : '<div style="color:var(--text-light);font-size:13px;">Подходящих заказов нет.</div>';
  m.innerHTML =
    '<div class="modal" style="max-width:540px;">' +
      '<div class="modal-header">' +
        '<h2><i class="ti ti-link"></i> Привязать счёт к заказу</h2>' +
        '<button class="icon-btn" onclick="document.getElementById(\'' + overlayId + '\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content" style="display:flex;flex-direction:column;gap:10px;">' +
        senderHtml +
        '<div style="color:var(--text-light);font-size:13px;">Привяжите счёт к существующему заказу — вложение станет файлом счёта, статус перейдёт в «Счёт получен».</div>' +
        selectOrEmpty +
        '<button class="btn ' + (orders.length ? 'btn-secondary' : 'btn-primary') + '" style="width:100%;justify-content:center;" onclick="createOrderFromInbox(' + inboxId + ')"><i class="ti ti-plus"></i> Создать новый заказ из этого счёта</button>' +
      '</div>' +
      '<div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border);">' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'' + overlayId + '\').remove()">Закрыть</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
  m.classList.add('visible');
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
}

async function createOrderFromInbox(inboxId) {
  if (!confirm('Создать новый заказ поставщику из этого счёта? Поставщик определится по отправителю письма.')) return;
  try {
    const r = await fetch(API_BASE + '/api/supply-inbox/' + inboxId + '/create-order', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''), 'Content-Type': 'application/json' },
      body: '{}',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(j.message || ('Ошибка (HTTP ' + r.status + ')'), 'error'); return; }
    showToast('Создан заказ ' + (j.order_label || ('#' + j.order_id)) + ' — счёт привязан', 'success');
    document.getElementById('inbox-attach-modal')?.remove();
    await loadSupplyInbox();
    if (j.order_id && typeof openSupplyOrder === 'function') openSupplyOrder(j.order_id);
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

async function submitAttachInboxToOrder(inboxId) {
  const sel = document.getElementById('inbox-attach-order-select');
  const orderId = parseInt((sel && sel.value) || '0', 10);
  if (!orderId) { showToast('Выбери заказ', 'error'); return; }
  try {
    const r = await fetch(API_BASE + '/api/supply-inbox/' + inboxId + '/attach', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''), 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(j.message || ('Ошибка (HTTP ' + r.status + ')'), 'error');
      return;
    }
    showToast('Привязано к заказу', 'success');
    document.getElementById('inbox-attach-modal')?.remove();
    await loadSupplyInbox();
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
  }
}

async function downloadInboxAttachment(inboxId, idx) {
  // v2.45.19: используем прямое скачивание из inbox, независимо от матча
  const item = (cache.supplyInbox || []).find(x => x.id === inboxId);
  if (!item || !item.attachments || !item.attachments.length) {
    showToast('Вложений нет', 'warning');
    return;
  }
  const att = item.attachments[idx] || item.attachments[0];
  return downloadInboxAttachmentDirect(inboxId, idx || 0, att && att.name);
}

// v2.45.37: ручное переназначение «какой файл в письме = счёт» — для случаев,
// когда поставщик прислал несколько PDF (свежий + старые из переписки) и робот
// автовыбрал не тот. Работает только если письмо уже привязано к заказу.
async function useInboxAttachmentAsInvoice(inboxId, idx) {
  if (!confirm('Привязать ЭТО вложение к заказу как счёт?\n\nПредыдущая ссылка на счёт будет перезаписана.')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-inbox/' + inboxId + '/attachments/' + idx + '/use-as-invoice', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || ('HTTP ' + r.status + ': не удалось'), 'error');
      return;
    }
    const d = await r.json().catch(() => ({}));
    showToast('Счёт привязан: ' + (d.attachment_name || '—'), 'success');
    // Закрываем модалку письма + перерисовываем inbox
    const m = document.getElementById('inbox-msg-modal');
    if (m) m.remove();
    if (typeof loadSupplyInbox === 'function') loadSupplyInbox().catch(() => {});
  } catch (e) { showToast('Ошибка', 'error'); }
}

// v2.45.33: удаление inbox-сообщения (только директор). Кладёт DELETE на бэк,
// который убирает запись из БД + чистит файлы вложений в storage.
// Выделение для массового удаления входящих счетов (писем)
let _ibxSel = new Set();

function _ibxToggle(id, checked) {
  if (checked) _ibxSel.add(id); else _ibxSel.delete(id);
  const all = document.querySelectorAll('#sup-inbox-list .ibx-cb');
  const selAll = document.getElementById('ibx-selall-cb');
  if (selAll) selAll.checked = all.length > 0 && _ibxSel.size === all.length;
  _ibxUpdateBar();
}

function _ibxToggleAll(checked) {
  _ibxSel = new Set();
  document.querySelectorAll('#sup-inbox-list .ibx-cb').forEach(cb => {
    cb.checked = checked;
    if (checked) _ibxSel.add(parseInt(cb.getAttribute('data-id'), 10));
  });
  _ibxUpdateBar();
}

function _ibxUpdateBar() {
  const cnt = document.getElementById('ibx-sel-count');
  const btn = document.getElementById('ibx-del-btn');
  const n = _ibxSel.size;
  if (cnt) cnt.textContent = n ? ('Выбрано: ' + n) : '';
  if (btn) btn.disabled = !n;
}

async function _ibxDeleteSelected() {
  const ids = Array.from(_ibxSel);
  if (!ids.length) return;
  if (!confirm('Удалить выбранные письма (' + ids.length + ')?\n\nЗаписи и приложенные файлы будут стёрты безвозвратно.')) return;
  const token = localStorage.getItem(TOKEN_KEY);
  let ok = 0;
  for (const id of ids) {
    try {
      const r = await fetch(API_BASE + '/api/supply-inbox/' + id, {
        method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token },
      });
      if (r.ok) ok++;
    } catch (e) {}
  }
  showToast(ok ? ('Удалено: ' + ok) : 'Не удалось удалить', ok ? 'success' : 'error');
  _ibxSel = new Set();
  if (typeof loadSupplyInbox === 'function') loadSupplyInbox().catch(() => {});
}

async function deleteInboxMessage(inboxId) {
  if (!confirm('Удалить это письмо из «Входящих счетов»?\n\nЗапись и приложенные файлы будут стёрты безвозвратно.')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-inbox/' + inboxId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || ('HTTP ' + r.status + ': не удалось удалить'), 'error');
      return;
    }
    showToast('Письмо удалено', 'success');
    // Перезагрузим список (фильтр читается из state.supplyInboxFilter внутри)
    if (typeof loadSupplyInbox === 'function') {
      loadSupplyInbox().catch(() => {});
    }
  } catch (e) { showToast('Ошибка', 'error'); }
}

async function downloadInboxAttachmentDirect(inboxId, idx, suggestedName) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-inbox/' + inboxId + '/attachments/' + idx + '/download', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      let msg = 'Не удалось скачать вложение';
      try {
        const j = await r.json();
        if (j && j.message) msg = j.message;
      } catch (_) {}
      showToast(msg + ' (HTTP ' + r.status + ')', 'error');
      return;
    }
    // Имя из Content-Disposition или из подсказки
    let filename = suggestedName || 'attachment';
    const cd = r.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^";]+)"?/i);
    if (m) filename = m[1];
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    showToast('Сеть: не удалось скачать', 'error');
  }
}

// v2.45.312: меню кнопки «+» на экране «Заказы» (мобильная и десктоп) —
// выбор: новый заказ поставщику или загрузить счёт на оплату.
function openSupplyOrderAddMenu() {
  const existing = document.getElementById('sup-ord-add-menu');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'sup-ord-add-menu';
  overlay.className = 'modal-overlay visible';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  const close = "document.getElementById('sup-ord-add-menu').remove();";
  overlay.innerHTML =
    '<div class="modal" style="max-width:360px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-plus"></i>Добавить</h3>' +
        '<button class="icon-btn" onclick="' + close + '"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body" style="display:flex;flex-direction:column;gap:10px;">' +
        '<button class="btn btn-primary" style="width:100%;justify-content:flex-start;gap:8px;" onclick="' + close + 'openNewSupplyOrder();">' +
          '<i class="ti ti-clipboard-plus"></i> Оформить заказ</button>' +
        '<button class="btn btn-secondary" style="width:100%;justify-content:flex-start;gap:8px;" onclick="' + close + 'openUploadInvoiceToPay();">' +
          '<i class="ti ti-cloud-upload"></i> Загрузить счёт</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
}

// v2.45.318: «Загрузить счёт» → создаёт заказ сразу «в оплату» (виден в «К оплате»).
// Файл стажируется, выбираешь договор/сумму/кому, жмёшь «Отправить» — окно не
// закрывается раньше времени, распознавание не запускается.
let _payInvoiceFile = null;
function openUploadInvoiceToPay() {
  const existing = document.getElementById('pay-inv-modal');
  if (existing) existing.remove();
  _payInvoiceFile = null;
  const inp = 'width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:white;color:var(--text-dark);box-sizing:border-box;';
  const lbl = 'display:block;font-size:12.5px;color:var(--text-mid);margin-bottom:4px;';
  const overlay = document.createElement('div');
  overlay.id = 'pay-inv-modal';
  overlay.className = 'modal-overlay visible';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML =
    '<div class="modal" style="max-width:460px;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-cloud-upload"></i>Счёт на оплату</h3>' +
        '<button class="icon-btn" onclick="document.getElementById(\'pay-inv-modal\').remove()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div id="pay-inv-drop" onclick="document.getElementById(\'pay-inv-file\').click()" style="border:1.5px dashed var(--border);border-radius:10px;padding:18px;text-align:center;cursor:pointer;">' +
          '<i class="ti ti-file-upload" style="font-size:30px;color:var(--brand);"></i>' +
          '<div id="pay-inv-fname" style="margin-top:6px;font-size:13.5px;color:var(--text-mid);">Выбрать файл счёта (PDF, фото, Excel)</div>' +
        '</div>' +
        '<input type="file" id="pay-inv-file" accept="image/*,application/pdf,.pdf,.xlsx,.xls,.doc,.docx" style="display:none;" onchange="_payInvOnFile(event)">' +
        '<div style="margin-top:14px;">' +
          '<label style="' + lbl + '"><i class="ti ti-file-text" style="font-size:13px;"></i> Договор клиента</label>' +
          '<select id="pay-inv-contract" style="' + inp + '"><option value="">— Без договора —</option></select>' +
        '</div>' +
        '<div style="margin-top:10px;">' +
          '<label style="' + lbl + '">Кому платим (необязательно)</label>' +
          '<input type="text" id="pay-inv-supplier" placeholder="напр. Лизинг ВТБ" style="' + inp + '">' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:10px;">' +
          '<div style="flex:1;"><label style="' + lbl + '">Номер счёта</label><input type="text" id="pay-inv-number" style="' + inp + '"></div>' +
          '<div style="flex:1;"><label style="' + lbl + '">Сумма, ₽</label><input type="number" inputmode="decimal" id="pay-inv-amount" style="' + inp + '"></div>' +
        '</div>' +
        '<div id="pay-inv-status" style="margin-top:10px;font-size:12.5px;text-align:center;color:var(--text-light);"></div>' +
        '<button class="btn btn-primary" style="width:100%;margin-top:14px;justify-content:center;" onclick="_payInvSubmit()"><i class="ti ti-send"></i> Отправить в оплату</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  _payInvPopulateContracts();
}

function _payInvOnFile(e) {
  const f = e.target.files && e.target.files[0];
  _payInvoiceFile = f || null;
  const el = document.getElementById('pay-inv-fname');
  if (el) el.textContent = f ? ('✓ ' + f.name) : 'Выбрать файл счёта (PDF, фото, Excel)';
}

async function _payInvPopulateContracts() {
  const sel = document.getElementById('pay-inv-contract');
  if (!sel) return;
  try {
    let contracts = (typeof cache !== 'undefined' && cache.contracts) || null;
    if (!contracts) {
      const d = await apiGet('/api/contracts?limit=500');
      contracts = d.contracts || [];
      if (typeof cache !== 'undefined') cache.contracts = contracts;
    }
    contracts.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = (c.number || ('#' + c.id)) + (c.contractor_name ? (' · ' + c.contractor_name) : '');
      sel.appendChild(o);
    });
  } catch (e) { /* без договора можно */ }
}

async function _payInvSubmit() {
  if (!_payInvoiceFile) { showToast('Сначала выберите файл счёта', 'error'); return; }
  const statusEl = document.getElementById('pay-inv-status');
  const fd = new FormData();
  fd.append('file', _payInvoiceFile, _payInvoiceFile.name);
  const c = document.getElementById('pay-inv-contract');   if (c && c.value) fd.append('contract_id', c.value);
  const sup = document.getElementById('pay-inv-supplier');  if (sup && sup.value.trim()) fd.append('supplier_name', sup.value.trim());
  const num = document.getElementById('pay-inv-number');    if (num && num.value.trim()) fd.append('invoice_number', num.value.trim());
  const amt = document.getElementById('pay-inv-amount');    if (amt && amt.value.trim()) fd.append('amount', amt.value.trim());
  if (statusEl) statusEl.innerHTML = '<i class="ti ti-loader" style="animation:spin 1s linear infinite;"></i> Отправляем…';
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const res = await fetch(API_BASE + '/api/supply-orders/from-invoice', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (statusEl) statusEl.innerHTML = '<span style="color:#8C2A2A;">' + escapeHtml(d.message || ('Ошибка ' + res.status)) + '</span>';
      return;
    }
    showToast('Счёт отправлен в оплату ✓', 'success');
    const m = document.getElementById('pay-inv-modal'); if (m) m.remove();
    cache.supplyOrders = null;
    try { selectSidebarItem('supply-orders'); } catch (_) {}
    try { setSupplyOrdFilter('to_pay'); } catch (_) {}
    try { _fillPayDueBlock(); } catch (_) {}
  } catch (e) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#8C2A2A;">Сеть: ' + escapeHtml(String(e.message || e)) + '</span>';
  }
}

// ====== МАСТЕР «ОФОРМИТЬ ЗАКАЗ» (v2.45.x) ======
// Удобное ручное оформление: поставщик → номенклатура (поиск + список) →
// корзина с кол-вом → телефон для связи + подпись → создать / создать и отправить.
let _owz = { list: [], me: null, openCats: {}, custom: 0 };

async function openNewSupplyOrder() {
  if (!canManageSupply()) { showToast('Доступно директору, заму, менеджеру', 'error'); return; }
  // Грузим параллельно: поставщиков, каталог комплектующих (как на производстве),
  // профиль (для телефона/подписи).
  const [supRes, compRes, meRes] = await Promise.all([
    (cache.suppliers ? Promise.resolve({ suppliers: cache.suppliers })
                     : apiGet('/api/suppliers').catch(() => ({ suppliers: [] }))),
    (cache.components ? Promise.resolve({ components: cache.components })
                      : apiGet('/api/components').catch(() => ({ components: [] }))),
    (cache.me ? Promise.resolve(cache.me) : apiGet('/api/me').catch(() => null)),
  ]);
  cache.suppliers = supRes.suppliers || [];
  cache.components = compRes.components || [];
  if (meRes) cache.me = meRes;
  if (!cache.suppliers.length) { showToast('Сначала добавьте хотя бы одного поставщика', 'error'); return; }

  _owz = { list: [], me: cache.me || {}, openCats: {}, custom: 0,
           supplierId: null, supplierEmail: '', supplierPhone: '', supplierName: '' };
  const me = _owz.me;
  const signName = (me.full_name || me.short_name || '').trim();
  const signPos = (me.position || '').trim();
  const phone = (me.phone || '').trim();

  const m = document.getElementById('supply-modal');
  m.innerHTML =
    '<div class="modal owz-modal owz2" onclick="event.stopPropagation()" style="max-width:660px;width:96vw;">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-clipboard-plus"></i> Оформить заказ</h3>' +
        '<button class="modal-close" onclick="closeSupplyModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        // Поставщик — поиск с подсказками (начни вводить название) + карточка выбранного
        '<div class="owz2-sec-l"><i class="ti ti-truck"></i> Поставщик</div>' +
        '<div class="form-group" style="position:relative;margin-bottom:0;" id="owz-sup-search-wrap">' +
          '<input id="owz-supplier-search" type="text" autocomplete="off" placeholder="Начните вводить название…" ' +
            'oninput="_owzSupFilter(this.value)" onfocus="_owzSupFilter(this.value)" ' +
            'onkeydown="_owzSupKey(event)" ' +
            'onblur="setTimeout(function(){var b=document.getElementById(\'owz-supplier-list\');if(b)b.style.display=\'none\';},180)" ' +
            'class="owz2-inp">' +
          '<div id="owz-supplier-list" class="owz2-sup-list" style="display:none;"></div>' +
          '<div id="owz-sup-hint" style="font-size:12px;color:var(--text-light);margin-top:4px;"></div>' +
        '</div>' +
        '<div id="owz-sup-card"></div>' +
        // Что заказываем
        '<div class="owz2-sec-l"><i class="ti ti-package"></i> Что заказываем</div>' +
        '<div class="owz2-srow">' +
          '<input id="owz-search" type="search" placeholder="Поиск или впишите свою позицию…" oninput="_owzRenderCatalog(this.value)" ' +
            'onkeydown="if(event.key===\'Enter\'){event.preventDefault();_owzAddTyped();}" class="owz2-inp" style="flex:1;min-width:0;">' +
          '<button class="btn btn-secondary" onclick="_owzNewItem()" title="Добавить позицию свободным текстом — в справочник она не добавляется"><i class="ti ti-plus"></i> Вписать</button>' +
        '</div>' +
        '<div id="owz-catalog" class="owz2-catalog"></div>' +
        // Корзина
        '<div class="owz2-sec-l"><i class="ti ti-shopping-cart"></i> В заказе <span id="owz-cart-count"></span></div>' +
        '<div id="owz-cart" class="owz-cart"></div>' +
        // Детали заказа
        '<div class="owz2-sec-l"><i class="ti ti-settings"></i> Детали заказа</div>' +
        '<div class="owz2-grid2">' +
          '<div class="form-group" style="margin:0;"><label>Ожидаемая дата приёмки</label><input type="date" id="owz-expected" class="owz2-inp"></div>' +
          '<div class="form-group" style="margin:0;"><label>Телефон для связи</label><input id="owz-phone" type="tel" value="' + escapeHtml(phone) + '" placeholder="+7 …" class="owz2-inp"></div>' +
        '</div>' +
        '<div class="form-group" style="margin-top:12px;"><label>Комментарий поставщику</label><textarea id="owz-comment" rows="2" placeholder="Необязательно" class="owz2-inp"></textarea></div>' +
        // Подпись
        '<div class="owz2-sign">' +
          '<i class="ti ti-signature owz2-sign-ic"></i>' +
          '<div class="owz2-sign-t">Подпись: <b>' + (escapeHtml(signName) || '—') + '</b>' +
            (signPos ? ' · ' + escapeHtml(signPos) : '') +
            '<div class="owz2-sign-sub">Имя и должность подставляются из вашей карточки и уходят в письмо и документ.</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="owz2-foot">' +
        '<button class="btn btn-secondary" onclick="submitOrderWizard(false)"><i class="ti ti-device-floppy"></i> Сохранить черновик</button>' +
        '<button class="btn btn-primary" onclick="submitOrderWizard(true)"><i class="ti ti-mail-search"></i> Проверить письмо и отправить</button>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
  _owzRenderCatalog('');
  _owzRenderCart();
}

function _owzSupplierHint() {
  const hint = document.getElementById('owz-sup-hint');
  if (!hint) return;
  if (!_owz.supplierId) { hint.textContent = ''; return; }
  const parts = [];
  if (_owz.supplierEmail) parts.push('✉ ' + _owz.supplierEmail);
  if (_owz.supplierPhone) parts.push('☎ ' + _owz.supplierPhone);
  hint.textContent = parts.join('   ') || 'Контакты не заполнены — письмо отправить не получится';
}

// Поставщик: фильтр-подсказки при вводе названия
function _owzSupFilter(q) {
  const box = document.getElementById('owz-supplier-list');
  if (!box) return;
  // если изменили текст после выбора — сбрасываем выбранного, пока не кликнут заново
  const inp = document.getElementById('owz-supplier-search');
  if (_owz.supplierId && inp && (inp.value || '').trim() !== _owz.supplierName) {
    _owz.supplierId = null; _owz.supplierEmail = ''; _owz.supplierPhone = ''; _owz.supplierName = '';
    _owzSupplierHint();
  }
  const s = (q || '').trim().toLowerCase();
  let sup = cache.suppliers || [];
  if (s) sup = sup.filter(x => (x.name || '').toLowerCase().includes(s) || (x.email || '').toLowerCase().includes(s));
  sup = sup.slice(0, 50);
  if (!sup.length) {
    box.innerHTML = '<div style="padding:10px 12px;color:var(--text-light);font-size:13px;">Поставщик не найден. Добавить можно в Справочники → Поставщики.</div>';
    box.style.display = 'block';
    return;
  }
  box.innerHTML = sup.map(x =>
    '<div onclick="_owzSupPick(' + x.id + ')" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border);" ' +
      'onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'">' +
      '<div style="font-weight:600;font-size:14px;">' + escapeHtml(x.name || '—') + '</div>' +
      ((x.email || x.phone)
        ? '<div style="font-size:12px;color:var(--text-light);">' +
            [x.email ? '✉ ' + escapeHtml(x.email) : '', x.phone ? '☎ ' + escapeHtml(x.phone) : ''].filter(Boolean).join('   ') +
          '</div>'
        : '') +
    '</div>'
  ).join('');
  box.style.display = 'block';
}

function _owzSupPick(id) {
  const x = (cache.suppliers || []).find(s => s.id === id);
  if (!x) return;
  _owz.supplierId = x.id;
  _owz.supplierEmail = x.email || '';
  _owz.supplierPhone = x.phone || '';
  _owz.supplierName = x.name || '';
  const inp = document.getElementById('owz-supplier-search');
  if (inp) inp.value = x.name || '';
  const box = document.getElementById('owz-supplier-list');
  if (box) box.style.display = 'none';
  _owzSupplierHint();
  _owzRenderSupplier();
}

// v2.45.6xx: карточка выбранного поставщика (вместо поля поиска)
function _owzRenderSupplier() {
  const card = document.getElementById('owz-sup-card');
  const wrap = document.getElementById('owz-sup-search-wrap');
  if (!card) return;
  if (!_owz.supplierId) {
    card.innerHTML = '';
    if (wrap) wrap.style.display = '';
    return;
  }
  if (wrap) wrap.style.display = 'none';
  const chips = [];
  if (_owz.supplierEmail) chips.push('<span class="owz2-sup-chip"><i class="ti ti-mail"></i> ' + escapeHtml(_owz.supplierEmail) + '</span>');
  if (_owz.supplierPhone) chips.push('<span class="owz2-sup-chip"><i class="ti ti-phone"></i> ' + escapeHtml(_owz.supplierPhone) + '</span>');
  if (!chips.length) chips.push('<span class="owz2-sup-chip warn"><i class="ti ti-alert-triangle"></i> контакты не заполнены — письмо не уйдёт</span>');
  card.innerHTML = '<div class="owz2-sup-card">' +
    '<div class="owz2-sup-ava">' + escapeHtml(getInitials(_owz.supplierName)) + '</div>' +
    '<div class="owz2-sup-body"><div class="owz2-sup-name">' + escapeHtml(_owz.supplierName || '—') + '</div>' +
      '<div class="owz2-sup-contacts">' + chips.join('') + '</div></div>' +
    '<button type="button" class="owz2-sup-change" onclick="_owzSupChange()">Сменить</button>' +
  '</div>';
}

function _owzSupChange() {
  _owz.supplierId = null; _owz.supplierEmail = ''; _owz.supplierPhone = ''; _owz.supplierName = '';
  const inp = document.getElementById('owz-supplier-search');
  if (inp) inp.value = '';
  _owzSupplierHint();
  _owzRenderSupplier();
  if (inp) inp.focus();
}

// Enter в поле поставщика — выбрать единственного совпавшего
function _owzSupKey(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const inp = document.getElementById('owz-supplier-search');
  const s = ((inp && inp.value) || '').trim().toLowerCase();
  if (!s) return;
  const matches = (cache.suppliers || []).filter(x =>
    (x.name || '').toLowerCase().includes(s) || (x.email || '').toLowerCase().includes(s));
  if (matches.length === 1) _owzSupPick(matches[0].id);
}

// Каталог комплектующих — как на производстве: группы по категориям,
// сворачиваемые, с поиском. Источник — /api/components.
function _owzRenderCatalog(filter) {
  const box = document.getElementById('owz-catalog');
  if (!box) return;
  const q = (filter || '').trim().toLowerCase();
  let comps = cache.components || [];
  if (q) comps = comps.filter(c =>
    (c.name || '').toLowerCase().includes(q) || (c.sku || '').toLowerCase().includes(q));
  if (!comps.length) {
    const raw = (filter || '').trim();
    box.innerHTML = '<div style="padding:14px;text-align:center;color:var(--text-light);font-size:13px;">' +
      (q
        ? 'В справочнике такого нет.<br>' +
          '<button type="button" class="btn btn-primary btn-small" style="margin-top:10px;" onclick="_owzAddTyped()">' +
            '<i class="ti ti-plus"></i> Добавить «' + escapeHtml(raw) + '» в заказ</button>' +
          '<div style="margin-top:6px;color:var(--text-light);font-size:11.5px;">Позиция уйдёт в заказ как есть — в справочник не добавляется.</div>'
        : 'Каталог комплектующих пуст.') +
      '</div>';
    return;
  }
  const chosen = new Set(_owz.list.map(x => x.cid).filter(v => v != null));
  // Группируем по категории, как BOM-пикер на производстве
  const groups = {};
  comps.forEach(c => { const cat = c.category_name || 'Без категории'; (groups[cat] = groups[cat] || []).push(c); });
  const cats = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'ru'));
  const allOpen = !!q;
  box.innerHTML = cats.map(cat => {
    const isOpen = allOpen || !!_owz.openCats[cat];
    const items = groups[cat];
    const rows = items.map(c => {
      const inCart = chosen.has(c.id);
      const meta = [];
      if (c.sku) meta.push(escapeHtml(c.sku));
      meta.push('остаток: ' + _fmtQty(c.qty_on_stock) + ' ' + escapeHtml(c.unit || 'шт.'));
      if (c.default_supplier_name) meta.push(escapeHtml(c.default_supplier_name));
      return '<div class="owz2-cat-item' + (inCart ? ' in' : '') + '" onclick="_owzAdd(' + c.id + ')">' +
        '<div class="owz2-ci-main"><div class="owz2-ci-name">' + escapeHtml(c.name || '—') + '</div>' +
          '<div class="owz2-ci-meta">' + meta.join(' · ') + '</div></div>' +
        '<span class="owz2-ci-add' + (inCart ? ' done' : '') + '"><i class="ti ti-' + (inCart ? 'check' : 'plus') + '"></i></span>' +
      '</div>';
    }).join('');
    return '<div class="owz2-cat-grp">' +
      '<div class="owz2-cat-head" onclick="_owzToggleCat(' + JSON.stringify(cat).replace(/"/g, '&quot;') + ')">' +
        '<span class="owz2-cat-ic"><i class="ti ' + _nvIconFor(cat) + '"></i></span>' +
        '<span class="owz2-cat-name">' + escapeHtml(cat) + '</span>' +
        '<span class="owz2-cat-cnt">' + items.length + '</span>' +
        '<i class="ti ti-chevron-' + (isOpen ? 'down' : 'right') + ' owz2-cat-chev"></i>' +
      '</div>' +
      '<div class="owz2-cat-body"' + (isOpen ? '' : ' style="display:none;"') + '>' + rows + '</div>' +
    '</div>';
  }).join('');
}

function _owzToggleCat(cat) {
  const inp = document.getElementById('owz-search');
  if (inp && inp.value.trim()) return; // при активном поиске все группы раскрыты
  _owz.openCats[cat] = !_owz.openCats[cat];
  _owzRenderCatalog(inp ? inp.value : '');
}

function _owzAdd(cid) {
  const c = (cache.components || []).find(x => x.id === cid);
  if (!c) return;
  const ex = _owz.list.find(x => x.cid === cid);
  if (ex) ex.qty = +(ex.qty + 1).toFixed(3);
  else _owz.list.push({ id: cid, cid: cid, name: c.name, unit: c.unit || 'шт.', qty: 1 });
  _owzRenderCart();
  _owzRenderCatalog((document.getElementById('owz-search') || {}).value || '');
}

function _owzSetQty(itemId, val) {
  const ex = _owz.list.find(x => x.id === itemId);
  if (!ex) return;
  const n = parseFloat(String(val).replace(',', '.'));
  ex.qty = (isNaN(n) || n <= 0) ? 0 : n;
}

function _owzSetUnit(itemId, val) {
  const ex = _owz.list.find(x => x.id === itemId);
  if (!ex) return;
  ex.unit = (val || 'шт.').trim() || 'шт.';
}

// Частые единицы измерения для выпадашки в корзине. Если у позиции единица
// нестандартная (из справочника) — добавляем её первой, чтобы не потерять.
function _owzUnitOptions(current) {
  const base = ['шт.', 'м', 'пог.м', 'м²', 'м³', 'компл.', 'упак.', 'кг', 'л', 'набор', 'рулон'];
  const cur = (current || 'шт.').trim() || 'шт.';
  const list = base.indexOf(cur) >= 0 ? base.slice() : [cur].concat(base);
  return list.map(u =>
    '<option value="' + escapeHtml(u) + '"' + (u === cur ? ' selected' : '') + '>' + escapeHtml(u) + '</option>'
  ).join('');
}

function _owzRemove(itemId) {
  _owz.list = _owz.list.filter(x => x.id !== itemId);
  _owzRenderCart();
  _owzRenderCatalog(document.getElementById('owz-search').value);
}

function _owzRenderCart() {
  const box = document.getElementById('owz-cart');
  const cnt = document.getElementById('owz-cart-count');
  if (!box) return;
  if (cnt) cnt.textContent = _owz.list.length ? '· ' + _owz.list.length + ' поз.' : '';
  if (!_owz.list.length) {
    box.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-light);font-size:13px;border:1px dashed var(--border);border-radius:8px;">Нажимайте на позиции выше, чтобы добавить их в заказ</div>';
    return;
  }
  box.innerHTML = _owz.list.map((x, i) =>
    '<div class="owz2-crow">' +
      '<span class="owz2-c-num">' + (i + 1) + '</span>' +
      '<span class="owz2-c-name">' + escapeHtml(x.name) + '</span>' +
      '<input class="owz2-c-qty" type="number" inputmode="decimal" min="0" step="any" value="' + x.qty + '" ' +
        'onchange="_owzSetQty(' + x.id + ', this.value)">' +
      '<select class="owz2-c-unit" onchange="_owzSetUnit(' + x.id + ', this.value)" title="Единица измерения">' +
        _owzUnitOptions(x.unit) +
      '</select>' +
      '<button class="owz2-c-del" onclick="_owzRemove(' + x.id + ')" title="Убрать"><i class="ti ti-x"></i></button>' +
    '</div>'
  ).join('');
}

// Добавить позицию свободным текстом прямо в заказ (в справочник НЕ добавляем).
// Берём то, что вписано в строку поиска. Единица по умолчанию «шт.».
function _owzAddTyped() {
  const inp = document.getElementById('owz-search');
  const name = ((inp && inp.value) || '').trim();
  if (!name) { if (inp) inp.focus(); return; }
  const id = -(++_owz.custom);   // отрицательный id — кастомная строка
  _owz.list.push({ id: id, cid: null, name: name, unit: 'шт.', qty: 1 });
  if (inp) inp.value = '';
  _owzRenderCart();
  _owzRenderCatalog('');
  showToast('Добавлено в заказ: ' + name, 'success');
}

// Кнопка «Вписать»: если в поиске уже есть текст — добавляем его сразу;
// иначе спрашиваем название (и единицу) через prompt как запасной путь.
function _owzNewItem() {
  const inp = document.getElementById('owz-search');
  if (((inp && inp.value) || '').trim()) { _owzAddTyped(); return; }
  const name = (prompt('Название позиции (свободный ввод):') || '').trim();
  if (!name) return;
  const unit = (prompt('Единица измерения (шт., м, компл. …):', 'шт.') || 'шт.').trim() || 'шт.';
  const id = -(++_owz.custom);
  _owz.list.push({ id: id, cid: null, name: name, unit: unit, qty: 1 });
  _owzRenderCart();
  showToast('Позиция добавлена в заказ', 'success');
}

async function submitOrderWizard(send) {
  const supplierId = _owz.supplierId || null;
  if (!supplierId) { showToast('Выберите поставщика из списка', 'error'); return; }
  const items = _owz.list.filter(x => x.qty > 0).map(x => ({ name: x.name, unit: x.unit, qty: x.qty }));
  if (!items.length) { showToast('Добавьте хотя бы одну позицию с количеством', 'error'); return; }
  const payload = {
    supplier_id: supplierId,
    expected_date: document.getElementById('owz-expected').value || null,
    comment: document.getElementById('owz-comment').value.trim(),
    contact_phone: document.getElementById('owz-phone').value.trim(),
    items,
  };
  if (send) {
    if (!_owz.supplierEmail) {
      showToast('У поставщика не указан email — добавьте его, либо «Сохранить черновик»', 'error');
      return;
    }
  }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось создать заказ', 'error');
      return;
    }
    const created = await r.json();
    closeSupplyModal();
    cache.supplyOrders = null;
    state.currentSupplyOrderId = created.id;
    if (send) {
      // v2.45.605: не шлём вслепую — открываем превью письма (та же модалка, что
      // у «Сформировать заказ»): видно текст, можно поправить и отправить.
      try {
        const pr = await fetch(API_BASE + '/api/supply-orders/' + created.id + '/preview', {
          headers: { 'Authorization': 'Bearer ' + token },
        });
        if (pr.ok) {
          const draft = await pr.json();
          _renderOrderPreviewModal(draft);
          return;   // остаёмся на месте, поверх — окно превью
        }
      } catch (_) { /* не валимся — ниже запасной путь */ }
      // Запасной путь: превью не получили — отправляем напрямую, как раньше.
      showToast('Заказ #' + created.id + ' создан, отправляем…', 'success');
      await sendSupplyOrderByEmail(created.id);
      selectSidebarItem('supply-order-detail');
    } else {
      showToast('Черновик заказа #' + created.id + ' создан', 'success');
      selectSidebarItem('supply-order-detail');
    }
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

// ========== КАРТОЧКА ЗАКАЗА ==========

function openSupplyOrder(orderId) {
  state.currentSupplyOrderId = orderId;
  selectSidebarItem('supply-order-detail');
}

async function loadSupplyOrderDetail() {
  if (!state.currentSupplyOrderId) {
    selectSidebarItem('supply-orders');
    return;
  }
  const container = document.getElementById('sup-ord-detail');
  if (!container) return;
  container.innerHTML = '<div class="loading-block">Загружаем заказ…</div>';
  try {
    const o = await apiGet('/api/supply-orders/' + state.currentSupplyOrderId);
    cache.currentSupplyOrder = o;
    renderSupplyOrderDetail(o);
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function _fmtSupOrdTs(s) {
  if (!s) return '';
  return String(s).replace('T', ' ').substring(0, 16);
}

function renderSupplyOrderDetail(o) {
  const container = document.getElementById('sup-ord-detail');
  const canManage = canManageSupply();
  const canEdit = canManage && ['draft', 'sent', 'partial'].includes(o.status);
  const canSend = canManage && o.status === 'draft' && (o.items || []).length > 0;
  const canReceive = canManage && ['sent', 'partial'].includes(o.status);
  // FSM-переходы для нового лайфцикла снабжения
  // v2.45.35: директор может перезалить счёт на любых открытых статусах,
  // включая to_pay/paid/partial — например, если файл стёрло в storage.
  const _isDir = state.user && (state.user.roles || []).includes('director');
  const _canUploadStatuses = _isDir
    ? ['sent', 'awaiting_invoice', 'invoice_received', 'to_pay', 'paid', 'partial']
    : ['sent', 'awaiting_invoice', 'invoice_received'];
  const canUploadInvoice = canManage && _canUploadStatuses.includes(o.status);
  // v2.45.310: оплатные переходы (На оплату / Оплачен) доступны и бухгалтеру —
  // бэкенд это разрешает (accountant → to_pay/paid).
  const _isAcc = state.user && (state.user.roles || []).includes('accountant');
  const _canPayFlow = canManage || _isAcc;
  const canToPay         = _canPayFlow && o.status === 'invoice_received';
  const canMarkPaid      = _canPayFlow && o.status === 'to_pay';
  const canMarkReceived  = canManage && ['paid', 'partial'].includes(o.status);
  const canCancel        = canManage && !['received', 'cancelled', 'draft'].includes(o.status);

  let html = '';
  // Шапка с возвратом
  html += '<div class="page-header">' +
    '<button class="back-btn" onclick="selectSidebarItem(\'supply-orders\')"><i class="ti ti-arrow-left"></i></button>' +
    '<div class="page-header-title">' +
      '<i class="ti ti-file-invoice"></i>' +
      '<h1>Заказ #' + o.id + '</h1>' +
      '<span class="sup-status-pill ord-' + o.status + '" style="margin-left: 8px;">' + escapeHtml(o.status_label) + '</span>' +
    '</div>' +
    '</div>';

  // Сведения о поставщике
  html += '<div class="detail-block">' +
    '<div class="detail-block-title"><i class="ti ti-truck-loading"></i> Поставщик' +
      (o.supplier_id ? '<button class="btn btn-secondary btn-small" style="margin-left:auto;" onclick="openEditSupplier(' + o.supplier_id + ')"><i class="ti ti-mail"></i> Переписка</button>' : '') +
    '</div>' +
    '<div class="detail-grid">' +
      '<div class="detail-item"><div class="detail-label">Название</div><div class="detail-value">' + escapeHtml(o.supplier_name) + '</div></div>' +
      (o.supplier_contact ? '<div class="detail-item"><div class="detail-label">Контакт</div><div class="detail-value">' + escapeHtml(o.supplier_contact) + '</div></div>' : '') +
      (o.supplier_phone ? '<div class="detail-item"><div class="detail-label">Телефон</div><div class="detail-value">' + escapeHtml(o.supplier_phone) + '</div></div>' : '') +
      (o.supplier_email ? '<div class="detail-item"><div class="detail-label">Email</div><div class="detail-value">' + escapeHtml(o.supplier_email) + '</div></div>' : '') +
      (o.expected_date ? '<div class="detail-item"><div class="detail-label">Ожидаем</div><div class="detail-value">' + escapeHtml(o.expected_date) + '</div></div>' : '') +
      (o.order_label ? '<div class="detail-item"><div class="detail-label">Метка</div><div class="detail-value" style="font-family:ui-monospace,Consolas,monospace;">' + escapeHtml(o.order_label) + '</div></div>' : '') +
      (o.contract_number ? '<div class="detail-item"><div class="detail-label">Договор</div><div class="detail-value">№' + escapeHtml(o.contract_number) + '</div></div>' : '') +
    '</div>' +
    (o.comment ? '<div class="detail-comment">' + escapeHtml(o.comment) + '</div>' : '') +
    '</div>';

  // История переходов (только если есть хоть один таймстамп лайфцикла)
  const tsEvents = [
    { ts: o.sent_at,             label: 'Отправлен поставщику',   icon: 'send' },
    { ts: o.awaiting_invoice_at, label: 'Ждём счёт',              icon: 'clock' },
    { ts: o.invoice_received_at, label: 'Счёт получен',           icon: 'file-invoice' },
    { ts: o.to_pay_at,           label: 'Передан на оплату',      icon: 'wallet' },
    { ts: o.paid_at,             label: 'Оплачен',                icon: 'cash' },
    { ts: o.fulfilled_at,        label: 'Получено на склад',      icon: 'package' },
  ].filter(e => !!e.ts);
  if (tsEvents.length) {
    html += '<div class="detail-block">' +
      '<div class="detail-block-title"><i class="ti ti-history"></i> История</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;padding:8px 4px;">' +
        tsEvents.map(e =>
          '<div style="display:flex;align-items:center;gap:10px;font-size:13px;">' +
            '<i class="ti ti-' + e.icon + '" style="color:var(--brand);width:18px;text-align:center;"></i>' +
            '<div style="flex:1;min-width:0;color:var(--text-mid);">' + escapeHtml(e.label) + '</div>' +
            '<div style="color:var(--text-light);font-variant-numeric:tabular-nums;white-space:nowrap;">' + escapeHtml(_fmtSupOrdTs(e.ts)) + '</div>' +
          '</div>'
        ).join('') +
      '</div>' +
    '</div>';
  }

  // Счёт от поставщика — отображение и загрузка
  html += '<div class="detail-block">' +
    '<div class="detail-block-title"><i class="ti ti-receipt"></i> Счёт от поставщика</div>' +
    '<div style="padding:8px 4px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">';
  if (o.invoice_file_key && o.invoice_filename) {
    const fnEsc = escapeHtml(o.invoice_filename).replace(/'/g, "\\'");
    html += '<i class="ti ti-file-check" style="color:#0A5B41;font-size:20px;"></i>' +
      '<div style="flex:1;min-width:200px;">' +
        '<div style="font-size:13px;color:var(--text-dark);">' + escapeHtml(o.invoice_filename) + '</div>' +
        '<div style="font-size:11.5px;color:var(--text-light);">Счёт привязан к заказу</div>' +
      '</div>' +
      // v2.45.24: inline-просмотр PDF/изображения без скачивания
      '<button class="btn btn-secondary" onclick="toggleSupplyOrderInvoicePreview(' + o.id + ',\'' + fnEsc + '\')" id="sup-inv-preview-btn-' + o.id + '"><i class="ti ti-eye"></i> Просмотреть</button>' +
      '<button class="btn btn-secondary" onclick="downloadSupplyOrderInvoice(' + o.id + ')"><i class="ti ti-download"></i> Скачать</button>';
    if (canUploadInvoice) {
      html += '<button class="btn btn-secondary" onclick="uploadSupplyOrderInvoice(' + o.id + ')"><i class="ti ti-refresh"></i> Заменить</button>';
    }
    // v2.45.261: распознанные реквизиты счёта — с копированием в один клик
    if (o.invoice_number || o.invoice_total || o.invoice_delivery_term) {
      // v2.45.264: заголовок дословно как в счёте — «Счет № 05-0223915 от 11 июня 2026 г.»
      const dm = String(o.invoice_date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      const ruMonths = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                        'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
      const invDateRu = dm
        ? (parseInt(dm[3], 10) + ' ' + (ruMonths[parseInt(dm[2], 10) - 1] || dm[2]) + ' ' + dm[1] + ' г.')
        : (o.invoice_date || '');
      const invTitle = 'Счет № ' + (o.invoice_number || '—') +
        (invDateRu ? ' от ' + invDateRu : '');
      const invTotal = (o.invoice_total !== null && o.invoice_total !== undefined)
        ? Number(o.invoice_total).toLocaleString('ru-RU', { minimumFractionDigits: 2 }) : '';
      const chip = (label, copyVal, mono) =>
        '<span onclick="_copyTxt(' + JSON.stringify(String(copyVal)).replace(/"/g, '&quot;') + ')" ' +
          'title="Нажми — скопируется" ' +
          'style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;background:var(--bg);border:1px dashed var(--border);' +
          'border-radius:8px;padding:4px 10px;font-size:12.5px;' + (mono ? 'font-family:ui-monospace,Consolas,monospace;' : '') + '">' +
          label + ' <i class="ti ti-copy" style="color:var(--text-light);font-size:13px;"></i></span>';
      html += '<div style="width:100%;display:flex;gap:8px;flex-wrap:wrap;padding-top:8px;align-items:center;">' +
        payerEntityPill({ tag: o.invoice_payer_tag, short_name: o.invoice_payer_name }, true) +
        chip('<b>' + escapeHtml(invTitle) + '</b>', invTitle, false) +
        (o.invoice_number ? chip('№ ' + escapeHtml(o.invoice_number), o.invoice_number, true) : '') +
        (invTotal ? chip(escapeHtml(invTotal) + ' ₽', invTotal, true) : '') +
        (o.invoice_org ? chip(escapeHtml(o.invoice_org), o.invoice_org, false) : '') +
        // v2.45.x: срок поставки/изготовления (заметным оранжевым)
        (o.invoice_delivery_term ? '<span style="display:inline-flex;align-items:center;gap:6px;background:#FFEDD5;border:1px solid #FDBA74;color:#9A3412;border-radius:8px;padding:4px 10px;font-size:12.5px;font-weight:700;"><i class="ti ti-truck-delivery"></i> Срок поставки: ' + escapeHtml(o.invoice_delivery_term) + '</span>' : '') +
      '</div>';
      // v2.45.319: повторное распознавание (например, после «Заменить»)
      html += '<div style="width:100%;padding-top:8px;">' +
        '<button class="btn btn-secondary btn-small" id="sup-inv-parse-btn-' + o.id + '" onclick="parseSupplyOrderInvoice(' + o.id + ')">' +
          '<i class="ti ti-sparkles"></i> Распознать заново</button>' +
      '</div>';
    } else {
      html += '<div style="width:100%;padding-top:8px;">' +
        '<button class="btn btn-secondary btn-small" id="sup-inv-parse-btn-' + o.id + '" onclick="parseSupplyOrderInvoice(' + o.id + ')">' +
          '<i class="ti ti-sparkles"></i> Распознать номер и сумму</button>' +
        '<span style="font-size:11.5px;color:var(--text-light);margin-left:8px;">ИИ вытащит № счёта, дату и сумму из PDF / фото / Excel / Word</span>' +
      '</div>';
    }
  } else if (canUploadInvoice) {
    html += '<div style="flex:1;color:var(--text-light);font-size:13px;">Счёт ещё не загружен. Прикрепи PDF/Excel/фото — система автоматически переведёт заказ в статус «Счёт пришёл».</div>' +
      '<button class="btn btn-primary" onclick="uploadSupplyOrderInvoice(' + o.id + ')"><i class="ti ti-upload"></i> Загрузить счёт</button>';
  } else {
    html += '<div style="color:var(--text-light);font-size:13px;">Счёт ещё не загружен.</div>';
  }
  html += '</div>';
  // v2.45.24: контейнер inline-предпросмотра — закрыт по умолчанию
  if (o.invoice_file_key && o.invoice_filename) {
    html += '<div id="sup-inv-preview-' + o.id + '" style="display:none;padding:0 4px 8px;" data-open="0"></div>';
  }
  html += '</div>';

  // Позиции заказа
  html += '<div class="detail-block">' +
    '<div class="detail-block-title">' +
      '<i class="ti ti-list"></i> Позиции' +
      (canEdit ? '<button class="btn btn-secondary btn-small" style="margin-left: auto;" onclick="openAddOrderItem(' + o.id + ')"><i class="ti ti-plus"></i> Добавить</button>' : '') +
    '</div>';

  const items = o.items || [];
  const invItems = o.invoice_items || [];
  if (!items.length && invItems.length) {
    // v2.45.321: позиции из распознанного счёта (наименования) — только показ
    html += '<div style="font-size:12px;color:var(--text-light);padding:2px 2px 8px;display:flex;align-items:center;gap:6px;"><i class="ti ti-sparkles" style="color:var(--brand);"></i> Наименования из счёта (распознано)</div>';
    html += '<div class="oi-list">';
    invItems.forEach((it, idx) => {
      const nm = (it && it.name) ? String(it.name) : '—';
      const q = (it && it.qty !== null && it.qty !== undefined && it.qty !== '') ? it.qty : '';
      const unit = (it && it.unit) ? String(it.unit) : '';
      const priceNum = (it && it.price !== null && it.price !== undefined && it.price !== '') ? Number(it.price) : null;
      const priceStr = priceNum != null && !isNaN(priceNum) ? priceNum.toLocaleString('ru-RU') + ' ₽' : '';
      const sumStr = (q !== '' && priceNum != null && !isNaN(priceNum)) ? Math.round(Number(q) * priceNum).toLocaleString('ru-RU') + ' ₽' : '';
      html += '<div class="oi-row">' +
        '<div class="oi-body">' +
          '<div class="oi-title">' + (idx + 1) + '. ' + escapeHtml(nm) + '</div>' +
          '<div class="oi-meta">' +
            (q !== '' ? '<span>' + escapeHtml(String(q)) + (unit ? ' ' + escapeHtml(unit) : '') + '</span>' : '') +
            (priceStr ? '<span>' + priceStr + '/шт</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="oi-total">' + sumStr + '</div>' +
      '</div>';
    });
    html += '</div>';
    html += '<div style="font-size:11.5px;color:var(--text-light);padding:8px 2px;">Это позиции из счёта на оплату (не приходуются на склад). Чтобы обновить — нажми «Распознать заново».</div>';
  } else if (!items.length) {
    html += '<div class="empty-block" style="padding: 24px;"><i class="ti ti-package-off"></i>В заказе пока нет позиций' +
      (canEdit ? '<br><br><button class="btn btn-primary btn-small" onclick="openAddOrderItem(' + o.id + ')"><i class="ti ti-plus"></i> Добавить первую</button>' : '') +
      '</div>';
  } else {
    html += '<div class="oi-list">';
    items.forEach(oi => {
      const totalLine = (oi.price !== null && oi.price !== undefined) ? Math.round(oi.amount).toLocaleString('ru-RU') + ' ₽' : '';
      const receivedTag = oi.received_qty > 0
        ? '<span class="oi-received">принято ' + oi.received_qty + ' из ' + oi.qty + '</span>'
        : '';
      // v2.45.314: сверка «запрошено vs в счёте» (кол-во из распознанного счёта)
      let _invQtyTag = '';
      if (oi.invoice_qty !== null && oi.invoice_qty !== undefined) {
        const diff = Number(oi.invoice_qty) - Number(oi.qty);
        if (Math.abs(diff) < 0.001) {
          _invQtyTag = '<span style="font-size:11px;font-weight:700;color:#15803D;background:#DCFCE7;padding:1px 8px;border-radius:6px;white-space:nowrap;"><i class="ti ti-check" style="font-size:11px;"></i> в счёте ' + _fmtQty(oi.invoice_qty) + '</span>';
        } else {
          _invQtyTag = '<span style="font-size:11px;font-weight:700;color:#9A3412;background:#FEE2E2;padding:1px 8px;border-radius:6px;white-space:nowrap;" title="Расхождение с запрошенным">⚠ в счёте ' + _fmtQty(oi.invoice_qty) + ' (' + (diff > 0 ? '+' : '') + _fmtQty(diff) + ')</span>';
        }
      }
      html += '<div class="oi-row">' +
        '<div class="oi-body">' +
          '<div class="oi-title">' + escapeHtml(oi.item_name) + '</div>' +
          '<div class="oi-meta">' +
            '<span>запрошено ' + oi.qty + ' ' + escapeHtml(oi.item_unit) + '</span>' +
            _invQtyTag +
            (oi.price !== null && oi.price !== undefined ? '<span>' + oi.price + ' ₽/шт</span>' : '') +
            (oi.contract_number ? '<span class="sup-contract-badge" onclick="openContractFromSupply(' + oi.request_contract_id + ')"><i class="ti ti-link"></i>' + escapeHtml(oi.contract_number) + '</span>' : '') +
            receivedTag +
          '</div>' +
          (oi.comment ? '<div class="oi-comment">' + escapeHtml(oi.comment) + '</div>' : '') +
        '</div>' +
        '<div class="oi-total">' + totalLine + '</div>' +
        (canEdit && o.status === 'draft' ? '<div class="oi-actions"><button class="btn-icon-warning" onclick="removeOrderItem(' + oi.id + ')" title="Убрать"><i class="ti ti-x"></i></button></div>' : '') +
        '</div>';
    });
    html += '</div>';
    // Итого
    html += '<div class="oi-total-row">Итого: <strong>' + Math.round(o.total_amount || 0).toLocaleString('ru-RU') + ' ₽</strong></div>';
  }
  html += '</div>';

  // Кнопки действий
  let actions = [];
  if (canSend)    actions.push('<button class="btn btn-primary" onclick="sendOrder(' + o.id + ')"><i class="ti ti-send"></i> Отправить поставщику</button>');
  // FSM-кнопки (последовательность статусов лайфцикла)
  if (canToPay)        actions.push('<button class="btn btn-primary" onclick="transitionSupplyOrder(' + o.id + ',\'to_pay\',\'Передать на оплату?\')"><i class="ti ti-wallet"></i> На оплату</button>');
  if (canMarkPaid)     actions.push('<button class="btn btn-primary" onclick="transitionSupplyOrder(' + o.id + ',\'paid\',\'Отметить заказ как оплаченный?\')"><i class="ti ti-cash"></i> Оплачен</button>');
  if (canMarkReceived) actions.push('<button class="btn btn-primary" onclick="transitionSupplyOrder(' + o.id + ',\'received\',\'Поставка получена на склад?\')"><i class="ti ti-package-import"></i> Получено</button>');
  if (canReceive) actions.push('<button class="btn btn-secondary" onclick="openReceiveOrder(' + o.id + ')"><i class="ti ti-package-import"></i> Приёмка</button>');
  // Кнопки экспорта (доступны для черновика и отправленных)
  if (['draft', 'sent', 'partial'].includes(o.status)) {
    actions.push('<button class="btn btn-secondary" onclick="downloadSupplyOrderDocx(' + o.id + ')"><i class="ti ti-file-download"></i> Скачать DOCX</button>');
  }
  if (o.status === 'draft' && o.supplier_email) {
    actions.push('<button class="btn btn-secondary" onclick="sendSupplyOrderByEmail(' + o.id + ')"><i class="ti ti-mail-send"></i> Отправить по email</button>');
  }
  if (canCancel) {
    actions.push('<button class="btn btn-tertiary" style="color:#B91C1C;" onclick="transitionSupplyOrder(' + o.id + ',\'cancelled\',\'Отменить заказ безвозвратно?\')"><i class="ti ti-x"></i> Отменить</button>');
  }
  if (actions.length) {
    html += '<div class="detail-actions">' + actions.join('') + '</div>';
  }

  container.innerHTML = html;
}

async function openAddOrderItem(orderId) {
  if (!cache.supplyCatalog) {
    try {
      const d = await apiGet('/api/supply-items');
      cache.supplyCatalog = d.items || [];
    } catch (e) { cache.supplyCatalog = []; }
  }
  // Загрузим заявки в статусе 'new' для возможной привязки
  let openRequests = [];
  try {
    const d = await apiGet('/api/supply-requests?status=new');
    openRequests = d.requests || [];
  } catch (e) {}
  const m = document.getElementById('supply-modal');
  m.innerHTML =
    
    '<div class="modal" onclick="event.stopPropagation()">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-plus"></i> Добавить позицию в заказ</h3>' +
        '<button class="modal-close" onclick="closeSupplyModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        (openRequests.length > 0
          ? '<div class="form-group"><label>Закрыть заявку (опционально)</label>' +
              '<select id="oi-request" onchange="onPickRequestForOrderItem()">' +
                '<option value="">— заявку не привязывать —</option>' +
                openRequests.map(r => '<option value="' + r.id + '" data-item-id="' + r.item_id + '" data-qty="' + r.qty + '">#' + r.id + ' · ' + escapeHtml(r.item_name) + ' — ' + r.qty + ' ' + escapeHtml(r.item_unit) + (r.contract_number ? ' · ' + escapeHtml(r.contract_number) : '') + '</option>').join('') +
              '</select>' +
            '</div>'
          : '') +
        '<div class="form-group"><label>Позиция *</label>' +
          '<select id="oi-item">' +
            '<option value="">— выбрать —</option>' +
            cache.supplyCatalog.map(i => '<option value="' + i.id + '">' + escapeHtml(i.name) + ' (' + escapeHtml(i.unit) + ')</option>').join('') +
          '</select>' +
        '</div>' +
        '<div class="form-group form-row-2">' +
          '<div><label>Количество *</label><input type="number" id="oi-qty" min="0.001" step="any" value="1"></div>' +
          '<div><label>Цена за единицу</label><input type="number" id="oi-price" min="0" step="any" placeholder="опц."></div>' +
        '</div>' +
        '<div class="form-group"><label>Комментарий</label><input type="text" id="oi-comment"></div>' +
        '<div class="modal-actions"><button class="btn btn-primary" onclick="saveOrderItem(' + orderId + ')"><i class="ti ti-check"></i> Добавить</button></div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

function onPickRequestForOrderItem() {
  const sel = document.getElementById('oi-request');
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) return;
  const itemId = opt.dataset.itemId;
  const qty = opt.dataset.qty;
  if (itemId) document.getElementById('oi-item').value = itemId;
  if (qty)    document.getElementById('oi-qty').value = qty;
}

async function saveOrderItem(orderId) {
  const payload = {
    item_id: parseInt(document.getElementById('oi-item').value || '0') || null,
    qty:     parseFloat(document.getElementById('oi-qty').value || '0'),
    price:   parseFloat(document.getElementById('oi-price').value || '') || null,
    request_id: (function() {
      const el = document.getElementById('oi-request');
      return el && el.value ? parseInt(el.value) : null;
    })(),
    comment: document.getElementById('oi-comment').value.trim(),
  };
  if (!payload.item_id) { showToast('Выберите позицию', 'error'); return; }
  if (!payload.qty || payload.qty <= 0) { showToast('Укажите количество', 'error'); return; }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-orders/' + orderId + '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось', 'error');
      return;
    }
    showToast('Позиция добавлена', 'success');
    closeSupplyModal();
    cache.supplyOrders = null;
    cache.supplyRequests = null;
    loadSupplyOrderDetail();
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

async function removeOrderItem(oiId) {
  if (!confirm('Убрать эту позицию из заказа?')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-orders/items/' + oiId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) { showToast('Не удалось', 'error'); return; }
    showToast('Позиция убрана', 'success');
    cache.supplyOrders = null;
    cache.supplyRequests = null;
    loadSupplyOrderDetail();
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

async function sendOrder(orderId) {
  if (!confirm('Перевести заказ в статус "Отправлен"?')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-orders/' + orderId + '/send', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось', 'error');
      return;
    }
    showToast('Заказ отправлен', 'success');
    cache.supplyOrders = null;
    loadSupplyOrderDetail();
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

// ========== ЭТАП 52.2: FSM-переходы статусов и счёт от поставщика ==========

async function transitionSupplyOrder(orderId, newStatus, confirmText) {
  if (confirmText && !confirm(confirmText)) return;
  try {
    // v2.45.309: для 'paid' бэкенд требует подтверждение личным паролём —
    // общий помощник (из app-1.js) спросит пароль и повторит при необходимости.
    const res = await supplyOrderTransitionConfirmed(orderId, newStatus);
    if (res.cancelled) return;
    if (!res.ok) {
      showToast(res.message || ('Не удалось (HTTP ' + res.status + ')'), 'error');
      return;
    }
    showToast('Статус обновлён', 'success');
    cache.supplyOrders = null;
    loadSupplyOrderDetail();
  } catch (e) {
    showToast('Сеть: не удалось обновить статус', 'error');
  }
}

function uploadSupplyOrderInvoice(orderId) {
  // Создаём скрытый <input type="file"> и кликаем по нему
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,image/*';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    showToast('Загружаем счёт…', 'info');
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const r = await fetch(API_BASE + '/api/supply-orders/' + orderId + '/invoice', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: fd,
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        showToast(d.message || ('Не удалось загрузить (HTTP ' + r.status + ')'), 'error');
        return;
      }
      showToast('Счёт загружен', 'success');
      cache.supplyOrders = null;
      loadSupplyOrderDetail();
    } catch (e) {
      showToast('Сеть: не удалось загрузить счёт', 'error');
    }
  });
  document.body.appendChild(input);
  input.click();
}

// v2.45.24: раскрыть/свернуть просмотр счёта прямо в карточке (без скачивания).
// PDF и картинки рендерим inline; для остальных типов оставляем сообщение
// со ссылкой на «Скачать» — браузер не умеет показывать Excel.
// v2.45.261: копирование в буфер + тост
function _copyTxt(text) {
  const done = () => showToast('Скопировано: ' + (text.length > 40 ? text.slice(0, 40) + '…' : text), 'success');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => _copyTxtFallback(text, done));
  } else {
    _copyTxtFallback(text, done);
  }
}
function _copyTxtFallback(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { showToast('Не удалось скопировать', 'error'); }
  ta.remove();
}

// v2.45.261: распознать реквизиты счёта (номер/дата/сумма) через ИИ
async function parseSupplyOrderInvoice(orderId) {
  const btn = document.getElementById('sup-inv-parse-btn-' + orderId);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Распознаём…'; }
  try {
    const r = await fetch(API_BASE + '/api/supply-orders/' + orderId + '/invoice/parse', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(j.message || 'Не распозналось', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-sparkles"></i> Распознать номер и сумму'; }
      return;
    }
    showToast('Счёт № ' + (j.number || '—') + (j.total ? ' · ' + Number(j.total).toLocaleString('ru-RU') + ' ₽' : ''), 'success');
    loadSupplyOrderDetail();   // перерисуем карточку с чипами
  } catch (e) {
    showToast('Сеть: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-sparkles"></i> Распознать номер и сумму'; }
  }
}

async function toggleSupplyOrderInvoicePreview(orderId, filename) {
  const cont = document.getElementById('sup-inv-preview-' + orderId);
  const btn  = document.getElementById('sup-inv-preview-btn-' + orderId);
  if (!cont) return;
  if (cont.dataset.open === '1') {
    // Закрываем — освобождаем blob URL чтобы не текла память
    const node = cont.querySelector('[data-blob-url]');
    if (node && node.dataset.blobUrl) URL.revokeObjectURL(node.dataset.blobUrl);
    cont.innerHTML = '';
    cont.style.display = 'none';
    cont.dataset.open = '0';
    if (btn) btn.innerHTML = '<i class="ti ti-eye"></i> Просмотреть';
    return;
  }
  cont.innerHTML = '<div style="padding:14px;color:var(--text-light);text-align:center;">Загружаем…</div>';
  cont.style.display = 'block';
  cont.dataset.open = '1';
  if (btn) btn.innerHTML = '<i class="ti ti-eye-off"></i> Скрыть';
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-orders/' + orderId + '/invoice/download', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      // v2.45.25: показываем реальный текст от сервера (он содержит ключ файла
      // и подсказку «файл удалили из storage / сменили S3-bucket»).
      let serverMsg = '';
      try { const d = await r.json(); serverMsg = d.message || d.error || ''; } catch (e) {}
      // v2.45.35: если файла нет в storage и юзер директор — даём кнопку
      // открепить мёртвую ссылку и загрузить счёт заново.
      const isDir = state.user && (state.user.roles || []).includes('director');
      const detachBtn = isDir
        ? '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="btn btn-secondary btn-small" onclick="detachSupplyOrderInvoice(' + orderId + ')"><i class="ti ti-unlink"></i> Открепить мёртвую ссылку</button>' +
            '<button class="btn btn-primary btn-small" onclick="uploadSupplyOrderInvoice(' + orderId + ')"><i class="ti ti-upload"></i> Загрузить заново</button>' +
          '</div>'
        : '';
      cont.innerHTML = '<div style="padding:14px;color:var(--danger);font-size:13px;line-height:1.5;">' +
        '<b>Не удалось загрузить счёт (HTTP ' + r.status + ').</b>' +
        (serverMsg ? '<br><span style="color:var(--text-mid);">' + escapeHtml(serverMsg) + '</span>' : '') +
        detachBtn +
      '</div>';
      return;
    }
    const ct = (r.headers.get('Content-Type') || '').toLowerCase();
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const fn = (filename || '').toLowerCase();
    const isPdf = ct.includes('pdf') || fn.endsWith('.pdf');
    const isImg = ct.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/.test(fn);
    // v2.45.261: Excel-счёт — рисуем таблицей прямо в карточке
    const isXls = /\.(xlsx|xlsm|xls)$/.test(fn) || ct.includes('spreadsheet') || ct.includes('ms-excel');
    if (isXls) {
      URL.revokeObjectURL(url);
      try {
        const vr = await fetch(API_BASE + '/api/supply-orders/' + orderId + '/invoice/view', {
          headers: { 'Authorization': 'Bearer ' + token },
        });
        const vj = await vr.json().catch(() => ({}));
        if (vr.ok && vj.html) {
          cont.innerHTML = '<div class="xls-wrap" style="max-height:75vh;">' + vj.html + '</div>';
        } else {
          cont.innerHTML = '<div style="padding:14px;color:var(--text-light);font-size:13px;">Не удалось отрисовать Excel — скачай файл кнопкой «Скачать».</div>';
        }
      } catch (e2) {
        cont.innerHTML = '<div style="padding:14px;color:var(--text-light);font-size:13px;">Не удалось отрисовать Excel — скачай файл.</div>';
      }
      return;
    }
    if (isPdf) {
      // На компьютере PDF показываем встроенно (iframe). На телефоне браузеры
      // (особенно Huawei) PDF в iframe не рендерят — даём кнопку «Открыть PDF».
      if (state && state.isDesktop) {
        cont.innerHTML = '<iframe data-blob-url="' + url + '" src="' + url + '#view=FitH" style="width:100%;height:75vh;border:1px solid var(--border);border-radius:8px;background:#f4f4f4;"></iframe>';
      } else {
        cont.innerHTML =
          '<div data-blob-url="' + url + '" style="padding:18px;text-align:center;background:var(--bg);border:1px solid var(--border);border-radius:8px;">' +
            '<i class="ti ti-file-type-pdf" style="font-size:42px;color:#C0392B;"></i>' +
            '<div style="margin:8px 0 14px;font-size:13px;color:var(--text-mid);word-break:break-word;">' + escapeHtml(filename || 'Счёт.pdf') + '</div>' +
            '<button class="btn btn-primary" onclick="window.open(\'' + url + '\',\'_blank\')"><i class="ti ti-external-link"></i> Открыть PDF</button>' +
            '<div style="margin-top:8px;font-size:11.5px;color:var(--text-light);">или кнопка «Скачать» выше</div>' +
          '</div>';
      }
    } else if (isImg) {
      cont.innerHTML = '<img data-blob-url="' + url + '" src="' + url + '" alt="Счёт" style="max-width:100%;max-height:80vh;display:block;margin:0 auto;border:1px solid var(--border);border-radius:8px;background:#f4f4f4;" />';
    } else {
      URL.revokeObjectURL(url);
      cont.innerHTML = '<div style="padding:14px;background:var(--bg);border-radius:8px;color:var(--text-mid);font-size:13px;">Этот формат не отображается в браузере (например, Excel). Жми <b>Скачать</b>, чтобы открыть в локальной программе.</div>';
    }
  } catch (e) {
    cont.innerHTML = '<div style="padding:14px;color:var(--danger);">Ошибка загрузки счёта.</div>';
  }
}

// v2.45.35: открепить мёртвую ссылку на файл счёта (директор). Когда файл
// исчез из storage (например, ephemeral диск стёр его при редеплое), запись
// в БД продолжает указывать на потерянный ключ — заказ висит «со счётом» но
// открыть его нельзя. Эта функция чистит ссылку, после чего можно залить
// новый файл через «Заменить».
async function detachSupplyOrderInvoice(orderId) {
  if (!confirm('Открепить ссылку на счёт от заказа?\n\nЗапись в БД будет очищена. Файл из storage тоже будет удалён, если он там ещё есть. После этого можно загрузить новый счёт.')) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-orders/' + orderId + '/invoice', {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || ('HTTP ' + r.status + ': не удалось открепить'), 'error');
      return;
    }
    showToast('Ссылка на счёт откреплена', 'success');
    // Перерисуем карточку заказа целиком
    if (typeof openSupplyOrder === 'function') openSupplyOrder(orderId);
  } catch (e) { showToast('Ошибка', 'error'); }
}

async function downloadSupplyOrderInvoice(orderId) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-orders/' + orderId + '/invoice/download', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Счёт недоступен', 'error');
      return;
    }
    // Получаем имя из Content-Disposition
    const cd = r.headers.get('Content-Disposition') || '';
    let filename = 'invoice_' + orderId;
    const m = cd.match(/filename="?([^";]+)"?/i);
    if (m) filename = m[1];
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    showToast('Не удалось скачать счёт', 'error');
  }
}

// ========== ПРИЁМКА ==========

async function openReceiveOrder(orderId) {
  // Загружаем заказ заново чтобы было актуальное received_qty
  let o;
  try {
    o = await apiGet('/api/supply-orders/' + orderId);
  } catch (e) {
    showToast('Не удалось загрузить заказ', 'error');
    return;
  }
  // v2.45.46: подгружаем активные договоры — для выпадашки распределения
  if (!cache.activeContracts) {
    try {
      const r = await apiGet('/api/contracts?status=in_work');
      cache.activeContracts = (r.contracts || r.items || []).filter(c =>
        c.status === 'published' || c.status === 'production' || c.status === 'in_work'
      );
    } catch (e) { cache.activeContracts = []; }
  }
  state._recAllocations = {}; // {orderItemId: [{qty, target_contract_id}]}
  const today = new Date().toISOString().substring(0, 10);
  const m = document.getElementById('supply-modal');
  m.innerHTML =
    '<div class="modal modal-wide" onclick="event.stopPropagation()">' +
      '<div class="modal-header">' +
        '<h3><i class="ti ti-package-import"></i> Приёмка заказа #' + o.id + '</h3>' +
        '<button class="modal-close" onclick="closeSupplyModal()"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        '<div class="form-group form-row-2">' +
          '<div><label>Дата приёмки *</label><input type="date" id="rec-date" value="' + today + '"></div>' +
          '<div><label>Комментарий</label><input type="text" id="rec-comment" placeholder="опционально"></div>' +
        '</div>' +
        '<div class="rec-items-title">Что приехало (и куда):</div>' +
        '<div class="rec-items-list">' +
          (o.items || []).map(oi => {
            const remaining = oi.qty - (oi.received_qty || 0);
            if (remaining <= 0) return '';
            // По умолчанию: всё на склад одной строкой
            state._recAllocations[oi.id] = [{ qty: remaining, target_contract_id: null }];
            return _recItemBlock(oi, remaining);
          }).join('') +
        '</div>' +
        '<div class="modal-actions"><button class="btn btn-primary" onclick="saveReceipt(' + orderId + ')"><i class="ti ti-check"></i> Принять</button></div>' +
        '<div class="modal-note">Можно поделить позицию между складом и одним-двумя договорами — кнопка <i class="ti ti-plus"></i> справа добавляет ещё одну строку.</div>' +
      '</div>' +
    '</div>';
  m.classList.add('visible');
}

// v2.45.46: рендер блока позиции в приёмке (несколько allocations)
function _recItemBlock(oi, remaining) {
  const allocs = state._recAllocations[oi.id] || [];
  return '<div class="rec-item-row" data-oi-id="' + oi.id + '" id="rec-row-' + oi.id + '">' +
    '<div class="rec-item-head">' +
      '<div class="rec-item-name">' + escapeHtml(oi.item_name) +
        ' <span class="rec-item-note">' + remaining + ' ' + escapeHtml(oi.item_unit) +
        (oi.received_qty > 0 ? ' (из ' + oi.qty + ', ещё ждём)' : '') +
        '</span>' +
      '</div>' +
      '<button class="btn btn-secondary btn-small" onclick="_recAddAlloc(' + oi.id + ',' + remaining + ')" title="Добавить строку"><i class="ti ti-plus"></i></button>' +
    '</div>' +
    '<div class="rec-allocs" id="rec-allocs-' + oi.id + '">' +
      allocs.map((a, i) => _recAllocRow(oi.id, i, a, remaining)).join('') +
    '</div>' +
  '</div>';
}

function _recAllocRow(oiId, idx, alloc, remaining) {
  const contracts = cache.activeContracts || [];
  const opts = '<option value="">📦 На склад (свободный запас)</option>' +
    contracts.map(c => {
      const sel = (alloc.target_contract_id && Number(alloc.target_contract_id) === Number(c.id)) ? ' selected' : '';
      const label = (c.number || '#' + c.id) + (c.contractor_name ? ' · ' + c.contractor_name : '');
      return '<option value="' + c.id + '"' + sel + '>📋 ' + escapeHtml(label) + '</option>';
    }).join('');
  return '<div class="rec-alloc-row" data-oi="' + oiId + '" data-idx="' + idx + '">' +
    '<input type="number" class="rec-alloc-qty" min="0" max="' + remaining + '" step="any" value="' + (alloc.qty || 0) + '" oninput="_recSetAlloc(' + oiId + ',' + idx + ',\'qty\',this.value)" />' +
    '<select class="rec-alloc-target" onchange="_recSetAlloc(' + oiId + ',' + idx + ',\'target_contract_id\',this.value)">' + opts + '</select>' +
    (idx > 0
      ? '<button class="btn btn-secondary btn-small" onclick="_recRemoveAlloc(' + oiId + ',' + idx + ')" title="Убрать" style="color:var(--danger);"><i class="ti ti-x"></i></button>'
      : '<span style="width:32px;"></span>') +
  '</div>';
}

function _recSetAlloc(oiId, idx, key, val) {
  const arr = state._recAllocations[oiId];
  if (!arr || !arr[idx]) return;
  if (key === 'qty') arr[idx].qty = parseFloat(val) || 0;
  else if (key === 'target_contract_id') arr[idx].target_contract_id = val ? parseInt(val, 10) : null;
}
function _recAddAlloc(oiId, remaining) {
  const arr = state._recAllocations[oiId] || (state._recAllocations[oiId] = []);
  // Остаток = remaining минус уже распределённое
  const used = arr.reduce((s, a) => s + (parseFloat(a.qty) || 0), 0);
  arr.push({ qty: Math.max(0, remaining - used), target_contract_id: null });
  const block = document.getElementById('rec-allocs-' + oiId);
  if (block) {
    block.innerHTML = arr.map((a, i) => _recAllocRow(oiId, i, a, remaining)).join('');
  }
}
function _recRemoveAlloc(oiId, idx) {
  const arr = state._recAllocations[oiId];
  if (!arr || arr.length <= 1) return;
  arr.splice(idx, 1);
  // remaining не пересчитываем — это max-валидация, в backend всё равно проверится
  const oiRow = document.querySelector('[data-oi-id="' + oiId + '"] .rec-item-note');
  const remaining = parseFloat((oiRow?.textContent || '0').match(/\d+(\.\d+)?/)?.[0] || 0);
  const block = document.getElementById('rec-allocs-' + oiId);
  if (block) {
    block.innerHTML = arr.map((a, i) => _recAllocRow(oiId, i, a, remaining)).join('');
  }
}

async function saveReceipt(orderId) {
  // v2.45.46: собираем по каждой позиции массив allocations
  const items = [];
  Object.keys(state._recAllocations || {}).forEach(oiKey => {
    const oiId = parseInt(oiKey, 10);
    const allocs = (state._recAllocations[oiId] || []).filter(a => (parseFloat(a.qty) || 0) > 0);
    if (!allocs.length) return;
    const totalQty = allocs.reduce((s, a) => s + (parseFloat(a.qty) || 0), 0);
    items.push({
      order_item_id: oiId,
      qty: totalQty,
      allocations: allocs.map(a => ({
        qty: parseFloat(a.qty) || 0,
        target_contract_id: a.target_contract_id || null,
      })),
    });
  });
  if (!items.length) { showToast('Не указано что приехало', 'error'); return; }
  const payload = {
    order_id:      orderId,
    received_date: document.getElementById('rec-date').value,
    comment:       document.getElementById('rec-comment').value.trim(),
    items,
  };
  if (!payload.received_date) { showToast('Укажите дату', 'error'); return; }
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const r = await fetch(API_BASE + '/api/supply-receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.message || 'Не удалось', 'error');
      return;
    }
    showToast('Приёмка зарегистрирована', 'success');
    closeSupplyModal();
    cache.supplyOrders = null;
    cache.supplyReceipts = null;
    cache.supplyRequests = null;
    loadSupplyOrderDetail();
  } catch (e) {
    showToast('Ошибка', 'error');
  }
}

// ========== ПРИЁМКИ (журнал) ==========

async function loadSupplyReceipts() {
  const container = document.getElementById('sup-rec-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-block">Загружаем приёмки…</div>';
  try {
    const d = await apiGet('/api/supply-receipts');
    cache.supplyReceipts = d.receipts || [];
    renderSupplyReceipts();
  } catch (e) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-alert-triangle"></i>Ошибка: ' + escapeHtml(String(e)) + '</div>';
  }
}

function renderSupplyReceipts() {
  const container = document.getElementById('sup-rec-list');
  const list = cache.supplyReceipts || [];
  document.getElementById('sup-rec-counter').textContent = list.length;
  if (!list.length) {
    container.innerHTML = '<div class="empty-block"><i class="ti ti-package-import"></i>Приёмок пока нет</div>';
    return;
  }
  let html = '';
  list.forEach(rec => {
    html += '<div class="sup-row" onclick="openSupplyOrder(' + rec.order_id + ')">' +
      '<div class="sup-row-icon"><i class="ti ti-package-import"></i></div>' +
      '<div class="sup-row-body">' +
        '<div class="sup-row-title">Приёмка #' + rec.id + ' · заказ #' + rec.order_id + '</div>' +
        '<div class="sup-row-meta">' +
          '<span><i class="ti ti-calendar"></i>' + escapeHtml(rec.received_date) + '</span>' +
          '<span><i class="ti ti-truck-loading"></i>' + escapeHtml(rec.supplier_name || '—') + '</span>' +
          '<span><i class="ti ti-list"></i>' + rec.items_count + ' позиций</span>' +
        '</div>' +
        (rec.comment ? '<div class="sup-row-comment">' + escapeHtml(rec.comment) + '</div>' : '') +
      '</div></div>';
  });
  container.innerHTML = html;
}


// ============================================================
// ============ ПОМОЩЬ: База знаний, FAQ, Что нового ============
// ============================================================

// Статьи базы знаний. Сгруппированы по категориям.
// id — стабильный, body — массив параграфов/списков.
const HELP_ARTICLES = [
  // ---------- Гайды по шагам ----------
  {
    id: 'guide-master-first',
    cat: 'guides', cat_label: 'Гайды по шагам', icon: 'ti-tool',
    title: 'Моя первая работа (мастер) — интерактивный гайд',
    summary: 'Подсказки с подсветкой каждого шага: где найти, что нажать, как сдать.',
    body: [
      { p: 'Гайд проведёт тебя по экранам приложения с подсветкой нужных кнопок. На каждом шаге будет короткое пояснение и кнопка «Дальше».' },
      { h: 'Что покажем' },
      { ul: [
        'Где найти раздел Производства',
        'Канбан и его колонки',
        'Как открыть карточку работы',
        '«Я работаю над этим» — забрать работу',
        'Отметка прогресса 25/50/75/100%',
        'Подключение соисполнителей',
        'Сдача на проверку',
      ] },
      { tour: 'master-first-assembly', tour_label: '▶ Запустить интерактивный гайд' },
      { note: 'В любой момент можно нажать «Пропустить», чтобы закрыть подсказки и продолжить самостоятельно.' },
    ],
  },
  {
    id: 'guide-master-defect',
    cat: 'guides', cat_label: 'Гайды по шагам', icon: 'ti-alert-circle',
    title: 'Как отметить брак / доработку',
    summary: 'Короткий гайд: где зарегистрировать проблему в сборке.',
    body: [
      { p: 'Гайд покажет где в приложении регистрируются доработки и как описать проблему так, чтобы директор понял.' },
      { tour: 'master-defect-report', tour_label: '▶ Запустить интерактивный гайд' },
    ],
  },

  // ---------- Старт ----------
  {
    id: 'start-login',
    cat: 'start', cat_label: 'Старт', icon: 'ti-key',
    title: 'Как войти в систему',
    summary: 'Через Telegram-бот @AtomusgroupBot, кодом из 6 цифр.',
    body: [
      { p: 'Atomus group — это веб-приложение. Чтобы попасть внутрь, нужно подтвердить, что ты — наш сотрудник. Делается это через Telegram-бот.' },
      { h: 'Шаги входа' },
      { ol: [
        'Открой Telegram и найди бота <b>@AtomusgroupBot</b>',
        'Напиши ему команду <code>/login</code>',
        'Бот пришлёт код из 6 цифр (например, <code>483102</code>)',
        'На странице входа в приложении нажми «Войти кодом» и введи этот код',
        'Готово — ты в системе',
      ] },
      { note: 'Код одноразовый и действует 5 минут. Если не успел — запроси новый командой <code>/login</code> ещё раз.' },
      { h: 'Если не получается войти' },
      { ul: [
        'Проверь что бот в Telegram именно <b>@AtomusgroupBot</b>, без опечаток',
        'Убедись что директор уже добавил тебя в систему',
        'Если код не приходит — напиши директору, что-то могло слететь',
      ] },
    ],
  },
  {
    id: 'start-install',
    cat: 'start', cat_label: 'Старт', icon: 'ti-device-mobile',
    title: 'Как поставить приложение на телефон',
    summary: 'PWA-установка на Android и iPhone, чтобы открывать как обычное приложение.',
    body: [
      { p: 'Atomus group — это <b>PWA</b> (Progressive Web App). Ты можешь поставить его на телефон, и оно будет выглядеть и работать как обычное приложение. Никаких магазинов, никаких apk.' },
      { h: 'На Android (через Chrome)' },
      { ol: [
        'Открой приложение в Chrome — <b>atomus-pwa.vercel.app</b>',
        'Нажми меню (три точки сверху справа)',
        'Выбери «<b>Установить приложение</b>» или «Добавить на главный экран»',
        'Иконка появится на рабочем столе телефона',
      ] },
      { h: 'На iPhone (через Safari)' },
      { ol: [
        'Открой <b>atomus-pwa.vercel.app</b> в <b>Safari</b> (не Chrome!)',
        'Нажми кнопку «Поделиться» (квадрат со стрелочкой вверх)',
        'Прокрути вниз и выбери «<b>На экран Домой</b>»',
        'Подтверди — иконка появится',
      ] },
      { note: 'После установки приложение работает быстрее и без адресной строки браузера. Логин сохраняется — заново код вводить не нужно.' },
    ],
  },
  {
    id: 'start-roles',
    cat: 'start', cat_label: 'Старт', icon: 'ti-users',
    title: 'Роли и доступы',
    summary: 'Кто что может делать: директор, зам, менеджер, мастер, инженер, бухгалтер.',
    body: [
      { p: 'В системе 6 ролей. У одного человека может быть несколько ролей одновременно (например, директор + менеджер).' },
      { h: 'Директор' },
      { ul: [
        'Видит и может всё',
        'Управляет сотрудниками и их ролями',
        'Доступ ко всем разделам и настройкам',
      ] },
      { h: 'Заместитель директора' },
      { ul: [
        'Управляет Продажами (договоры, КП, контрагенты)',
        'Управляет Снабжением (заявки, заказы, поставщики)',
        'Видит Производство и Склад',
      ] },
      { h: 'Менеджер' },
      { ul: [
        'То же что зам по Продажам и Снабжению',
        'Создаёт договоры, КП, заявки на закупку',
      ] },
      { h: 'Мастер' },
      { ul: [
        'Вносит сборки в Производстве',
        'Управляет статусами сборок (готова / списана)',
        'Видит склад',
      ] },
      { h: 'Инженер' },
      { ul: [
        'Только просмотр Производства, без внесения сборок',
      ] },
      { h: 'Бухгалтер' },
      { ul: [
        'Просмотр сводок и финансовой информации',
      ] },
      { note: 'Роли назначает только директор через раздел «Сотрудники» в Производстве.' },
    ],
  },

  // ---------- Главная ----------
  {
    id: 'home-overview',
    cat: 'home', cat_label: 'Главная', icon: 'ti-home',
    title: 'Что показывает Главная страница',
    summary: 'Виджеты с задачами, KPI производства, обзор по продажам.',
    body: [
      { p: 'Главная — это твой обзор дня. Тут собрано самое важное по всем разделам, чтобы быстро понять что происходит.' },
      { h: 'Виджеты на Главной' },
      { ul: [
        '<b>Мои задачи</b> — задачи, назначенные на тебя, со статусами и дедлайнами',
        '<b>KPI Производства</b> — сколько собрано сегодня, за неделю, за месяц',
        '<b>Динамика 14 дней</b> — график сборок по дням',
        '<b>Топ сборщиков</b> — кто больше всего собрал за неделю',
        '<b>Последние записи</b> — недавно внесённые сборки',
      ] },
      { note: 'Виджеты подстраиваются под твою роль. Например, мастер видит свои сборки, директор — общие KPI.' },
    ],
  },

  // ---------- Производство ----------
  {
    id: 'prod-new-assembly',
    cat: 'production', cat_label: 'Производство', icon: 'ti-circle-plus',
    title: 'Как внести новую сборку',
    summary: 'Пошагово: модель, исполнение, IP, количество, сборщики, дата.',
    body: [
      { p: 'Сборку вносишь когда уже собрал изделие. Это не «план», а факт — то что реально готово.' },
      { h: 'Шаги' },
      { ol: [
        'Открой <b>Производство → Новая сборка</b> (или кнопка «+» в шапке)',
        'Выбери <b>модель</b> из каталога (можно искать по названию или артикулу)',
        'Если у модели есть варианты исполнения — выбери <b>Стандарт</b> или <b>Нерж. AISI</b>',
        'Если нужен IP-класс — выбери его (IP54, IP55 и т.п.)',
        'Укажи <b>количество</b> (обычно 1, но может быть больше)',
        'Отметь <b>кто собирал</b> — одного или нескольких сборщиков',
        'Поставь <b>дату</b> сборки (по умолчанию сегодня)',
        'Если нужно — добавь <b>комментарий</b>',
        'Выбери куда сборка пойдёт: <b>«На склад»</b> (свободная) или <b>«По договору»</b> (зарезервированная)',
        'Нажми <b>«Сохранить»</b>',
      ] },
      { note: 'После сохранения сборка автоматически попадает на склад со статусом «готова». Если выбрал договор — она зарезервирована за ним и видна в карточке этого договора.' },
      { h: 'Что если ошибся' },
      { p: 'Открой нужную сборку в журнале и поправь. Если уже списали или отгрузили — нужно сначала откатить движение со склада.' },
    ],
  },
  {
    id: 'prod-journal',
    cat: 'production', cat_label: 'Производство', icon: 'ti-list-details',
    title: 'Журнал сборок и фильтры',
    summary: 'Где смотреть свои сборки, как найти нужную запись.',
    body: [
      { p: 'Все сборки попадают в журнал. Производство → Сборки.' },
      { h: 'Фильтры' },
      { ul: [
        '<b>Период</b> — день / неделя / месяц / произвольная дата',
        '<b>Направление</b> — отопление, вентиляция и т.д.',
        '<b>Сборщик</b> — фильтр по конкретному сотруднику',
        '<b>Поиск</b> — по модели или артикулу',
      ] },
      { h: 'Что видно в строке' },
      { ul: [
        'Дата сборки',
        'Модель + артикул',
        'Исполнение и IP-класс',
        'Сборщики',
        'Бейдж «склад» (свободная) или номер договора (зарезервирована)',
      ] },
    ],
  },
  {
    id: 'prod-summary',
    cat: 'production', cat_label: 'Производство', icon: 'ti-chart-bar',
    title: 'Что показывают сводки',
    summary: 'Графики по направлениям, топ моделей и сборщиков.',
    body: [
      { p: 'Раздел <b>Производство → Сводки</b> показывает аналитику за выбранный период.' },
      { h: 'Что есть' },
      { ul: [
        '<b>По направлениям</b> — сколько собрано каждого типа',
        '<b>Топ моделей</b> — что собирали чаще всего',
        '<b>Топ сборщиков</b> — кто больше всего работал',
        '<b>Динамика</b> — график по дням',
      ] },
      { note: 'Период переключается в шапке: день / неделя / месяц / произвольный диапазон.' },
    ],
  },

  // ---------- Продажи ----------
  {
    id: 'sales-new-contract',
    cat: 'sales', cat_label: 'Продажи', icon: 'ti-file-plus',
    title: 'Как создать новый договор',
    summary: 'Контрагент, номер, дата, тип, юрлицо, менеджер, доставка.',
    body: [
      { p: 'Договор — это центральная сущность Продаж. К нему привязываются сборки, задачи, заявки на закупку.' },
      { h: 'Шаги' },
      { ol: [
        'Открой <b>Продажи → Новый договор</b>',
        'Выбери <b>контрагента</b> (или создай нового через «+» рядом с полем)',
        'Укажи <b>номер договора</b> — как у вас принято в учёте',
        'Поставь <b>дату подписания</b>',
        'Выбери <b>тип</b>: «Только поставка», «Поставка + монтаж» или «Только монтаж»',
        'Выбери <b>юрлицо</b>, от которого работаем (ООО Атомус или ООО ТД Атомус)',
        'Укажи <b>сумму</b> (опционально)',
        'Поставь <b>дату доставки</b> и адрес',
        'Назначь <b>менеджера</b> (по умолчанию — ты)',
        'При необходимости добавь комментарий',
        'Сохрани',
      ] },
      { note: 'Новый договор сразу попадает в статус «В производстве». Если есть готовые сборки — их можно сразу к нему привязать.' },
    ],
  },
  {
    id: 'sales-offers',
    cat: 'sales', cat_label: 'Продажи', icon: 'ti-file-invoice',
    title: 'Как составить КП (коммерческое предложение)',
    summary: 'Подбор позиций из каталога, скидки, экспорт в PDF и Word.',
    body: [
      { p: 'КП собирается из <b>продажной номенклатуры</b>. Это не модели сборок, а готовый каталог товаров с ценами.' },
      { h: 'Шаги' },
      { ol: [
        'Открой <b>Продажи → КП → Новое КП</b>',
        'Выбери контрагента (или впиши потенциального клиента)',
        'Добавь позиции из каталога: модель/товар, количество, цена',
        'При нужде укажи скидку (в % или сумму)',
        'Выбери юрлицо и ставку НДС',
        'Сохрани',
      ] },
      { h: 'Экспорт' },
      { ul: [
        'Открой готовое КП → кнопка <b>«Скачать PDF»</b> — выгрузит документ с логотипом для отправки клиенту',
        'Или <b>«Скачать DOCX»</b> — Word-файл для правок',
      ] },
      { note: 'Если КП согласовали — можно создать договор «на основе КП» одной кнопкой, перенесутся контрагент и сумма.' },
    ],
  },
  {
    id: 'sales-contractors',
    cat: 'sales', cat_label: 'Продажи', icon: 'ti-users',
    title: 'Контрагенты',
    summary: 'Справочник клиентов: реквизиты, контакты, история договоров.',
    body: [
      { p: 'Контрагенты — это клиенты. Раздел <b>Продажи → Контрагенты</b>.' },
      { h: 'Что хранится' },
      { ul: [
        'Название (юр. + краткое)',
        'ИНН',
        'Контактные лица, телефоны, email',
        'Адрес',
        'Комментарий',
      ] },
      { h: 'Карточка контрагента' },
      { p: 'В карточке видно всю историю — какие договоры были, статусы, суммы. Удобно для звонка повторному клиенту.' },
    ],
  },
  {
    id: 'sales-products',
    cat: 'sales', cat_label: 'Продажи', icon: 'ti-package',
    title: 'Продажная номенклатура',
    summary: 'Каталог товаров и услуг для КП — категории, цены, описания.',
    body: [
      { p: 'Это не то же что модели сборок! Это <b>продажный каталог</b> — то, что продаём клиентам.' },
      { h: 'Структура' },
      { ul: [
        '<b>Категории</b> — например, «Шкафы», «Кабели», «Услуги монтажа»',
        '<b>Позиции</b> — в каждой категории свой набор товаров',
        'У позиции: название, артикул, единица измерения, цена, описание',
      ] },
      { h: 'Связь с моделями сборок' },
      { p: 'Позицию каталога можно <b>связать</b> с моделью сборки — тогда при добавлении в КП будет ясно «эту позицию мы собираем сами».' },
    ],
  },
  {
    id: 'sales-catalog',
    cat: 'sales', cat_label: 'Продажи', icon: 'ti-books',
    title: 'Каталог оборудования (новый)',
    summary: 'Структурированный каталог поставщика на 8 разделов с подбором по параметрам, фото и фильтрами.',
    body: [
      { p: 'Раздел <b>Продажи → Каталог оборудования</b> — это отдельный структурированный справочник: 8 разделов (Компрессоры, Воздухоохладители, Конденсаторы, Теплообменники, Холодильная автоматика, Электронные устройства, Материалы и запчасти, Хладагенты и масла) со специальным набором полей под каждую категорию.' },
      { h: 'Отличие от Продажной номенклатуры' },
      { ul: [
        '<b>Продажная номенклатура</b> — то что мы реально продаём клиенту (КП)',
        '<b>Каталог оборудования</b> — то из чего мы выбираем; имеет артикул, бренд, мощность, габариты, cooling_data',
      ] },
      { h: 'Навигация' },
      { ul: [
        '8 круглых табов сверху — переключение разделов',
        'Чипы <b>«Тип»</b> (двухпоточные / кубические / наклонные / компактные / шокфростеры) — фильтр поверх категории',
        'Чипы <b>«Бренд»</b> — Belief / Karyer / ECO Modine / SECOP …',
        '<b>Поиск</b> по артикулу / названию / бренду / серии (350 мс дебаунс)',
        'Фильтры комбинируются (AND): можно «Karyer + кубические + 450»',
      ] },
      { h: 'Карточка позиции' },
      { ul: [
        'Кликаешь по строке → большая модалка с бейджем поставщика, габаритами (Bento), характеристиками и таблицей холодопроизводительности (для air_cooler)',
        'Цена показывается в EUR с НДС; если нет — «по запросу»',
      ] },
      { h: 'Подбор по параметрам' },
      { p: 'Кнопка <b>«Подбор по мощности»</b> или <b>«Подбор по характеристикам»</b>. Открывает форму с динамическими полями — для воздухоохладителей это <code>required_power_kw, To, DT, refrigerant</code>; для автоматики — <code>subtype, connection</code>. Результаты ранжируются с маркерами: 🟢 +20%, 🟡 +5%, 🔴 -12% (power-based) или «Точно / Частично» (filter-based).' },
    ],
  },
  {
    id: 'sales-catalog-import',
    cat: 'sales', cat_label: 'Продажи', icon: 'ti-file-import',
    title: 'Импорт каталога из PDF / Excel',
    summary: 'Залить весь каталог поставщика одним файлом — AI или прямой парсинг.',
    body: [
      { p: 'Кнопки <b>«Импорт PDF»</b> и <b>«Импорт Excel-прайса»</b> в шапке каталога — для массового заполнения.' },
      { h: 'PDF (через AI Claude)' },
      { ul: [
        'Грузишь PDF-секцию каталога поставщика (до 50 МБ)',
        'Сервер режет на куски по 10 страниц, гоняет каждый через Claude API',
        'Прогресс-бар: «чанк X из N · найдено позиций: K»',
        'По завершении — превью таблицы; жмёшь «Загрузить в каталог»',
        'Идёт в фоне — закроешь модалку, продолжится',
      ] },
      { note: 'Для целого каталога 500+ страниц стоимость API ~$1-2. Лучше резать на разделы (одна серия = один pdf, 5-30 стр).' },
      { h: 'Excel (прямой парсинг, без AI)' },
      { ul: [
        'Грузишь xlsx с прайсом — структура «артикул, наименование, ед. изм., цена с НДС, валюта»',
        'Один лист = одна категория; маппинг по префиксу (18→Воздухоохладители, 19→Конденсаторы, 22→Автоматика и т.д.)',
        'AI не используется — парсится напрямую через openpyxl, очень быстро',
        'Из названия выделяется код производителя (Belief BS-…, Karyer EA-/ED-, SECOP NL/SC…) — позиции с уже залитым артикулом обновляются ценой',
      ] },
    ],
  },

  // ---------- Задачи ----------
  {
    id: 'tasks-new',
    cat: 'tasks', cat_label: 'Задачи', icon: 'ti-circle-plus',
    title: 'Как поставить задачу',
    summary: 'Название, исполнитель, дедлайн, приоритет, привязка к договору.',
    body: [
      { p: 'Задачи — для всего что нужно сделать вручную: позвонить клиенту, согласовать спецификацию, выехать на объект.' },
      { h: 'Шаги' },
      { ol: [
        'Открой <b>Задачи → Новая задача</b>',
        'Напиши <b>название</b> (коротко, до 200 символов)',
        'Опционально — подробное <b>описание</b>',
        'Выбери <b>исполнителя</b>',
        'Поставь <b>дедлайн</b> (если есть)',
        'Выбери <b>приоритет</b>: обычный / срочный / низкий',
        'Если задача по конкретному договору — <b>привяжи к нему</b>',
        'Сохрани',
      ] },
      { note: 'Исполнитель получит уведомление в Telegram-бот. За день до дедлайна — ещё одно напоминание.' },
    ],
  },
  {
    id: 'tasks-contracts',
    cat: 'tasks', cat_label: 'Задачи', icon: 'ti-link',
    title: 'Привязка задач к договорам',
    summary: 'Как создать задачу из карточки договора и видеть все задачи по нему.',
    body: [
      { p: 'Если задача относится к конкретному договору — привяжи её. Это упорядочит работу.' },
      { h: 'Как создать задачу из договора' },
      { ol: [
        'Открой нужный договор в <b>Продажах</b>',
        'Прокрути вниз до блока «Задачи по договору»',
        'Нажми «<b>+ Новая задача</b>»',
        'Привязка к договору заполнится автоматически',
      ] },
      { h: 'Как видеть задачи договора' },
      { ul: [
        'В карточке договора — блок «Задачи по договору» со счётчиком',
        'В строке задачи — синий бейдж с номером договора, клик ведёт в договор',
      ] },
    ],
  },

  // ---------- Склад ----------
  {
    id: 'wh-stock',
    cat: 'warehouse', cat_label: 'Склад', icon: 'ti-stack-2',
    title: 'Остатки на складе',
    summary: 'Что лежит, что свободно, что зарезервировано.',
    body: [
      { p: 'На складе лежат <b>готовые сборки</b>. Каждая сборка после внесения автоматически попадает сюда.' },
      { h: 'Фильтры остатков' },
      { ul: [
        '<b>Все</b> — все готовые сборки',
        '<b>Свободные</b> — не привязаны к договору, можно отгрузить куда угодно',
        '<b>Зарезервированные</b> — привязаны к договору, ждут отгрузки именно по нему',
      ] },
      { h: 'Сводка сверху' },
      { p: 'Три цифры в шапке: <b>Всего на складе</b>, <b>Свободных</b>, <b>Зарезервировано</b>.' },
      { note: 'Клик по строке открывает карточку сборки с историей всех движений.' },
    ],
  },
  {
    id: 'wh-ship',
    cat: 'warehouse', cat_label: 'Склад', icon: 'ti-truck-delivery',
    title: 'Как отгрузить сборки по договору',
    summary: 'Кнопка «Отгрузить по договору» в карточке договора.',
    body: [
      { p: 'Когда договор готов к отгрузке — все зарезервированные сборки можно списать одной кнопкой.' },
      { h: 'Шаги' },
      { ol: [
        'Открой нужный <b>договор</b> в Продажах',
        'В блоке «Готовность по сборкам» появится зелёная кнопка <b>«Отгрузить по договору (готово N)»</b>',
        'Жми → подтверди',
        'Все готовые сборки этого договора уйдут со склада, статус сборок изменится на «отгружена»',
      ] },
      { note: 'В Журнале движений склада появится запись о расходе с привязкой к договору.' },
    ],
  },
  {
    id: 'wh-writeoff',
    cat: 'warehouse', cat_label: 'Склад', icon: 'ti-trash',
    title: 'Как списать брак',
    summary: 'Удаление сборки со склада с указанием причины.',
    body: [
      { p: 'Если сборку повредили, обнаружили брак или потеряли — её нужно списать.' },
      { h: 'Шаги' },
      { ol: [
        'Открой <b>Склад → Остатки</b>',
        'Кликни на нужную сборку → откроется модалка',
        'Нажми <b>«Списать»</b> (красная иконка корзины)',
        'Укажи <b>причину</b> (брак, потеря, бой и т.п.)',
        'Подтверди',
      ] },
      { note: 'Списание попадёт в Журнал движений с пометкой причины и автора. Откатить нельзя — будь внимателен.' },
    ],
  },
  {
    id: 'wh-journal',
    cat: 'warehouse', cat_label: 'Склад', icon: 'ti-history',
    title: 'Журнал движений склада',
    summary: 'История приходов, расходов и списаний.',
    body: [
      { p: 'Все события склада записываются в журнал. Это полная история «что и когда произошло».' },
      { h: 'Типы движений' },
      { ul: [
        '<span style="color:#16a34a;"><b>+ Приход</b></span> — сборка пришла на склад (автоматически при внесении)',
        '<span style="color:#dc2626;"><b>− Расход</b></span> — сборка отгружена по договору',
        '<span style="color:#C18B00;"><b>− Списание</b></span> — сборка списана (брак, бой)',
      ] },
      { note: 'Клик по строке журнала открывает карточку сборки с её полной историей.' },
    ],
  },
  {
    id: 'wh-component-ten',
    cat: 'warehouse', cat_label: 'Склад', icon: 'ti-bolt',
    title: 'Комплектующее ТЭН: куда идёт + кВт + AISI',
    summary: 'Для ТЭНа можно указать целевые модели — авто-замена в их BOM.',
    body: [
      { p: 'Когда в форме «Редактировать комплектующее» выбрана категория с «ТЭН» в названии — появляются дополнительные поля специально для ТЭНов.' },
      { h: 'Особенности формы для ТЭНов' },
      { ul: [
        '<b>Исполнение материала</b> заблокировано на <b>AISI (нержавейка)</b> — переключатель disabled, потому что ТЭНы у нас всегда нержавейка',
        '<b>Куда идёт</b> — multi-select моделей из номенклатуры оборудования (можно выбрать сразу несколько: и обычный НПВ, и нержавеющий)',
        '<b>Мощность, кВт</b> — числовое поле',
      ] },
      { h: 'Автоматическое обновление BOM' },
      { p: 'При сохранении ТЭНа с указанными моделями <b>сервер сам синхронизирует BOM</b>:' },
      { ol: [
        'В BOM каждой указанной модели <b>удаляются все компоненты той же категории</b> (старые ТЭНы)',
        'Добавляется этот ТЭН с qty=1, is_critical=1',
        'Тост покажет: «Сохранено · Обновлено BOM в N моделях, удалено старых ТЭНов: K»',
      ] },
      { note: 'Если убрать модель из списка «Куда идёт» — ТЭН останется в BOM этой модели (автоудаления нет). Если нужно его убрать оттуда — открой BOM модели и сделай вручную.' },
    ],
  },

  // ---------- Снабжение ----------
  {
    id: 'sup-flow',
    cat: 'supply', cat_label: 'Снабжение', icon: 'ti-arrow-narrow-right',
    title: 'Общий процесс снабжения',
    summary: 'Заявка → Заказ → Приёмка. Как всё связано.',
    body: [
      { p: 'Снабжение работает по цепочке: <b>заявка → заказ → приёмка</b>. Каждый шаг автоматически тянет статусы дальше.' },
      { h: 'Этап 1: Заявка' },
      { p: 'Кому-то что-то нужно купить. Менеджер создаёт заявку: «нужно 50 м² листа 1.5мм к 20 мая». Статус заявки — <b>«новая»</b>.' },
      { h: 'Этап 2: Заказ' },
      { p: 'Снабженец собирает заявки и формирует заказ конкретному поставщику. При добавлении заявки в заказ статус заявки меняется на <b>«в заказе»</b>.' },
      { h: 'Этап 3: Отправка' },
      { p: 'Когда в заказе всё нужное — жмёшь «Отправить поставщику». Статус заказа: <b>«отправлен»</b>.' },
      { h: 'Этап 4: Приёмка' },
      { p: 'Поставщик привёз — оформляешь приёмку. Указываешь сколько и чего реально приехало. Статусы пересчитываются автоматически.' },
      { note: 'Если приёмка частичная — заказ остаётся открытым в статусе «частично», можно потом доприходовать остаток.' },
    ],
  },
  {
    id: 'sup-supplier',
    cat: 'supply', cat_label: 'Снабжение', icon: 'ti-truck-loading',
    title: 'Добавить поставщика',
    summary: 'Справочник поставщиков с контактами и ИНН.',
    body: [
      { h: 'Шаги' },
      { ol: [
        'Открой <b>Снабжение → Поставщики</b>',
        'Нажми <b>«+ Добавить поставщика»</b>',
        'Заполни обязательное поле — название',
        'Опционально: ИНН, контактное лицо, телефон, email, комментарий',
        'Сохрани',
      ] },
      { note: 'Поставщик нужен чтобы оформлять заказы. Без него заказ не создать.' },
    ],
  },
  {
    id: 'sup-catalog',
    cat: 'supply', cat_label: 'Снабжение', icon: 'ti-list-details',
    title: 'Каталог закупаемой номенклатуры',
    summary: 'Что закупаем: комплектующие и товары для перепродажи.',
    body: [
      { p: 'Каталог закупок — это <b>не</b> модели сборок и не продажная номенклатура. Это отдельный список того что мы покупаем у поставщиков.' },
      { h: 'Два типа' },
      { ul: [
        '<b>Комплектующие</b> — для сборок (металл, кабели, реле, корпуса)',
        '<b>Товары для перепродажи</b> — то что покупаем и продаём как есть',
      ] },
      { h: 'Как добавить позицию' },
      { ol: [
        'Снабжение → Каталог → «+ Добавить позицию»',
        'Название (например, «Лист стальной 1.5мм»)',
        'Тип: Комплектующее или Для перепродажи',
        'Единица измерения (шт, м, м², кг и т.п.)',
        'Опциональный комментарий',
      ] },
    ],
  },
  {
    id: 'sup-request',
    cat: 'supply', cat_label: 'Снабжение', icon: 'ti-clipboard-list',
    title: 'Создать заявку на закупку',
    summary: 'Что нужно купить, в каком количестве, к какой дате.',
    body: [
      { p: 'Заявка — это «хотелка»: что и когда нужно. Сама по себе заявка ничего не покупает — её ещё надо включить в заказ поставщику.' },
      { h: 'Шаги' },
      { ol: [
        'Снабжение → Заявки → «+ Новая заявка»',
        'Выбери <b>позицию</b> из каталога (если её нет — сначала добавь в каталог)',
        'Укажи <b>количество</b>',
        'Поставь <b>дату «нужно к»</b> (опционально)',
        'Опционально привяжи к <b>договору</b> — будет видно, под какой проект',
        'Сохрани',
      ] },
      { note: 'Свежие заявки видны с бейджем «новая». Когда снабженец добавит их в заказ — станут «в заказе».' },
    ],
  },
  {
    id: 'sup-order',
    cat: 'supply', cat_label: 'Снабжение', icon: 'ti-file-invoice',
    title: 'Создать заказ поставщику',
    summary: 'Собрать заявки в один заказ и отправить поставщику.',
    body: [
      { h: 'Шаги' },
      { ol: [
        'Снабжение → Заказы → «+ Новый заказ»',
        'Выбери <b>поставщика</b>',
        'Укажи ожидаемую дату приёмки и комментарий',
        'Жми <b>«Создать черновик»</b> — откроется карточка заказа',
        'В карточке нажми <b>«+ Добавить»</b> в блоке позиций',
        'В модалке можешь выбрать <b>«Закрыть заявку»</b> из выпадающего списка — позиция и количество подставятся автоматически. Или добавь позицию вручную.',
        'Укажи цену за единицу (опционально)',
        'Когда все позиции добавлены — нажми <b>«Отправить поставщику»</b>',
      ] },
      { note: 'После отправки заказ нельзя «откатить», но можно добавлять/убирать позиции пока он не принят.' },
    ],
  },
  {
    id: 'sup-shopping',
    cat: 'supply', cat_label: 'Снабжение', icon: 'ti-shopping-cart-plus',
    title: 'Что закупить (единый список)',
    summary: 'Список всего что надо купить — по поставщикам, с массовым назначением и экспортом.',
    body: [
      { p: 'Раздел <b>Снабжение → Что закупить</b> автоматически собирает позиции, которые надо закупить, и группирует их по поставщикам. Это первое что видит снабженец утром.' },
      { h: 'Откуда берутся позиции' },
      { ul: [
        '<b>Низкий остаток</b>: <code>qty_on_stock ≤ min_stock</code> для компонентов где задан минимум',
        '<b>Дефицит под план</b>: чего не хватит для активных договоров (статусы «в производстве», «готов», «частично отгружен») с учётом уже собранных сборок',
        'Объединяются по component_id — одна позиция = одна строка',
      ] },
      { h: 'Рекомендованное количество' },
      { p: 'Формула: <code>recommended_qty = ⌈max(до_минимума, дефицит_плана) × 1.2⌉</code>. Округление вверх + 20% запас.' },
      { h: 'Группы' },
      { ul: [
        'Каждый поставщик — своя карточка с синей шапкой, контактами (ИНН / email / телефон) и кнопкой <b>«Скачать DOCX»</b>',
        '<b>(поставщик не назначен)</b> — янтарная карточка для позиций без default_supplier_id',
      ] },
      { h: 'Назначить поставщика' },
      { ul: [
        'На каждой строке в группе «не назначен» — кнопка <b>[🚚 Поставщик]</b> → выбираешь поставщика, позиция перепрыгивает в нужную карточку',
        'Для массового назначения — поставь <b>галочки</b> на нескольких строках, появится янтарная панель «Выбрано N · [Назначить поставщика всем]»',
        'Чекбокс в шапке таблицы выбирает все позиции группы сразу',
      ] },
      { note: 'Чтобы поставщик появился в выборе — заведи его в Снабжение → Поставщики. Иначе позиция останется в группе «не назначен».' },
    ],
  },
  {
    id: 'sup-receipt',
    cat: 'supply', cat_label: 'Снабжение', icon: 'ti-package-import',
    title: 'Оформить приёмку',
    summary: 'Зафиксировать что и сколько реально приехало.',
    body: [
      { p: 'Когда товар привезли — фиксируем приёмку. Это закрывает заявки и обновляет статус заказа.' },
      { h: 'Шаги' },
      { ol: [
        'Открой нужный заказ в <b>Снабжение → Заказы</b>',
        'Нажми <b>«Принять приёмку»</b>',
        'Поставь <b>дату приёмки</b> (по умолчанию сегодня)',
        'Для каждой позиции укажи <b>сколько реально приехало</b>',
        '   • Если позиция приехала вся — оставь подставленное число',
        '   • Если приехала частично — впиши сколько по факту',
        '   • Если совсем не приехала — поставь 0',
        'Нажми <b>«Принять»</b>',
      ] },
      { h: 'Что произойдёт автоматически' },
      { ul: [
        'Если весь заказ закрыт — статус заказа станет <b>«получен»</b>',
        'Если что-то не приехало — статус станет <b>«частично»</b>, можно потом доприходовать',
        'Связанные заявки перейдут в <b>«получена»</b>',
        'В Журнале приёмок появится новая запись',
      ] },
    ],
  },

  // ============ QR-КОДЫ ============
  {
    id: 'qr-overview', cat: 'qr', cat_label: 'QR-коды', icon: 'ti-qrcode',
    title: 'Что такое QR-коды в Atom CRM',
    summary: 'Каждая сборка и каждый договор получают свой уникальный QR-код. Зачем и как его использовать.',
    body: [
      { p: 'QR-коды — это «быстрая ссылка» на карточку сборки или договора. Просто навёл камерой — и сразу видишь всю информацию, не надо ничего искать в системе.' },
      { h: 'Что зашифровано в QR' },
      { p: 'В QR-коде записан короткий уникальный токен (например, <code>abc7xkz9</code>). По нему открывается ссылка вида <code>atomus-pwa.vercel.app/a/abc7xkz9</code> для сборки или <code>/c/abc7xkz9</code> для договора.' },
      { h: 'Что произойдёт при сканировании' },
      { ul: [
        '<b>Сотрудник (залогинен в CRM)</b> — сразу попадёт в карточку сборки/договора <i>внутри приложения</i> со всеми деталями и возможностью редактировать',
        '<b>Не сотрудник</b> (например, монтажник субподрядчика) — увидит <i>публичную мини-страницу</i> с базовой информацией: модель, артикул, статус, история. Без секретных данных.',
      ] },
      { h: 'Где взять QR-коды' },
      { ul: [
        '<b>На сборках</b> — в карточке сборки кнопка <i class="ti ti-qrcode"></i> QR (вверху справа)',
        '<b>На договорах</b> — в карточке договора аналогичная кнопка',
        '<b>Печать наклеек 58×60мм</b> — Склад → Остатки → отметь сборки чекбоксами → кнопка «Печать наклеек»',
      ] },
      { note: 'Сканировать можно как обычной камерой телефона (откроется ссылка в браузере), так и встроенным сканером в CRM — кнопка <b>📷 Скан</b> в шапке системы. Сканер в CRM удобнее: сразу переходит в карточку без перепрыгивания между приложениями.' },
    ],
  },
  {
    id: 'qr-print-labels', cat: 'qr', cat_label: 'QR-коды', icon: 'ti-printer',
    title: 'Печать QR-наклеек на термопринтере',
    summary: 'Пошаговая инструкция: как массово напечатать наклейки 58×60мм для сборок на складе.',
    body: [
      { h: 'Что понадобится' },
      { ul: [
        '🖨 <b>Термопринтер</b> для этикеток 58мм (например, Xprinter XP-420B или HPRT HT300)',
        '🏷 <b>Рулон термонаклеек</b> 58×60мм (продаются на Озон, Wildberries, в специализированных магазинах)',
        '💻 Планшет или компьютер с доступом в CRM',
      ] },
      { h: 'Как массово напечатать' },
      { ol: [
        'Открой <b>Склад → Остатки</b>',
        'Отметь чекбоксами те сборки, на которые нужны наклейки',
        'Внизу появится панель «Выбрано N · Печать наклеек»',
        'Нажми <b>«Печать наклеек»</b> — откроется экран предпросмотра',
        'Нажми <b>Ctrl+P</b> (или иконку 🖨 в шапке экрана)',
        'В диалоге печати выбери свой термопринтер',
        'Размер бумаги поставится автоматически 58×60мм',
        'Нажми «Печать»',
      ] },
      { h: 'Печать одной наклейки из карточки сборки' },
      { ol: [
        'Открой карточку любой сборки (через Склад или Производство)',
        'Нажми кнопку <i class="ti ti-qrcode"></i> <b>QR</b> в шапке карточки',
        'В модалке нажми <b>«Печать наклейки»</b>',
        'Дальше так же — Ctrl+P → выбрать принтер',
      ] },
      { note: 'На наклейке печатается: «ATOM CRM» (вверху), QR-код, артикул сборки (например, «ЩУ-003-005»), модель и дата сборки. Размер QR подобран так, чтобы сканировался телефоном с расстояния 10–20 см.' },
    ],
  },
  {
    id: 'qr-scanner', cat: 'qr', cat_label: 'QR-коды', icon: 'ti-scan',
    title: 'Как сканировать QR в приложении',
    summary: 'Кнопка «Скан» в шапке + три способа: камера, фото из галереи, ручной ввод.',
    body: [
      { p: 'В шапке CRM есть кнопка <b>📷 Скан</b> — она открывает встроенный сканер. После распознавания QR ты автоматически попадёшь в карточку сборки или договора <i>внутри приложения</i>.' },
      { h: 'Три способа сканировать' },
      { ol: [
        '<b>📷 Камерой</b> — наведи на QR-код наклейки, через 1–2 секунды распознается',
        '<b>🖼 Из галереи</b> — если QR не распознаётся (плохой свет, размытость), сфотографируй обычной камерой → в сканере жми <b>иконку фото</b> → выбери снимок. Декодирование статичной картинки работает лучше',
        '<b>⌨ Ручной ввод</b> — если совсем не получается, можно ввести URL или токен вручную',
      ] },
      { h: 'Если сканер ничего не находит' },
      { ul: [
        'Отойди от QR <b>дальше</b> (10–20 см) — у многих телефонов минимальная дистанция фокуса',
        'Убедись что хорошее <b>освещение</b>',
        'Попробуй <b>фото из галереи</b> — самый надёжный способ',
        'Проверь что есть <b>интернет</b> — без него карточка не откроется',
      ] },
      { note: 'Сканер работает только когда ты залогинен. Если нет интернета — QR ничего не сделает. Альтернатива: можно отсканировать QR любой обычной камерой телефона — откроется публичная страница сборки в браузере.' },
    ],
  },

  // ============ ДОРАБОТКИ ============
  {
    id: 'defects-overview', cat: 'defects', cat_label: 'Доработки', icon: 'ti-alert-circle',
    title: 'Что такое раздел «Доработки»',
    summary: 'Обратная связь с поля — монтажник или клиент могут оставить замечание через QR.',
    body: [
      { p: 'Раздел «Доработки» — это место где собираются <b>замечания, дефекты и пожелания</b> от монтажников, клиентов и сотрудников. Например, монтажник на объекте увидел, что не хватает заземляющего болта — он сканирует QR на сборке, пишет замечание с фото, и оно попадает к директору.' },
      { h: 'Четыре типа замечаний' },
      { ul: [
        '🔴 <b>Дефект</b> — что-то сломано, не работает',
        '🟡 <b>Замечание</b> — работает, но неудобно или не так как ожидалось',
        '🟢 <b>Улучшение</b> — пожелание как сделать лучше в будущем',
        '🔵 <b>Вопрос</b> — нужно уточнение от инженера',
      ] },
      { h: 'Что в форме замечания' },
      { ul: [
        '<b>Тип</b> (обязательно) — выбрать одну из 4 категорий',
        '<b>Описание</b> (обязательно) — что не так',
        '<b>Фото</b> (опционально) — до 5 шт',
        '<b>Локация</b> (опционально) — например: «ТП-3 на объекте Невский»',
        '<b>Имя и телефон</b> (опционально) — чтобы можно было связаться',
      ] },
      { h: 'Статусы замечаний' },
      { ul: [
        '<b>🆕 Новое</b> — только что пришло, никто ещё не смотрел',
        '<b>⏳ В работе</b> — назначен ответственный, дорабатывается',
        '<b>✅ Решено</b> — закрыто, можно добавить комментарий «что сделано»',
        '<b>❌ Отклонено</b> — не подтверждено, с указанием причины',
      ] },
      { note: 'Замечания видят: <b>директор</b>, <b>зам</b>, <b>менеджер</b> договора и <b>мастер</b> сборки. Менять статус могут только <b>директор</b> и <b>зам</b>.' },
    ],
  },
  {
    id: 'defects-create', cat: 'defects', cat_label: 'Доработки', icon: 'ti-pencil-plus',
    title: 'Как оставить замечание с поля',
    summary: 'Пример: монтажник на объекте обнаружил, что в сборке не хватает болтов.',
    body: [
      { h: 'Что делать' },
      { ol: [
        'Найди <b>QR-наклейку</b> на сборке (она наклеена на изделие)',
        'Открой <b>камеру телефона</b> или сканер любого приложения',
        'Наведи на QR → нажми на появившуюся ссылку',
        'Откроется страница с информацией о сборке',
        'Внизу страницы — оранжевая кнопка <b>«🔔 Сообщить о замечании»</b>',
        'Выбери <b>тип</b> (дефект / замечание / улучшение / вопрос)',
        'Опиши проблему: «Не хватает 2 крепёжных болтов M10, не могу установить корпус»',
        'Прикрепи <b>фото</b> (опционально, но желательно)',
        'Укажи <b>где найдено</b>: «ТЦ Невский Атриум, ТП-3»',
        'Можно оставить <b>имя и телефон</b> для обратной связи',
        'Нажми <b>«Отправить»</b>',
      ] },
      { h: 'Пример хорошего замечания' },
      { p: '<b>Тип:</b> Дефект<br><b>Описание:</b> «При монтаже обнаружено что отсутствуют 2 крепёжных болта M10 для корпуса (по чертежу должно быть 6). На фото видно где именно. Закупаем сами или заберёте?»<br><b>Локация:</b> «ТРЦ Невский Атриум, помещение ТП-3»<br><b>Фото:</b> 3 шт (общий вид, крупный план, чертёж)<br><b>Имя:</b> Иванов А.А.<br><b>Телефон:</b> +7 911 ...' },
      { note: 'Чем больше деталей — тем быстрее решится проблема. Особенно полезны фото: видно что не так с первого взгляда.' },
    ],
  },
  {
    id: 'defects-manage', cat: 'defects', cat_label: 'Доработки', icon: 'ti-checkup-list',
    title: 'Работа с замечаниями (для директора)',
    summary: 'Как просматривать, менять статусы, отвечать на замечания клиентов и монтажников.',
    body: [
      { h: 'Как посмотреть' },
      { ol: [
        'В шапке кликни <b>«Доработки»</b>',
        'Слева в сайдбаре — фильтры по статусам',
        'Открой <b>«Новые»</b> — там самое свежее',
        'Кликни на любое замечание → откроется детальная карточка',
      ] },
      { h: 'В карточке видно' },
      { ul: [
        'Полное описание проблемы',
        'Связанная сборка или договор (можно перейти одним кликом)',
        'Контакт автора (имя + телефон)',
        'Локация (где найдено)',
        'Фото в сетке (клик — открывается на весь экран)',
        'Дата создания',
      ] },
      { h: 'Как сменить статус' },
      { ol: [
        '<b>«В работу»</b> — если замечание принято, дорабатывается',
        '<b>«Решено»</b> — закрыли проблему. Появится prompt чтобы добавить комментарий что сделано',
        '<b>«Отклонить»</b> — не подтвердилось / не наша проблема. Тоже можно указать причину',
        '<b>«Вернуть в Новые»</b> — если случайно изменил',
      ] },
      { note: 'Менять статусы могут только директор и зам. Если у тебя другая роль, кнопки смены статуса не покажутся.' },
    ],
  },

  // ============ КАДРЫ ============
  {
    id: 'hr-vacations', cat: 'hr', cat_label: 'Кадры', icon: 'ti-beach',
    title: 'Планирование отпусков',
    summary: 'Как добавлять отпуска сотрудников, смотреть таймлайн и календарь.',
    body: [
      { h: 'Где это' },
      { p: 'Раздел <b>Кадры</b> в шапке. Внутри 3 представления одной и той же информации:' },
      { ul: [
        '<b>Таймлайн</b> — графики всех сотрудников по горизонтали с разноцветными плашками отпусков. Удобно видеть пересечения',
        '<b>Список</b> — таблица всех отпусков с фильтрами',
        '<b>Календарь</b> — обычный месячный календарь с отметками',
      ] },
      { h: 'Как добавить отпуск' },
      { ol: [
        'Открой Кадры → Список (или Таймлайн)',
        'Нажми <b>«+ Новый отпуск»</b>',
        'Выбери сотрудника из списка',
        'Укажи <b>дату начала</b> и <b>дату конца</b>',
        'Опционально: тип (основной / без сохранения / больничный)',
        'Опционально: комментарий («Турция, семьёй»)',
        'Сохрани',
      ] },
      { note: 'В Таймлайне сразу видно пересечения — если у двух мастеров отпуск в одно время, цветные плашки наложатся. Можно сразу скорректировать.' },
    ],
  },

  // ============ ПРОИЗВОДСТВО — ТИПЫ РАБОТ (Этап 23) ============
  {
    id: 'production-work-types', cat: 'production', cat_label: 'Производство', icon: 'ti-list-check',
    title: 'Типы работ: не только сборки',
    summary: 'В Производстве теперь регистрируют 8 типов работ. Кто что и где делал — полная картина.',
    body: [
      { p: 'Раньше в Производстве были только <b>сборки</b> — записи о собранных щитах с моделями. Теперь учитываем все типы работ: от ремонта на объекте до пусконаладки. Это позволяет видеть полную картину занятости сотрудников и считать рабочие часы по объектам/договорам.' },
      { h: '8 типов работ' },
      { ul: [
        '🔧 <b>Сборка</b> — классика. Сборка щита, увлажнителя и т.п. Привязана к модели. <i>Идёт на склад автоматически</i>.',
        '🔨 <b>Ремонт</b> — починка, замена компонентов на объекте или в мастерской',
        '⚡ <b>Пусконаладка</b> — запуск оборудования, прошивка, настройка',
        '🛠 <b>Монтаж</b> — установка щита на объекте, протяжка кабелей',
        '🔍 <b>Диагностика</b> — замеры, проверки, инспекция (без правок)',
        '📐 <b>Проектирование</b> — разработка схем, чертежей',
        '🔧 <b>ТО</b> — плановое тех. обслуживание',
        '➕ <b>Прочее</b> — всё что не подходит под другие категории',
      ] },
      { h: 'Чем отличаются от сборки' },
      { ul: [
        '<b>Не привязаны к модели</b> — модель опциональна',
        '<b>Не идут на склад</b> — это услуга, а не товар',
        '<b>Есть поле «Что было сделано»</b> — обязательное описание',
        '<b>Есть поле «Где»</b> — адрес объекта',
        '<b>Есть поле «Часы»</b> — можно учитывать рабочее время',
      ] },
      { h: 'Зачем это нужно' },
      { ol: [
        'Видеть кто чем занимался за неделю/месяц (не только сборщики)',
        'Считать часы по договорам и объектам',
        'История работ привязана к сотруднику и договору',
        'Монтажник может через QR на сборке зарегистрировать «Ремонт» прямо с поля',
      ] },
      { note: 'Сборки и работы лежат в одном журнале, но в карточке видно тип работы (бейдж цветной). На главной отображаются обе категории.' },
    ],
  },
  {
    id: 'production-create-work', cat: 'production', cat_label: 'Производство', icon: 'ti-plus',
    title: 'Как зарегистрировать работу (не сборку)',
    summary: 'Пример: бригада сделала пусконаладку на объекте. Заносим в систему.',
    body: [
      { h: 'Шаги' },
      { ol: [
        'Производство → <b>«+ Новая сборка»</b> (кнопка осталась той же — она для всех типов)',
        'Сверху появится переключатель <b>«Тип работы»</b> — выбери нужный (например, «Пусконаладка»)',
        'Поле «Модель» <i>исчезнет</i> — вместо неё появятся «Что было сделано», «Где», «Часы»',
        'Заполни <b>описание работы</b>: «Запуск приточной установки ПУ-1, прошивка контроллера»',
        'Укажи <b>где</b>: «ТРЦ Невский Атриум, помещение венткамеры»',
        'Опционально <b>часы</b>: 4.5',
        'Дальше как обычно: дата, исполнители, договор/объект (опционально)',
        'Сохрани',
      ] },
      { h: 'Пример хорошего описания' },
      { p: '<b>Тип:</b> Пусконаладка<br><b>Что сделано:</b> «Запустили приточную установку ПУ-1. Прошили контроллер на конфигурацию заказчика, проверили работу всех режимов (зима/лето/межсезонье), настроили часы работы 7:00–22:00. Согласовали параметры с инженером объекта.»<br><b>Где:</b> «ТРЦ Невский Атриум, венткамера 2 этажа»<br><b>Часы:</b> 4.5<br><b>Исполнители:</b> Иванов А.А., Петров П.С.' },
      { note: 'Не-сборки <b>не отображаются на складе</b> — это услуга. В журнале Производства они видны рядом со сборками с цветным бейджем типа.' },
    ],
  },

  // ============ ДОРАБОТКИ — РАСШИРЕНИЕ ============
  {
    id: 'defects-share-installer', cat: 'defects', cat_label: 'Доработки', icon: 'ti-send',
    title: 'Отправить ссылку монтажнику',
    summary: 'Как поделиться ссылкой на сборку/договор с подрядчиком. Telegram-share, QR, копирование.',
    body: [
      { p: 'Часто на объект едет монтажник без логина в нашу систему. Надо чтобы он видел всю информацию по сборке и мог оставить замечание прямо с поля. Кнопка <b>«Монтажнику»</b> делает именно это.' },
      { h: 'Где кнопка' },
      { ul: [
        'В карточке сборки (открой её через Склад → Остатки → клик)',
        'В шапке карточки договора (раздел Продажи)',
        'Цвет — <i>зелёный</i>, рядом с QR',
      ] },
      { h: 'Три способа отправить' },
      { ol: [
        '<b>📨 Telegram</b> — открывается стандартное окно Telegram, выбираешь чат, ссылка отправляется',
        '<b>📋 Копировать</b> — ссылка в буфере обмена, вставляешь куда угодно (WhatsApp, email, SMS)',
        '<b>📷 QR на экране</b> — монтажник наводит свой телефон, сканирует',
      ] },
      { h: 'Что увидит монтажник' },
      { p: 'По ссылке открывается <i>публичная страница</i> сборки/договора с базовой информацией: модель, артикул, договор, статус, история. Без секретных данных. Внизу — оранжевая кнопка <b>«🔔 Сообщить о замечании»</b>. Если что-то не так — он может прямо там оставить замечание с фото.' },
      { note: 'Внутри CRM у сотрудников есть та же возможность — кнопка <b>«🟠 Доработка»</b> (оранжевая) в карточке. Имя предзаполнено из профиля, не надо заново вводить.' },
    ],
  },

  // ============ v2.6.x / v2.7.x — НОВОЕ ============

  {
    id: 'start-mobile-nav',
    cat: 'start', cat_label: 'Старт', icon: 'ti-device-mobile-message',
    title: 'Мобильная навигация (v2.6)',
    summary: 'Как пользоваться приложением с телефона: нижняя панель, бургер, action sheet «+».',
    body: [
      { p: 'С версии 2.6 на телефонах появилась полностью переделанная навигация. Главное отличие от компьютера — вместо боковых меню используется нижняя панель и выпадающий ящик слева.' },
      { h: 'Нижняя панель (tab-bar)' },
      { p: 'Внизу экрана всегда видны 5 кнопок:' },
      { ul: [
        '🏠 <b>Главная</b> — обзор: KPI, ближайшие отгрузки, последние действия',
        '🔍 <b>Поиск</b> — глобальный поиск по договорам, задачам, контрагентам, доработкам',
        '➕ <b>Плюс</b> (центр) — action sheet с быстрыми действиями',
        '🔔 <b>Уведомления</b> — последние события которые тебе нужно знать',
        '👤 <b>Аккаунт</b> — твой профиль и выход',
      ] },
      { h: 'Action sheet «+»' },
      { p: 'Клик по центральной кнопке открывает меню снизу с 6 быстрыми пунктами:' },
      { ul: [
        'Новая сборка',
        'Новый договор',
        'Новое КП',
        'Новая задача',
        'Сообщить о замечании',
        'Сканировать QR',
      ] },
      { h: 'Бургер (drawer)' },
      { p: 'В шапке каждого раздела слева — иконка из трёх линий. Открывает боковое меню текущего раздела как ящик (drawer). Полезно когда ты внутри Производства, Продаж или Склада и хочешь переключиться между его подразделами без выхода в главный экран.' },
      { h: 'Глобальный поиск' },
      { p: 'Клик на 🔍 в нижней панели открывает overlay с одним полем ввода. Ищет сразу по четырём базам:' },
      { ul: [
        'Договоры (по номеру и контрагенту)',
        'Задачи (по названию и описанию)',
        'Контрагенты (по названию и ИНН)',
        'Доработки (по тексту замечания)',
      ] },
      { note: 'Поиск работает мгновенно по клиентскому индексу. Если результатов нет — попробуй короткий фрагмент названия, поиск по части слова работает.' },
    ],
  },

  {
    id: 'sales-contract-spec',
    cat: 'sales', cat_label: 'Продажи', icon: 'ti-list-check',
    title: 'Спецификация договора (v2.7)',
    summary: 'Список позиций договора — что именно мы должны изготовить или поставить по нему.',
    body: [
      { p: 'С версии 2.7.2 у каждого договора появилась <b>спецификация</b> — список позиций, которые мы по нему должны изготовить или поставить. Это нужно, чтобы было ясно «что входит в договор» — для контроля производства, отгрузок и документов.' },
      { h: 'Где она находится' },
      { p: 'Открой договор (Продажи → Договоры → клик). В карточке договора между блоками «Готовность по сборкам» и «Отгрузка» есть блок <b>«📋 Спецификация»</b>. Внутри — список позиций и кнопка <b>«+ Добавить позицию»</b>.' },
      { h: 'Как добавить позицию' },
      { ol: [
        'В блоке «Спецификация» жми <b>«+ Добавить позицию»</b>',
        'В поле <b>«Позиция»</b> начни вводить название или артикул — появятся подсказки из существующей номенклатуры',
        'Можно выбрать из подсказки <i>либо</i> нажать квадратную кнопку <b>▦</b> справа от поля — откроется модалка-обозреватель',
        'Заполни <b>«Кол-во»</b> и <b>«Ед.изм.»</b> (по умолчанию шт.)',
        'Жми <b>«Добавить»</b>',
      ] },
      { h: 'Модалка-обозреватель (кнопка ▦)' },
      { p: 'Это удобно когда не помнишь точное название позиции. В модалке две вкладки:' },
      { ul: [
        '<b>Производство</b> — все модели из справочника номенклатуры (щиты, увлажнители и т.п.), сгруппированы по направлениям (КЛМ, УВЛ, ВНТ, ЩУ)',
        '<b>Продажи</b> — позиции из <i>продажной номенклатуры</i> (товары перепродажи, услуги — то что используется в КП)',
      ] },
      { p: 'Сверху — поле фильтра. Вводишь часть названия — список сужается, группы автоматически раскрываются.' },
      { h: 'Чем отличаются типы позиций для системы' },
      { ul: [
        'Выбрал из <b>Производства</b> → позиция помнит <code>model_id</code> и через неё сможет связаться со сборками в будущем',
        'Выбрал из <b>Продаж</b> → позиция помнит только название + единицу (модели нет, это товар/услуга)',
        'Можно <b>не выбирать</b> из номенклатуры — просто вписать свободный текст. Подходит для разовых нестандартных позиций',
      ] },
      { h: 'Редактирование и удаление' },
      { ul: [
        'Иконка <i class="ti ti-edit"></i> рядом с позицией — открывает форму редактирования',
        'Иконка <i class="ti ti-trash"></i> — удаляет позицию (с подтверждением)',
      ] },
      { note: 'В будущих версиях спецификация будет связана с отгрузкой (какая коробка покрывает какую позицию), и можно будет распечатать её в Word/PDF для прикрепления к договору.' },
    ],
  },

  {
    id: 'wh-ship-qr',
    cat: 'warehouse', cat_label: 'Склад', icon: 'ti-scan',
    title: 'Отгрузка по QR (v2.11)',
    summary: 'Кладовщик сканирует QR коробок и сборок при погрузке — позиции автоматически отмечаются как отгруженные. Прогресс — сколько ещё осталось.',
    body: [
      { p: 'Отдельный экран отгрузки с прогрессом и QR-сканированием. С v2.10 закрытие договора блокируется, если отгружено не всё — это страховка от «забыл что-то погрузить».' },
      { h: 'Откуда запустить' },
      { ul: [
        '<b>Из карточки договора:</b> в блоке отгрузки нажми «Открыть отгрузку»',
        '<b>Из раздела Склад:</b> нажми «Произвести отгрузку» справа сверху → «По договору» → выбери договор',
        '<b>Через главный сканер</b> (📷 Скан в шапке): отсканируй QR любой сборки/коробки этого договора — система сама предложит открыть отгрузку',
      ] },
      { h: 'Как идёт отгрузка' },
      { ol: [
        'На экране отгрузки видишь прогресс <b>«N / Total»</b> и два списка: «Ожидают отгрузки» и «Отгружено»',
        'Жми <b>«📷 Сканировать QR»</b> — открывается камера',
        'Сканируешь QR <b>каждой коробки или сборки</b> по очереди при загрузке в машину',
        'После каждого скана позиция переезжает из «Ожидают» в «Отгружено», прогресс растёт',
        'Когда всё отгружено — кнопка станет <b>«✓ Всё отгружено»</b>',
      ] },
      { h: 'Что можно сканировать' },
      { ul: [
        '<b>QR коробки</b> — на упаковке. Одна коробка может содержать несколько позиций (см. «Коробки в договоре»)',
        '<b>QR сборки</b> — на самой сборке',
      ] },
      { h: 'Чем это удобнее старого процесса' },
      { ul: [
        'Сразу видишь сколько ещё осталось погрузить — не забудешь позицию',
        'Невозможно «отгрузить» не ту позицию — система привязывает QR к договору',
        'Если погрузка идёт частями (в разные дни или машины) — прогресс сохраняется',
        'История отгрузки — кто сканировал, когда',
      ] },
      { note: 'Если нужно отгрузить позицию <b>без договора</b> (опт, гарантия, физлицу) — см. статью «Отгрузка без договора».' },
    ],
  },
  // ============ ЭТАП 30 (v2.11): Содержимое коробок ============
  {
    id: 'sales-box-content',
    cat: 'sales', cat_label: 'Продажи', icon: 'ti-package',
    title: 'Коробки в договоре. Что и зачем',
    summary: 'Создаём коробки, кладём в них номенклатуру, печатаем упаковочный лист и QR.',
    body: [
      { p: 'Коробка — это контейнер для отгрузки. Например, в один договор входят 5 щитов автоматики, 200 м кабеля, монтажные хомуты. Это удобно паковать в 3 коробки: «щиты», «кабель», «расходники». У каждой коробки свой QR — при погрузке кладовщик сканирует QR, а не каждую сборку по отдельности.' },
      { h: 'Создать коробку' },
      { ol: [
        'Открой договор → блок <b>«Коробки»</b> → жми <b>«+ Добавить»</b>',
        'Коробка создаётся с автоименем (Коробка #1, #2, ...). Можно переименовать позже',
        'Сразу открывается экран коробки — там список содержимого (пока пуст)',
      ] },
      { h: 'Что и как класть в коробку' },
      { p: 'На экране коробки внизу две кнопки добавления:' },
      { ul: [
        '<b>«Из номенклатуры»</b> — выбор из списка. Доступны: сборки этого договора, позиции спецификации договора, общий каталог моделей. Удобно когда позиция уже заведена в систему',
        '<b>«Вручную»</b> — простая форма: название, количество, единица (шт/м/кг/л/компл/уп) + комментарий. Используй когда нужно положить что-то нестандартное (расходники, метизы)',
      ] },
      { h: 'Печать упаковочного листа A4' },
      { ul: [
        'На экране коробки внизу кнопка <b>«Упаковочный лист (A4)»</b>',
        'Откроется новая вкладка с готовым документом — шапка Atom CRM, контрагент, ИНН, адрес доставки, имя коробки, дата, таблица содержимого, место для подписей упаковщика и принимающего, QR коробки',
        'Браузер сразу предложит «Печать» — кладёшь распечатанный лист сверху в коробку',
      ] },
      { h: 'Печать QR-наклейки на коробку' },
      { ul: [
        'На экране коробки — кнопка <b>«QR / наклейка»</b>',
        'Открывается QR-модалка с кнопками: «Скачать PNG», «Печать наклейки», «Копировать ссылку»',
        'Печать наклейки — формат 58×60 мм для термопринтера или просто наклейка на тубу/коробку',
      ] },
      { h: 'Сканирование QR коробки' },
      { ul: [
        'Внешней камерой телефона (вне CRM) → откроется публичная страница: «Коробка #N / договор / контрагент». Удобно покупателю или транспортной',
        'Главным сканером в CRM (📷 Скан в шапке) → сразу открывается экран отгрузки соответствующего договора',
      ] },
      { note: 'Коробка, которую уже отгрузили, переименовать или удалить нельзя — она зафиксирована в журнале отгрузок.' },
    ],
  },
  {
    id: 'wh-ship-external',
    cat: 'warehouse', cat_label: 'Склад', icon: 'ti-package-export',
    title: 'Отгрузка без договора',
    summary: 'Отдать позицию покупателю по ИНН или физлицу — для опта, гарантии, розницы.',
    body: [
      { p: 'Иногда нужно отгрузить сборку или коробку, которая <b>не привязана к договору</b>. Например: продали со склада другой фирме, отдали по гарантии, отгрузили физлицу. С v2.11 в системе для этого есть отдельный сценарий.' },
      { h: 'Как открыть' },
      { ol: [
        'Раздел <b>Склад</b> → справа сверху кнопка <b>«Произвести отгрузку»</b>',
        'В модалке выбери <b>«По номенклатуре (без договора)»</b>',
      ] },
      { h: 'Заполнить форму' },
      { ul: [
        '<b>Получатель</b> — выбери Юрлицо (ИНН) или Физлицо',
        '<b>ИНН</b> (если юрлицо) — 10 или 12 цифр. Система проверяет формат',
        '<b>Название / ФИО</b> получателя — кому отдаём',
        '<b>Комментарий</b> — обязательное поле: куда и зачем (например, «По устной договорённости с Ивановым, для гарантийной замены»)',
      ] },
      { h: 'Добавить позиции' },
      { ul: [
        '<b>«Сканировать QR»</b> — открывается камера, сканируешь сборку или коробку',
        '<b>«Ввести токен»</b> — для ручного ввода (если QR не сканируется)',
        'Можно добавить несколько позиций сразу — список накапливается',
      ] },
      { h: 'Подтвердить' },
      { ul: [
        'Жми «Отгрузить (N поз.)» внизу формы',
        'Позиции пометятся как отгруженные с полями получателя в журнале',
        'Если какая-то позиция уже была отгружена раньше — система выдаст ошибку именно по ней, остальные пройдут',
      ] },
      { note: 'Отменить внешнюю отгрузку через UI пока нельзя — если ошибся, обратись к директору, исправим через БД.' },
    ],
  },

  // ---------- Новые разделы (v2.45.154–159) ----------
  {
    id: 'qr-public-password',
    cat: 'qr', cat_label: 'QR-коды', icon: 'ti-lock',
    title: 'Пароль на публичные QR-коды',
    summary: 'Любой публичный QR открывается «с улицы» только по паролю договора, который высылают получателю.',
    body: [
      { p: 'Чтобы посторонний не мог по ссылке/QR увидеть содержимое отгрузки, все публичные QR-коды (договора, короба, сборки) защищены паролем. Клиент, отсканировав код, сначала вводит пароль и только потом видит карточку.' },
      { h: 'Как это работает' },
      { ul: [
        'Пароль <b>один на договор</b> — 6 цифр. Он открывает все QR этого договора (договор, его короба и сборки)',
        'Пароль запоминается на устройстве получателя — при следующих сканах того же договора вводить не нужно',
        '<b>Сотрудники в CRM пароль не вводят</b> — сканер внутри приложения работает как раньше (узнаём по входу)',
      ] },
      { h: 'Где взять пароль и отправить клиенту' },
      { ol: [
        'Открой карточку договора → кнопка <b>QR</b>',
        'В окне QR — жёлтый блок <b>«Пароль для получателя»</b>',
        'Нажми <b>«Копировать»</b> и отправь пароль клиенту (смс/мессенджер) — как удобно',
        'Если пароль утёк — <b>«Перевыпустить»</b>: старый сразу перестаёт работать',
      ] },
      { note: 'Уже напечатанные ранее QR тоже теперь требуют пароль — это и есть смысл защиты. Просто вышли получателю пароль из окна QR договора.' },
    ],
  },
  {
    id: 'push-to-phone',
    cat: 'home', cat_label: 'Главная', icon: 'ti-device-mobile-message',
    title: 'Уведомления на телефон (пуш)',
    summary: 'Включить пуш, проверить кнопкой «Тест», директору приходит всё из колокольчика.',
    body: [
      { p: 'Приложение умеет присылать пуш-уведомления прямо на телефон — как обычные уведомления, даже когда вкладка закрыта.' },
      { h: 'Как включить' },
      { ol: [
        'Открой колокольчик (вверху справа)',
        'Нажми значок <b>📱</b> в шапке панели — браузер спросит разрешение, дай его',
        'Значок станет зелёным — пуш включён на этом телефоне',
      ] },
      { note: 'Включать нужно на каждом телефоне отдельно. На iPhone — только если PWA добавлено на экран «Домой».' },
      { h: 'Проверить' },
      { ul: [
        'Кнопка <b>«Тест»</b> в шапке панели уведомлений — нажал и сразу видишь, как пуш приходит на телефон',
        'Если на устройстве пуш ещё не включён — кнопка предложит включить',
      ] },
      { h: 'Что приходит директору' },
      { ul: [
        '<b>Директору приходит пуш по любому событию колокольчика</b>: новый договор, новая сборка, замечание и сообщения по нему, сообщения/файлы в разработке, Фото УПД, приход счёта и пр.',
        'Счёт от поставщика приходит директору и бухгалтеру',
      ] },
      { note: 'Если после обновления приложения пуш будто «слетел» — ничего делать не нужно: при запуске подписка пере-сохраняется сама, значок снова зеленеет. Если «Тест» всё же не пришёл — нажми один раз 📱.' },
    ],
  },
  {
    id: 'shipment-writeoff',
    cat: 'warehouse', cat_label: 'Склад', icon: 'ti-truck-delivery',
    title: 'Отгрузка списывает со склада',
    summary: 'Отгрузка по QR (и по договору) списывает изделия со склада и снимает резерв. Откат возвращает.',
    body: [
      { p: 'Когда изделия отгружены, они должны уйти со склада. Теперь это происходит при любой отгрузке.' },
      { h: 'Как работает' },
      { ul: [
        'Отгрузка по <b>QR-коду</b> сборки или короба <b>списывает изделия со склада</b> и снимает резерв (статус → «отгружена», позиция уходит из «Готовой продукции» и из резерва)',
        '<b>Короб</b> при сканировании списывает все сборки, которые в нём лежат',
        'Кнопка «Произвести отгрузку» по договору — как и раньше, тоже списывает',
      ] },
      { h: 'Если ошиблись' },
      { ul: [
        '<b>Откат отгрузки</b> (одной записи или сброс всех по договору) возвращает изделия обратно на склад',
      ] },
      { note: 'То, что было отгружено ДО этого обновления, автоматически не пересчиталось. Чтобы поправить: откати отгрузку и отгрузи заново — тогда спишется корректно. Либо поправь остаток вручную.' },
    ],
  },
  {
    id: 'bom-manual-relink',
    cat: 'production', cat_label: 'Производство', icon: 'ti-arrows-exchange',
    title: 'Сопоставить позицию спецификации со складом вручную',
    summary: 'Если в «Новой работе» позиция показана «есть 0», хотя на складе она есть — привязать вручную.',
    body: [
      { p: 'Иногда позиция спецификации модели показана как «есть 0», хотя на складе она есть — обычно потому, что заведена дублем под другой записью, и авто-сопоставление указало не на ту складскую позицию.' },
      { h: 'Что делать' },
      { ol: [
        'В «Новой работе» (создание сборки) в блоке <b>«Будет списано со склада»</b> у дефицитной позиции нажми <b>«Сопоставить со складом»</b>',
        'В поиске найди нужную складскую позицию (с её реальным остатком)',
        'Выбери её — спецификация модели привяжется к ней, количество подтянется правильно',
      ] },
      { note: 'Привязка действует и для будущих сборок этой модели. Доступно директору/заму.' },
    ],
  },
];

// FAQ
const HELP_FAQ = [
  {
    q: 'Я случайно списал не ту сборку, можно откатить?',
    a: 'Нет, движения склада необратимы — это сделано специально для целостности учёта. Но ты можешь внести точно такую же сборку заново (Производство → Новая сборка). Тогда она снова появится на складе.',
  },
  {
    q: 'Можно ли положить одну и ту же сборку в две разные коробки?',
    a: 'Технически — да, состав коробки это просто список позиций для печати упаковочного листа. Но логически не стоит — будет путаница при отгрузке. Лучше держи позицию в одной коробке.',
  },
  {
    q: 'Что считается отгрузкой по договору, а что — без договора?',
    a: 'Если позиция (сборка или коробка) привязана к договору и идёт в счёт этого договора — это отгрузка по договору, делается через QR-сканирование на экране договора. Если позиция уходит вне договора (опт, гарантия, физлицо) — это внешняя отгрузка из раздела Склад через кнопку «Произвести отгрузку» → «По номенклатуре».',
  },
  {
    q: 'Что если поставщик привёз меньше чем заказывали?',
    a: 'Просто впиши фактическое количество в приёмке. Заказ останется в статусе «частично», заявки — в «в заказе» (не «получены»). Когда довезут — оформи ещё одну приёмку на остаток.',
  },
  {
    q: 'Как поменять менеджера у договора?',
    a: 'Открой договор → нажми «Редактировать» → смени менеджера → сохрани. Делать это может директор, зам или текущий менеджер договора.',
  },
  {
    q: 'У меня не пришёл код для входа',
    a: 'Проверь что бот в Telegram именно <b>@AtomusgroupBot</b>. Иногда Telegram задерживает сообщения — подожди 30 секунд, потом запроси /login ещё раз. Если код всё равно не приходит — напиши директору, возможно тебя ещё не добавили в систему.',
  },
  {
    q: 'Можно ли работать без интернета?',
    a: 'Частично. PWA сохраняет в кэш то что ты уже открывал — можно читать. Но создать/изменить что-то без интернета не получится — данные не сохранятся на сервере.',
  },
  {
    q: 'Где взять PDF коммерческого предложения?',
    a: 'Открой нужное КП в Продажи → КП. Нажми «Скачать PDF» — выгрузится файл с логотипом, готовый для отправки клиенту. Также есть «Скачать DOCX» для правок в Word.',
  },
  {
    q: 'В чём разница между «продажной номенклатурой» и «каталогом закупок»?',
    a: '<b>Продажная номенклатура</b> — это то, что продаём клиентам (используется в КП). <b>Каталог закупок</b> — это то, что покупаем у поставщиков. Это два разных списка, могут пересекаться (например, кабель мы и продаём, и закупаем) — но ведутся отдельно.',
  },
  {
    q: 'Зачем привязывать сборку к договору?',
    a: 'Чтобы сборка была <b>зарезервирована</b> именно за этим договором. Тогда её нельзя случайно отгрузить по другому. И в карточке договора всегда видно, что уже готово.',
  },
  {
    q: 'Удалил поставщика — куда делись заказы?',
    a: 'Поставщики удаляются «мягко» (архивируются). Все исторические заказы остаются на месте, просто новый заказ на такого поставщика создать нельзя. Если нужно вернуть — обратись к директору.',
  },
  {
    q: 'Сколько раз можно править КП после создания?',
    a: 'Сколько угодно, пока договор по нему не создан. После создания договора КП фиксируется и редактирование не рекомендуется.',
  },
  {
    q: 'Что делать если QR-код не сканируется в приложении?',
    a: 'Попробуй три варианта подряд: 1) Отойди дальше от QR — у многих телефонов минимальная дистанция фокуса 15-20 см. 2) Сфотографируй QR обычной камерой, затем в сканере жми <i class="ti ti-photo"></i> (иконку фото) → выбери снимок из галереи. 3) Если совсем не работает — жми <i class="ti ti-keyboard"></i> и введи токен вручную (короткие 11 символов из URL под QR-кодом). Альтернатива: сканируй обычной камерой телефона — откроется публичная страница в браузере.',
  },
  {
    q: 'Кто может оставить замечание через QR?',
    a: 'Любой кто отсканировал QR — даже без логина в системе. Это сделано специально, чтобы монтажники-субподрядчики или клиенты могли быстро написать. Опционально можно указать имя и телефон для обратной связи. Замечание сразу попадает в раздел «Доработки» и видно директору.',
  },
  {
    q: 'Кто видит замечания и кто может их закрывать?',
    a: '<b>Видят:</b> директор, зам, менеджер договора, мастер сборки. <b>Меняют статусы (В работу / Решено / Отклонено):</b> только директор и зам. Если у тебя другая роль — кнопки смены статуса будут скрыты.',
  },
  {
    q: 'Где взять QR-код для конкретной сборки?',
    a: 'Открой карточку сборки (через Склад → Остатки или Производство → Сборки → клик на любую). В шапке карточки увидишь кнопку <i class="ti ti-qrcode"></i> <b>QR</b>. В модалке будет сам QR + 3 кнопки: «Скачать PNG», «Печать наклейки», «Копировать ссылку».',
  },
  {
    q: 'Какой принтер нужен для наклеек?',
    a: 'Любой термопринтер с поддержкой формата 58мм. Хорошие варианты: <b>HPRT HT300</b> (~10 000 ₽) или <b>Xprinter XP-420B</b> (~8 000 ₽) — оба с Wi-Fi и Bluetooth, печатают с планшета без проводов. Наклейки термо 58×60мм закупаются отдельно — ~700 ₽ за рулон 1000 шт.',
  },
  {
    q: 'Можно ли распечатать одну наклейку, не открывая склад?',
    a: 'Да. Открой карточку сборки → жми <i class="ti ti-qrcode"></i> QR → в модалке «Печать наклейки» → откроется страница 58×60мм для печати. Удобно когда сборка только что закончилась — сразу клеишь наклейку на изделие.',
  },
  {
    q: 'Что отображается на публичной странице сборки (когда клиент сканирует)?',
    a: 'Базовая инфо без секретов: артикул, модель, исполнение, IP-класс, количество, дата сборки, статус (готова/отгружена), сборщик, связанный договор (если есть), история движений. Не показывается: цены, поставщики, внутренние комментарии. Всё что может быть полезно монтажнику.',
  },
  {
    q: 'Что делать если приложение не открывается / висит?',
    a: '1) Нажми <b>Ctrl+Shift+R</b> (десктоп) — полная перезагрузка с очисткой кэша. 2) Если не помогло — F12 → Application → Service Workers → Unregister. 3) На телефоне: настройки → очистить данные сайта <code>atomus-pwa.vercel.app</code>. 4) Если совсем плохо — напиши в Telegram-бот @AtomusgroupBot.',
  },
  {
    id: 'team-password-login',
    cat: 'start', cat_label: 'Старт', icon: 'ti-key',
    title: 'Вход по паролю (для тех, кто без Telegram)',
    summary: 'Как зайти в Atomus без Telegram — по паролю. Как директор задаёт пароль сотруднику.',
    body: [
      { p: 'С версии 2.8 в систему можно зайти двумя способами: через Telegram-бот (как раньше) или по паролю. Пароль удобен для сотрудников, которые не пользуются Telegram, — например, для бухгалтера или мастера производства.' },
      { h: 'Как зайти по паролю (сотрудник)' },
      { ul: [
        'Открой страницу входа: <code>atomus-pwa.vercel.app</code>',
        'Переключись на вкладку <b>«По паролю»</b>',
        'Введи пароль и жми <b>«Войти»</b> — больше ничего вводить не нужно',
        'Система сама определит, кто ты, и поздоровается: «Добро пожаловать, Иванов И.И.!»',
      ] },
      { note: 'Пароль выдаёт директор. Если забыл — не пытайся подобрать (после 10 попыток с одного устройства вход блокируется на 10 минут), просто попроси директора задать новый.' },
      { h: 'Как директор задаёт пароль' },
      { p: 'Только директор может ставить и менять пароли сотрудников.' },
      { ul: [
        'Кадры → Сотрудники → выбери сотрудника (или создай нового)',
        'В форме найди блок <b>«Пароль для входа»</b>',
        'Жми <b>«Сгенерировать»</b> — система предложит случайный пароль из 8 символов (без неоднозначных букв вроде <code>O</code>/<code>0</code> или <code>l</code>/<code>1</code>)',
        'Либо введи свой пароль (минимум 6 символов)',
        'Сохрани сотрудника',
        'Запиши пароль и передай сотруднику — на стороне системы пароль увидеть нельзя (хранится только хеш)',
      ] },
      { h: 'Как сменить или снять пароль' },
      { p: 'При редактировании сотрудника в блоке «Пароль для входа» доступно три варианта:' },
      { ul: [
        '<b>Не менять</b> — оставить как есть (выбрано по умолчанию)',
        '<b>Сменить пароль</b> — задать новый',
        '<b>Снять пароль</b> — сотрудник больше не сможет входить по паролю (Telegram-вход, если был, продолжит работать)',
      ] },
      { h: 'Можно ли использовать оба способа одновременно?' },
      { p: 'Да. Если у сотрудника есть и Telegram-привязка, и пароль — он выбирает на странице входа удобную вкладку. Telegram даёт ещё и уведомления от бота; пароль — это просто доступ к веб-кабинету.' },
      { h: 'Безопасность' },
      { ul: [
        'Пароль хранится в виде хеша PBKDF2-SHA256 с уникальной солью на каждого сотрудника',
        'Подбор тормозится: на одно неверное угадывание уходит ~50 мс серверного времени',
        'Дополнительная защита: после 10 неверных попыток с одного IP вход блокируется на 10 минут',
        'Пароль должен быть <b>уникальным в системе</b> — двух одинаковых не бывает (иначе вход стал бы недетерминированным)',
      ] },
      { note: 'В списке «Сотрудники» рядом с именем тех, у кого установлен пароль, показывается иконка <i class="ti ti-key"></i>.' },
    ],
  },

  {
    id: 'team-access-levels',
    cat: 'start', cat_label: 'Старт', icon: 'ti-shield-lock',
    title: 'Уровни доступа (v2.9)',
    summary: 'Как настроить кто что видит и может делать в системе.',
    body: [
      { p: 'С версии 2.9 в системе нет фиксированных ролей. Вместо этого директор сам собирает галочками <b>уровни доступа</b> — наборы прав. Каждому сотруднику назначается один уровень, и от него зависит абсолютно всё: какие разделы он видит в шапке, какие кнопки доступны, что можно создавать и редактировать.' },
      { h: 'Где это всё' },
      { p: 'Кадры → ЛЮДИ → <b>Уровни доступа</b>. Пункт виден только тем, у кого есть право «Настраивать уровни доступа» (по умолчанию — у директора).' },
      { h: 'Базовые уровни (создаются автоматически)' },
      { ul: [
        '<b>Директор</b> — все права без исключений',
        '<b>Заместитель директора</b> — почти всё, кроме настройки самих уровней доступа',
        '<b>Менеджер по продажам</b> — Продажи, контрагенты, договоры, КП, плюс просмотр Производства и Склада',
        '<b>Бухгалтер</b> — финансовые KPI на Главной, просмотр договоров и контрагентов',
        '<b>Работник производства</b> — внесение сборок, просмотр Склада, замечания',
      ] },
      { note: 'Базовые уровни <b>нельзя удалить</b> и нельзя переименовать (на них завязан системный код), но галочки внутри менять можно.' },
      { h: 'Создать свой уровень' },
      { p: 'Кнопка <b>«Новый уровень»</b> сверху. Например: «Электромонтажник», «Кладовщик», «Снабженец». После создания раскрой карточку — там 25 галочек, разбитых на 9 групп. Поставь нужные, нажми «Сохранить».' },
      { h: 'Группы прав' },
      { ul: [
        '<b>Главная</b> — видеть «Последние действия», видеть финансовые KPI',
        '<b>Производство</b> — видеть, создавать сборки, редактировать/удалять',
        '<b>Продажи</b> — видеть (договоры, КП, контрагенты), создавать, управлять ценами',
        '<b>Склад</b> — видеть, отгружать/принимать',
        '<b>Логистика</b> — видеть, управлять',
        '<b>Снабжение</b> — видеть, управлять',
        '<b>Доработки</b> — видеть, создавать замечания, решать',
        '<b>Задачи</b> — видеть задачи всех (иначе только свои), создавать другим',
        '<b>Кадры</b> — отпуска (видеть/создавать), сотрудники, должности, уровни доступа',
      ] },
      { h: 'Назначить уровень сотруднику' },
      { p: 'В карточке сотрудника блок <b>«Уровень доступа»</b> — выпадашка с списком всех активных уровней. Под выпадашкой автоматически показывается сводка «Что включает» — какие именно разрешения у этого уровня.' },
      { h: 'Что произошло с моими ролями?' },
      { p: 'При обновлении до v2.9 все сотрудники автоматически получили базовый уровень по своим старым ролям:' },
      { ul: [
        'Был «Директор» → стал «Директор»',
        'Был «Зам директора» → стал «Заместитель директора»',
        'Был «Менеджер» → стал «Менеджер по продажам»',
        'Был «Бухгалтер» → стал «Бухгалтер»',
        'Был «Мастер» или «Инженер» → стал «Работник производства»',
      ] },
      { h: 'Защита от блокировки доступа' },
      { ul: [
        'Нельзя снять «Настраивать уровни доступа» с уровня, если в системе это последний сотрудник с такой галочкой',
        'Нельзя удалить системный уровень (Директор, Зам, и т.д.)',
        'Нельзя удалить уровень, если к нему привязан хотя бы один активный сотрудник — сначала переназначь их на другой уровень',
      ] },
      { note: 'Если случайно убрал у себя право «Настраивать уровни доступа» — пункт меню «Уровни доступа» исчезнет. Попроси другого сотрудника с этим правом вернуть тебе галочку (или сделай это до выхода через F5).' },
    ],
  },

  {
    id: 'team-positions',
    cat: 'start', cat_label: 'Старт', icon: 'ti-briefcase',
    title: 'Справочник должностей (v2.8.2)',
    summary: 'Как пополнить список должностей для выпадашки в карточке сотрудника.',
    body: [
      { p: 'С версии 2.8.2 в Кадрах появился справочник должностей. Должность — это просто <b>надпись</b> в карточке сотрудника (например «Электромонтажник» или «Сборщик-слесарь»). На права не влияет (за права отвечает уровень доступа), но удобно для понимания «кто чем занимается».' },
      { h: 'Где это' },
      { p: 'Кадры → ЛЮДИ → <b>Должности</b>.' },
      { h: 'Что можно делать' },
      { ul: [
        '<b>Создать</b> новую должность — кнопка «+» сверху или внизу пустого списка',
        '<b>Переименовать</b> — иконка карандаша на строке',
        '<b>Скрыть</b> — иконка архива. Сотрудники, у кого она уже стоит, не теряют надпись, просто из выпадашки она пропадёт',
        '<b>Восстановить</b> — иконка обновления у скрытых',
      ] },
      { h: 'Где должности используются' },
      { p: 'В форме сотрудника поле «Должность» теперь с автоподсказкой — печатаешь, появляются варианты из справочника. Но при этом можно и вписать своё (например для разового сотрудника). То что вписал руками, не попадает в справочник автоматически.' },
    ],
  },
];

// Changelog — что нового, от свежего к старому
// ВАЖНО: ПРИ КАЖДОМ РЕЛИЗЕ Atom CRM добавлять новую запись сюда — первой в массиве!
const HELP_CHANGELOG = [
  {
    version: 'v2.45.616',
    date: '06.07.2026',
    title: 'Безопасность: живой просмотр камеры офиса (директору)',
    features: [
      'Новый раздел <b>«Безопасность»</b> на главной — живой просмотр камеры офиса (~1 кадр/сек)',
      'Доступ <b>только директору</b>, работает и из офиса, и удалённо',
    ],
  },
  {
    version: 'v2.45.614',
    date: '01.07.2026',
    title: 'Спецификация: «Пришло частично» по частичной поставке',
    features: [
      'Если по позиции договора заказ пришёл <b>не полностью</b> (например, 1 из 2), в спецификации теперь бейдж <b>«Пришло частично»</b> (янтарный) вместо «Заказано»',
      'Полный приход по-прежнему помечается «Готово»',
    ],
  },
  {
    version: 'v2.45.612',
    date: '01.07.2026',
    title: 'Что закупить: карточки-счётчики кликабельны',
    features: [
      'Карточки наверху («К закупке», «Ждём поставку», «Долго ждём &gt;14дн», «Сегодня на складе») теперь <b>кликабельны</b>',
      'Нажми <b>«Долго ждём»</b> — откроется список именно этих позиций, сразу видно, о чём речь и кого теребить',
      '«Сегодня на складе» — покажет то, что должно прийти сегодня; в отфильтрованном списке есть кнопка <b>«показать все»</b>',
    ],
  },
  {
    version: 'v2.45.609',
    date: '30.06.2026',
    title: 'Атом Электрика — вернули тёмную тему',
    features: [
      'По просьбе вернули мастеру «Атом Электрика» прежнюю тёмную тему',
    ],
  },
  {
    version: 'v2.45.608',
    date: '30.06.2026',
    title: 'Атом Электрика — светлая тема',
    features: [
      'Мастер «Атом Электрика» теперь на <b>белом фоне</b> вместо чёрного — карточки, формы и списки в светлой теме',
      'Электрическая схема осталась на тёмном холсте (так читаемее), как и было',
    ],
  },
  {
    version: 'v2.45.607',
    date: '30.06.2026',
    title: 'Монтажный договор — кнопка «Закрыть договор»',
    features: [
      'В карточке монтажного договора появилась кнопка <b>«Закрыть договор»</b> — когда монтаж сдан клиенту, договор можно закрыть (раньше у монтажных договоров переключателя статуса не было)',
      'Закрытый договор можно вернуть в работу кнопкой «вернуть в работу»',
    ],
  },
  {
    version: 'v2.45.606',
    date: '30.06.2026',
    title: '«Оформить заказ» — обновлённый вид',
    features: [
      'Форма заказа собрана по секциям: <b>Поставщик · Что заказываем · В заказе · Детали</b>',
      'Выбранный поставщик показывается <b>карточкой</b> — аватар, название, почта и телефон чипами, кнопка «Сменить»',
      'Каталог комплектующих — с <b>иконками категорий</b> и счётчиками; у позиции «＋», у добавленных — галочка',
      'Кнопки <b>«Сохранить черновик» и «Проверить письмо и отправить» закреплены внизу</b> — всегда под рукой, не нужно прокручивать',
      'Поиск поставщика, «вписать свою позицию», выбор единицы измерения — работают как раньше',
    ],
  },
  {
    version: 'v2.45.605',
    date: '30.06.2026',
    title: 'Заказ поставщику: видно письмо перед отправкой',
    features: [
      'В мастере «Оформить заказ» кнопка теперь — <b>«Проверить письмо и отправить»</b>: сначала показываем <b>текст письма поставщику</b>, а уже потом отправляем',
      'В окне превью можно <b>поправить тему и текст</b> письма, проверить позиции и количество, открыть вложение-DOCX — и только затем нажать «Отправить»',
      'Раньше «Создать и отправить» уходило сразу, текст письма было не видно',
    ],
  },
  {
    version: 'v2.45.604',
    date: '30.06.2026',
    title: 'Заказ поставщику: выбор единицы измерения',
    features: [
      'В корзине заказа у каждой позиции теперь можно <b>выбрать единицу</b>: шт., м, пог.м, м², компл., упак., кг, л и др.',
      'Особенно удобно для вписанных вручную позиций — например, кабель в <b>метрах</b>',
    ],
  },
  {
    version: 'v2.45.603',
    date: '30.06.2026',
    title: '«Чаты» — новый вид списка',
    features: [
      'Чаты теперь в стиле мессенджера: <b>аватар с инициалами</b> (цвет по названию), у владельца — значок <b>короны</b> 👑',
      'Название жирно + время справа; у чатов с непрочитанными — синий акцент и <b>счётчик непрочитанных</b>',
      'Превью последнего сообщения; системные сообщения («добавил участника») — курсивом',
      'Снизу — число участников и «вы владелец». Создание чата и открытие — как раньше',
      'Под переключателем «Новый вид» — кнопкой «Вернуть старый» откатишься на прежний вид',
    ],
  },
  {
    version: 'v2.45.602',
    date: '30.06.2026',
    title: 'Заказ поставщику: вписал позицию — и готово',
    features: [
      'В «Оформить заказ» <b>поставщик теперь с поиском</b>: начни вводить название — система подберёт; клик по подсказке выбирает его',
      'Позицию, которой нет в справочнике, <b>можно просто вписать</b> — нажми Enter (или «Добавить … в заказ») и она уйдёт в заказ как есть',
      'Создавать новую номенклатуру для этого <b>не нужно</b> — вписанная позиция в справочник не добавляется, просто едет в заказ',
    ],
  },
  {
    version: 'v2.45.601',
    date: '30.06.2026',
    title: '«Замечания» (Сервис) — новый вид',
    features: [
      'Список замечаний теперь карточками с <b>цветной полосой слева по статусу:</b> 🔵 Новое, 🟠 В работе, 🟢 Решено, ⚪ Отклонено. Видно состояние с одного взгляда',
      '<b>Иконка в кружке = тип:</b> 🐞 Дефект (красный), ⚠️ Замечание (янтарный), 💡 Улучшение (зелёный), ❓ Вопрос (синий)',
      'К чему относится (сборка / договор) — чипом справа; внизу автор с мини-аватаром, место, фото и дата',
      'Фильтры слева (Все / Новые / В работе / Решённые / Отклонённые) и открытие карточки — как раньше',
      'Под переключателем «Новый вид» — кнопкой «Вернуть старый» откатишься на прежний вид',
    ],
  },
  {
    version: 'v2.45.600',
    date: '30.06.2026',
    title: '«Комплектующие» (Склад) — новый вид',
    features: [
      'KPI-плитки сверху теперь с <b>иконками</b> и цветными акцентами: всего позиций, ниже минимума, нет в наличии, ожидается приход',
      'Строки позиций — с <b>цветной полосой слева по состоянию склада:</b> 🔴 нет в наличии, 🟠 критично (ниже минимума), 🟢 в норме, 🔵 избыток. Видно дефицит и запас по цвету',
      'У каждой позиции — иконка категории, артикул отдельным чипом, остаток крупно (с минимумом), расход в месяц',
      'Баннер дефицита под план, чипы категорий, поиск, фильтры «В наличии» / «Требуют внимания», кнопки «Заказать» / «Расход» / «Брак» — всё как раньше',
      'Под переключателем «Новый вид» — кнопкой «Вернуть старый» откатишься на прежний вид',
    ],
  },
  {
    version: 'v2.45.599',
    date: '30.06.2026',
    title: '«Производство» — новый вид (визуальный)',
    features: [
      'KPI-плитки сверху теперь с <b>иконками</b> и цветными акцентами: в очереди, в работе, просрочка, заблокированы, упаковка, за неделю — статус виден с одного взгляда',
      'Колонки канбана помечены <b>цветной точкой</b>: очередь — серая, в работе — синяя, проверка — янтарная, упаковка — фиолетовая, готово — зелёная',
      'Карточки и бары загрузки чуть аккуратнее (скруглённые статус-чипы)',
      'Вся логика прежняя: перетаскивание карточек, AI-анализ, батч-помощь, таймеры «сейчас», блокировки по деталям',
      'Под переключателем «Новый вид» — кнопкой «Вернуть старый» откатишься на привычный вид',
    ],
  },
  {
    version: 'v2.45.598',
    date: '30.06.2026',
    title: 'Кнопка «Оплатить» на пришедшем счёте',
    features: [
      'У <b>привязанного к заказу</b> счёта на карточке появилась кнопка <b>«Оплатить»</b> — счёт пришёл, жмёшь, и заказ уходит в раздел «На оплату», бухгалтер получает уведомление',
      'Платит <b>через сам заказ</b> — без задвоения: пришедшая позже УПД закроет именно этот заказ',
      'Если запросил счёт вручную и он не привязался — сначала «Привязать к заказу», затем на карточке появится «Оплатить»',
      'Кнопка скрыта, если заказ уже оплачивается, оплачен или отменён',
    ],
  },
  {
    version: 'v2.45.597',
    date: '30.06.2026',
    title: '«Отчёты менеджеров» — новый вид',
    features: [
      '<b>«Сводка за месяц»</b> сверху — 6 плиток с общими цифрами по всем менеджерам: звонки, дозвоны, заявки, КП, сделки, выручка. Видно общую картину сразу',
      'Каждый менеджер — <b>карточкой с аватаром</b> и плитками итогов за месяц (выручка — золотом)',
      '<b>Воронка конверсии</b> 🟢 — звонки → дозвоны → заявки → сделки с процентами на каждом шаге. Сразу понятно, где теряются клиенты и насколько эффективен менеджер',
      '<b>«По дням»</b> — таблица сворачивается, чтобы не было простыни; внутри дневные цифры, нарастающий итог и кнопки «копировать для Telegram» и «удалить»',
      'Ввод за день, копирование в Telegram, удаление и переключение месяцев — как раньше',
      'Под переключателем «Новый вид» — кнопкой «Вернуть старый» откатишься на прежний вид',
    ],
  },
  {
    version: 'v2.45.596',
    date: '30.06.2026',
    title: '«На оплату» прямо на карточке счёта',
    features: [
      'У входящего счёта (раздел «Счета — нужна привязка») кнопка <b>«На оплату»</b> теперь прямо на карточке — не нужно заходить в «Письмо»',
      'Удобно, когда счёт <b>запросил вручную</b> и хочешь сразу отправить его в оплату, минуя привязку к заказу',
      'Кнопка появляется только если к письму приложен документ-счёт',
    ],
  },
  {
    version: 'v2.45.595',
    date: '30.06.2026',
    title: 'Ответить поставщику прямо из письма',
    features: [
      'В карточке входящего письма появилась кнопка <b>«Ответить»</b> — можно написать поставщику, не выходя из CRM',
      'Есть быстрые заготовки: <b>«Пришлите счёт»</b>, <b>«Уточните срок»</b>, <b>«Счёт + срок»</b> — текст подставляется в одно касание, его можно дописать',
      'Ответ уходит <b>в ту же переписку</b> (тема «Re: [Заявка ORD-N]»), <b>подпись и цитата</b> их письма добавляются автоматически',
      'Когда поставщик пришлёт счёт ответом — он, как и раньше, <b>сам привяжется к заказу</b> по метке заявки',
    ],
  },
  {
    version: 'v2.45.594',
    date: '30.06.2026',
    title: '«Коммерческие предложения» — новый вид списка',
    features: [
      'КП теперь <b>карточками-строками</b> с <b>аватаром клиента</b> — листать и искать глазами проще',
      '<b>Цвет полосы слева = статус КП:</b> серая — черновик, 🔵 синяя — отправлен, 🟢 зелёная — принят, 🔴 красная — отклонён. Пробежал глазами список — сразу видно, где что',
      'Контрагент крупно + статусная плашка того же цвета; для версий выше первой — значок <b>v2</b>',
      'Ниже — <b>№ КП и ИНН</b>; справа крупно <b>сумма</b> и <b>менеджер</b> с мини-аватаром',
      'Поиск, фильтры (Все / Черновики / Отправлены / Приняты / Отклонены) и открытие КП — как раньше',
      'Под переключателем «Новый вид» — кнопкой «Вернуть старый» откатишься на прежнюю таблицу',
    ],
  },
  {
    version: 'v2.45.593',
    date: '30.06.2026',
    title: 'Приёмка УПД сама закрывает закупку',
    features: [
      'Когда оприходуешь поступление по <b>УПД от поставщика</b>, заказ снабжения теперь <b>закрывается автоматически</b> — больше не висит в «Ждём поставки»',
      'Позиции уходят из списка <b>«Что закупить»</b> сами, как только заказ принят полностью',
      'В договоре связанные позиции автоматически отмечаются <b>«Получено»</b> — не нужно проставлять руками',
      'Сопоставление строк УПД с заказом стало умнее: ловит позицию и по <b>коду модели</b>, и по <b>НС-артикулу</b>, даже если в счёте название написано чуть иначе',
    ],
  },
  {
    version: 'v2.45.592',
    date: '30.06.2026',
    title: 'Защита от повторных счетов',
    features: [
      'Если один и тот же счёт случайно прислать в бота <b>дважды</b> — он больше <b>не уйдёт в оплату повторно</b>',
      'Проверяем по <b>ИНН поставщика, сумме и номеру счёта</b> среди всех ранее загруженных — в ответ придёт «этот счёт уже есть в боте»',
    ],
  },
  {
    version: 'v2.45.591',
    date: '29.06.2026',
    title: 'Заказ поставщику — отправка до Миасса',
    features: [
      'В письмо и в <b>заявку поставщику</b> автоматически добавляется строка: «просим отправить транспортной компанией до г. Миасс» — не нужно дописывать вручную',
    ],
  },
  {
    version: 'v2.45.590',
    date: '29.06.2026',
    title: 'Схема (PDF) у модели снова открывается',
    features: [
      'Исправили ошибку, из-за которой <b>«Схема (PDF)»</b> у модели не открывалась (выдавала 404) — теперь файл открывается как положено',
    ],
  },
  {
    version: 'v2.45.589',
    date: '30.06.2026',
    title: '«Договоры» — новый вид списка',
    features: [
      'Список договоров теперь <b>карточками-строками</b> с <b>аватаром клиента</b> — листать и искать глазами проще',
      'Слева <b>цветная полоса</b> по сроку: 🔴 просрочен, 🟢 в работе в срок, серая — отгружен/закрыт',
      'Контрагент крупно + <b>статусная плашка</b>; для горящих — значок <b>⚠️ ПРОСРОЧЕН / 🔥 ГОРИТ</b>',
      'Справа в одну линию: <b>срок</b> (красный чип, если просрочен), <b>сумма</b> крупно и <b>менеджер</b> — суммы выстроены в колонку, удобно пробежать глазами',
      'Поиск и фильтры (Все / В производстве / Готов к отгрузке / Отгружен / Закрыт) — прежние; клик открывает договор как и раньше',
      'Под переключателем «Новый вид» — кнопкой «Вернуть старый» откатишься на прежнюю таблицу',
    ],
  },
  {
    version: 'v2.45.587',
    date: '30.06.2026',
    title: '«Главная продаж» — новый дизайн',
    features: [
      'Наверху <b>4 плитки</b> с цифрами: всего договоров, в производстве, к отгрузке, отгружено',
      '<b>«Готовность договоров в работе»</b> — карточки с аватаром клиента, <b>полосой готовности</b> (% по сборкам) и чипом срока. Просроченные подсвечены красной полосой слева, в срок — зелёной',
      '<b>«Срочные · 7 дней»</b> — отдельной лентой те договоры, у которых срок поджимает',
      '<b>«Последние договоры»</b> — компактными строками со статусной плашкой',
      'Видно с одного взгляда: что горит, что близко к сроку и насколько готов каждый договор — без захода внутрь',
      'Под переключателем «Новый вид» — кнопкой «Вернуть старый» откатишься на прежний вид',
    ],
  },
  {
    version: 'v2.45.584',
    date: '25.06.2026',
    title: '«Поставщики» — новый дизайн',
    features: [
      'Поставщики теперь карточками с <b>аватарами</b> — удобно листать и искать глазами',
      'Контакты — <b>кликабельными чипами</b>: тап по телефону звонит, по почте — пишет письмо, WhatsApp отдельным зелёным чипом',
      '<b>«Возит: …»</b> (продукция) видно сразу — понятно, кто что поставляет',
      '<b>Поиск</b> работает мгновенно и теперь ищет ещё и <b>по продукции</b> (например, «насос» → найдёт «Все насосы»)',
      'Под переключателем «Новый вид» — кнопкой «Вернуть старый» откатишься на прежний список',
    ],
  },
  {
    version: 'v2.45.583',
    date: '25.06.2026',
    title: '«Приём УПД от ЭДО» — новый дизайн',
    features: [
      'Документы из 1С-ЭДО разложены: <b>«Нужно оприходовать»</b> (ещё не на складе) наверх, <b>«В приёмке»</b> — ниже',
      'Сверху счётчики: сколько нужно оприходовать, сколько не привязано к заказу, сколько уже в приёмке',
      'На карточке — поставщик, номер/дата УПД, тип (СЧФДОП), сумма с НДС и привязка к заказу. Прямо из списка кнопки <b>«Оприходовать»</b> и <b>«Привязать»</b> — не открывая карточку',
      'Под переключателем «Новый вид» — кнопкой «Вернуть старый» откатишься на прежний список',
    ],
  },
  {
    version: 'v2.45.582',
    date: '25.06.2026',
    title: '«Приёмка УПД» — новый дизайн',
    features: [
      'Документы разложены по статусу: <b>«Ждут распознавания»</b> и <b>«Черновики — оприходовать»</b> наверх (то, что требует действия), а <b>«Оприходовано»</b> — спокойно ниже',
      'Сверху счётчики: сколько черновиков, сколько ждут распознавания, сколько оприходовано',
      'На карточке сразу видно поставщика (аватар), номер и дату УПД, договор и <b>сумму с НДС</b>. У черновика — крупная кнопка «Оприходовать»',
      'Под переключателем «Новый вид» — кнопкой «Вернуть старый» откатишься на прежний список',
    ],
  },
  {
    version: 'v2.45.581',
    date: '25.06.2026',
    title: '«Входящие счета» — новый дизайн',
    features: [
      'Письма теперь разложены по смыслу: <b>счета с вложением-документом</b> (PDF/Excel/Word) — наверх крупными карточками с кнопкой «Привязать к заказу», а <b>рассылки и уведомления без вложений</b> — свёрнуты вниз серой группой, чтобы не мешали',
      'Сверху — счётчики: сколько счетов ждут привязки, сколько уже привязано, сколько рассылок. Сразу видно объём работы',
      'У счёта видно отправителя (аватар), сам файл-вложение, метку MAX и плательщика (АГ/ТД)',
      'Всё под переключателем «Новый вид» — кнопкой «Вернуть старый» откатишься на прежний список',
    ],
  },
  {
    version: 'v2.45.580',
    date: '25.06.2026',
    title: '«Что закупить» — новый дизайн',
    features: [
      'Сверху — <b>4 цифры одним взглядом</b>: к закупке, ждём поставку, долго ждём (красным — где затык), сегодня на складе',
      'Два таба — <b>«К закупке»</b> и <b>«Ждём поставку»</b>, чтобы не скроллить всё подряд',
      'У поставщиков — <b>аватары</b> с инициалами; у позиций в ожидании — <b>трекер доставки</b> (Заказан → Оплачен → В пути → На складе), видно, на каком шаге каждая',
      'Всё под переключателем «Новый вид» — если что, кнопкой «Вернуть старый» откатишься на прежний вид',
    ],
  },
  {
    version: 'v2.45.570',
    date: '25.06.2026',
    title: 'Производство: защита отгрузки + «продолжить вчерашнее»',
    features: [
      'QR-отгрузка теперь <b>не выпустит изделие, которое ещё в работе</b>. При сканировании, если по этому договору изделие ещё на канбане (в работе / упаковке / проверке), сканер скажет «Нельзя — ещё в работе» и не отгрузит. Сначала закрой работу на канбане',
      'Автостоп → <b>«вчера не доделал?»</b>: если в 18:00 тебя застопило, а работа не закрыта — на следующий день при заходе в Производство сверху появится баннер «Вчера не доделано: [модель], этап [этап] — Продолжить / Возьму новое». «Продолжить» сразу запускает часики на той же работе и этапе',
    ],
  },
  {
    version: 'v2.45.569',
    date: '25.06.2026',
    title: 'Этапы в спецификации — в один клик',
    features: [
      'Этап теперь виден <b>прямо в строке</b> тех. карты: у каждой комплектующей чип «этап». Нажал — выбрал этап (сварка / покраска / ТЭНы+электрика) или <b>создал новый</b> прямо там. Раньше это пряталось в кнопке «изменить»',
    ],
  },
  {
    version: 'v2.45.568',
    date: '25.06.2026',
    title: 'Спецификация по этапам производства',
    features: [
      'В тех. карте (BOM) у каждой комплектующей можно указать <b>этап производства</b> — сварка, покраска, ТЭНы+электрика и т.д. Спецификация показывается сгруппированной по этапам, чтобы видеть, что нужно на каждом шаге',
      'Это первый шаг к поэтапной сборке НВП: закупать и собирать по циклу (сначала сварка — только свои детали, потом покраска, потом ТЭНы и электрика), а не всё сразу',
    ],
  },
  {
    version: 'v2.45.551',
    date: '24.06.2026',
    title: 'Чаты доступны всем — кнопка в шапке',
    features: [
      'Кнопка <b>«Чаты»</b> теперь есть в верхней панели — открывается из любого раздела и для любой роли (не только в Сервисе и Монтаже). Так чаты видит каждый сотрудник, кого добавили в группу, независимо от прав',
    ],
  },
  {
    version: 'v2.45.545',
    date: '24.06.2026',
    title: 'Чаты доступны монтажнику',
    features: [
      'Пункт <b>«Чаты»</b> появился в разделе <b>Монтаж</b> — монтажник видит чаты, в которых он участвует, и может общаться. Непрочитанные подсвечиваются',
    ],
  },
  {
    version: 'v2.45.543',
    date: '24.06.2026',
    title: 'Чаты: большое окно и управление участниками',
    features: [
      'Окно чата теперь во весь экран — удобно переписываться и смотреть вложения',
      'Слева — постоянная панель участников: видно весь состав, можно <b>добавить</b> людей, <b>удалить</b> кого-то (у владельца) и <b>переименовать</b> чат прямо там. Раньше это пряталось за иконкой',
    ],
  },
  {
    version: 'v2.45.540',
    date: '24.06.2026',
    title: 'Сервис → «Чаты»: общение командой',
    features: [
      'В разделе <b>Сервис</b> появились <b>Чаты</b> — свободные группы для обсуждений. Создаёте чат, даёте название, приглашаете участников (менеджеров, монтажников, кого угодно) — и общаетесь. Как группы в мессенджере',
      'В чате можно писать сообщения и прикреплять файлы (фото, видео, документы — до 5 на сообщение)',
      'Владелец чата может переименовать его, добавлять и удалять участников. Любой участник может выйти из чата. Непрочитанные подсвечиваются счётчиком',
    ],
  },
  {
    version: 'v2.45.522',
    date: '24.06.2026',
    title: 'Снабжение: кнопка «получено» стала понятнее',
    features: [
      'В «Снабжение → Ждём поставку» кнопка <b>«получено»</b> сбивала с толку — было непонятно, это статус («уже получено») или действие. Переименовали в <b>«Отметить, что пришло»</b> и оформили явной кнопкой-действием. Жмёшь, когда товар пришёл — заказ закрывается, позиция уходит из ожидания',
    ],
  },
  {
    version: 'v2.45.506',
    date: '23.06.2026',
    title: 'Атом Электрика — правильный ток цепи управления',
    features: [
      'Исправлен расчёт автомата цепей управления: раньше туда суммировался коммутируемый/номинальный ток контакторов и твердотельных реле (и QF цепей управления раздувался до десятков ампер). Теперь учитывается только реальный ток управления — контроллер, катушки (~0,05 А) и лампы',
    ],
  },
  {
    version: 'v2.45.505',
    date: '23.06.2026',
    title: 'Атом Электрика — старые обозначения K меняются на KM',
    features: [
      'Контакторы, добавленные раньше как K1/K2/K3, теперь автоматически переименовываются в KM1/KM2/KM3 при открытии компоновки, спецификации и редактора (а не только на шаге «Вспомогат.»)',
    ],
  },
  {
    version: 'v2.45.504',
    date: '23.06.2026',
    title: 'Атом Электрика — контактор раздельно (как принято)',
    features: [
      'Контактор на схеме показан раздельно: силовые контакты — на силовом листе, катушка — на листе управления (связь по общему обозначению KM)',
      'Полное УГО контактора (катушка+контакты) осталось в библиотеке редактора для ручной вставки',
    ],
  },
  {
    version: 'v2.45.503',
    date: '23.06.2026',
    title: 'Атом Электрика — полное обозначение контактора',
    features: [
      'Контактор из «Вспомогат.» рисуется полным УГО как в каталоге NC1: катушка A1/A2, три силовых контакта с выводами 1/L1…6/T3, вспомогательный контакт 21/22 и штриховая механическая связь',
      'Полный символ контактора добавлен и в библиотеку редактора (раздел «Коммутация»)',
    ],
  },
  {
    version: 'v2.45.502',
    date: '23.06.2026',
    title: 'Атом Электрика — единое обозначение контакторов (KM)',
    features: [
      'Все контакторы теперь обозначаются одинаково — KM, со сквозной нумерацией: добавленные вручную и сгенерированные автоматически не путаются (раньше был разнобой K и KM)',
    ],
  },
  {
    version: 'v2.45.501',
    date: '23.06.2026',
    title: 'Атом Электрика — цепь автомат→контактор→ТР→клемма',
    features: [
      'Если у нагрузки есть и контактор, и твердотельное реле (через «что коммутирует»), на силовой схеме рисуется правильная цепь: автомат → контактор → твердотельное реле → клемма → нагрузка',
      'У твердотельного реле показан вход управления 0-10В (← от аналогового выхода контроллера)',
    ],
  },
  {
    version: 'v2.45.499',
    date: '23.06.2026',
    title: 'Атом Электрика — твердотельное реле с фазой и 0-10 В',
    features: [
      'Твердотельное реле (регулятор напряжения) рисуется отдельным символом: силовой вход L1 сверху, выход T1 снизу и вход управления 0-10 В сбоку',
      'ТР больше не участвует в логике «общего контактора» — это отдельное устройство (контактор → ТР → нагрузка)',
    ],
  },
  {
    version: 'v2.45.498',
    date: '23.06.2026',
    title: 'Атом Электрика — один контактор на несколько нагрузок',
    features: [
      'Если несколько нагрузок закреплены за одним контактором (через «что коммутирует»), на силовой схеме рисуется ОДИН контактор с контактами на каждый отвод (одно общее обозначение, напр. K1), а не по контактору на каждую',
      'В спецификации и компоновке такой контактор считается один раз; у остальных нагрузок — свои контакторы как обычно',
    ],
  },
  {
    version: 'v2.45.497',
    date: '23.06.2026',
    title: 'Атом Электрика — контактор у каждой нагрузки вернулся',
    features: [
      'На силовой схеме у каждой нагрузки снова рисуется свой контактор (KM3 и т.д.) — он не пропадает',
      'Реальный габарит реле промежуточного (РЭК77/3) остаётся',
    ],
  },
  {
    version: 'v2.45.494',
    date: '23.06.2026',
    title: 'История договора — по-русски',
    features: [
      'В «Истории изменений» договора английские коды действий заменены на понятные подписи: «Запрошена/Отменена сборка к отгрузке», «Сброс отгрузки», «Сброс отметок „собрано“», «Авто-привязка к складу» и др.',
      'Технические хвосты тоже переведены: removed→снято, linked→привязано, skipped→пропущено',
    ],
  },
  {
    version: 'v2.45.493',
    date: '23.06.2026',
    title: 'Атом Электрика — контакторы по NC1 (3 полюса, выводы 1/3/5→2/4/6)',
    features: [
      'Все контакторы на силовой схеме рисуются 3-полюсными (серия NC1 — трёхполюсная) с выводами 1/3/5 сверху и 2/4/6 снизу (T1/T2/T3 — на двигатель) — как в схемах NC1',
    ],
  },
  {
    version: 'v2.45.492',
    date: '23.06.2026',
    title: 'Атом Электрика — клеммы для объединённого автомата',
    features: [
      'Если автомат объединён (несколько линий на одном QF), при «Пересобрать из состава» каждая линия получает свою клемму, и в колонке «Линия» у всех них стоит один и тот же автомат (QF)',
      'То же в выборе «из оборудования» — линии объединённого автомата показываются по каждой нагрузке с её QF',
    ],
  },
  {
    version: 'v2.45.491',
    date: '23.06.2026',
    title: 'Атом Электрика — контактор тремя контактами',
    features: [
      'Трёхфазный контактор (KM) на силовой схеме теперь рисуется как положено — тремя силовыми контактами с выводами на двигатель T1 / T2 / T3 (а не одним контактом)',
      'Однофазные контакторы остаются одним контактом',
    ],
  },
  {
    version: 'v2.45.490',
    date: '23.06.2026',
    title: 'Атом Электрика — провода не идут по одной линии',
    features: [
      'В редакторе нельзя проложить провод поверх уже существующего (по той же линии) — если сегмент совпал бы с другим проводом, система не даёт завершить и подсказывает развести в стороне',
    ],
  },
  {
    version: 'v2.45.489',
    date: '23.06.2026',
    title: 'Атом Электрика — HMI отдельным элементом в схеме',
    features: [
      'Сенсорная панель (HMI) теперь отдельный элемент на схеме — можно спокойно перенести её куда нужно (раньше была вшита в символ контроллера)',
      'Связь RS-485 заведена проводами: выводы A/B панели соединены с выводами A/B контроллера',
    ],
  },
  {
    version: 'v2.45.488',
    date: '23.06.2026',
    title: 'Атом Электрика — выделение рамкой и перенос группой',
    features: [
      'В редакторе можно протянуть мышкой рамку по пустому месту и выделить сразу несколько элементов, затем перенести их группой (тащи любой выделенный)',
      'Группой работают также поворот (R), зеркало (M) и удаление (Delete)',
      'Панорама листа — пробел (зажать) + тянуть, либо инструмент «рука», либо средняя кнопка мыши',
    ],
  },
  {
    version: 'v2.45.487',
    date: '23.06.2026',
    title: 'Атом Электрика — порядок клемм и катушки контакторов',
    features: [
      'В шаге «Клеммы» появились ↑↓ (поменять местами) и ＋ (вставить клемму ниже) — номера в группе (X2:1, X2:2…) сдвигаются автоматически',
      'Контакторы на схеме теперь показывают катушку с выводами A1 / A2 (вместо «голых» контактов)',
    ],
  },
  {
    version: 'v2.45.486',
    date: '23.06.2026',
    title: 'Атом Электрика — видно, что уже назначено на клеммы',
    features: [
      'В окне «Выбрать из оборудования» (на клемме) уже назначенные позиции помечаются галочкой с номером клеммы (напр. «✓ уже: X2:1») и слегка затемняются — сразу видно, что и куда уже разнесено',
    ],
  },
  {
    version: 'v2.45.485',
    date: '23.06.2026',
    title: 'Атом Электрика — нормальный символ блока питания',
    features: [
      'Блок питания на схеме теперь рисуется как положено — с 4 выводами: вход L/N (~ переменное) сверху, выход +24В/0В (= постоянное) снизу — вместо безликого прямоугольника',
      'Символ блока питания добавлен и в библиотеку редактора (раздел «Питание и приборы»)',
    ],
  },
  {
    version: 'v2.45.483',
    date: '23.06.2026',
    title: 'Продажная позиция: характеристики прямо в форме',
    features: [
      'В форме позиции (Продажная номенклатура) появился блок <b>«Характеристики»</b> — добавляйте/правьте параметры (например, у воздухоохладителей и наружных блоков)',
      'Характеристики видны в карточке позиции и автоматически подставляются под позицию в КП и PDF',
    ],
  },
  {
    version: 'v2.45.482',
    date: '23.06.2026',
    title: 'Атом Электрика — схема держится в рамке листа',
    features: [
      'Аппараты в схеме редактора больше не вылезают за рамку A3 и не залезают на штамп — теперь они на отдельных листах «аппараты управления» с сеткой в пределах рамки',
      'Когда аппаратов много и на лист не помещаются — автоматически переносятся на следующий лист',
    ],
  },
  {
    version: 'v2.45.481',
    date: '23.06.2026',
    title: 'Атом Электрика — все аппараты в схеме редактора',
    features: [
      'В схему (Лист 2 · цепи управления) теперь заносятся все аппараты из шага «Вспомогат.»: кнопки, переключатели, грибок, реле промежуточные, твердотельные реле и т.д. — отдельным блоком «АППАРАТЫ УПРАВЛЕНИЯ» с обозначениями и УГО',
      'Их можно двигать и разводить в редакторе; назначение (что коммутирует) подписано',
    ],
  },
  {
    version: 'v2.45.480',
    date: '23.06.2026',
    title: 'Атом Электрика — коммутация нагрузок с количеством',
    features: [
      'В «что коммутирует» нагрузка с количеством разворачивается по единицам (например, обеззараживатель ×3 → #1, #2, #3) — можно назначить каждую',
      'Одну и ту же нагрузку теперь можно добавить несколько раз (запрет на повтор снят)',
    ],
  },
  {
    version: 'v2.45.479',
    date: '23.06.2026',
    title: 'Атом Электрика — аппарат может коммутировать несколько нагрузок',
    features: [
      'У контактора / реле / твердотельного реле «что коммутирует» теперь можно указать несколько нагрузок (например, приточный и вытяжной вентилятор) — выбранные показываются чипами, добавляются выпадающим списком и убираются крестиком',
    ],
  },
  {
    version: 'v2.45.478',
    date: '23.06.2026',
    title: 'Атом Электрика — ровная нумерация аппаратов и объединение автоматов',
    features: [
      'Аппараты внутри рода нумеруются по порядку без дыр: было «ТР3, ТР4» (без ТР1/ТР2) — стало ТР1, ТР2 (вручную заданные обозначения сохраняются)',
      'Объединять линии на один автомат теперь можно для любого автомата, кроме ввода — включая автомат блока питания и цепей управления',
    ],
  },
  {
    version: 'v2.45.477',
    date: '23.06.2026',
    title: 'Атом Электрика — без «прыжка» наверх при правке',
    features: [
      'Когда нажимаешь «изменить» (или добавляешь/удаляешь элемент), страница больше не прыгает наверх — прокрутка остаётся на месте, правка открывается прямо там, где стоишь',
      'Наверх прокручивает только при переходе на другой шаг мастера',
    ],
  },
  {
    version: 'v2.45.476',
    date: '23.06.2026',
    title: 'Атом Электрика — аппараты по роду + «что коммутирует» у реле',
    features: [
      'Аппараты в шкафу группируются по роду: добавил ещё один контактор — он встаёт к своим (K1, K2, K3, K4…), реле к реле, лампы к лампам и т.д.',
      'Поле «что коммутирует» теперь есть не только у контактора, но и у реле промежуточного и твердотельного реле',
    ],
  },
  {
    version: 'v2.45.475',
    date: '23.06.2026',
    title: 'Атом Электрика — у аппаратов редактируется марка/модель',
    features: [
      'В шаге «Аппараты в шкафу» при правке строки (✎) теперь можно менять и марку/модель — вместе с обозначением, наименованием, типом, током и количеством',
    ],
  },
  {
    version: 'v2.45.474',
    date: '23.06.2026',
    title: 'Атом Электрика — назначение клеммы выбором из оборудования',
    features: [
      'У каждой клеммы появилась кнопка «▾»: открывает список внесённого оборудования (ввод/N·PE, отходящие линии автоматов, потребители, вспомогательное, датчики, контроллер, HMI) — выбираешь, и назначение с линией подставляются',
      'Свободный ввод назначения тоже остался — можно набрать вручную',
    ],
  },
  {
    version: 'v2.45.473',
    date: '23.06.2026',
    title: 'Атом Электрика — шаг «Клеммы» редактируемый',
    features: [
      'В шаге «Клеммы» теперь можно добавлять, редактировать (клемма / назначение / линия) и убирать клеммы прямо в таблице',
      'Кнопка «↻ Пересобрать из состава» возвращает автоматический набор клемм по вводу, отходящим линиям и датчикам; изменённый план сохраняется в проекте',
    ],
  },
  {
    version: 'v2.45.472',
    date: '23.06.2026',
    title: 'Воздухоохладители LUN: характеристики',
    features: [
      'У воздухоохладителей 201/202/203/204 LUN заполнены характеристики (холодопроизводительность, поверхность теплообмена, расход воздуха, вентиляторы, габариты, вес, хладагент, оттайка) — в карточке модели и в продажной позиции',
      'При добавлении воздухоохладителя в КП характеристики подставляются под позицию (как у наружных блоков)',
    ],
  },
  {
    version: 'v2.45.471',
    date: '23.06.2026',
    title: 'Наружные блоки: характеристики в КП',
    features: [
      'У наружных блоков НБ 7/9/12/18/24 заполнены характеристики (габариты, вес, потребляемая мощность, ток, хладагент R32, заводская заправка) — видны в карточке модели',
      'При добавлении наружного блока в КП его характеристики <b>автоматически подставляются под позицию</b> (в расшифровку) и печатаются в PDF',
    ],
  },
  {
    version: 'v2.45.470',
    date: '23.06.2026',
    title: 'Атом Электрика — «Сохранить как…»',
    features: [
      'Появилась кнопка «⎘ Сохранить как…» (в шапке мастера и в шаге «Спецификация»): сохраняет копию проекта с выбором раздела и названия — исходный чертёж не перезаписывается',
      'В окне видно обозначение и шифр для выбранного раздела; номер в разделе подставляется автоматически',
    ],
  },
  {
    version: 'v2.45.469',
    date: '23.06.2026',
    title: 'Атом Электрика — имя изделия следует за разделом',
    features: [
      'Если имя изделия ещё «автоматическое» (не задано вручную), при выборе раздела оно подставляется по разделу — демо-имя «Холодильная камера созревания» больше не прилипает к ПВУ и другим разделам',
      'Срабатывает и при повторном клике по уже выбранному разделу — стоишь на ПВУ с чужим именем, кликнул раздел → имя стало «Приточно-вытяжная система». Своё, вручную заданное имя не трогается',
    ],
  },
  {
    version: 'v2.45.468',
    date: '23.06.2026',
    title: 'Атом Электрика — схема правильно рисует сгруппированный автомат',
    features: [
      'Если на один автомат назначено несколько потребителей, на схеме (Лист 1) он теперь рисуется как один QF → шина распределения → отдельные отводы, у каждого свой контактор (KM) и клемма (X)',
      'Нумерация контакторов согласована между листами: силовой контакт KMn на Листе 1 соответствует катушке KMn на Листе 2',
    ],
  },
  {
    version: 'v2.45.467',
    date: '23.06.2026',
    title: 'Атом Электрика — несколько потребителей на один автомат',
    features: [
      'В шаге «Автоматы» можно объединять линии на один автомат: у автомата — «⤵ объединить с…» (выбор другого автомата той же полюсности). Номинал автоматически поднимается под суммарный ток',
      'Обратное действие: у линии в сгруппированном автомате — кнопка «⤴» выносит её обратно в отдельный автомат',
      'Подсказка показывает «N линии на одном автомате», перегруз по-прежнему подсвечивается; число модулей в корпусе пересчитывается',
    ],
  },
  {
    version: 'v2.45.466',
    date: '23.06.2026',
    title: 'Производство: удобный выбор компонента со склада',
    features: [
      'В окне <b>«Сопоставить со склада»</b> сверху показываются позиции, <b>похожие на нужную</b> (по названию), а не случайные — даже до ввода поиска',
      'То, что <b>есть в наличии</b>, поднимается выше; «нет в наличии» помечается и притеняется',
      'Поиск работает по <b>названию и артикулу</b>, видно категорию позиции и галочку у выбранной',
    ],
  },
  {
    version: 'v2.45.465',
    date: '23.06.2026',
    title: 'Снабжение: кнопка «Получено» в «Ждём поставку»',
    features: [
      'У позиций в <b>«Ждём поставку»</b> появилась кнопка <b>«получено»</b> — когда товар пришёл, жмёшь её, и заказ закрывается (статус «получен»), позиция уходит из ожидания',
      'Удобно, если приёмка УПД не «схлопнула» заказ автоматически или товар пришёл вообще без УПД',
    ],
  },
  {
    version: 'v2.45.464',
    date: '22.06.2026',
    title: 'КП без колонки «Скидка»',
    features: [
      'Из КП убрана колонка <b>«Скидка»</b> — в форме составления, в карточке КП и в PDF. Состав стал чище: №, наименование, кол-во, цена, сумма',
    ],
  },
  {
    version: 'v2.45.462',
    date: '22.06.2026',
    title: 'КП: расшифровка позиции для клиента',
    features: [
      'У каждой позиции КП появилось заметное поле <b>«Расшифровка — что это, видит клиент»</b> (отдельной строкой во всю ширину)',
      'Расшифровка показывается под названием позиции <b>в самом КП и в PDF</b> — клиенту понятно, что за «ЩУ-003-001»: напишите, например, «Щит управления, стандартное исполнение, IP54»',
      'Если позиция добавлена из каталога и у неё уже есть описание — оно подставляется в расшифровку автоматически',
    ],
  },
  {
    version: 'v2.45.459',
    date: '22.06.2026',
    title: 'Excel-прайс в КП: листы-вкладки и округление цен',
    features: [
      'Если в прайсе несколько листов (Вентиляторы, Сетевые элементы, Решётки…), они теперь показываются <b>вкладками</b> — переключайтесь между ними прямо в просмотрщике',
      'Цены больше не показываются «хвостами» вроде 5490.179999 — числа аккуратно округляются, а в КП цена встаёт <b>целым числом рублей</b>',
    ],
  },
  {
    version: 'v2.45.458',
    date: '22.06.2026',
    title: 'Excel-прайс в КП: во весь экран, крупнее фото, ровный текст',
    features: [
      'В просмотрщике Excel-прайса появилась кнопка <b>«Во весь экран»</b> — таблицу удобно листать целиком',
      'Фотографии моделей стали <b>крупнее и чётче</b>',
      'Текст в ячейках <b>больше не рвётся по буквам</b> — колонки подстраиваются под содержимое, надписи читаются нормально',
    ],
  },
  {
    version: 'v2.45.457',
    date: '22.06.2026',
    title: 'Excel-прайс для КП: открываются и старые форматы',
    features: [
      'При загрузке прайса в КП теперь видны и выбираются файлы <b>.xls</b> и <b>.xlsm</b>, а не только .xlsx — раньше старый прайс «не находился» в окне выбора',
      'Старый формат .xls тоже открывается таблицей с кликабельными позициями (без фото — этот формат их не хранит)',
    ],
  },
  {
    version: 'v2.45.456',
    date: '22.06.2026',
    title: 'КП: добавляйте позиции прямо из Excel-прайса',
    features: [
      'При составлении КП в окне «Добавить позицию» появилась вкладка <b>«Excel-прайс»</b> — загрузите .xlsx, и он откроется <b>прямо в приложении как таблица, с фотографиями</b>, как в Excel',
      'Кликните по строке с моделью — <b>позиция сразу добавится в КП с ценой</b>; можно набрать так всё КП, листая прайс',
      'Загруженные прайсы сохраняются — их можно переоткрывать в любом КП, не загружая заново',
    ],
  },
  {
    version: 'v2.45.455',
    date: '22.06.2026',
    title: 'Список КП: видно, кто рассчитал',
    features: [
      'В списке КП рядом с <b>менеджером</b> теперь показывается, <b>кто рассчитал</b> КП (если указано) — раньше это было видно только в карточке и в PDF',
    ],
  },
  {
    version: 'v2.45.454',
    date: '22.06.2026',
    title: 'Продажная номенклатура: импорт прайса из Excel',
    features: [
      'На странице <b>«Продажная номенклатура»</b> появилась кнопка <b>«Прайс из Excel»</b> — загрузите .xlsx, и позиции с ценами зальются автоматически',
      'Сервер сам находит колонки <b>«Наименование»</b> и <b>«Цена»</b> по заголовкам; каждый <b>лист</b> книги становится отдельной <b>группой</b> (папкой)',
      'Позиция с тем же названием в выбранной категории <b>обновится ценой</b>, новые — добавятся; каталожные позиции (с артикулом) не затрагиваются',
    ],
  },
  {
    version: 'v2.45.453',
    date: '22.06.2026',
    title: 'Монтаж: чат и файлы прямо в карточке',
    features: [
      'В карточке монтажа теперь есть <b>чат и прикрепление файлов по договору</b> — встроены прямо в карточку (ниже отчётов), отдельное окно больше не открывается',
      'Монтажник, менеджер и директор переписываются и обмениваются фото/документами по объекту в одном месте — сообщения общие с чатом договора',
    ],
  },
  {
    version: 'v2.45.452',
    date: '22.06.2026',
    title: 'КП: поле «Рассчитал» + аккуратнее шапка PDF',
    features: [
      'В форме КП появилось необязательное поле <b>«Рассчитал»</b> — можно указать сотрудника, который считал КП (если это не менеджер)',
      'В PDF добавлен блок <b>«Менеджер / Рассчитал»</b>, а блок «Кому / От кого» сделан компактнее',
    ],
  },
  {
    version: 'v2.45.451',
    date: '22.06.2026',
    title: 'КП: предпросмотр + обновлённый PDF (Times New Roman 12)',
    features: [
      'В открытом КП появилась кнопка <b>«Предпросмотр»</b> — открывает PDF во вкладке, чтобы сразу посмотреть, как будет выглядеть документ, не скачивая',
      'Сам PDF переоформлен: шрифт <b>Times New Roman 12</b>, уже боковые поля, а суммы в таблице больше не переносятся на две строки',
    ],
  },
  {
    version: 'v2.45.450',
    date: '22.06.2026',
    title: 'КП: цена и количество вводятся нормально',
    features: [
      'В позициях <b>«Новое КП»</b> поля <b>«Цена»</b>, <b>«Кол-во»</b> и <b>«Скидка»</b> больше не теряют фокус после каждой цифры — теперь сумму можно набрать одним заходом',
      'Сумма позиции и общий итог по-прежнему пересчитываются на лету, прямо во время ввода',
    ],
  },
  {
    version: 'v2.45.449',
    date: '22.06.2026',
    title: 'Черновик КП не теряется при обновлении страницы',
    features: [
      'Начатое <b>«Новое КП»</b> теперь сохраняется автоматически — если случайно обновить страницу или закрыть вкладку, при возврате форма восстановится с баннером «Восстановлен черновик незаконченного КП»',
      'Раньше сохранялось только то, что вводилось руками; выбор <b>менеджера, контрагента, юрлица и позиций</b> через окошки не попадал в черновик. Теперь попадает всё',
      'Очистить черновик можно кнопкой «Очистить» в баннере или просто создав КП',
    ],
  },
  {
    version: 'v2.45.448',
    date: '22.06.2026',
    title: 'КП: менеджер и контрагент снова сохраняются',
    features: [
      'В форме <b>«Новое КП»</b> снова выбираются <b>менеджер</b> и <b>контрагент</b> — раньше выбор в окне не закреплялся и поле оставалось пустым',
      'Причина была техническая: обработчик выбора в КП перекрывался обработчиком из формы договора. Теперь у КП и договора свои независимые обработчики',
    ],
  },
  {
    version: 'v2.45.436',
    date: '19.06.2026',
    title: 'Карточка комплектующего: «Сколько заказывать»',
    features: [
      'В карточке комплектующего (Склад → Комплектующие → ✎) появилось поле <b>«Сколько заказывать»</b> — фиксированное кол-во к заказу при низком остатке',
      'Пример: «Наружный блок 9» — мин. остаток 1, сколько заказывать 2. Как только на складе останется 1 (или меньше) — в «Что закупить» предложит заказать ровно <b>2 шт</b>',
      'Если поле пустое — работает как раньше (заказываем дефицит до минимума автоматически)',
    ],
  },
  {
    version: 'v2.45.435',
    date: '19.06.2026',
    title: 'Каталог прайсов: понятная причина, если прайс не открылся',
    features: [
      'Если в окне «Каталог поставщика» прайс не открывается — теперь видно <b>почему</b>: «файл прайса не найден в хранилище» или «не открылся Excel» (с текстом ошибки), вместо глухого «Не удалось отрисовать таблицу»',
      'Тут же подсказка, что делать: загрузить прайс заново кнопкой «Прайс из Excel» или удалить файл корзинкой и добавить новый',
    ],
  },
  {
    version: 'v2.45.434',
    date: '19.06.2026',
    title: 'Дата поставки «15 июля» + куда придёт',
    features: [
      'Дата поставки теперь пишется по-человечески — <b>«придёт 15 июля»</b> (а не «15 июл»)',
      'В окошке «когда придёт» добавлен выбор <b>куда придёт: «К нам» или «К ним на склад»</b> — видно прямо в чипе рядом с датой',
    ],
  },
  {
    version: 'v2.45.433',
    date: '19.06.2026',
    title: 'Ожидаемая дата поставки в «Ждём поставку»',
    features: [
      'У позиции в «Ждём поставку» появилась кнопка <b>«когда придёт?»</b> — открывается окошко с выбором даты. Менеджер поставщика назвал срок (например, 15 июля) — ставишь, и видишь его прямо в списке',
      'Дата показывается зелёным чипом <b>«📅 придёт 15 июл»</b>; если срок уже прошёл, а поставки нет — чип становится <b>красным с ⚠</b>',
      'Дата задаётся на заказ (ORD) и показывается у всех его позиций — можно поправить в любой момент или убрать',
    ],
  },
  {
    version: 'v2.45.432',
    date: '19.06.2026',
    title: 'Акцент на «сколько ждём поставку»',
    features: [
      'В блоке «Ждём поставку» срок ожидания теперь цветной чип с часиками, а не серый текст — видно сразу',
      'Градация по сроку: до недели — синий, <b>7–13 дней — оранжевый</b> (ждём уже долго), <b>14+ дней — красный с ⚠</b> (пора теребить поставщика)',
    ],
  },
  {
    version: 'v2.45.431',
    date: '18.06.2026',
    title: '«Ждём поставку» — нормальная вёрстка на телефоне',
    features: [
      'Позиции в блоке «Ждём поставку» больше не обрезаются за край экрана: название теперь отдельной строкой, а под ним — чипсы (кол-во · сколько дней ждём · статус заказа · «вернуть к закупке») с переносом',
      'Длинная метка «Оплачен · ждём поставку» укорочена до «Оплачен» (блок и так называется «Ждём поставку») — статусы стали компактнее и читаемее',
    ],
  },
  {
    version: 'v2.45.430',
    date: '18.06.2026',
    title: '«Вернуть к закупке» в блоке «Ждём поставку»',
    features: [
      'У позиции-комплектующего, попавшей в <b>«Ждём поставку»</b> из <b>черновика</b> заказа («Заказ создан»), появилась кнопка <b>«↩ вернуть к закупке»</b> — убирает её из заказа и возвращает в список к закупке (потом можно собрать в другой заказ)',
      'Так можно разделить заказ: оставить в нём только реально заказанное/оплаченное, а лишние позиции вернуть и заказать отдельно — без захода в раздел «Заказы»',
      'Кнопка доступна только для черновика — из отправленного/оплаченного заказа позицию так не выдернуть',
    ],
  },
  {
    version: 'v2.45.429',
    date: '18.06.2026',
    title: 'Отзыв запроса сборки + телефон поставщика',
    features: [
      'В блоке <b>«Сборка к отгрузке»</b> появилась кнопка <b>«Отозвать сборку»</b> — снимает отметку «сборка запрошена» и возвращает кнопку «Запросить сборку к отгрузке». Уже собранное не трогается, у сборщика договор уходит из списка к сборке',
      'В блоке <b>«Ждём поставку»</b> вместо кнопки «Позвонить» теперь сразу виден <b>номер телефона</b> поставщика, а тап по нему открывает <b>карточку поставщика</b>',
    ],
  },
  {
    version: 'v2.45.428',
    date: '18.06.2026',
    title: 'Снабжение — заказанные комплектующие тоже едут в «Ждём поставку»',
    features: [
      'Теперь и <b>комплектующие</b> (а не только покупные по договорам), по которым уже есть заказ, уходят из списка «к закупке» в общий блок <b>«Ждём поставку»</b> — со статусом, числом дней ожидания и связью с поставщиком',
      'Уже заказанная позиция больше не предлагается к закупке и не попадёт в новый заказ (исключается и из «Сформировать заказ», и из «Скачать DOCX»)',
      'Так список «к закупке» показывает только то, что реально надо купить, а всё оплаченное/в пути — в одной таблице-трекинге',
    ],
  },
  {
    version: 'v2.45.427',
    date: '18.06.2026',
    title: 'Снабжение — оплаченное не предлагается снова, едет в «Ждём поставку»',
    features: [
      'Покупная позиция по договору, по которой уже есть заказ (заказана/на оплате/оплачена/едет), <b>больше не предлагается к закупке</b> и не попадает в новую заявку',
      'Такие позиции уезжают в отдельный блок <b>«Ждём поставку»</b>: статус заказа, <b>сколько дней ждём</b> (если долго — подсветка), и кнопки <b>«Написать» / «Позвонить»</b> поставщику',
      'Защита от двойного заказа на бэкенде: при формировании заявки уже заказанные позиции пропускаются, ссылка на действующий заказ не перезаписывается',
    ],
  },
  {
    version: 'v2.45.426',
    date: '18.06.2026',
    title: 'Сборка к отгрузке — можно откатить',
    features: [
      'В блоке <b>«Сборка к отгрузке»</b> появилась кнопка <b>«Откатить сборку (N)»</b> — снимает все отметки «собрано» и возвращает счётчик сборки к 0',
      'Откат без пароля: сборка к отгрузке склад не затрагивала, поэтому откатывается свободно (в отличие от отгрузки, где нужен личный пароль)',
      'Отдельные единицы по-прежнему можно снимать по одной — тапом по строке в экране «Собрать по QR»',
    ],
  },
  {
    version: 'v2.45.424',
    date: '18.06.2026',
    title: 'Уведомление «Договор отгружён»',
    features: [
      'Когда договор <b>полностью отгружён</b> (по QR или ручной отметкой) — в «колокольчик» приходит уведомление <b>«Договор отгружён»</b> (№ договора, контрагент, число единиц), директору ещё и push на телефон',
      'Тап по уведомлению открывает сам договор',
      'Раньше уведомление было только на <b>запрос</b> сборки к отгрузке — теперь и на сам факт отгрузки',
    ],
  },
  {
    version: 'v2.45.423',
    date: '18.06.2026',
    title: 'Отгрузка — кнопка «Отметить отгруженным» работает честно',
    features: [
      'Кнопка <b>«Отметить отгруженным»</b> (отметка отгрузки без QR) раньше показывала «отмечено», даже когда на деле ничего не отгружалось (единица уже отгружена) — теперь читает реальный ответ сервера и сразу обновляет экран',
      'Если по единице уже есть отгрузка — честно пишет «уже отгружена» и перерисовывает список с актуальным прогрессом',
      'Плюс на бэкенде: скан отгрузки при дублирующемся QR у одинаковых единиц сам отгружает ещё не отгруженную копию',
    ],
  },
  {
    version: 'v2.45.422',
    date: '18.06.2026',
    title: 'Атом Электрика — маркировка питания контроллера по ГОСТ',
    features: [
      'Убрано слово «ПИТАНИЕ» у контроллера — оставлена только маркировка выводов «+24 В» / «0 В» (для сетевого питания — «L» / «N»), как принято по ГОСТ',
    ],
  },
  {
    version: 'v2.45.421',
    date: '18.06.2026',
    title: 'Атом Электрика — питание контроллера реально подключено в схеме',
    features: [
      'Исправлено: после переноса подписей выводы питания «+24 В»/«0 В» оказались сдвинуты, и провода до них не доходили — теперь провода идут точно на выводы, соединение есть (ERC больше не ругается на питание)',
      'Выводы RS-485 A/B соединяются с панелью HMI внутри символа — лишних «не подключено» по ним нет',
    ],
  },
  {
    version: 'v2.45.420',
    date: '18.06.2026',
    title: 'Сборка к отгрузке — ручная отметка «собрано» тапом по строке',
    features: [
      'Если единицу не получается отсканировать (две одинаковые единицы делят один QR, слетела наклейка) — теперь можно <b>тапнуть по строке в списке сборки</b> и отметить её «собрано» вручную',
      'Повторный тап по собранной строке снимает отметку (с подтверждением). Склад при этом не затрагивается — это по-прежнему только подготовка к отгрузке',
      'Плюс на бэкенде: при скане одинаковых единиц система сама добирает ещё не собранную копию той же модели (фикс «застрял на 8/9»)',
    ],
  },
  {
    version: 'v2.45.418',
    date: '18.06.2026',
    title: 'Атом Электрика — подписи A/B и питания на контроллере читаемы',
    features: [
      'Буквы RS-485 «A» и «B» вынесены сбоку от проводов (раньше сидели прямо на линии и были не видны), добавлены клеммы-кружки',
      'Питание контроллера: убрано дублирование (было «ПИТАНИЕ =24 В» и «+24 В» сразу) — теперь заголовок «ПИТАНИЕ» и понятные выводы «+24 В» / «0 В» (или «L» / «N» c «~230 В»)',
    ],
  },
  {
    version: 'v2.45.417',
    date: '18.06.2026',
    title: 'Атом Электрика — питание контроллера в схеме читаемо и понятно',
    features: [
      'Подписи питания на контроллере переписаны читаемо: «+24 В» и «0 В» крупно, с интервалом (раньше «+24V 0V» сливалось)',
      'У выводов питания добавлены клеммы-кружки и явный заголовок «ПИТАНИЕ =24 В» (или «~230 В») — сразу видно, какие выводы контроллера силовые',
    ],
  },
  {
    version: 'v2.45.416',
    date: '18.06.2026',
    title: 'Атом Электрика — контакторы из серии CHINT NC1',
    features: [
      'Все контакторы теперь подбираются из серии CHINT NC1 по рабочему току: NC1-0910 (9А), NC1-1210 (12А), NC1-1810, NC1-2510, NC1-3210, NC1-4011 (40А) и выше — катушка 230В, AC-3',
      'Модель полностью отражена в спецификации, подсказке и схеме редактора (напр. «NC1-1210 12А 230В AC-3 1НО»)',
      'В карточке аппарата у контактора показан реальный габарит из серии NC1 (Ш×В×Г), а не модульная ширина',
    ],
  },
  {
    version: 'v2.45.415',
    date: '18.06.2026',
    title: 'Сборка к отгрузке — список «что собрано / что осталось» по тапу',
    features: [
      'Во время сборки/отгрузки по QR тап по счётчику <b>«X/Y»</b> вверху камеры открывает список: сверху <b>«Осталось собрать»</b>, ниже — <b>«Собрано»</b> (см. также v2.45.413)',
      'Напоминание по сборке к отгрузке: у Михаила Шевелёва в навигации только «Главная» и «Производство», а на Главной — блок «Собрать к отгрузке» с кнопкой «Собрать по QR» (v2.45.406)',
    ],
  },
  {
    version: 'v2.45.414',
    date: '18.06.2026',
    title: 'Атом Электрика — видно размеры аппаратов в щите',
    features: [
      'По клику на аппарат в карточке появилась строка «Габарит»: ширина в мм и модулях (1 модуль = 17,5 мм), для контроллера/HMI — полные Ш×В×Г, для дверных — отверстие Ø22 мм',
      'Габарит продублирован в подсказке при наведении',
      'На чертеже щита внизу справа добавлена масштабная линейка 100 мм — чтобы на глаз оценивать реальные размеры',
    ],
  },
  {
    version: 'v2.45.413',
    date: '18.06.2026',
    title: 'Скан сборки/отгрузки: список «что собрано и что осталось» по тапу',
    features: [
      'Во время сканирования (и сборки к отгрузке, и отгрузки) тап по счётчику <b>«X/Y»</b> вверху открывает список: сначала <b>«Осталось собрать»</b> (что ещё нужно положить), ниже — <b>«Собрано»</b> уже отмеченное',
      'Список тянет актуальные данные сразу после сканов, поэтому видно ровно то, что осталось добрать перед погрузкой',
      'Для режима отгрузки те же разделы называются «Осталось отгрузить» / «Отгружено»',
    ],
  },
  {
    version: 'v2.45.412',
    date: '17.06.2026',
    title: 'Атом Электрика — контакторы электромагнитные, с катушкой',
    features: [
      'Все контакторы KM в раскладке щита рисуются как электромагнитные — с символом катушки и выводами A1–A2',
      'В подсказках и спецификации контактор обозначен как «электромагнитный (с катушкой)»',
    ],
  },
  {
    version: 'v2.45.411',
    date: '17.06.2026',
    title: 'Атом Электрика — габариты HMI и вырез под панель вручную',
    features: [
      'В блоке «Сенсорная панель / HMI» можно вручную задать габариты самой панели (Ш×В×Г) — для любой модели или через пункт «+ задать размеры вручную»',
      'Появились поля «Вырез в двери» (Ш×В) — размеры монтажного отверстия под панель; кнопка «≈ от габарита» прикинет вырез автоматически',
      'Вырез рисуется на двери штриховым контуром и попадает в спецификацию (позиция A2 «Панель оператора»)',
    ],
  },
  {
    version: 'v2.45.410',
    date: '17.06.2026',
    title: 'Атом Электрика — выбор шага стрелок и удаление аппаратов из щита',
    features: [
      'Шаг перемещения элемента двери стрелками теперь выбирается: 1 мм / 5 мм / 1 см',
      'В компоновке щита по клику на аппарат в карточке появилась кнопка «Удалить из щита» — убирает автомат, контактор (и от потребителя, и из «Вспомогат.») или доп. устройство из раскладки, спецификации и расчёта модулей',
      'Удаление обратимо: под раскладкой показывается счётчик удалённых и ссылка «вернуть все»',
    ],
  },
  {
    version: 'v2.45.409',
    date: '17.06.2026',
    title: 'Атом Электрика — точное позиционирование на двери стрелками',
    features: [
      'Выбранный элемент на двери (кликни или потяни его) можно двигать стрелками клавиатуры ←↑↓→ с шагом 1 см — удобно выставить точные размеры от края щита',
      'Перемещение по-прежнему держится в габаритах двери; размеры со стрелками обновляются на каждом шаге',
    ],
  },
  {
    version: 'v2.45.408',
    date: '17.06.2026',
    title: 'Атом Электрика — дверь не прыгает + размеры элемента со стрелками',
    features: [
      'При перетаскивании элемента по двери страница больше не прокручивается наверх — обновляется только сама дверь',
      'Когда переносишь (или просто касаешься) элемент, рядом появляются размеры со стрелками: ширина и высота от края щита. У круглых (кнопки, переключатели, грибок, лампы) — до центра, у прямоугольных (HMI) — до верхнего левого угла',
    ],
  },
  {
    version: 'v2.45.407',
    date: '17.06.2026',
    title: 'Атом Электрика — сенсорная панель (HMI) и перетаскивание по двери',
    features: [
      'В шаге «Контроллер» появился блок «Сенсорная панель / HMI на дверь»: выбор модели из списка или загрузка даташита — ИИ снимает габариты, питание и клеммы; панель рисуется на двери в реальном размере',
      'Клеммы и габариты HMI попадают в спецификацию (позиция A2 «Панель оператора»)',
      'Элементы на двери (HMI, кнопки, переключатели, грибок, лампы) теперь перетаскиваются мышью: свободное размещение с прилипанием к сетке 5 мм и удержанием в габаритах двери; позиции сохраняются в проекте',
    ],
  },
  {
    version: 'v2.45.406',
    date: '17.06.2026',
    title: 'Сборщик: только «Производство» + блок «Собрать к отгрузке» на Главной',
    features: [
      'Для мастера-сборщика <b>Михаила Шевелёва</b> в верхней навигации остались только <b>«Главная»</b> и <b>«Производство»</b> — остальные разделы (Продажи, Задачи, Склад, Логистика и т.д.) скрыты, чтобы не мешали',
      'На <b>Главной</b> появился блок <b>«Собрать к отгрузке»</b>: как только директор/менеджер запросил сборку, здесь виден список договоров с прогрессом <b>«собрано X/Y»</b> и кнопкой <b>«Собрать по QR»</b> — сразу к сканеру',
      'Тап по строке открывает сам договор; собрано всё — строка показывает «Собрано · открыть». Когда собирать нечего, блок скрыт',
    ],
  },
  {
    version: 'v2.45.405',
    date: '17.06.2026',
    title: 'Договор: запрос сборки к отгрузке + комплектация по QR',
    features: [
      'В блоке отгрузки появилась кнопка <b>«Запросить сборку к отгрузке»</b> — директор/менеджер нажимает её, и <b>мастер/слесарь-сборщик получает уведомление</b> в «колокольчике», что договор пора собрать к погрузке',
      'Отдельный шаг <b>«Сборка к отгрузке»</b> со своим прогрессом: сборщик жмёт <b>«Собрать по QR»</b> и сканирует коробки/узлы/покупное — каждая единица помечается <b>«собрано»</b> (синий бейдж в списке «К отгрузке»)',
      'Это <b>комплектация перед погрузкой</b> — отдельно от самой отгрузки: сборка ничего не списывает со склада и обратима, а «Отгрузка по QR» (со списанием) остаётся следующим шагом',
      'Сборка по QR — без пароля (быстро и обратимо), отгрузка — по-прежнему под личным паролём',
    ],
  },
  {
    version: 'v2.45.404',
    date: '17.06.2026',
    title: 'Атом Электрика — видно, откуда взялся контактор (потребитель / вспом.)',
    features: [
      'В компоновке у каждого контактора KM в углу блока стоит бейдж источника: «П» — сгенерирован автоматически из шага «Потребители», «В» — добавлен вручную в «Вспомогат.»',
      'Источник продублирован в подсказке при наведении и в карточке аппарата (строка «Источник»: из «Потребители» / из «Вспомогат.»)',
      'Внизу компоновки добавлена расшифровка обозначений П/В',
    ],
  },
  {
    version: 'v2.45.404',
    date: '17.06.2026',
    title: 'Мастер Шевелёв: убрали утреннее окно и пункт «На оплату»',
    features: [
      'Для мастера <b>Михаила Шевелёва</b> больше не показывается утреннее окно <b>«Начать смену»</b> с отметкой % готовности — он его пока не заполняет',
      'У него же из левого меню убран пункт <b>«На оплату»</b> — с оплатой счетов он не работает',
      'Для остальных мастеров и пользователей всё работает как раньше',
    ],
  },
  {
    version: 'v2.45.403',
    date: '17.06.2026',
    title: 'Атом Электрика — контактор с назначением (что коммутирует)',
    features: [
      'У контактора, добавленного вручную в «Вспомогат.», теперь можно выбрать потребителя, которого он коммутирует — назначение видно в строке, в карточке и подсказке компоновки (напр. «KM8 → насос P3»)',
      'Если назначение не указано — рядом подсвечивается «назначение не указано», чтобы не было висящих контакторов без логики',
    ],
  },
  {
    version: 'v2.45.402',
    date: '17.06.2026',
    title: 'Атом Электрика — экспорт PDF без пустых страниц',
    features: [
      'При сохранении схемы в PDF каждый лист теперь умещается строго на одну страницу A3 — больше нет лишних пустых страниц (было 4 листа на 2-листовую схему, стало 2)',
    ],
  },
  {
    version: 'v2.45.401',
    date: '17.06.2026',
    title: 'Атом Электрика — точки соединений на схеме мельче',
    features: [
      'Узловые точки соединений на схеме в редакторе сделаны заметно меньше — чертёж выглядит чище',
    ],
  },
  {
    version: 'v2.45.400',
    date: '17.06.2026',
    title: 'Атом Электрика — сенсорная панель на двери и единая нумерация контакторов',
    features: [
      'На двери щита теперь рисуется сенсорная панель (HMI) — контроллер остаётся внутри на рейке, на дверь идут панель, переключатели и грибки',
      'Контакторы из «Вспомогат.» больше не нумеруются отдельной серией K — все контакторы идут единой сквозной нумерацией KM1..KMn (KM и K — это одно и то же изделие)',
    ],
  },
  {
    version: 'v2.45.399',
    date: '17.06.2026',
    title: 'Монтаж: видно, заходил ли монтажник на свой объект',
    features: [
      'На карточке монтажа теперь видно, <b>открывал ли назначенный монтажник свой монтаж</b> со своего телефона: «<b>Алексей заходил: 17.06 09:14</b>» или «<b>ещё не открывал монтаж</b>»',
      'Это честный признак присутствия исполнителя — в отличие от статуса, который мог переключить кто-то <b>из офиса</b>',
      'Показывается и сколько раз монтажник открывал монтаж',
    ],
  },
  {
    version: 'v2.45.398',
    date: '17.06.2026',
    title: 'Атом Электрика — контактор как готовый блок с катушкой',
    features: [
      'Контактор/пускатель из «Вспомогат.» теперь рисуется в компоновке как полноценный блок (катушка уже входит в изделие в сборе), а не как тонкий модуль — полная ширина и цвет контактора',
    ],
  },
  {
    version: 'v2.45.397',
    date: '17.06.2026',
    title: 'Атом Электрика — вид двери щита и реальные размеры аппаратов',
    features: [
      'Добавлен вид лицевой панели (двери): грибок аварийный, переключатели, кнопки и сигнальные лампы рисуются на двери — они не ставятся на DIN-рейку',
      'Контакторы и твердотельные реле теперь занимают реальное число модулей (контактор 3ф ~3 мод., SSR ~2 мод.)',
      'Аппараты управления на двери тоже поддерживают подсказку при наведении и копирование марки правым кликом',
    ],
  },
  {
    version: 'v2.45.396',
    date: '17.06.2026',
    title: 'Атом Электрика — копирование наименования аппарата',
    features: [
      'Правый клик по аппарату в компоновке копирует его наименование с маркой/моделью в буфер обмена (всплывает «Скопировано…»)',
    ],
  },
  {
    version: 'v2.45.395',
    date: '17.06.2026',
    title: 'Атом Электрика — карточка аппарата по клику в компоновке',
    features: [
      'Клик по аппарату в компоновке открывает карточку с маркой, моделью, номиналом и назначением (автомат/контактор/контроллер)',
      'Короткий клик без перемещения теперь не двигает аппарат, а показывает его карточку; перетаскивание работает как раньше',
    ],
  },
  {
    version: 'v2.45.394',
    date: '17.06.2026',
    title: 'Атом Электрика — подсказка с маркой в компоновке (исправлено)',
    features: [
      'Подсказка с маркой/моделью аппарата теперь точно всплывает при наведении — переведено на прямые обработчики на каждом аппарате вместо ненадёжного SVG-title',
    ],
  },
  {
    version: 'v2.45.393',
    date: '17.06.2026',
    title: 'Атом Электрика — подсказка с маркой в компоновке',
    features: [
      'При наведении на аппарат в компоновке всплывает подсказка у курсора с маркой/моделью и назначением',
    ],
  },
  {
    version: 'v2.45.392',
    date: '17.06.2026',
    title: 'Атом Электрика — компоновка: ставить куда угодно',
    features: [
      'В компоновке аппарат можно бросить между двумя другими или в свободное место на рейке — позиция определяется по точке броска',
    ],
  },
  {
    version: 'v2.45.391',
    date: '17.06.2026',
    title: 'Атом Электрика — компоновка: перемещение и подсказки',
    features: [
      'Перетаскивание в компоновке теперь перемещает аппарат к месту цели (остальные сохраняют порядок) — автоматы остаются подряд QF1…QFn, ничего не «убегает»',
      'При наведении на аппарат всплывает подсказка с маркой/моделью (напр. «Контактор · CHINT NXC-09 · Приточный вентилятор»)',
    ],
  },
  {
    version: 'v2.45.390',
    date: '17.06.2026',
    title: 'Атом Электрика — подписи и нумерация в компоновке',
    features: [
      'В компоновке подписи аппаратов, которые не влезают по ширине, разворачиваются на 90° (вертикально)',
      'Сквозная нумерация по физическому порядку: после перестановки автоматы идут QF1…QFn, контакторы KM1…KMn слева-направо (без разнобоя)',
    ],
  },
  {
    version: 'v2.45.389',
    date: '16.06.2026',
    title: 'Атом Электрика — перетаскивание в компоновке',
    features: [
      'На шаге «Компоновка» аппараты можно перетаскивать: тащишь один на другой — они меняются местами (раскладка остаётся на рейках)',
      'У кабель-каналов подписан размер (напр. 40×60 мм)',
    ],
  },
  {
    version: 'v2.45.388',
    date: '16.06.2026',
    title: 'Атом Электрика — экспорт схемы в PDF',
    features: [
      'В редакторе кнопка «⎙ PDF» — открывает все листы (A3, альбомная) и печать / сохранение в PDF одним файлом',
      'В штамп подставляется реальное обозначение щита и номер листа',
    ],
  },
  {
    version: 'v2.45.387',
    date: '16.06.2026',
    title: 'Атом Электрика — провода строго под прямым углом',
    features: [
      'Все провода на схеме теперь строго горизонтальные/вертикальные (стиль sPlan) — никаких диагоналей',
      'При переносе элемента провод за ним спрямляется под 90° (Г-образно), и при загрузке схемы косые сегменты выправляются',
    ],
  },
  {
    version: 'v2.45.386',
    date: '16.06.2026',
    title: 'Атом Электрика — компактные ссылки на схеме',
    features: [
      'Перекрёстные ссылки между листами стали компактными «(л.1)»/«(л.2)» и убраны в сторону — не мешают чертежу',
      'У мелких подписей (фазы, номера проводов и цепей, шины) убрана широкая разрядка букв',
    ],
  },
  {
    version: 'v2.45.385',
    date: '17.06.2026',
    title: 'Отгрузка по QR: покупные позиции',
    features: [
      'При отгрузке по QR теперь распознаются <b>покупные позиции</b> (приточная установка, вентилятор и т.п.), отмеченные «отгружать отдельной позицией»',
      'Раньше их этикетка выдавала «QR-код не распознан» — сканер не понимал ссылку позиции. Теперь сканируется и отгружается как отдельная единица',
      'Перепечатывать старые этикетки не нужно — работают как есть',
    ],
  },
  {
    version: 'v2.45.384',
    date: '17.06.2026',
    title: 'Срок поставки от поставщика',
    features: [
      'В письме-заявке поставщику добавлена просьба <b>указать срок поставки/изготовления</b>',
      'ИИ вытаскивает срок из <b>счёта</b> («Срок изготовления», «Условия поставки»…) и из <b>текста письма</b> («до 15.07», «10–15 рабочих дней»)',
      'Срок показывается на карточке заказа и в блоке <b>«На оплате»</b> — чтобы видеть его <b>до</b> оплаты, а не после',
    ],
  },
  {
    version: 'v2.45.378',
    date: '16.06.2026',
    title: 'Атом Электрика — мостики проводов и ссылки листов',
    features: [
      'На пересечениях провода перескакивают друг через друга дугой (мостик) — сразу видно, где соединение, а где просто пересечение',
      'Перекрёстные ссылки между листами: у силового контакта — «катушка → л.2», у катушки — «силовой контакт → л.1»',
    ],
  },
  {
    version: 'v2.45.377',
    date: '16.06.2026',
    title: 'Атом Электрика — маркировка проводов',
    features: [
      'На силовом листе у линий проставляются фазы (L1/L2/L3, для трёхфазных — все) и номера проводов (W1, W2…), у шины — L1·L2·L3·N·PE',
      'На листе управления цепи пронумерованы: входы 11, 12…, выходы 21, 22…',
    ],
  },
  {
    version: 'v2.45.376',
    date: '16.06.2026',
    title: 'Атом Электрика — выводы катушек и обозначения',
    features: [
      'У катушек контакторов на схеме подписаны выводы A1/A2',
      'На всех листах элементы подписаны только обозначением (KM1, BT1, QF3…); полное название показывается при наведении мыши',
    ],
  },
  {
    version: 'v2.45.375',
    date: '16.06.2026',
    title: 'Договор «только монтаж»',
    features: [
      'Для договоров только на монтаж — монтажные разделы: что установить, демонтировать, работы и материалы (вместо сборок/отгрузки)',
    ],
  },
  {
    version: 'v2.45.374',
    date: '16.06.2026',
    title: 'Атом Электрика — без наездов, подсказки по наведению',
    features: [
      'Элементы на листе управления (катушки, датчики) разнесены с большим шагом и подведены проводами — подписи больше не наезжают друг на друга',
      'На схеме показывается только обозначение (KM1, BT1…), а полное название элемента всплывает при наведении мыши',
    ],
  },
  {
    version: 'v2.45.373',
    date: '16.06.2026',
    title: 'Атом Электрика — вкладки листов',
    features: [
      'В редакторе вверху появились заметные вкладки «Лист 1 · силовые цепи» и «Лист 2 · цепи управления» — переключение одним кликом',
    ],
  },
  {
    version: 'v2.45.372',
    date: '16.06.2026',
    title: 'Атом Электрика — схема на нескольких листах',
    features: [
      'Схема разнесена на листы: Лист 1 — силовые цепи, Лист 2 — цепи управления (контроллер, датчики, катушки). Переключение — по «Лист 1/2» внизу редактора',
      'Каждый лист просторный и читаемый; в штампе проставляется номер листа и подзаголовок',
    ],
  },
  {
    version: 'v2.45.371',
    date: '16.06.2026',
    title: 'Атом Электрика — авторазводка I/O контроллера',
    features: [
      'Провода от выводов контроллера разводятся автоматически по назначениям: входы AI/DI — к датчикам (NTC/сигнальные клеммы) слева, выходы DO — к катушкам контакторов справа',
      'Катушки контакторов нумеруются как в силовой части (KM1, KM2…); добавлены шины «общий/0В» и «N»',
    ],
  },
  {
    version: 'v2.45.370',
    date: '16.06.2026',
    title: 'Атом Электрика — питание контроллера и панель оператора',
    features: [
      'У контроллера на схеме всегда показываются выводы питания (L/N или +24В/0В — по напряжению), запитанные от автомата управления',
      'Добавлена связь RS-485 (выводы A/B) с сенсорной панелью оператора (HMI) — блок панели рисуется рядом с контроллером',
    ],
  },
  {
    version: 'v2.45.369',
    date: '16.06.2026',
    title: 'Атом Электрика — контроллер с выводами на схеме',
    features: [
      'Контроллер в редакторе рисуется как блок с выводами: AI/DI — слева, AO/DO — справа, с номерами клемм и подписями назначений (что на каком входе/выходе)',
      'Выводы берутся из распределения I/O, сделанного на шаге «Контроллер»',
    ],
  },
  {
    version: 'v2.45.368',
    date: '16.06.2026',
    title: 'Атом Электрика — контроллер на схеме',
    features: [
      'При построении схемы из мастера в редакторе теперь рисуется и контроллер (блок A1) с автоматом цепей управления',
      'Добавлена зона автоматики: датчики (BT), сигнальные лампы (HL), сигнальный клеммник и подписи зон «силовые цепи» / «автоматика · датчики»',
    ],
  },
  {
    version: 'v2.45.367',
    date: '16.06.2026',
    title: 'Производство — утреннее окно по работам «В работе»',
    features: [
      'Утреннее окно показывает только работы «В работе»; % подставляется текущий из карточки и сохраняется туда же',
    ],
  },
  {
    version: 'v2.45.366',
    date: '16.06.2026',
    title: 'Атом Электрика — потребитель по марке (ИИ)',
    features: [
      'На шаге «Потребители» блок «Своё — по марке»: вводишь модель → ИИ определяет питание (3ф/1ф/24/12В), мощность и тип управления (контактор/ЧРП/SSR/реле/напрямую) и добавляет потребителя',
      'Найденные потребители сохраняются в общую библиотеку — повторно добавляются в один клик',
    ],
  },
  {
    version: 'v2.45.365',
    date: '16.06.2026',
    title: 'Атом Электрика — БП для низковольтных цепей',
    features: [
      'Низковольтные потребители (24/12 В) теперь питаются от блока питания, а не от вводного автомата напрямую',
      'Мощность БП подбирается автоматически по сумме нагрузок (с запасом), на каждое напряжение свой БП; БП попадает в автоматы (своя линия), баланс фаз и спецификацию',
      'Вводной автомат нагружается только первичкой БП (а не самими 24/12 В нагрузками)',
    ],
  },
  {
    version: 'v2.45.364',
    date: '16.06.2026',
    title: 'Атом Электрика — питание потребителя 24В/12В',
    features: [
      'У потребителя поле «Питание» теперь с вариантами 3ф·400В, 1ф·230В, =24В, =12В — для приводов узлов регулирования и низковольтной автоматики',
      'Ток считается по выбранному напряжению (для 24/12 В — как постоянный ток)',
    ],
  },
  {
    version: 'v2.45.363',
    date: '16.06.2026',
    title: 'Производство — % готовности по сборкам',
    features: [
      'Утренняя отметка % считается по сборкам (а не договорам); % виден у каждой сборки в карточке договора',
    ],
  },
  {
    version: 'v2.45.362',
    date: '16.06.2026',
    title: 'Атом Электрика — библиотека аппаратов',
    features: [
      'Аппарат, найденный по марке, сохраняется в общую библиотеку — остаётся после перезагрузки и виден всем',
      'На шаге «Аппараты в шкафу» появился раздел «📚 Библиотека аппаратов»: клик добавляет сохранённый аппарат, ✕ убирает из библиотеки',
    ],
  },
  {
    version: 'v2.45.361',
    date: '16.06.2026',
    title: 'Атом Электрика — аппарат по марке (ИИ)',
    features: [
      'На шаге «Аппараты в шкафу» в блоке «Своё — по марке» вводишь модель (LA167-BDF41, HD-4022.10U, РЭК77/3…) → ИИ ищет в интернете, определяет тип аппарата и добавляет его с нужным УГО и обозначением',
    ],
  },
  {
    version: 'v2.45.359',
    date: '16.06.2026',
    title: 'Атом Электрика — каталог аппаратов в шкафу',
    features: [
      'Шаг «Аппараты в шкафу»: каталог готовых аппаратов (контактор, SSR, промежуточное реле, переключатель, аварийный грибок, кнопка, лампа, БП, автомат, ЧРП) — клик добавляет элемент',
      'У каждого аппарата рисуется схемный символ (УГО по ГОСТ с выводами) и проставляется позиционное обозначение (K1, ТР1, KL1, SA1, SB1, HL1…)',
      'Любой элемент редактируется (✎); обозначение попадает в спецификацию',
    ],
  },
  {
    version: 'v2.45.358',
    date: '16.06.2026',
    title: 'Производство — утренняя отметка % готовности',
    features: [
      'Утреннее окно мастеру с обязательной отметкой % готовности; прогресс сохраняется на сервере и виден всем',
    ],
  },
  {
    version: 'v2.45.357',
    date: '16.06.2026',
    title: 'Атом Электрика — редактирование датчиков и вспомогательного',
    features: [
      'Строки «Датчиков» и «Вспомогательного оборудования» теперь тоже редактируются прямо в списке (✎): наименование, сигнал/тип, ток, количество',
    ],
  },
  {
    version: 'v2.45.356',
    date: '16.06.2026',
    title: 'Атом Электрика — обозначение потребителя для схемы',
    features: [
      'При вводе наименования потребителя автоматически подставляется позиционное обозначение для схемы (напр. «Приточный вентилятор» → П1, «Вытяжной» → В1)',
      'Обозначение можно поправить вручную и видно в строке потребителя',
    ],
  },
  {
    version: 'v2.45.355',
    date: '16.06.2026',
    title: 'Атом Электрика — не сбрасывается при обновлении',
    features: [
      'Мастер запоминает текущий шаг и весь введённый состав — после обновления страницы открывается там же и ничего не сбивается (контроллер, потребители и т.д. на месте)',
    ],
  },
  {
    version: 'v2.45.354',
    date: '16.06.2026',
    title: 'Атом Электрика — редактирование потребителей',
    features: [
      'Любого добавленного потребителя можно отредактировать прямо в строке (✎): имя, фазы, мощность, количество, тип',
      'Поле «Тип» стало комбобоксом — можно выбрать из списка или вписать свой (компрессор, насос и т.п.); новые типы запоминаются',
      'Тип потребителя теперь виден в строке',
    ],
  },
  {
    version: 'v2.45.353',
    date: '16.06.2026',
    title: 'Монтаж — монтажник видит только свой раздел',
    features: [
      'Монтажнику показывается только раздел «Монтаж»',
    ],
  },
  {
    version: 'v2.45.352',
    date: '16.06.2026',
    title: 'Атом Электрика — библиотека контроллеров',
    features: [
      'Распознанный по даташиту контроллер теперь сохраняется в общую библиотеку — остаётся в списке после перезагрузки и виден всем',
      'При выборе такого контроллера из списка восстанавливаются его входы/выходы и габариты',
    ],
  },
  {
    version: 'v2.45.351',
    date: '16.06.2026',
    title: 'Атом Электрика — имя следует за разделом',
    features: [
      'Пока наименование изделия не правил вручную, оно автоматически подставляется по выбранному разделу (и обновляется в шапке) — больше не «Холодильная камера» во всех разделах',
      'Как только впишешь своё название — оно фиксируется и при смене раздела не перезаписывается',
    ],
  },
  {
    version: 'v2.45.350',
    date: '16.06.2026',
    title: 'Атом Электрика — редактируемые разделы',
    features: [
      'Название раздела можно переименовать прямо на карточке (✎ у названия) — изменение сохраняется на сервере и видно всем',
      'Список разделов теперь общий и серверный; новые разделы и удаление тоже сохраняются',
    ],
  },
  {
    version: 'v2.45.349',
    date: '16.06.2026',
    title: 'Раздел «Монтаж»',
    features: [
      'Новый раздел «Монтаж»: объекты, статусы и отчёты монтажников с фото',
    ],
  },
  {
    version: 'v2.45.348',
    date: '16.06.2026',
    title: 'Атом Электрика — чертежи прямо в разделе',
    features: [
      'Клик по разделу на шаге 1 раскрывает список сохранённых чертежей этого раздела',
      'Любой чертёж открывается на редактирование прямо отсюда, рядом — кнопка удаления',
      'На карточке раздела показывается, сколько в нём сохранённых чертежей',
    ],
  },
  {
    version: 'v2.45.347',
    date: '16.06.2026',
    title: 'Атом Электрика — имя изделия и авто-номер',
    features: [
      'На шаге «Раздел» появились поля «Наименование изделия», «Номер в разделе» и «Вариант» — обозначение больше не залипает на демо-названии',
      'При выборе раздела номер подставляется автоматически — следующий свободный в этом разделе (например, в «Приточно-вытяжная вентиляция» — 008, а не 009)',
    ],
  },
  {
    version: 'v2.45.346',
    date: '16.06.2026',
    title: 'Атом Электрика — даташит по нескольким страницам',
    features: [
      'В распознавании даташита можно загрузить сразу несколько страниц (например схему + «Технические характеристики») — ИИ читает весь набор',
      'Если входы/выходы прочитаны частично, мастер подсказывает добавить страницу характеристик и даёт кнопку «➕ Добавить страницу» — габариты при дозагрузке сохраняются',
    ],
  },
  {
    version: 'v2.45.345',
    date: '16.06.2026',
    title: 'Дубли по марке — ручная склейка',
    features: [
      'Одинаковая модель-код склеивается вручную, чтобы убрать дубли по марке',
    ],
  },
  {
    version: 'v2.45.344',
    date: '16.06.2026',
    title: 'Атом Электрика — контроллер по даташиту (ИИ)',
    features: [
      'На шаге «Контроллер» кнопка «Нет в списке? Загрузить даташит» открывает окно загрузки',
      'Загружаешь PDF или фото даташита — ИИ читает его и выписывает модель, производителя, габариты (мм), монтаж, степень защиты, питание и состав входов/выходов',
      'Кнопка «Применить» добавляет распознанный контроллер в список и подставляет его I/O и размеры в проект',
    ],
  },
  {
    version: 'v2.45.343',
    date: '16.06.2026',
    title: 'Договоры — аккуратная плашка срочности',
    features: [
      'Плашка срочности больше не наезжает на дату; брендовый ховер строки договора',
    ],
  },
  {
    version: 'v2.45.342',
    date: '16.06.2026',
    title: 'Атом Электрика — сохранение проектов',
    features: [
      'В мастере «Атом Электрика» проект теперь сохраняется на сервере по кнопке «⭱ Сохранить»',
      'Новая кнопка «📂 Мои проекты» — общая библиотека щитов, доступная всем сотрудникам с любого устройства: любой проект можно открыть заново или удалить',
      'Если нет связи — проект сохранится локально, чтобы работа не потерялась; есть импорт/экспорт через файл (.json)',
    ],
  },
  {
    version: 'v2.45.341',
    date: '16.06.2026',
    title: 'Что закупить — статусы заказа едиными пилюлями',
    features: [
      'Статусы заказа в «Что закупить» показаны едиными пилюлями, добавлен чип «заказать»',
      'Блок договорных закупок приведён к единому стилю',
    ],
  },
  {
    version: 'v2.45.339',
    date: '16.06.2026',
    title: 'Снабжение — сразу «Что закупить»',
    features: [
      'При входе в раздел «Снабжение» сразу открывается «Что закупить» (раньше открывались «Заявки»)',
    ],
  },
  {
    version: 'v2.45.338',
    date: '16.06.2026',
    title: '«Что закупить» — кнопка «Оформить вручную» (заказал по телефону)',
    features: [
      'На группе поставщика появилась кнопка <b>«Оформить вручную»</b> — для случая, когда счёт <b>запросили и/или оплатили по телефону</b>, минуя письмо из системы',
      'Создаёт заказ по позициям группы <b>без отправки письма</b> поставщику и сразу ставит выбранный статус: <b>«Счёт запрошен» / «Счёт получен» / «На оплате» / «Оплачен»</b>',
      'Промежуточные даты этапов проставляются автоматически — в истории заказа видно, что счёт был запрошен и оплачен',
      'Статус сразу подсвечивается у позиции в «Что закупить» (как и у обычных заказов)',
    ],
  },
  {
    version: 'v2.45.337',
    date: '16.06.2026',
    title: '«Что закупить» — собранные проекты больше не просят закупку',
    features: [
      'Если изделие по договору <b>уже собрано</b> (готовая сборка лежит на складе или стоит на отгрузке) — его комплектующие <b>больше не висят в «Что закупить»</b> как «план производства»',
      'Раньше учитывались только сборки, <b>жёстко привязанные</b> к договору. Свободную готовую продукцию (собрали, но ещё не зарезервировали под конкретный проект) система не видела — и ошибочно требовала закупить весь BOM заново',
      'Теперь свободный остаток готовой продукции по модели <b>зачитывается</b> в потребность плана — двойного счёта нет',
    ],
  },
  {
    version: 'v2.45.336',
    date: '16.06.2026',
    title: 'Новая сборка: аккуратные кнопки типов работ и счётчик',
    features: [
      'Экран новой сборки причёсан: <b>аккуратные кнопки типов работ</b>, сегментированный счётчик количества и более чистый список списания комплектующих',
    ],
  },
  {
    version: 'v2.45.328',
    date: '15.06.2026',
    title: 'Атом Электрика: схему можно развернуть на весь экран',
    features: [
      'В модуле <b>Атом Электрика</b> (Производство) в шапке появилась кнопка <b>⛶ Во весь экран</b> — разворачивает мастер/редактор схемы на весь экран, скрывая меню CRM; <b>Esc</b> или повторное нажатие — свернуть обратно',
    ],
  },
  {
    version: 'v2.45.326',
    date: '15.06.2026',
    title: 'Спецификация: понятная плашка доставки на объект',
    features: [
      'Жёлтая плашка у позиций «отгрузка на объект» теперь подписана <b>«Пока не доставлено на объект (как доставят — нажмите)»</b> — раньше было просто «Доставлено на объект» и путало (выглядело как будто уже доставлено)',
      'После нажатия позиция переходит в зелёный статус <b>«Доставлено на объект»</b> (как и раньше)',
    ],
  },
  {
    version: 'v2.45.325',
    date: '15.06.2026',
    title: 'Производство: модуль «Атом Электрика» (проектирование щитов)',
    features: [
      'В разделе <b>Производство</b> появилась вкладка <b>Атом Электрика</b> — встроенный инструмент проектирования щитов управления (AtomCAD): мастер сборки щита по составу (контроллер, потребители, датчики, автоматы, компоновка, спецификация) и редактор электрических схем по ЕСКД',
      'Переключатель <b>Мастер ⇄ Редактор</b>: схема из мастера открывается в редакторе одним кликом',
      'Первая версия — встроенный прототип; интеграция с номенклатурой CRM и сохранением на сервере впереди',
    ],
  },
  {
    version: 'v2.45.323',
    date: '15.06.2026',
    title: 'Спецификация: кнопка «QR» рядом с Word/PDF',
    features: [
      'На вкладке <b>Спецификация</b> договора рядом с кнопками «Word» и «PDF» добавлена кнопка <b>QR</b> — открывает QR-код договора с печатью наклейки и скачиванием PNG (раньше QR был только в шапке карточки)',
      'Доступно всем, у кого есть доступ к договору, включая роль <b>Мастер</b>',
    ],
  },
  {
    version: 'v2.45.322',
    date: '15.06.2026',
    title: 'Спецификация: «Доставлено на объект»',
    features: [
      'У позиций с пометкой <b>«Отгрузка сразу на объект»</b> (закуп в др. городе) появилась кнопка <b>«Доставлено на объект»</b> — отмечает позицию доставленной (зелёный бейдж «Доставлено ✓»)',
      'При отметке <b>директору</b> приходит уведомление: какая позиция, по какому договору и кто отметил',
    ],
  },
  {
    version: 'v2.45.321',
    date: '15.06.2026',
    title: 'Заказ: наименования из счёта в «Позициях»',
    features: [
      'После распознавания счёта его <b>наименования</b> (что в счёте) показываются в блоке <b>«Позиции»</b> заказа — с количеством, ценой и суммой',
      'Это позиции из счёта на оплату (только для просмотра, на склад не приходуются). Обновить — кнопкой «Распознать заново»',
    ],
  },
  {
    version: 'v2.45.320',
    date: '15.06.2026',
    title: 'Счёт в заказе: «Распознать заново» и просмотр PDF на телефоне',
    features: [
      'После кнопки <b>«Заменить»</b> счёт теперь можно <b>распознать заново</b> — старые реквизиты сбрасываются, появляется кнопка распознавания (и отдельная «Распознать заново» рядом с реквизитами)',
      'На телефоне PDF-счёт открывается кнопкой <b>«Открыть PDF»</b> (Huawei и др. не показывают PDF встроенно) — на компьютере остаётся встроенный просмотр',
    ],
  },
  {
    version: 'v2.45.319',
    date: '15.06.2026',
    title: 'Нумерация сборок',
    features: [
      'В блоке «Готовность по сборкам» строки теперь пронумерованы (1, 2, 3…) — как в спецификации, удобнее считать и ссылаться',
    ],
  },
  {
    version: 'v2.45.318',
    date: '15.06.2026',
    title: 'Загрузить счёт → сразу в «К оплате»',
    features: [
      'Кнопка <b>«Загрузить счёт»</b> (на «+» и в шапке «Заказов») теперь открывает форму: выбираешь <b>файл</b>, <b>договор</b> (или без), по желанию <b>кому платим</b>, <b>номер</b> и <b>сумму</b>, и жмёшь <b>«Отправить в оплату»</b> — окно не закрывается само',
      'Счёт сразу попадает в <b>«К оплате»</b> — бухгалтер видит его рядом с заказами, открывает файл и оплачивает (с подтверждением паролём)',
      'Отделу оплаты (бухгалтер + директор) приходит уведомление «Новый счёт на оплату»',
    ],
  },
  {
    version: 'v2.45.317',
    date: '15.06.2026',
    title: 'Входящие счета: кнопка «Открыть счёт»',
    features: [
      'В карточке счёта и в списке «Входящих счетов» появилась кнопка <b>«Открыть счёт»</b> (значок 👁) — бухгалтер открывает PDF/фото счёта, копирует номер и видит наименование',
      'Доступно бухгалтеру, директору, мастеру и заму',
    ],
  },
  {
    version: 'v2.45.316',
    date: '15.06.2026',
    title: 'Пояснения под блоками договора',
    features: [
      'Под заголовками блоков договора — короткие подсказки: <b>«Готовность по сборкам»</b> — что собираем на производстве; <b>«Спецификация»</b> — всё, что поставляется клиенту (сборки + покупное + материалы); <b>«К отгрузке»</b> — что физически уезжает (коробки и отдельные узлы)',
    ],
  },
  {
    version: 'v2.45.315',
    date: '15.06.2026',
    title: 'Счёт на оплату: кнопка на «+» и без лишней приёмки',
    features: [
      'На экране <b>«Заказы»</b> кнопка <b>«+»</b> (в т.ч. на телефоне) теперь спрашивает: <b>«Новый заказ»</b> или <b>«Загрузить счёт»</b>',
      'При загрузке счёта на оплату <b>больше не запускается приёмка/распознавание УПД</b> — счёт просто кладётся во «Входящие счета» и отдел оплаты получает уведомление',
      'Приложение не перекидывает на экран приёмки — остаётесь там, где были',
    ],
  },
  {
    version: 'v2.45.314',
    date: '15.06.2026',
    title: 'Заказ: сверка «запрошено / в счёте»',
    features: [
      'В позициях заказа теперь видно <b>«запрошено N»</b> и рядом <b>«в счёте M»</b> — количество, которое поставщик выставил в распознанном счёте',
      'Если кол-во в счёте отличается от запрошенного — строка подсвечивается красным с разницей (⚠ +/-), совпало — зелёным',
      'Кол-во из счёта подтягивается автоматически при распознавании (кнопка «Распознать номер и сумму» или авто с почты)',
    ],
  },
  {
    version: 'v2.45.313',
    date: '15.06.2026',
    title: 'Кнопка удаления сборки — всегда видна',
    features: [
      'В «Готовность по сборкам» кнопка 🗑 раньше пряталась за длинным именем сборщика и её нельзя было нажать — теперь имя усекается, а кнопки управления (готово / вернуть / удалить) всегда на виду',
    ],
  },
  {
    version: 'v2.45.312',
    date: '15.06.2026',
    title: 'Договор: коробки в спецификации и раздел «К отгрузке»',
    features: [
      '<b>«в Коробке N»</b>: позиция спецификации, упакованная в коробку, помечается зелёным бейджем — клик открывает коробку',
      '<b>Раздел «К отгрузке»</b>: под прогрессом отгрузки — список единиц с группировкой (Коробки отдельно, Узлы и сборки отдельно) со статусом «готово к отгрузке / отгружено»',
    ],
  },
  {
    version: 'v2.45.311',
    date: '15.06.2026',
    title: 'Загрузить счёт + выбрать договор',
    features: [
      'На экране <b>«Заказы»</b> появилась кнопка <b>«Загрузить счёт»</b>: получили счёт (в Max, почте и т.п.), скачали PDF — заходите в СРМ, загружаете файл и сразу выбираете <b>договор клиента</b> или <b>«Без договора»</b>',
      'Счёт попадает во <b>«Входящие счета»</b> с пометкой договора, запускается распознавание, отделу оплаты приходит уведомление',
      'Договор виден в карточке счёта и в списке — понятно, по какому проекту/клиенту расход',
    ],
  },
  {
    version: 'v2.45.310',
    date: '15.06.2026',
    title: 'Бухгалтер: кнопка «На оплату»',
    features: [
      'У <b>бухгалтера</b> на главном экране появился блок <b>«Счёт получен — на оплату»</b> с кнопкой <b>«На оплату»</b>: можно передать пришедший счёт в очередь на оплату, не дожидаясь директора',
      'Те же кнопки «На оплату» и «Оплачен» теперь видны бухгалтеру и в карточке заказа поставщику',
      'Дальше по цепочке — кнопка «Оплатил» (с подтверждением паролём) и уведомление директору, как и раньше',
    ],
  },
  {
    version: 'v2.45.309',
    date: '15.06.2026',
    title: 'Оплата счёта — подтверждение паролём и уведомление директору',
    features: [
      'Отметка <b>«Оплачено»</b> теперь требует подтверждения — кто отмечает оплату, вводит <b>свой пароль от Atom</b>. Защита от случайной и чужой отметки (если пароль у сотрудника не задан — подтверждение пропускается)',
      'Как только счёт отмечен оплаченным — <b>директору</b> приходит уведомление (пуш на телефон + запись в колокольчике): поставщик, сумма и кто отметил',
      'Работает и на главном экране (блок «На оплате»), и в карточке заказа поставщику',
    ],
  },
  {
    version: 'v2.45.308',
    date: '15.06.2026',
    title: 'Счёт на оплату — «Поделиться» из любого приложения',
    features: [
      'Теперь счёт (PDF, Excel, Word, фото) можно отправить в CRM прямо из любого приложения — открыли документ → <b>«Поделиться» → Atom</b> (или нашего <b>Telegram-бота → кнопка «🧾 В отдел оплаты»</b>). Файл сразу падает во «Входящие счета»',
      'Бухгалтер <b>и</b> директор получают пуш <b>«Новый счёт на оплату»</b> с именем отправителя — счёт не потеряется',
      'В системном меню «Поделиться» Atom теперь стабильно появляется и для Excel/Word, не только для PDF. <i>Важно: делитесь самим файлом, а не «ссылкой на документ». Если Atom не виден — самый надёжный путь на любом телефоне: поделиться файлом в наш Telegram-бот</i>',
    ],
  },
  {
    version: 'v2.45.293',
    date: '12.06.2026',
    title: 'Договоры: добавлен тип «Только монтаж»',
    features: [
      'В форме договора теперь <b>три варианта типа</b>: «Только поставка», «Поставка + монтаж» и <b>«Только монтаж»</b>. Для случаев, когда клиент заказывает один монтаж без поставки оборудования',
      'В списках и карточках договоров — соответствующая подпись («только монтаж»)',
    ],
  },
  {
    version: 'v2.45.292',
    date: '12.06.2026',
    title: 'Помощник переехал в «Помощь»',
    features: [
      'Чат-помощник теперь живёт в разделе <b>«Помощь»</b> — первым пунктом, рядом с «Базой знаний» и FAQ. Так логичнее: всё про помощь в одном месте',
      'Из меню «Сервисы» убран — там остались только калькулятор и внешние ссылки',
    ],
  },
  {
    version: 'v2.45.291',
    date: '12.06.2026',
    title: 'Помощник — подключение к ИИ',
    features: [
      'Помощник теперь умеет работать через <b>настоящий ИИ (Claude)</b> — тот же, что распознаёт УПД. Если на сервере включён эндпоинт помощника, ответы становятся «живыми» на любые формулировки',
      'Пока эндпоинт не включён — помощник <b>сам</b> работает по локальной базе инструкций (ничего не ломается), и автоматически «поумнеет», как только ИИ подключат',
      'База знаний CRM передаётся в ИИ как контекст — ответы строго по нашим инструкциям, без выдумок',
    ],
  },
  {
    version: 'v2.45.290',
    date: '12.06.2026',
    title: 'Помощник — чат прямо в CRM',
    features: [
      'В меню <b>«Сервисы» → «Помощник»</b> появился чат-помощник. Напиши вопрос своими словами («как создать договор», «как принять товар») — он найдёт нужную инструкцию и ответит <b>по шагам</b>, объяснит зачем функция',
      'Подсказывает похожие темы и даёт кнопку «Открыть в Помощи» с полным гайдом',
      'Работает прямо на устройстве по нашей базе из 50+ инструкций и 20 ответов FAQ — <b>бесплатно и без интернета</b>',
      'Это первый шаг: дальше планируем подключить <b>настоящий ИИ</b> для свободных ответов на любые формулировки',
    ],
  },
  {
    version: 'v2.45.289',
    date: '12.06.2026',
    title: 'Заказы: фильтр «Открытые» → «В работе»',
    features: [
      'Первый фильтр в «Заказах поставщикам» переименован <b>«Открытые» → «В работе»</b> — точнее отражает смысл: это активные заказы, которые ещё не завершены',
      'Раньше «Открытые» путали с «Черновиками» — теперь понятнее, что это сводный вид «по умолчанию»',
    ],
  },
  {
    version: 'v2.45.288',
    date: '12.06.2026',
    title: 'Заказы поставщикам — компактные карточки',
    features: [
      'Карточка заказа стала <b>заметно компактнее</b>: больше заказов помещается на экран',
      '<b>«Заказ»</b> в заголовке убрано (раздел и так «Заказы»). Номер <b>ORD-61</b> — отдельным мини-чипом, имя поставщика — основным текстом и обрезается «…» если не влезает',
      'Иконка, корзина и пилы статусов уменьшены и приведены к общему ритму отступов',
    ],
  },
  {
    version: 'v2.45.287',
    date: '12.06.2026',
    title: 'Заказы поставщикам — ровные карточки',
    features: [
      'Карточка заказа в «Заказах» теперь <b>выровнена</b>: чекбокс, иконка, текст и корзина — в один ровный ряд, по центру. Раньше на телефоне всё «разъезжалось» — чекбокс висел посередине, корзина уезжала вниз',
      'Аккуратные отступы и переносы: длинное имя поставщика больше не ломает сетку',
      'Мелочь: «1 позиция» вместо «1 позиций» — правильное склонение по числу',
    ],
  },
  {
    version: 'v2.45.286',
    date: '12.06.2026',
    title: '«Что закупить» — убрать позицию и изменить количество',
    features: [
      'Можно <b>убрать ненужную позицию</b> из «Что закупить» крестиком справа. Скрытая позиция не показывается и не попадает в новый заказ',
      'Можно <b>изменить количество</b>: тап по «3 шт.» — ввёл нужное число — сохранилось. Изменённое значение подсвечивается оранжевой плашкой',
      'Сверху появляется тулбар <b>«Скрыто N · Показать все»</b> — одной кнопкой возвращаются все вручную убранные',
      'При создании заказа (<b>«Сформировать заказ»</b> и <b>«Скачать DOCX»</b>) подставляется изменённое количество, а скрытые позиции пропускаются',
      '<b>Важно:</b> и скрытие, и переопределение хранятся <b>локально</b>, только на этом устройстве. На сервере данные не меняются — это «мой взгляд», а не редактирование плана производства',
    ],
  },
  {
    version: 'v2.45.285',
    date: '12.06.2026',
    title: 'Поиск — чипы без листания',
    features: [
      'Все 6 чипов фильтров (Всё / Договоры / Сборки / Задачи / Доработки / Контрагенты) теперь видны <b>сразу на двух строках</b> — листать вправо больше не нужно',
      'Чипы чуть компактнее (padding и шрифт), но клик-зона по-прежнему удобная',
    ],
  },
  {
    version: 'v2.45.284',
    date: '12.06.2026',
    title: 'Поиск: часы сборок + сводка по сотруднику',
    features: [
      'В подписи каждой сборки теперь видно <b>часы</b>: «8ч» — факт, «~16ч» — оценка',
      'Если запрос совпал с сотрудником цеха — наверху появляется <b>карточка-сводка</b>: имя, статус загрузки, <b>часы за неделю</b>, прогресс-бар (норма / перегруз / недогруз) и сколько у него своих сборок и где он соисполнитель',
      'Сводка берётся из того же источника, что и виджет «Загрузка сборщиков» на канбане производства — цифры всегда одинаковые',
    ],
  },
  {
    version: 'v2.45.283',
    date: '12.06.2026',
    title: 'Поиск находит и сборки',
    features: [
      'Появился отдельный чип <b>«Сборки»</b> в фильтрах поиска',
      'По <b>сборкам</b> ищется по: модели, артикулу, номеру договора, контрагенту, <b>сборщику</b> и <b>соисполнителям</b>',
      'Раньше «Шевелев» не находился, хотя он стоит сборщиком/соисполнителем в куче работ — теперь находится',
      'Тап по результату открывает <b>модалку работы</b> прямо на главной',
      'В подписи — подсказка «сборщик …» / «соисполнитель», как у договоров',
    ],
  },
  {
    version: 'v2.45.282',
    date: '12.06.2026',
    title: 'Поиск находит и по людям',
    features: [
      'По <b>договорам</b> теперь ищется и по <b>менеджеру</b>, и по <b>соменеджерам</b> — раньше проверялись только номер, контрагент и комментарий. Раньше «Малахова» не находилась, хотя стояла менеджером',
      'По <b>задачам</b> теперь ищется и по <b>исполнителю</b> — раньше только название и описание',
      'В подписи результата подсказка <b>почему нашлось</b>: «менеджер Малахова», «соменеджер», «исполнитель …»',
    ],
  },
  {
    version: 'v2.45.281',
    date: '12.06.2026',
    title: 'Поиск: чипы недавних + порядок в дизайне',
    features: [
      '<b>Недавние запросы</b> теперь компактными <b>чипами</b> в ряд (а не громоздкими карточками во всю ширину) — больше помещается, выглядит легче',
      'Под чипами — <b>короткая подсказка</b> в одну строку вместо большого блока «Или введите новый запрос»',
      'Кнопка <b>«Очистить»</b> аккуратнее, с лёгкой подсветкой при тапе',
      '<b>Фикс:</b> на экранах «Поиск» и «Уведомления» больше не просвечивает контент главной над таб-баром — оверлей идёт от шапки до самого низа',
    ],
  },
  {
    version: 'v2.45.280',
    date: '12.06.2026',
    title: 'Поиск и уведомления — реальная работа',
    features: [
      '<b>Уведомления внизу теперь живые</b>: видны все уведомления (доработки, договоры, сборки) и чаты по договорам — тот же список, что в колокольчике. Клик по карточке открывает запись',
      'Кнопка <b>«Отметить все»</b> прочитанными — прямо на экране',
      '<b>Поиск стал быстрее</b>: договоры/задачи/доработки/контрагенты теперь грузятся <b>параллельно</b>, а не по очереди',
      'Появилась <b>история поиска</b>: до 8 последних удачных запросов, тап — повторить. Кнопка «Очистить»',
      'В чипах фильтров — <b>счётчики</b> найденного по каждому типу',
      'Вместо «Ищем…» — <b>скелет-загрузка</b> с шиммером (как в больших мессенджерах)',
    ],
  },
  {
    version: 'v2.45.279',
    date: '11.06.2026',
    title: 'Объёмные кнопки в мобильной шапке',
    features: [
      'Кнопки шапки — гамбургер, камера, QR-скан и колокольчик — теперь <b>объёмные плитки</b>, в одном стиле с нижним таб-баром',
      'Камера и QR — <b>брендовый градиент</b>, колокольчик — белая плитка, гамбургер — «стеклянная» на тёмной шапке',
      'Скруглённые квадраты вместо кругов, при нажатии кнопка «утопает»',
    ],
  },
  {
    version: 'v2.45.278',
    date: '11.06.2026',
    title: 'Объёмные иконки в нижнем таб-баре',
    features: [
      'Все иконки нижнего меню стали <b>объёмными плитками</b> — с мягким градиентом, лёгкой тенью и подсветкой сверху (как кнопки приложений на iOS)',
      'Активная вкладка — <b>брендовая синяя плитка</b> с белой иконкой и более глубокой тенью',
      'Нажатия — иконка слегка «утопает» (вдавленная тень + scale), ощущается тактильно',
    ],
  },
  {
    version: 'v2.45.277',
    date: '11.06.2026',
    title: 'Редизайн нижнего таб-бара',
    features: [
      'Активный пункт теперь выделяется <b>«пилюлей»</b> — мягкой брендовой подложкой под иконкой, видно с одного взгляда где ты',
      'Кнопка «+» — с градиентом и белой окантовкой, чуть компактнее, аккуратнее сидит в баре',
      'У бара появилась <b>мягкая тень сверху</b>, нажатия — с плавной анимацией иконки',
    ],
  },
  {
    version: 'v2.45.276',
    date: '11.06.2026',
    title: 'История изменений — имена полей по-русски',
    features: [
      'В блоке <b>«История изменений»</b> договора английские имена полей теперь переводятся: <code>fields: number, sign_date, contractor_id…</code> → <b>«поля: номер, дата подписания, контрагент…»</b>',
      'Переведены контрагент, юр. лицо, тип договора, сумма, дата отгрузки/подписания/оплаты, менеджер/соменеджеры, аванс, скидка, приоритет и др.',
      'Если в payload встретится незнакомое поле — оно останется как есть (без падений и пустых строк)',
    ],
  },
  {
    version: 'v2.45.275',
    date: '11.06.2026',
    title: 'Сайдбар: «На оплате» → «На оплату»',
    features: [
      'В левом меню пункт переименован: <b>«На оплате» → «На оплату»</b>. Грамматически точнее — это кнопка, ведущая <i>к заказам, которые надо оплатить</i>, а не статус самого заказа',
      'Сам статус заказа в карточке остался прежним — «На оплате» (отвечает на вопрос «в каком состоянии?»)',
    ],
  },
  {
    version: 'v2.45.274',
    date: '11.06.2026',
    title: '«Что закупить» — статус заказа у всех позиций',
    features: [
      'Обычные позиции (низкий остаток / план производства) теперь тоже показывают <b>живой статус заказа</b>: создал заказ у «Все инструменты» — у позиций появится «Счёт запрошен ORD-N», потом «Счёт получен», «Оплачен»…',
      'Раньше это работало только у покупных позиций договоров',
    ],
  },
  {
    version: 'v2.45.273',
    date: '11.06.2026',
    title: '«На оплате» — и на главном сайдбаре',
    features: [
      'На главной странице в левой колонке — <b>подсвеченная янтарным кнопка «На оплате»</b> с бейджем: один клик из любого места — и список заказов к оплате открыт',
    ],
  },
  {
    version: 'v2.45.272',
    date: '11.06.2026',
    title: '«На оплате» в левом меню',
    features: [
      'В Снабжении появился пункт <b>«На оплате»</b> с бейджем количества — один клик, и открыт список заказов «К оплате» (там же кнопки оплаты в карточке)',
    ],
  },
  {
    version: 'v2.45.271',
    date: '11.06.2026',
    title: 'Блок «На оплате» на главной',
    features: [
      'На главной странице (для бухгалтера, директора и зама) — блок <b>«На оплате»</b>: заказы, ждущие оплату, с номером счёта и суммой',
      'Кнопка <b>«Оплатил»</b> прямо в блоке — заказ уходит в «Оплачен», строка исчезает; клик по строке открывает заказ',
      'Бухгалтеру разрешены оплатные переходы статусов (раньше упиралась в «нет прав»)',
    ],
  },
  {
    version: 'v2.45.270',
    date: '11.06.2026',
    title: '«Дубли» стали зорче',
    features: [
      'Инструмент «Дубли» в Комплектующих теперь ловит позиции, отличающиеся только пробелами («ДУ25 ,» = «ДУ25,», двойные пробелы, пробел перед двоеточием) — и среди позиций с артикулами тоже',
      'После склейки дублей строки в «Что закупить» объединятся',
    ],
  },
  {
    version: 'v2.45.269',
    date: '11.06.2026',
    title: 'Уведомление об УПД из ЭДО',
    features: [
      'В колокольчике вместо «edo_upd_received» — нормальный текст: <b>«УПД № 847 из ЭДО»</b> с поставщиком и суммой; клик открывает карточку УПД',
    ],
  },
  {
    version: 'v2.45.268',
    date: '11.06.2026',
    title: 'УПД из ЭДО — пометка в списке',
    features: [
      'После «Оприходовать» УПД помечается в списке синим бейджем <b>«В приёмке»</b> — сразу видно, что уже отправлен на склад, и он уходит из счётчика новых',
    ],
  },
  {
    version: 'v2.45.267',
    date: '11.06.2026',
    title: 'УПД из ЭДО — оприходование на склад',
    features: [
      'В карточке УПД из ЭДО — кнопка <b>«Оприходовать (на склад)»</b>: документ уходит в «Приёмку УПД», система сопоставляет позиции с номенклатурой',
      'Дальше обычный путь приёмки: проверил сопоставление → подтвердил → комплектующие легли на склад',
      'Данные берутся из XML (точные, без распознавания фото) — сопоставление надёжнее',
    ],
  },
  {
    version: 'v2.45.266',
    date: '11.06.2026',
    title: 'Старые .xls-счета',
    features: [
      'Счета в старом формате Excel (<b>.xls</b>, до 2007 года — их шлёт, например, СПС холод) теперь открываются на просмотр и распознаются ИИ, как и .xlsx',
    ],
  },
  {
    version: 'v2.45.265',
    date: '11.06.2026',
    title: 'Приём УПД от ЭДО (синхронизация с 1С)',
    features: [
      'Новый раздел в Снабжении — <b>«Приём УПД от ЭДО»</b>: 1С отправляет УПД прямо в CRM, новые документы появляются здесь первыми (+ пуш директору и бухгалтеру)',
      'CRM сама разбирает XML ФНС: номер, дата, продавец, суммы и таблица строк; XML/PDF скачиваются из карточки',
      'Автопривязка к заказу поставщику по ИНН и сумме (±1%); не привязалось — кнопка «Привязать к заказу» вручную',
    ],
  },
  {
    version: 'v2.45.264',
    date: '11.06.2026',
    title: 'Чип счёта — дословно как в счёте',
    features: [
      'Главный чип копирует текст ровно как в шапке счёта: <b>«Счет № 05-0223915 от 11 июня 2026 г.»</b> — вставляй в платёжку без правок. Организация — отдельным чипом',
    ],
  },
  {
    version: 'v2.45.263',
    date: '11.06.2026',
    title: 'Дата счёта — по-людски',
    features: [
      'В чипах реквизитов дата теперь в привычном виде «от 11.06.2026» (а не «2026-06-11») — копируется дословно для платёжки',
    ],
  },
  {
    version: 'v2.45.262',
    date: '11.06.2026',
    title: 'Фикс чипов реквизитов счёта',
    features: [
      'Распознанные № счёта, дата и сумма не показывались в карточке заказа (сервер не отдавал поля) — исправлено',
    ],
  },
  {
    version: 'v2.45.261',
    date: '11.06.2026',
    title: 'Счёт от поставщика — реквизиты и Excel',
    features: [
      'В карточке заказа под счётом — чипы <b>«Счёт № … от … · сумма»</b>: нажал на чип — скопировалось (номер, сумма, всё целиком)',
      'Реквизиты вытаскивает ИИ из <b>PDF, фото, Excel и Word</b> — кнопка «Распознать номер и сумму»; для новых счетов с почты распознаётся само',
      '<b>Excel-счета</b> теперь открываются прямо в карточке таблицей (кнопка «Просмотреть»), как PDF и фото',
    ],
  },
  {
    version: 'v2.45.260',
    date: '11.06.2026',
    title: '«Что закупить» — убрать позицию из закупки',
    features: [
      'У покупных позиций договоров появился <b>крестик</b>: убирает позицию из «Что закупить» (например, закупили мимо системы). Позиция в договоре остаётся',
    ],
  },
  {
    version: 'v2.45.259',
    date: '11.06.2026',
    title: 'Пуш о счетах — без пропусков',
    features: [
      'Пуш на телефон теперь приходит и для счетов, которые <b>не привязались автоматически</b> к заказу (письмо без метки ORD-N) — раньше такие падали только в колокольчик',
      'Напоминание: пуш включается на каждом телефоне отдельно — колокольчик → кнопка 📱; там же есть «тестовый пуш» для проверки',
    ],
  },
  {
    version: 'v2.45.258',
    date: '11.06.2026',
    title: 'Удаление заказов — под пароль',
    features: [
      'Удаление заказа в «Заказах» (и массовое тоже) теперь требует <b>повторный ввод пароля</b> — случайно не снесёшь',
      'При удалении заказа покупные позиции договоров автоматически возвращаются в <b>«К заказу»</b> — можно заказать заново',
    ],
  },
  {
    version: 'v2.45.257',
    date: '11.06.2026',
    title: 'Покупные позиции — живой статус заказа',
    features: [
      'В «Что закупить» покупные позиции договоров показывают <b>статус своего заказа</b>, а не вечное «Заказано»: Счёт запрошен → Счёт получен → На оплате → Оплачен · ждём поставку → Получено (+ номер ORD-N)',
      'Статус обновляется сам по мере движения заказа в «Заказах» (включая авто-приёмку счёта по почте)',
      'Старые заказанные позиции привязались к своим заказам автоматически',
    ],
  },
  {
    version: 'v2.45.256',
    date: '11.06.2026',
    title: '«Что закупить» — карточка по клику',
    features: [
      'Клик по названию позиции в «Что закупить» открывает <b>карточку комплектующего</b> — можно сразу посмотреть/поправить артикул, мин. остаток, кратность закупки, поставщика',
    ],
  },
  {
    version: 'v2.45.255',
    date: '11.06.2026',
    title: 'Прайс «как в Excel» — фото слева',
    features: [
      'Лента фотографий в прайсе прижата к левому краю — больше не уезжает вправо за экран на широких таблицах',
    ],
  },
  {
    version: 'v2.45.254',
    date: '11.06.2026',
    title: 'Загрузка прайса — сразу таблица',
    features: [
      'После «Прайс из Excel» → выбора листа прайс <b>сразу сохраняется и открывается таблицей</b> — окно с галочками убрано. Позиции выбираются кликом по строке таблицы',
    ],
  },
  {
    version: 'v2.45.253',
    date: '11.06.2026',
    title: 'Прайс «как в Excel» — фото в одну ленту',
    features: [
      'Фотографии и иконки баннерных блоков прайса собраны <b>в одну ленту</b> на всю ширину — без раскиданных по пустым ячейкам картинок, пустые строки-прокладки убраны',
    ],
  },
  {
    version: 'v2.45.252',
    date: '11.06.2026',
    title: 'Каталог — управление прайсами',
    features: [
      'У каждого прайса появилась <b>корзинка</b>: удаляет файл и его позиции из каталога. Новый прайс — кнопкой «Прайс из Excel»',
      'Прайс открывается сразу <b>«как в Excel»</b> — переключатель «Список» убран',
    ],
  },
  {
    version: 'v2.45.251',
    date: '11.06.2026',
    title: 'Прайс «как в Excel» — компактнее',
    features: [
      'Таблица прайса плотнее: меньше шрифт и отступы, фото аккуратнее — на экран помещается заметно больше, как в самом Excel',
    ],
  },
  {
    version: 'v2.45.250',
    date: '11.06.2026',
    title: 'Прайс «как в Excel» — цвета и фото на местах',
    features: [
      'Цвета, заданные <b>темой Office</b> (а не прямым RGB), теперь тоже переносятся — красные шапки и заливки появились',
      'Фото внутри объединённых блоков больше не разъезжаются по техническим ячейкам — лежат вместе, как в оригинале',
    ],
  },
  {
    version: 'v2.45.249',
    date: '11.06.2026',
    title: 'Прайс «как в Excel» — мелкие доводки',
    features: [
      'Таблица прайса всегда перерисовывается свежей при открытии каталога (раньше могла показаться старая из кэша окна)',
      'Содержимое ячеек по центру вертикали, фото чуть крупнее — ближе к оригиналу',
    ],
  },
  {
    version: 'v2.45.248',
    date: '11.06.2026',
    title: 'Прайс «как в Excel» — дизайн оригинала',
    features: [
      'Таблица прайса теперь повторяет оригинальный Excel: <b>цвета заливки, жирный шрифт, цвет текста, выравнивание</b>',
      'Ширины колонок берутся из файла, <b>скрытые строки и колонки не показываются</b> — мусорных пустых столбцов больше нет',
      'Высоты строк тоже как в оригинале — фотографии не плющатся',
    ],
  },
  {
    version: 'v2.45.247',
    date: '11.06.2026',
    title: 'Каталог — во весь экран',
    features: [
      'В окне каталога поставщика кнопка <b>развернуть</b> (рядом с крестиком): окно раскрывается на весь экран — прайс «как в Excel» смотреть гораздо удобнее. Выбор запоминается',
    ],
  },
  {
    version: 'v2.45.246',
    date: '10.06.2026',
    title: 'Прайс «как в Excel» — мобильная версия',
    features: [
      'Таблица прайса больше не ужимается под экран телефона (текст складывался в столбик по букве) — колонки держат нормальную ширину, таблица листается вбок пальцем',
    ],
  },
  {
    version: 'v2.45.245',
    date: '10.06.2026',
    title: 'Прайс «как в Excel» — с фото',
    features: [
      'В открытом прайсе поставщика переключатель <b>«Как в Excel (с фото)»</b>: лист рисуется таблицей — картинки, характеристики, цены, объединённые ячейки',
      'Строки товаров кликабельны: нажал — позиция подставилась в заявку',
    ],
  },
  {
    version: 'v2.45.244',
    date: '10.06.2026',
    title: 'Прайс открывается по клику',
    features: [
      'В каталоге поставщика нажми на прайс (XIGMA, ROYAL Clima…) — <b>откроются его позиции прямо в окне</b>: листай, ищи, нажал на строку — она подставилась в заявку',
      'Ничего предварительно «добавлять в каталог» не нужно — система сама запоминает выбранное',
      'Скачать Excel-оригинал — маленькая стрелка ⬇ рядом с названием прайса',
    ],
  },
  {
    version: 'v2.45.243',
    date: '10.06.2026',
    title: 'Каталог поставщика — вкладки по прайсам',
    features: [
      'У поставщика может быть несколько прайсов (XIGMA, ROYAL Clima…) — в каталоге они теперь <b>вкладками</b>: загрузил 3–4 прайса и переключаешься',
      'Excel-оригинал каждого прайса сохраняется — кнопка <b>«Excel: …»</b> скачивает его, можно полистать с фото и ценами',
      'Удаление прайс-файла убирает и его позиции из каталога',
    ],
  },
  {
    version: 'v2.45.242',
    date: '10.06.2026',
    title: 'Прайс из Excel — выбор галочками',
    features: [
      'После загрузки Excel прайс открывается <b>списком с галочками</b>: листаешь, ищешь, отмечаешь нужное — «Добавить в каталог». Текстовое окно больше не мучает',
      'Если открывал из позиции заявки: отметил одну строку → <b>«Добавить и подставить в позицию»</b> — она сразу уходит и в каталог, и в письмо',
    ],
  },
  {
    version: 'v2.45.241',
    date: '10.06.2026',
    title: 'Прайс поставщика — точнее и чище',
    features: [
      'Если в Excel-прайсе несколько листов (Скидка, РАСПРОДАЖА, ПОЛУПРОМ On-Off…) — система спросит, <b>какой лист взять</b>, и прочитает только его',
      'Парсер больше не тащит характеристики («3 СКОРОСТИ ВЕНТИЛЯТОРА», «мин./макс.», «3+2 ГОДА») — только модели',
      'В каталоге поставщика у каждой строки крестик — <b>удалить мусор из прайса</b> навсегда',
    ],
  },
  {
    version: 'v2.45.240',
    date: '10.06.2026',
    title: 'Выбор «у поставщика» из каталога',
    features: [
      'В превью заявки рядом с полем «У поставщика» — кнопка <b>каталога</b>: открывается прайс поставщика с поиском, кликнул по позиции — сопоставилось',
      'Если прайс ещё не загружен — кнопка «Прайс из Excel» прямо в этом окне: выбери файл (XIGMA, Royal Clima…), удали лишние строки и сохрани',
    ],
  },
  {
    version: 'v2.45.239',
    date: '10.06.2026',
    title: 'Прайс поставщика из Excel',
    features: [
      'В карточке поставщика — блок <b>«Прайс поставщика»</b>: загрузи его Excel-прайс, система вытащит названия, лишнее удаляешь (например, оставляешь только полупром) и сохраняешь',
      'В превью заявки поле «У поставщика» теперь подсказывает названия из загруженного прайса — начни печатать и выбери из списка',
    ],
  },
  {
    version: 'v2.45.238',
    date: '10.06.2026',
    title: 'Заявка поставщику — название из его прайса',
    features: [
      'В превью заявки под каждой позицией появилось поле <b>«У поставщика»</b>: впиши название из прайса поставщика (например, наш «Наружный блок 18» = «XIGMA XG-TXC50RHA-ODU, HC-1596058» у БИС) — именно оно уйдёт в письмо и DOCX',
      'Соответствие запоминается на пару «позиция + поставщик»: один раз сопоставил — в следующих заявках этому поставщику подставится автоматически',
    ],
  },
  {
    version: 'v2.45.237',
    date: '10.06.2026',
    title: 'Артикул модели можно менять',
    features: [
      'В форме «Изменить модель» поле <b>Артикул</b> стало редактируемым (раньше «менять нельзя»). Уникальность проверяется — занять чужой артикул не даст',
      'История сборок и связи сохраняются — они привязаны к модели, а не к тексту артикула',
    ],
  },
  {
    version: 'v2.45.236',
    date: '10.06.2026',
    title: 'Заказ поставщику из покупных позиций',
    features: [
      'У группы поставщика в «Покупных позициях по договорам» — кнопка <b>«Сформировать заказ»</b>: создаётся заказ снабжения с письмом-превью (как у комплектующих)',
      'Дальше заказ живёт в <b>«Заказах»</b> по статусам: Отправлен → <b>Ожидаем счёт</b> → Счёт получен → На оплате → Оплачен → Получено. Позиции договора автоматически становятся «Заказано»',
    ],
  },
  {
    version: 'v2.45.235',
    date: '10.06.2026',
    title: 'Покупные позиции: поставщик галочками',
    features: [
      'В блоке «Покупные позиции по договорам» — <b>галочки</b>: отметь несколько → <b>«Назначить поставщика»</b> → выбери одного на всех (для запроса счёта). Позиции группируются по поставщикам с контактами',
      'Импорт BOM больше <b>не плодит дубли</b>: если позиция с таким именем уже есть — переиспользует её. Инструмент «Дубли» теперь находит и дубликаты <b>по имени</b> (без артикула) — можно склеить существующие',
    ],
  },
  {
    version: 'v2.45.233',
    date: '10.06.2026',
    title: '«Что закупить» видит покупные позиции договоров',
    features: [
      'В разделе <b>Снабжение → «Что закупить»</b> появился блок <b>«Покупные позиции по договорам»</b>: товары спецификаций со статусом «К заказу»/«Заказано» (ZPW, ZFC и т.д.), сгруппированы по договорам',
      'Раньше там был только дефицит комплектующих под производство — покупные позиции было видно лишь внутри договора. Клик по строке открывает договор',
    ],
  },
  {
    version: 'v2.45.232',
    date: '10.06.2026',
    title: 'Документы модели в карточке работы',
    features: [
      'В карточке производственной работы появился блок <b>«Документы модели»</b>: схема (PDF), файл СП и фото — сборщик открывает прямо из работы',
      'Правка позиции спецификации (смена модели/кол-ва) теперь <b>синхронизирует производство</b>: новая работа создаётся, как при добавлении (раньше — нет)',
    ],
  },
  {
    version: 'v2.45.229',
    date: '10.06.2026',
    title: 'BOM: массовое удаление позиций',
    features: [
      'В тех. карте (BOM) у каждой позиции появилась <b>галочка</b> + «выбрать все» — отметил и нажал <b>«Удалить выбранные»</b>, не по одной',
    ],
  },
  {
    version: 'v2.45.228',
    date: '10.06.2026',
    title: 'Схема (PDF) у модели + чистка картинок',
    features: [
      'У модели можно сохранить <b>принципиальную схему (PDF)</b> — кнопка «Схема (PDF)» в блоке характеристик; открыть/удалить рядом',
      'Картинку модели (унаследованную из продажной позиции) можно <b>убрать</b> — крестик на картинке; есть вариант <b>убрать сразу у всех моделей с такой же картинкой</b> (для копий)',
      'Плюс: главная кнопка опросника — «Сохранить и отправить», текст без «2 рабочих дней» (v2.45.227); из шапки «Опросных листов» убраны дублирующие кнопки (v2.45.226)',
    ],
  },
  {
    version: 'v2.45.225',
    date: '10.06.2026',
    title: 'Удаление фото и файла СП у модели',
    features: [
      'В карточке модели у <b>фото</b> появился крестик 🗑 (в углу картинки) — можно удалить неудачное фото',
      'У <b>файла СП</b> — кнопка удаления рядом со «Скачать» (разобранные характеристики при этом остаются)',
    ],
  },
  {
    version: 'v2.45.224',
    date: '10.06.2026',
    title: 'Опросные листы — карточки анкет',
    features: [
      'В разделе «Опросные листы» теперь видно <b>доступные анкеты</b>: карточка <b>«Опросный лист — Проектирование сыроварни»</b> со своими кнопками «Ссылка для клиента» и «Заполнить»',
      'Под карточками — список заполненных анкет. Новые виды опросников будут добавляться сюда же',
    ],
  },
  {
    version: 'v2.45.223',
    date: '10.06.2026',
    title: 'Опросные листы в Продажах',
    features: [
      'Новый раздел <b>Продажи → «Опросные листы»</b>: красивая анкета «Сыроварня» — жми <b>«Ссылка для клиента»</b> и отправляй в любой мессенджер, клиент заполняет с телефона',
      'Заполненные анкеты <b>сами прилетают в раздел</b> (плюс уведомление в колокольчик и пуш). Менеджер может заполнить и сам — кнопка «Заполнить самому»',
    ],
  },
  {
    version: 'v2.45.222',
    date: '10.06.2026',
    title: '«Поделиться → Atom» — счёт сразу в систему',
    features: [
      'Atom CRM появляется в системном меню <b>«Поделиться»</b> на телефоне: получили счёт в Максе/Телеге/почте → «Поделиться» → <b>Atom</b> → файл сам загрузился во <b>«Входящие счета»</b>',
      'Работает из любого приложения, без пересылок. Нужно: приложение установлено на главный экран; после обновления переустановить значок (удалить и «Добавить на главный экран»), чтобы телефон увидел новую возможность',
    ],
  },
  {
    version: 'v2.45.221',
    date: '10.06.2026',
    title: 'Импорт BOM: создаёт недостающие позиции',
    features: [
      'При импорте BOM строки, которых нет в каталоге, теперь можно <b>создавать автоматически</b> (галочка «Создавать недостающие позиции») — они заводятся в категории «Прочее (импорт)» и сразу попадают в BOM',
      'Распознаются <b>числовые артикулы поставщиков</b> (напр. 0-18-0035), а не только коды вида AG-…',
    ],
  },
  {
    version: 'v2.45.220',
    date: '10.06.2026',
    title: 'Импорт BOM из Excel + шаблон',
    features: [
      'В окне импорта BOM появились кнопки <b>«Скачать шаблон Excel»</b> и <b>«Загрузить Excel»</b> — заполняешь таблицу (Кол-во · Исполнение · Артикул · Наименование), загружаешь, строки подставляются и проверяются',
      'Текстовая вставка тоже осталась — как было',
    ],
  },
  {
    version: 'v2.45.219',
    date: '10.06.2026',
    title: 'Характеристики модели — правка из карточки',
    features: [
      'У блока <b>«Характеристики»</b> (параметры: Модель насоса, Kvs, расход…) в карточке модели появилась кнопка <b>«Редактировать»</b> — открывает форму, где их можно добавить/изменить/удалить',
    ],
  },
  {
    version: 'v2.45.218',
    date: '09.06.2026',
    title: 'КП: выбор позиции по разделам/подразделам',
    features: [
      'В составлении КП окно «Выберите позицию из каталога» стало <b>иерархическим</b> (группа → подгруппа), а не плоским списком',
      'Добавлены <b>две вкладки</b>: <b>«Продажи»</b> (продажная номенклатура) и <b>«Производство»</b> (модели по направлениям/подгруппам) — можно добавить в КП и то, и другое',
    ],
  },
  {
    version: 'v2.45.217',
    date: '09.06.2026',
    title: 'Закупка пачками/бухтами (кратность)',
    features: [
      'У комплектующего появилось поле <b>«Кратность закупки»</b> (фасовка/бухта). В разделе «Что закупить» количество <b>округляется вверх до кратного</b>',
      'Например: наконечники/хомуты — кратность 100 (нужно 29 → к закупке 100), провод — 40/50 м (нужно 2 м → 40 м). Пусто = как раньше, поштучно',
    ],
  },
  {
    version: 'v2.45.216',
    date: '09.06.2026',
    title: 'Лента действий — по-русски',
    features: [
      'В «Последние действия» при изменении договора названия полей теперь по-русски (напр. «номер, дата подписания, сумма, менеджер»), а не <code>number, sign_date, sum_amount</code>',
    ],
  },
  {
    version: 'v2.45.215',
    date: '09.06.2026',
    title: 'Позиции спецификации — аккуратнее на телефоне',
    features: [
      'Карточка позиции переделана: <b>название</b> отдельной строкой, под ним ровный ряд <b>меток</b> (вид/система/закуп) и <b>статус</b>, затем количество',
      'На телефоне кнопки (QR/правка/удаление) уходят в <b>нижний ряд</b> и больше не сжимают название — читается чисто',
    ],
  },
  {
    version: 'v2.45.214',
    date: '09.06.2026',
    title: 'Кабель/провод в метрах — теперь точно',
    features: [
      'Исправлена нормализация: в прошлой версии фильтр по кириллице не срабатывал (регистр), поэтому провода оставались в «шт.». Теперь все кабели/провода реально переведены в «м» — в т.ч. в разделе «Что закупить»',
    ],
  },
  {
    version: 'v2.45.213',
    date: '09.06.2026',
    title: 'Кабель/провод — в метрах везде',
    features: [
      'Все комплектующие с «кабель»/«провод» в названии переведены в единицу <b>«м»</b> — на складе, в номенклатуре, в BOM и в спецификациях договоров (разовая нормализация по всей базе)',
      'При создании нового кабеля/провода единица сама ставится <b>«м»</b> (можно вручную поменять)',
    ],
  },
  {
    version: 'v2.45.212',
    date: '09.06.2026',
    title: 'QR договора в PDF спецификации',
    features: [
      'В шапке <b>PDF</b> спецификации печатается <b>QR-код договора</b> — навёл камеру, открылась публичная страница договора (статус онлайн, по паролю для клиента)',
    ],
  },
  {
    version: 'v2.45.211',
    date: '09.06.2026',
    title: 'PDF спецификации — шире, меньше пустых полей',
    features: [
      'Таблица в <b>PDF</b> спецификации теперь занимает почти всю ширину листа (поля по бокам уменьшены, колонка «Наименование» шире) — раньше было много пустого места слева и справа',
    ],
  },
  {
    version: 'v2.45.210',
    date: '09.06.2026',
    title: 'Выбор позиции (Производство) — по разделам/подразделам',
    features: [
      'Вкладка <b>«Производство»</b> в окне «Выбор позиции» теперь по <b>разделам → подразделам</b> (как каталог), а не плоским списком',
      'Свежесозданные позиции (модели/товары/комплектующие) сразу видны в окне выбора — раньше показывались только после перезагрузки страницы',
    ],
  },
  {
    version: 'v2.45.209',
    date: '09.06.2026',
    title: 'Остановка работы — простое подтверждение',
    features: [
      'При завершении работы («×» у «работаю сейчас») больше не спрашивает повторно «что делал» — сотрудник уже указал операцию при старте. Теперь просто <b>«Точно закрыть работу?»</b>',
    ],
  },
  {
    version: 'v2.45.208',
    date: '09.06.2026',
    title: 'QR у каждого изделия спецификации',
    features: [
      'У <b>каждой</b> позиции спецификации появилась кнопка <b>QR</b> — печать этикетки на конкретное изделие (раньше только у позиций в резерве)',
      'Скан QR изделия открывает <b>карточку именно этой позиции</b>: что это, договор, кол-во, статус, система/объект, пометка «закуп в другом городе» (сотруднику — по сессии, клиенту — по паролю договора)',
    ],
  },
  {
    version: 'v2.45.207',
    date: '09.06.2026',
    title: 'PDF спецификации — пометки печатаются нормально',
    features: [
      'В <b>PDF</b> спецификации метки «система/объект» и «закуп в другом городе» теперь печатаются как текст, а не сырыми тегами <code>&lt;br/&gt;&lt;font&gt;</code> (исправлено экранирование)',
    ],
  },
  {
    version: 'v2.45.206',
    date: '09.06.2026',
    title: 'Вид позиции — из описания товара',
    features: [
      'Если у продажной позиции нет подгруппы/группы, но есть <b>описание</b> (напр. «ВЕНТИЛЯТОРЫ ZILON») — в строке показывается оно (конкретнее, чем общая категория)',
    ],
  },
  {
    version: 'v2.45.205',
    date: '09.06.2026',
    title: 'Вид позиции — запасной вариант по категории',
    features: [
      'Если у продажной позиции не заданы подгруппа/группа — теперь в строке показывается <b>категория товара</b> (чтобы было видно «что это», а не только код)',
    ],
  },
  {
    version: 'v2.45.204',
    date: '09.06.2026',
    title: 'Позиция вручную + починены кнопки BOM',
    features: [
      'В спецификации можно <b>вписать позицию вручную</b> (свободный ввод) — если в каталоге нет: набери название и нажми «Добавить». Удобно для того, что закупается в другом городе',
      'Кнопки <b>«Взять BOM»</b> и <b>«Импорт BOM»</b> в карточке модели не реагировали на клик (ломались из-за кавычек в названии) — исправлено',
    ],
  },
  {
    version: 'v2.45.203',
    date: '09.06.2026',
    title: 'Тревога «диск заполняется» + защита от переполнения',
    features: [
      'Если том сервера заполняется выше <b>80%</b> — директору приходит <b>тревога</b> (Телеграм + пуш), чтобы освободить место заранее, до отказа',
      'Бэкенд теперь <b>сам переживает переполнение диска</b>: при старте чистит лишние бэкапы (хранение снижено 20 → 6, off-site копии в Телеграм остаются)',
    ],
  },
  {
    version: 'v2.45.199',
    date: '09.06.2026',
    title: 'Позиция: к какой системе/объекту относится',
    features: [
      'У позиции спецификации можно указать <b>«Относится к системе / объекту»</b> (напр. AtomCold№24) — рядом с позицией показывается метка, видно что к чему относится',
      'Подсказка из уже введённых по договору систем (datalist) — удобно переиспользовать. Метка попадает в PDF и Word',
    ],
  },
  {
    version: 'v2.45.198',
    date: '09.06.2026',
    title: 'Позиция «закуп в другом городе»',
    features: [
      'В форме позиции спецификации появилась галочка <b>«Закуп в другом городе (отгрузка сразу на объекте)»</b> — с полями город, телефон, комментарий и возможностью <b>прикрепить файл</b> (счёт/спека/фото, до 25 МБ)',
      'Такая позиция помечается в спецификации (бейдж + строка с деталями) и попадает с пометкой в <b>PDF и Word</b>',
    ],
  },
  {
    version: 'v2.45.197',
    date: '09.06.2026',
    title: 'Зависший таймер чистится сам; категории в форме модели',
    features: [
      'Если у сборщика «завис» таймер «СЕЙЧАС» по уже готовой/перенесённой работе — он теперь <b>снимается автоматически</b> при открытии загрузки производства (чистит старые хвосты)',
      'В форме модели в списке «Категория» теперь видны и <b>непривязанные категории</b> (напр. «ЩУ-004.000 Приточно-вытяжная вентиляция») — можно выбрать при создании/переносе',
    ],
  },
  {
    version: 'v2.45.196',
    date: '09.06.2026',
    title: 'Подгруппы: удаление + перенос модели в категорию',
    features: [
      'В каталоге моделей у подгруппы появилась <b>корзина</b> — удалить лишнюю/ошибочную подгруппу (модели из неё переезжают в «Без подгруппы», не удаляются)',
      'В форме <b>редактирования модели</b> добавлен выбор <b>категории</b> — можно перенести модель в нужную группу (напр. «ЩУ-004.000 Приточно-вытяжная вентиляция»), выбрав подгруппу и категорию',
    ],
  },
  {
    version: 'v2.45.195',
    date: '09.06.2026',
    title: 'Таймер сборщика останавливается; панель уведомлений',
    features: [
      'Таймер «СЕЙЧАС» у сборщика теперь <b>останавливается</b>, когда работа уходит на проверку/упаковку/готово (или отменена) — раньше время продолжало тикать по уже завершённой работе',
      'Панель уведомлений (колокольчик): заголовок и крестик сверху, кнопки «Тест / звук / Очистить всё» — отдельным ровным рядом, ничего не обрезается',
    ],
  },
  {
    version: 'v2.45.194',
    date: '09.06.2026',
    title: 'Мастер заходит в договоры (без сумм)',
    features: [
      'Мастер больше <b>не вылетает</b> из договоров — раньше любой «нет прав» (403) ошибочно разлогинивал; теперь выкидывает только реально истёкшая сессия',
      'Мастеру производства <b>не показываются суммы</b> договоров (в списке, в карточке и в спецификации) — он видит состав и сроки, но не деньги',
    ],
  },
  {
    version: 'v2.45.192',
    date: '09.06.2026',
    title: 'Характеристики прямо в окне «Выбор позиции»',
    features: [
      'В окне выбора продажной позиции под каждым товаром показываются <b>ключевые характеристики</b> (до 6) — крутящий момент, расход воздуха и т.д.',
      'Можно сравнивать и выбирать нужный вариант не выходя смотреть характеристики отдельно',
    ],
  },
  {
    version: 'v2.45.191',
    date: '09.06.2026',
    title: 'В спецификации — точный вид позиции',
    features: [
      'Метка вида в строке спецификации теперь показывает <b>подгруппу</b> (конкретнее): «Приточные установки…», «Гибкие вставки…» вместо общей группы «Компакты ZILON», «Сетевые элементы»',
    ],
  },
  {
    version: 'v2.45.190',
    date: '09.06.2026',
    title: 'В спецификации виден вид позиции',
    features: [
      'В строках спецификации договора теперь показывается <b>вид позиции</b> (группа каталога) — «Электроприводы», «Гибкие вставки» и т.д., а не только коды/артикул',
      'Сразу понятно, что за позиция, без открытия карточки',
    ],
  },
  {
    version: 'v2.45.189',
    date: '09.06.2026',
    title: 'Выбор позиции — как справочник',
    features: [
      'Окно <b>«Выбор позиции»</b> (вкладка «Продажи») теперь устроено как страница <b>«Продажная номенклатура»</b>: аккуратные <b>свёрнутые группы → подгруппы → товары</b>',
      'Открываешь нужную группу, затем подгруппу — и спокойно выбираешь позицию. Больше нет вороха одиночных позиций под огромной категорией',
    ],
  },
  {
    version: 'v2.45.188',
    date: '09.06.2026',
    title: 'Несколько менеджеров на договоре',
    features: [
      'В договоре можно указать <b>несколько менеджеров</b> — основной + поле <b>«Доп. менеджеры»</b> (кнопка «Добавить менеджера», можно выбрать нескольких)',
      'Доп. менеджеры видны в карточке договора и в спецификации (PDF/Word) — «Менеджеры: …»',
    ],
  },
  {
    version: 'v2.45.187',
    date: '09.06.2026',
    title: 'Выбор позиции: большие категории — по подгруппам',
    features: [
      'В окне <b>«Выбор позиции»</b> (Продажи) большие категории (как «Вентиляция» с тысячами решёток) теперь разбиты на <b>подгруппы по сериям</b> (например «1 WA», «2 WA») — раскрываешь нужную и спокойно выбираешь, без простыни на 1359 строк',
      'При поиске по названию/артикулу всё показывается списком как раньше',
    ],
  },
  {
    version: 'v2.45.186',
    date: '09.06.2026',
    title: 'Нет двойного учёта: резерв vs производство',
    features: [
      'Исправлено: позиция, уже <b>зарезервированная со склада</b> (готовая продукция), больше не висит ещё и в <b>производстве</b> как «нужно собрать». Раньше, например, «Балка монтажная» была и «В резерве», и в очереди на сборку',
      'Когда резерв покрывает потребность — лишние работы в очереди <b>автоматически снимаются</b> (начатые работы не трогаются)',
      'Чтобы вылечить уже существующие такие договоры — нажмите на договоре <b>«Пересобрать резервы»</b>',
    ],
  },
  {
    version: 'v2.45.185',
    date: '09.06.2026',
    title: 'Спецификация: внизу только ответственный',
    features: [
      'В подписи спецификации (PDF и Word) убраны «От Поставщика / От Покупателя» — осталась одна графа <b>«Ответственный (менеджер)»</b> с местом для подписи',
    ],
  },
  {
    version: 'v2.45.184',
    date: '09.06.2026',
    title: 'Спецификация: убран блок «Поставщик/Покупатель»',
    features: [
      'Из печатной спецификации (PDF и Word) убран блок <b>«ПОСТАВЩИК / ПОКУПАТЕЛЬ»</b> сверху. Подписи внизу («От Поставщика / От Покупателя») пока оставлены',
    ],
  },
  {
    version: 'v2.45.183',
    date: '09.06.2026',
    title: 'Спецификация: убран двойной «№», добавлен менеджер',
    features: [
      'В печатной спецификации (PDF и Word) заголовок больше не дублирует «№ №» — теперь «Спецификация к договору № 11ТД/06.26»',
      'В шапку спецификации добавлен <b>менеджер</b> (чей объект ведёт)',
    ],
  },
  {
    version: 'v2.45.182',
    date: '09.06.2026',
    title: 'Печать QR — для менеджера и мастера',
    features: [
      'Кнопки печати QR (<b>«Печать QR на все»</b>, термопечать в окне QR, печать по позиции) теперь доступны не только директору, но и <b>менеджеру, заму и мастеру</b> — раньше у них были скрыты, хотя печатать им можно',
    ],
  },
  {
    version: 'v2.45.181',
    date: '09.06.2026',
    title: 'Инвентаризация ГП: каталог открывается списком',
    features: [
      'В «Инвентаризации ГП» теперь сразу <b>открывается весь каталог моделей списком</b> — не нужно ждать поиск. Поле поиска просто фильтрует список мгновенно',
      'Убрана причина «зависания» — каталог грузится один раз при открытии',
    ],
  },
  {
    version: 'v2.45.180',
    date: '09.06.2026',
    title: 'Поиск моделей работает надёжно',
    features: [
      'Поиск моделей (в т.ч. в «Инвентаризации ГП») теперь находит по названию и артикулу надёжно — раньше часть моделей (например «Балка монтажная») не находилась',
      'В инвентаризации видно состояние поиска: «Поиск…», результат или понятная ошибка',
    ],
  },
  {
    version: 'v2.45.179',
    date: '09.06.2026',
    title: 'Админ-инструменты: прокрутка',
    features: [
      'Окно «Админ-инструменты» теперь прокручивается — нижние карточки (в т.ч. «Инвентаризация ГП») больше не обрезаются',
    ],
  },
  {
    version: 'v2.45.178',
    date: '09.06.2026',
    title: 'Инвентаризация готовой продукции',
    features: [
      'В <b>Снабжение → Админ-инструменты</b> добавлен инструмент <b>«Инвентаризация ГП»</b> — поправить склад готовой продукции по факту: где-то добавить излишек, где-то убрать недостачу',
      'Важно: при <b>добавлении</b> излишка комплектующие <b>НЕ списываются</b> (изделия уже есть физически, это правка учёта, а не новая сборка)',
      '<b>Недостача</b> убирается только со свободного остатка — резерв под договоры не трогается. Видно текущее всего/свободно/резерв перед правкой',
    ],
  },
  {
    version: 'v2.45.177',
    date: '09.06.2026',
    title: 'Тревоги о сбоях',
    features: [
      'Если что-то ломается тихо — <b>бэкап не сделался</b>, <b>почта перестала забирать счета</b>, или повторяется ошибка в системе — директору приходит <b>тревога в Телеграм и пуш</b>',
      'Тревоги не спамят: один тип — не чаще раза в 30 минут',
      'Проверить можно: <b>Аккаунт → «Проверить тревоги»</b> — придёт тестовое оповещение',
    ],
  },
  {
    version: 'v2.45.176',
    date: '09.06.2026',
    title: 'Резервная копия базы приходит в Телеграм',
    features: [
      'Теперь раз в сутки <b>копия всей базы</b> автоматически приходит директору <b>в Телеграм</b> — это копия «вне сервера» на случай потери диска. Файл можно просто хранить у себя',
      'Кнопкой «сделать копию сейчас» (через админ-доступ) можно получить свежую копию в Телеграм в любой момент',
    ],
  },
  {
    version: 'v2.45.175',
    date: '09.06.2026',
    title: 'Авто-бэкап базы + код разнесён на части',
    features: [
      'Защита данных: теперь база <b>автоматически копируется</b> (резервный снимок) несколько раз в сутки — на случай сбоя можно восстановиться',
      'Техническое: код приложения разнесён на несколько файлов — дальнейшие правки идут быстрее и безопаснее (на работу не влияет)',
    ],
  },
  {
    version: 'v2.45.173',
    date: '09.06.2026',
    title: 'Главная: ровные отступы и объёмные значки',
    features: [
      'Шапка главной выровнена: приветствие, календарь, заголовки и карточки теперь по одному левому краю — без «съехавших» слов',
      'Значки в блоке <b>«Сегодня»</b> (Договоров, КП и др.) стали <b>объёмными</b> (3D) — в одном стиле с быстрыми действиями',
    ],
  },
  {
    version: 'v2.45.172',
    date: '09.06.2026',
    title: 'Поправлены отступы на главной и в новой работе',
    features: [
      'Заголовок <b>«Быстрые действия»</b> на главной больше не «съезжает» влево — выровнен с карточками',
      'В форме <b>«Новая работа»</b> выбор «На склад / Под договор» на телефоне теперь в столбик — плашка «Под договор» видна полностью, не обрезается',
    ],
  },
  {
    version: 'v2.45.171',
    date: '09.06.2026',
    title: 'Снабжение: скрыт пункт «Каталог»',
    features: [
      'Пункт <b>«Каталог»</b> в разделе Снабжение временно скрыт из меню — вернём, когда определимся с его назначением',
    ],
  },
  {
    version: 'v2.45.170',
    date: '09.06.2026',
    title: 'Объёмные значки и версия по-русски',
    features: [
      'Значки быстрых действий на главной (Новая работа, Новый договор, Новая задача, Доработка) стали <b>крупнее и объёмными</b> (3D) — приятный цветной вид',
      'В подвале меню версия теперь пишется <b>по-русски</b> (номер + краткое описание), без технических английских хвостов',
      'Убраны прочерки «—» в подвале главного меню: аватар, имя и роль теперь подставляются корректно',
    ],
  },
  {
    version: 'v2.45.169',
    date: '09.06.2026',
    title: 'Панель уведомлений: ровная шапка',
    features: [
      'Шапка панели уведомлений на телефоне выровнена: заголовок и крестик — сверху одной строкой, кнопки действий (📱, «Тест», звук, «Очистить всё») — ровным рядом снизу. Симметрично, с одинаковыми отступами',
    ],
  },
  {
    version: 'v2.45.168',
    date: '09.06.2026',
    title: 'Панель уведомлений: кнопки не обрезаются',
    features: [
      'В шапке панели уведомлений на телефоне кнопки (📱, «Тест», звук, «Очистить всё», закрыть) больше не уезжают за край — переносятся на отдельную строку и помещаются полностью',
    ],
  },
  {
    version: 'v2.45.167',
    date: '09.06.2026',
    title: 'Входящие счета: аккуратные карточки на телефоне',
    features: [
      'Карточки писем во «Входящих счетах от поставщиков» на телефоне больше не сжимаются — текст идёт во всю ширину, а кнопки («Открыть», «Открыть заказ» и т.д.) выстроены ровным рядом снизу и не уезжают за край',
    ],
  },
  {
    version: 'v2.45.166',
    date: '09.06.2026',
    title: 'В отчёте «Активность» видно, что делали',
    features: [
      'В отчёте <b>«Активность производства»</b> (Excel и PDF) колонка <b>«Что делал»</b> теперь показывает <b>этап</b> (шаг работы) для строк помощи, а не только заметку',
      'Если у записи указан этап — он попадёт в отчёт; авто-закрытые записи (без этапа) остаются как есть',
    ],
  },
  {
    version: 'v2.45.165',
    date: '09.06.2026',
    title: 'Снабжение: кнопка «Назад» на телефоне и ровные фильтры',
    features: [
      'В карточке заказа поставщику на <b>телефоне</b> вернулась кнопка <b>«Назад»</b> (раньше была видна только на компьютере) — больше не нужно лезть в меню',
      'Статус-фильтры в «Заказах» на телефоне выстроены в <b>ровную сетку</b> 2 в ряд — аккуратно и читаемо',
      'Пункт меню переименован во <b>«Входящие счета от поставщиков»</b> — как и название раздела',
    ],
  },
  {
    version: 'v2.45.164',
    date: '09.06.2026',
    title: 'Провалиться в запись из Сводок',
    features: [
      'В <b>Сводках</b> (раздел «Последние записи») запись теперь <b>кликабельна</b> — нажал и открылась карточка работы: что за работа, по какому договору, кто и что делал по дням, сколько часов',
      'В строке записи теперь видно <b>этап</b> (что делали), если он указан',
    ],
  },
  {
    version: 'v2.45.163',
    date: '09.06.2026',
    title: 'Аккуратный баннер обновления + показ версии',
    features: [
      'Баннер <b>«Доступно обновление»</b> больше не сжимается на телефоне — текст и кнопки читаемы, на узком экране кнопка переносится вниз на всю ширину',
      'В баннере теперь видно, <b>какая версия</b> готова к установке (номер и краткое описание)',
      'Описание версии — человеческое, на русском',
    ],
  },
  {
    version: 'v2.45.162',
    date: '08.06.2026',
    title: 'Техническое: разнесли код приложения по файлам',
    features: [
      'Внутреннее улучшение: стили и код вынесены из одного огромного файла в отдельные (app.css, app.js) — на работу приложения не влияет, но дальнейшие доработки идут быстрее',
    ],
  },
  {
    version: 'v2.45.161',
    date: '08.06.2026',
    title: 'Взять BOM из другой модели',
    features: [
      'В карточке модели, в блоке <b>«Тех. карта (BOM)»</b>, добавлена кнопка <b>«Взять BOM»</b> — выбираешь модель-источник, и её тех.карта копируется в текущую',
      'Удобно, когда новая модель почти как существующая: скопировал BOM, убрал лишнее, добавил своё — не нужно заводить позиции с нуля',
      'Уже имеющиеся позиции не задваиваются (копируются только недостающие)',
    ],
  },
  {
    version: 'v2.45.160',
    date: '08.06.2026',
    title: 'Помощь: новые разделы',
    features: [
      'В <b>Помощь</b> добавлены инструкции по свежим функциям: пароль на публичные QR, уведомления на телефон (пуш) и кнопка «Тест», списание со склада при отгрузке, ручное сопоставление позиции спецификации со складом',
    ],
  },
  {
    version: 'v2.45.159',
    date: '08.06.2026',
    title: 'Пуш больше не «слетает» после обновления',
    features: [
      'Раньше после обновления страницы значок пуша гас и уведомления переставали приходить — приходилось включать заново. Теперь при каждом запуске приложение само пере-подписывает телефон и сохраняет подписку',
      'Если поменялся ключ сервера — подписка автоматически пересоздаётся, ничего нажимать не нужно',
    ],
  },
  {
    version: 'v2.45.158',
    date: '08.06.2026',
    title: 'Кнопка «Тест» уведомления на телефон',
    features: [
      'В шапке панели уведомлений (колокольчик) появилась кнопка <b>«Тест»</b> — нажал и сразу проверил, как пуш приходит на телефон',
      'Если пуш на устройстве ещё не включён — кнопка предложит включить (нажать 📱)',
    ],
  },
  {
    version: 'v2.45.157',
    date: '08.06.2026',
    title: 'Ручное сопоставление позиции спецификации со складом',
    features: [
      'Если в «Новой работе» позиция спецификации показана как «есть 0», хотя на складе она есть (например, заведена дублем под другой записью) — у дефицитной позиции появилась кнопка <b>«Сопоставить со складом»</b>',
      'По кнопке выбираешь нужную складскую позицию (с её остатком) — спецификация модели привязывается к ней, и количество подтягивается правильно (для будущих сборок тоже)',
    ],
  },
  {
    version: 'v2.45.156',
    date: '08.06.2026',
    title: 'Отгрузка по QR списывает со склада',
    features: [
      'Теперь отгрузка по QR-коду (сборки или короба) <b>списывает изделия со склада</b> и снимает резерв — раньше это делала только кнопка «Произвести отгрузку», а скан только отмечал факт',
      'Короб при сканировании списывает все сборки, которые в нём лежат',
      '<b>Откат отгрузки</b> (по одной записи или сброс всех) возвращает изделия обратно на склад',
      'Уже отгруженное ранее (до этого обновления) не пересчитывается — при необходимости откатите и отгрузите заново, либо поправьте остаток вручную',
    ],
  },
  {
    version: 'v2.45.155',
    date: '08.06.2026',
    title: 'Пуш директору по всем событиям колокольчика',
    features: [
      'Теперь <b>директору</b> приходит пуш на телефон по <b>любому</b> событию, которое падает в колокольчик: новый договор, новая сборка, замечание и сообщения по нему, сообщения/файлы в разработке, Фото УПД, счета и пр.',
      'Чтобы пуши приходили — один раз нажмите <b>📱</b> в шапке панели уведомлений на своём телефоне (подписка привязана к устройству)',
      'Дубля по счетам нет: счёт от поставщика по-прежнему пушится директору и бухгалтеру одним сообщением',
    ],
  },
  {
    version: 'v2.45.154',
    date: '08.06.2026',
    title: 'Пароль на публичные QR-коды',
    features: [
      'Теперь любой публичный QR (договора, короба, сборки) открывается «с улицы» <b>только по паролю</b>, который высылают получателю — посторонний по ссылке ничего не увидит',
      'Пароль <b>один на договор</b> (6 цифр) и открывает все его коды. Виден в окне <b>QR-кода договора</b> — там же кнопки «Копировать» и «Перевыпустить»',
      'Сотрудники в CRM пароль не вводят — сканер внутри приложения работает как раньше',
      'Введённый получателем пароль запоминается, чтобы не вводить его при каждом сканировании',
    ],
  },
  {
    version: 'v2.45.153',
    date: '08.06.2026',
    title: 'Подтверждение завершения работы + порядок в загрузке сборщиков',
    features: [
      'При нажатии <b>«Готово»/«Сделано»</b> на работе теперь спрашивается подтверждение — чтобы не завершить случайно',
      'Блок <b>«Загрузка сборщиков»</b> на телефоне больше не «рассыпается»: имя и статус сверху, шкала загрузки снизу — ровно и читаемо',
      'Раздел переименован во «Входящие счета от поставщиков»',
    ],
  },
  {
    version: 'v2.45.152',
    date: '08.06.2026',
    title: 'Каталог закупок — чище список',
    features: [
      'Из списка <b>«Каталог закупок»</b> убрана строка-«россыпь» под позициями (НС-код · категория · подкатегория) — список стал чище. Сам комментарий остался в карточке позиции',
    ],
  },
  {
    version: 'v2.45.151',
    date: '08.06.2026',
    title: 'Счётчики на вкладках заказов поставщикам',
    features: [
      'На вкладках статусов в «Заказы поставщикам» появились <b>счётчики</b> — сразу видно, сколько заказов «К оплате», «Ждут счёт», «Оплачены» и т.д.',
    ],
  },
  {
    version: 'v2.45.148',
    date: '08.06.2026',
    title: 'Пуш-уведомления на телефон (приход счёта)',
    features: [
      'Появились <b>пуш-уведомления на телефон</b>: в колокольчике — иконка 📱, нажми её один раз, разреши уведомления — и телефон будет пикать',
      'Сейчас пуш приходит <b>директору и бухгалтеру, когда поступает счёт</b> от поставщика (на оплату)',
      'Включать нужно на каждом телефоне отдельно (один раз). На iPhone работает только если приложение добавлено на экран «Домой»',
    ],
  },
  {
    version: 'v2.45.147',
    date: '08.06.2026',
    title: 'QR договора — печать на термопринтер',
    features: [
      'В окне <b>QR-кода договора</b> (и доработки) теперь есть кнопка <b>«🖨 На термопринтер»</b> — раньше она была только у сборки и коробки',
      'Печатается без требования спец-права (как и для коробки/сборки) — наклейку клеят прямо на складе',
    ],
  },
  {
    version: 'v2.45.146',
    date: '08.06.2026',
    title: 'Отгрузка — только по паролю',
    features: [
      '<b>«Отгрузить по договору»</b> (массовая) теперь требует подтверждения <b>личным паролём</b>',
      '<b>«Отгрузка по QR»</b>: перед запуском сканера тоже спрашивается личный пароль — без него сканирование не начнётся',
      'Если у сотрудника пароль не задан — отгрузка работает как раньше (легаси)',
    ],
  },
  {
    version: 'v2.45.145',
    date: '08.06.2026',
    title: 'Отгрузка по QR — починена логика подтверждения',
    features: [
      'Исправлено: при сканировании имя позиции показывалось как «Позиция», а уже отгружённый код предлагал отгрузить повторно',
      'Теперь при наведении видно <b>название позиции</b>; если код <b>уже отгружён</b> (в т.ч. в составе короба) — пишет «Уже отгружено», а не предлагает кнопку',
      'Кнопка «Отгрузить» теперь реально отрабатывает и обновляет счётчик сразу',
    ],
  },
  {
    version: 'v2.45.144',
    date: '08.06.2026',
    title: 'Кнопка «Обновить» в блоке отгрузки',
    features: [
      'В блоке <b>«Отгрузка по QR»</b> на странице договора добавлена кнопка <b>«Обновить»</b> — нажал и сразу видишь актуальный прогресс (X/Y), статус коробов и сборок после сканирования, без перезагрузки страницы',
    ],
  },
  {
    version: 'v2.45.143',
    date: '08.06.2026',
    title: 'Короб в отгрузке подтягивает содержимое',
    features: [
      'Исправлено: короб, упакованный <b>из спецификации</b>, показывал «0 сборок» и не подтягивал содержимое. Теперь короб правильно связывает свои позиции со сборками (через модель) — отгрузка короба отгружает все его сборки',
      'Если навести код сборки, которая уже отгружена <b>в составе короба</b> — система напишет «уже отгружено», а не предложит отгрузить повторно',
      'Хранилище файлов счетов/УПД переведено на постоянный диск (Railway Volume) — файлы больше не пропадают при обновлениях',
    ],
  },
  {
    version: 'v2.45.142',
    date: '08.06.2026',
    title: 'Откат отгрузки по QR (под паролем)',
    features: [
      'В блоке <b>«Отгрузка по QR»</b> появилась кнопка <b>«Откатить отгрузку»</b> — снимает все отметки об отгрузке, счётчик возвращается к 0',
      'Откат требует <b>подтверждения личным паролём</b> (как смена статуса) и пишется в журнал договора',
      'Если договор был «Отгружен» / «Отгружен частично» — после отката возвращается в «Готов к отгрузке»',
    ],
  },
  {
    version: 'v2.45.141',
    date: '08.06.2026',
    title: 'Приёмка УПД: массовый раздел + память по поставщику',
    features: [
      'В приёмке УПД можно <b>выбрать несколько позиций и разом задать раздел</b> (например, «Сантехника») — в нижней панели выбора рядом с «Перенести в» появился выбор раздела и кнопка «Задать раздел»',
      'Система теперь <b>учится по истории поставщика</b>: если раньше его позиции уже клали в «Сантехника», новые непривязанные позиции по умолчанию пойдут туда же (раньше училось только по подтверждённым связкам, теперь — и по прошлым УПД, по ИНН или имени поставщика)',
      'Это работает для позиций, которые создаются как новые. Позиции с «N вариантов» — это совпадения с уже существующими карточками, у них раздел берётся от выбранной карточки',
    ],
  },
  {
    version: 'v2.45.140',
    date: '08.06.2026',
    title: 'Уведомления: фото УПД и приход счёта',
    features: [
      'Когда кто-то сделал <b>Фото УПД</b> — в колокольчике появляется уведомление «Сделано фото УПД» (директор и бухгалтер видят, кто и что загрузил)',
      'Когда по почте <b>пришёл счёт</b> и не привязался к заказу автоматически — уведомление «Пришёл счёт (нужна привязка)». Привязанные счета уведомляли и раньше',
      'Клик по уведомлению открывает нужный раздел: «Приёмка УПД», «Заказы» или «Входящие счета»',
    ],
  },
  {
    version: 'v2.45.139',
    date: '08.06.2026',
    title: 'Отгрузка коробом — скан короба отгружает все его сборки',
    features: [
      'В списке отгрузки сборки, упакованные в короб, больше не дублируются: показывается <b>«Короб №1 · N сборок»</b> + сборки, которые в короб не клали',
      'Сканируешь QR короба → подтверждаешь → <b>все его сборки отгружаются разом</b>, счётчик прыгает на N (например, было 0/7, отгрузил короб с 3 сборками → 3/7)',
      'Счётчик отгрузки теперь считает <b>сборки-позиции</b>, а не короба отдельной единицей. Покупные позиции в коробе в счёт отгрузки не идут',
    ],
  },
  {
    version: 'v2.45.138',
    date: '08.06.2026',
    title: 'Сброс отгрузки при возврате статуса + русская история',
    features: [
      'Если вернуть договор из «Отгружен частично» в <b>«Готов к отгрузке»</b> (или «В производстве») — прогресс <b>«Отгрузка по QR» обнуляется</b> (был баг: счётчик оставался 3/8)',
      'В <b>«Истории изменений»</b> убраны английские слова: статусы и действия теперь по-русски («Статус: отгружен частично → готов к отгрузке», «Пересборка резервов» и т.п.)',
    ],
  },
  {
    version: 'v2.45.137',
    date: '08.06.2026',
    title: 'Отгрузка по QR — подтверждение перед списанием',
    features: [
      'При сканировании на отгрузку теперь сначала появляется зелёная плашка <b>«Совпадает по договору»</b> с названием позиции и кнопкой <b>«Отгрузить»</b> — позиция уходит только после нажатия',
      'Это страхует от случайной отгрузки не той позиции: навёл → проверил → отгрузил → наводишь следующую',
      'Если позиция из другого договора или уже отгружена — плашка не появится, покажется ошибка',
      'Счётчик «X из 8» работает как раньше, в конце видно сколько отгружено',
    ],
  },
  {
    version: 'v2.45.136',
    date: '08.06.2026',
    title: 'QR коробки — печать на термопринтер прямо из модалки',
    features: [
      'В окне <b>QR-кода коробки</b> (и сборки) теперь есть кнопка <b>«🖨 На термопринтер»</b> — наклейка уходит в очередь офисного термопринтера сразу, не нужно открывать отдельную печать',
      'Раньше эта кнопка требовала особое право и не показывалась на упаковке/складе — теперь для коробок и сборок доступна так же, как обычная «Печать наклейки»',
    ],
  },
  {
    version: 'v2.45.135',
    date: '08.06.2026',
    title: 'В превью заказа можно удалить позицию',
    features: [
      'В окне <b>«Сформировать заказ»</b> у каждой позиции появилась корзина 🗑 — можно <b>убрать лишнюю позицию</b> прямо перед отправкой (например, заказать только часть из группы)',
      'После удаления текст письма и вложение DOCX пересобираются автоматически',
      'Последнюю позицию удалить нельзя — если заказ не нужен совсем, жми «Отмена»',
    ],
  },
  {
    version: 'v2.45.134',
    date: '08.06.2026',
    title: 'Печать QR на все — теперь и на покупные позиции',
    features: [
      'Кнопка <b>«Печать QR на все»</b> теперь печатает наклейки не только на сборки, но и на <b>покупные позиции в резерве</b> (кронштейны, пластины и т.п.) — выходят автоматом',
      'Счётчик на кнопке и в плашке «Готово на складе» больше не «отстаёт»: раньше он считался до загрузки спецификации и показывал только сборки. Теперь обновляется как спецификация загрузилась',
      'Печать берёт <b>свежий список позиций с сервера</b> — даже если нажать сразу после открытия договора, кронштейны не потеряются',
    ],
  },
  {
    version: 'v2.45.133',
    date: '08.06.2026',
    title: 'Готовность договора: покупное видно отдельно',
    features: [
      'В плашке <b>«Готово на складе»</b> теперь второй строкой показывается <b>«+ N покупных в резерве»</b> — покупные комплектующие резервируются со склада и не считаются сборками',
      'Раньше это путало: например, в спецификации 8 зелёных «В резерве», а «сборок» 7 — разница как раз и есть покупное (его собирать не нужно). Теперь полная картина видна сразу',
    ],
  },
  {
    version: 'v2.45.132',
    date: '08.06.2026',
    title: 'Список закупки — аккуратный вид на телефоне',
    features: [
      'Раздел <b>«Что закупить»</b> на телефоне больше не «разъезжается»: позиции теперь показываются <b>ровными карточками</b> вместо широкой таблицы',
      'В каждой карточке: слева галочка, сверху название и количество к заказу, ниже — артикул, «остаток/мин» и причина, а кнопка <b>«Поставщик»</b> растянута на всю ширину',
      'На компьютере вид прежний (таблица) — изменения только для узких экранов',
    ],
  },
  {
    version: 'v2.45.131',
    date: '08.06.2026',
    title: 'Упаковочный лист и подпись в письмах поставщикам',
    features: [
      'В <b>упаковочном листе</b> убран QR-код — лист стал чище, место под подписи шире',
      'Строка «Упаковал (подпись)» больше <b>не подставляет имя</b> автоматически — пустая линия, расписываются от руки',
      'Исправлено <b>задвоение «№ №»</b> в номере договора (было «к договору № №06ТД/04.26» → стало «к договору № 06ТД/04.26»). Поправлено и в карточке коробки',
      'В письме поставщику подпись теперь содержит <b>имя директора и телефон</b> («С уважением, Подкорытов Дмитрий … Тел.: …») — раньше для директора подставлялось только название компании',
    ],
  },
  {
    version: 'v2.45.129',
    date: '05.06.2026',
    title: '3D-схемы и цветные выноски в калькуляторе',
    features: [
      'В разделе <b>«Производство»</b> появился новый пункт <b>«3D-схемы»</b> — здесь живут интерактивные модели агрегатов (Атомбриз 1, Чиллер). Открываются в новой вкладке',
      'В калькуляторе холода подписи стен (А-1, Б-2, А-3, Б-4, Потолок, Дверь) теперь — <b>цветные выноски снаружи камеры</b>: больше не пересекаются с дверью и не мешают читать схему',
      'У каждой стороны свой цвет (А-1 синяя, Б-2 оранжевая, А-3 фиолетовая, Б-4 зелёная, потолок бирюзовый, дверь коричневая) — легко сопоставить с вкладками «Стены»',
    ],
  },
  {
    version: 'v2.45.105',
    date: '05.06.2026',
    title: 'Калькулятор холода: погрузчики, воздухообмен, схема в PDF',
    features: [
      'На вкладке <b>«Люди/свет/двигатели»</b> добавлены поля: <b>Погрузчики (шт.)</b>, <b>Часов в сутки</b>, <b>Тепло от 1 погрузчика, кВт</b> (по умолчанию 4) и <b>Воздухообмен, раз/сутки</b>',
      'Погрузчики добавлены в Q5; вентиляция — отдельный <b>Q-вент.</b> в разбивке (показывается только если есть)',
      'В печатном отчёте (PDF) теперь рисуется <b>схема камеры</b> (план + разрез) — попадает на печать',
      'Из PDF убраны строки <b>«Работа оборудования, ч/сут»</b> в условиях и в подписи под итогом — больше не печатается',
      'Поле «Открыта в сутки, мин» переименовано в более понятное <b>«Открытие двери в сутки, мин»</b>',
      'Схема в SVG расширена с 520→640 px по горизонтали, имена изоляции сокращаются («Пенополиуретан» → «PIR») — длинные подписи больше не выходят за края',
    ],
  },
  {
    version: 'v2.45.104',
    date: '05.06.2026',
    title: 'Кнопка печати QR — у любой позиции в резерве',
    features: [
      'Раньше иконка 🖨 печати QR появлялась только у компонентных позиций. Теперь — у <b>любой позиции</b> со статусом «В резерве» (модели, балки, кронштейны и т.д.)',
      'Имя берётся в порядке: <code>component_name → model_name → sale_product_name → name</code> — подойдёт для всех типов спецификаций',
      'Печатается qty этикеток с подписью «Дог.№X · Имя · 1 шт/комплект»',
    ],
  },
  {
    version: 'v2.45.103',
    date: '05.06.2026',
    title: 'Калькулятор холода: визуальная схема камеры',
    features: [
      'На вкладке <b>«Камера»</b> под полями размеров теперь рисуется <b>SVG-схема</b>: план сверху (вид сверху, 4 стены с цветными паттернами материалов и подписями «А-1», «Б-2», «А-3», «Б-4» с длинами) + разрез сбоку (с высотой H и подписью пола/потолка с типом изоляции)',
      'Цветовые паттерны разных материалов: <b>кирпич</b> 🟥 (узор кирпичной кладки), <b>сэндвич</b> 🟦 (серая панель с полосками), <b>бетон/железобетон</b> ⚫ (точки), <b>дерево</b> 🟫 (горизонтальные полоски), <b>пеноблок/шлакоблок/инсиблок</b> ⬜ (крупная блочная сетка)',
      'Схема автоматически обновляется при изменении размеров — длина сторон, высота, площадь и объём пересчитываются на лету',
      'Поля размеров переименованы: «Сторона А-1 / Б-2 / А-3 / Б-4» — соответствуют подписям на схеме',
    ],
  },
  {
    version: 'v2.45.102',
    date: '05.06.2026',
    title: 'Карточка сборки: корректные «Готово» и «Исполнение»',
    features: [
      'Статус сборки «готова» заменён на нейтральное <b>«готово»</b> — подходит и к «Наружный блок» (м.р.), и к «Сборка» (ж.р.), и к «Изделие» (с.р.)',
      'Поле <b>«Исполнение»</b> в карточке сборки теперь читается из самой модели: для воздухоохладителя с выбранной нержавейкой пишет <b>«Нерж. AISI»</b> (а не «Обычное»), для щита с fixed «Стандарт» пишет именно <b>«Стандарт»</b>',
      'Соответствует ярлыкам которые директор задаёт в модели — exec_label_st / exec_label_ne',
    ],
  },
  {
    version: 'v2.45.100',
    date: '05.06.2026',
    title: 'Печать QR на комплектующие — по этикетке на каждый комплект',
    features: [
      'Если в позиции 2 кронштейна (комплекта) — печатается <b>2 этикетки</b>, на каждой написано <code>Дог.№X · Кронштейн 450 (комплект) · 1 комплект</code>',
      'Единица учитывается из имени/поля unit: «комплект», «упак.», «пара», «м» или дефолт «шт»',
      'То же поведение и для одиночной печати (иконка 🖨 у позиции), и для batch-печати «Печать QR на все»',
      'Счётчик на кнопке теперь показывает сумму комплектов, не позиций: «(8: 7 сбор. · 2 компл.)» — где «2 компл.» это сумма qty по компонентам, а не число позиций',
    ],
  },
  {
    version: 'v2.45.98',
    date: '05.06.2026',
    title: 'Калькулятор холода: ограждения в PDF + новые материалы стен',
    features: [
      'В печатном отчёте калькулятора добавлена таблица <b>«Ограждения: материал, теплоизоляция, t° снаружи»</b> — для каждой стены, пола и потолка видно конструкцию, тип утеплителя, толщину изоляции в мм, длину и температуру снаружи',
      'В список материалов стен добавлены <b>Пеноблок (газобетон)</b>, <b>Шлакоблок</b>, <b>Инсиблок (арболит)</b> со стандартными значениями λ — теперь можно выбрать в выпадашке во вкладке «Стены/изоляция»',
    ],
  },
  {
    version: 'v2.45.97',
    date: '05.06.2026',
    title: 'Печать QR прямо из позиции спецификации',
    features: [
      'У component-позиций в резерве (например, «Кронштейн 450») в правом блоке actions появилась иконка <i class="ti ti-printer"></i> — печать QR одной этикетки',
      'Подтверждение показывает что напечатается: <code>Дог.№X · Имя позиции · N шт</code>',
      'Один клик — задание уходит в очередь шлюза. На физическую коробку с этой позицией клеишь QR договора',
    ],
  },
  {
    version: 'v2.45.96',
    date: '05.06.2026',
    title: 'Калькулятор холода: печать и сохранение в PDF',
    features: [
      'Во вкладке <b>«Результат»</b> появилась кнопка <b>«Печать / PDF»</b> рядом с «Сохранить расчёт»',
      'Открывается новое окно с готовым к печати отчётом: шапка ATOMUS group, данные клиента, параметры камеры, продукта, условий, разбивка теплопритоков и итоговая мощность',
      'Системный диалог печати запускается автоматически — выбери реальный принтер или «Сохранить как PDF» / «Microsoft Print to PDF» для файла',
      'Если браузер блокирует всплывающее окно — разреши попап для этого сайта и попробуй снова',
    ],
  },
  {
    version: 'v2.45.95',
    date: '05.06.2026',
    title: 'Пакетная печать QR теперь включает комплектующие в резерве',
    features: [
      'Раньше «🖨 Печать QR на все готовые» печатала только сборки. Теперь — и комплектующие (кронштейны, пластины и т.п.), которые «В резерве»',
      'Кнопка обновлена: <b>«🖨 Печать QR на все (N: M сбор. · K компл.)»</b>',
      'На комплектующие приходит QR договора с подписью <code>Дог.№ · Имя позиции · N шт</code> — клеишь на коробку, при сканировании открывается карточка договора',
    ],
  },
  {
    version: 'v2.45.94',
    date: '05.06.2026',
    title: 'Кнопка «Зарезервировать со склада» для комплектующих',
    features: [
      'Если позиция спецификации привязана к комплектующему (бейдж «комплектующее»), а статус показывает «К закупке» — значит резерв не оформился. Рядом появилась кнопка <b>«Зарезервировать»</b> (<i class="ti ti-package-import"></i>)',
      'Один клик — система пересоздаёт резервы для всего договора: для каждой компонент-позиции забирает доступное со склада (с учётом резервов других договоров) и оформляет <code>component_reservation</code>',
      'Полезно когда на складе кронштейны/пластины есть, но в спецификации висит «К закупке» — система просто не успела зарезервировать при добавлении позиции',
    ],
  },
  {
    version: 'v2.45.93',
    date: '05.06.2026',
    title: 'Печать QR на все готовые сборки договора',
    features: [
      'В карточке договора, если есть готовые сборки на складе, под кнопкой «Отгрузить по договору» появилась <b>«🖨 Печать QR на все готовые (N)»</b>',
      'Один клик — система получает токены всех готовых сборок и отправляет в очередь шлюза термопринтера N заданий. Дальше идёшь к принтеру и клеишь — не нужно открывать каждую сборку',
      'Если шлюз сейчас оффлайн — задания подождут в очереди и напечатаются как только он вернётся',
      'Тост покажет сколько заданий ушло успешно (например «📤 Отправлено 7 QR-наклеек в очередь»)',
    ],
  },
  {
    version: 'v2.45.91',
    date: '05.06.2026',
    title: 'Калькулятор холода: кнопка «Рассчитать» и автосохранение',
    features: [
      'На ноутбуках 1366×768 кнопка <b>«Рассчитать»</b> уезжала за низ экрана — фикс высоты модалки, теперь всегда видна',
      'Все введённые данные <b>автоматически сохраняются в браузере</b>: обновишь страницу или закроешь вкладку — при следующем открытии калькулятор откроется с теми же значениями (на той же вкладке)',
      'Сохраняется не только форма, но и последний результат расчёта',
      'При нажатии «Сброс» черновик очищается',
    ],
  },
  {
    version: 'v2.45.90',
    date: '05.06.2026',
    title: 'Сверка склада: Excel-выгрузка по BOM активных работ',
    features: [
      'В <b>Номенклатуре оборудования</b> рядом с кнопкой «Excel» появилась <b>«Сверка склада»</b>',
      'Жмёшь → скачивается XLSX с колонками <i>Категория, Артикул, Название, Нужно, На складе, Дефицит, Ед., Статус</i>',
      'Цветовая раскраска: 🟥 красный — нужны, но <b>на складе 0</b>; 🟨 жёлтый — есть, но не хватает; 🟩 зелёный — закрыто планом; без заливки — не используется в текущих работах',
      'Колонка «Нужно» — сумма qty по BOM всех работ со статусом «В очереди» / «В работе»',
      'Второй лист «Сводка» — счётчики по категориям (нет в наличии, не хватает, в наличии, не используется) — для общего понимания состояния',
    ],
  },
  {
    version: 'v2.45.88',
    date: '05.06.2026',
    title: 'Кнопка «Стоп» в Загрузке сборщиков',
    features: [
      'У каждого сотрудника с пометкой <b>«СЕЙЧАС»</b> справа появилась красная кнопка <i class="ti ti-player-stop"></i> — снять с текущей помощи/батча',
      'Подтверждение показывает имя сотрудника, операцию и размер батча: «Шевелев · Операция: дверки · Батч: 3 сборок (часы поделятся поровну)»',
      'Отработанные часы записываются в журнал по каждой сборке; для батча — поделятся между всеми',
    ],
  },
  {
    version: 'v2.45.87',
    date: '05.06.2026',
    title: 'Батч-помощь: видно «чем занят» сотрудник',
    features: [
      'В модалке <b>«Батч-помощь»</b> рядом с выбором сотрудника появилось поле <b>«Что делает»</b> (например, «дверки», «сварка»)',
      'В блоке <b>«Загрузка сборщиков»</b> у того, кто помечен «СЕЙЧАС», теперь видна строка <code>🔨 дверки ×3 · Atom-BBAS</code> — операция, размер батча и первая сборка',
      'В подсказке (наведение) дополнительно: «Прямо сейчас: дверки (батч ×3)» + полный список работ',
      'При остановке таймера операция попадает в начало <i>note</i> каждой записи журнала: <code>дверки [батч ×3, всего 1ч]</code>',
    ],
  },
  {
    version: 'v2.45.85',
    date: '05.06.2026',
    title: 'Категория в форме «Новая модель»',
    features: [
      'В форме <b>«Новая модель»</b> после подгруппы появилось поле <b>«Категория»</b>',
      'Список фильтруется по выбранной подгруппе (например, в «Донагревателях» появятся «Балка монтажная» и другие)',
      'Рядом с лейблом кнопка <b>«+ Новая»</b> — создать категорию прямо отсюда и сразу её выбрать',
      'Категория опциональна — если не выбрана, модель привязывается просто к подгруппе',
    ],
  },
  {
    version: 'v2.45.84',
    date: '05.06.2026',
    title: 'Батч-помощь: один сотрудник делает операцию на N сборок',
    features: [
      'В блоке <b>«Загрузка сборщиков»</b> появилась кнопка <i class="ti ti-users-group"></i> <b>«Батч-помощь»</b>',
      'Выбираешь сотрудника + чекбоксами 2 и более сборок (например, дверки сразу на 3 чиллера) → жмёшь «Стартовать батч». У сотрудника тикает один общий таймер',
      'При остановке («Готово»/«Сменить») часы делятся <b>поровну</b> между всеми сборками батча и пишутся отдельными записями в журнал каждой сборки',
      'У каждой записи в журнале появляется пометка <code>[батч ×N, всего Hч]</code> — видно что время разделено',
      'Если у сотрудника уже была активна другая помощь — она автоматически закрывается и записывается, как обычно',
    ],
  },
  {
    version: 'v2.45.83',
    date: '04.06.2026',
    title: 'Кнопка «Новая задача» на мобильной',
    features: [
      'Под фильтрами/переключателем «Список/Доска» появилась синяя кнопка <b>«+ Новая задача»</b> во всю ширину — нажать сложно мимо',
      'Дополнительно в правом верхнем углу (рядом с обновить) есть иконка <i class="ti ti-plus"></i> — для тех, кто привык к компактному виду',
    ],
  },
  {
    version: 'v2.45.82',
    date: '04.06.2026',
    title: 'Редактор этикеток: «Печать на термопринтер» на мобильной',
    features: [
      'Раньше кнопки внизу редактора этикеток уезжали вправо и <b>«Печать на термопринтер»</b> терялась за горизонтальным скроллом',
      'Теперь футер на мобильной — сетка 2×N: Сброс/Сохранить шаблон/PNG/ZPL парами, а главная синяя <b>«Печать на термопринтер»</b> внизу во всю ширину',
      'Учтён <code>safe-area-inset-bottom</code> — кнопка не залезает под нижнюю системную полоску',
    ],
  },
  {
    version: 'v2.45.81',
    date: '04.06.2026',
    title: 'Задачи: чистый мобильный список',
    features: [
      'На мобильной фильтры задач (Открытые / Новые / В работе / Готовые / Все) теперь идут одной строкой с горизонтальным скроллом — больше не разваливаются в столбец',
      'Кнопки <b>Список / Доска</b> вынесены в отдельную полосу под фильтрами, во всю ширину',
      'Убрана задвоенная плюс-кнопка (плавающая «+» внизу справа) — оставили только «+» в центральной таб-баре',
      'Скрыт desktop-заголовок «Задачи» на мобильной — он дублировал название в шапке',
    ],
  },
  {
    version: 'v2.45.80',
    date: '04.06.2026',
    title: 'Голосовой ввод в задачах',
    features: [
      'В форме «Новая задача» рядом с полями <b>«Название»</b> и <b>«Описание»</b> появилась кнопка-микрофон <i class="ti ti-microphone"></i>',
      'Жмёшь → даёшь разрешение на микрофон (первый раз) → говоришь — текст автоматически появляется в поле',
      'Повторное нажатие на микрофон останавливает запись. Распознанное добавляется к тому, что было — не затирает',
      'Работает в Chrome и Edge (Web Speech API, бесплатно, без обращения к внешним сервисам). В Safari/iOS — недоступно',
      'Можно надиктовать сразу несколько фраз подряд (continuous mode), включая запятые и числа («встреча с Иваном завтра в четырнадцать ноль ноль»)',
    ],
  },
  {
    version: 'v2.45.79',
    date: '04.06.2026',
    title: 'Звук уведомлений',
    features: [
      'Когда приходит новое уведомление — короткий «бим-бом» (две ноты, ~370 мс)',
      'В шапке панели колокольчика появилась кнопка-динамик: <i class="ti ti-volume"></i> — клик включает/выключает звук, настройка сохраняется в браузере',
      'Звук играется только на действительно новых уведомлениях (не на первой загрузке после логина), и не дублируется в фокусированных формах создания',
      'При первом включении проигрывается короткая демонстрация',
    ],
  },
  {
    version: 'v2.45.76',
    date: '04.06.2026',
    title: 'Админ-инструмент «Массовая замена текста»',
    features: [
      'В <b>Снабжение → Админ-инструменты</b> добавился инструмент <b>«Замена текста»</b>',
      'Вписываешь «Найти» и «Заменить на», выбираешь где искать (название/артикул моделей, имена подгрупп/категорий, имя/sku компонентов) → Предпросмотр → Заменить',
      'Пример: <code>НПВ</code> → <code>НВП</code> по полям «Модели — название» и «Модели — артикул» переписывает оба поля у всех моделей',
      'UNIQUE-коллизии для артикула модели попадают в «пропущенные», ничего не ломается',
    ],
  },
  {
    version: 'v2.45.75',
    date: '04.06.2026',
    title: 'Переименование категории каталога + цветовая тема «нержавейка»',
    features: [
      'У каждой категории внутри подгруппы появилась кнопка-карандашик — переименовать без захода в админку',
      'Если в имени категории есть «нерж» или «AISI» — она автоматически окрашивается в розово-стальную тему (как «Нерж. AISI» в моделях). Пример: переименуй «Воздухоохладители доработанные» в «Воздухоохладители из нержавеющей стали» — цвет поменяется сам',
      'Цветовая тема работает и для подгрупп, и теперь для категорий',
    ],
  },
  {
    version: 'v2.45.74',
    date: '04.06.2026',
    title: 'Исправлены «двойники» моделей в каталоге',
    features: [
      'Модели, у которых одновременно проставлены и подгруппа, и категория (как у моделей, созданных через «Перенос → Номенклатура производства»), отображались в списке дважды',
      'Бэк теперь дедуплицирует моделей по id перед отдачей — каждая модель показывается ровно один раз',
    ],
  },
  {
    version: 'v2.45.73',
    date: '04.06.2026',
    title: 'Перезапись артикула удалённой модели при пересоздании',
    features: [
      'Когда создаёшь модель через «Перенос → Номенклатура производства» и артикул уже занят <i>удалённой</i> моделью — старой модели автоматически добавляется метка <code>.deleted-N</code>, а артикул переходит к новой',
      'Это снимает блокировку, когда сначала создал модели с ошибкой → удалил → пытаешься пересоздать с тем же артикулом. Сборки старой модели сохраняются в истории',
      'Если артикул занят <i>активной</i> моделью — по-прежнему попадает в «пропущенные»',
    ],
  },
  {
    version: 'v2.45.72',
    date: '04.06.2026',
    title: 'Удаление модели из каталога',
    features: [
      'В карточке модели рядом с «Изменить модель» появилась кнопка <b>«Удалить модель»</b> (красная, видна директору и заму)',
      'Это <i>мягкое</i> удаление: модель деактивируется и пропадает из каталога/поиска, но <b>сборки и история по ней сохраняются</b> — старые работы можно открыть',
      'Полезно когда модели создались неправильно (например, через «Перенос компонентов → модели» с ошибочными артикулами) — можно удалить и пересоздать',
    ],
  },
  {
    version: 'v2.45.71',
    date: '04.06.2026',
    title: 'Создание моделей: artikul из имени, если sku пустой',
    features: [
      'Если у компонента не заполнен sku (как у воздухоохладителей со склада) — артикул новой модели формируется из имени',
      'Правило: всё после последней закрывающей скобки в имени → артикул. Пример: «Воздухоохладитель (теплообменник) BS-TEF 027M 45» → артикул <code>BS-TEF 027M 45</code>, плюс суффикс <code>-ДБ</code>',
      'Превью в строке компонента показывает будущий артикул заранее',
    ],
  },
  {
    version: 'v2.45.70',
    date: '04.06.2026',
    title: 'Перенос компонентов: копирование в номенклатуру производства',
    features: [
      'В «Перенос компонентов» добавлен переключатель <b>Куда</b>: «Комплектующие» (как было) или <b>«Номенклатура производства»</b>',
      'В режиме «Номенклатура производства» появляются селекторы <b>Направление → Подгруппа → Категория</b> каталога моделей',
      'Жмёшь <b>«Создать модели»</b> — выбранные компоненты создаются как модели в каталоге производства, артикул = sku компонента + суффикс (например <code>-ДБ</code>). Оригиналы остаются на складе',
      'По умолчанию исходный компонент сразу добавляется первой строкой в BOM новой модели (галочка «Добавить компонент в BOM») — модель сразу готова к сборке',
      'Артикул модели уникален: коллизии (например, если такая модель уже есть) попадают в «пропущенные»',
    ],
  },
  {
    version: 'v2.45.69',
    date: '04.06.2026',
    title: 'Перенос компонентов: режим «Скопировать» и «Снять суффикс»',
    features: [
      'В модалке «Перенос компонентов» появился переключатель режима: <b>Перенести</b> (как раньше — оригинал пропадает) или <b>Скопировать</b> (создаёт дубль в целевой категории, оригиналы остаются на месте)',
      'Добавлено поле <b>«Снять суффикс»</b> — нужно для отката. Если случайно перенёс с <code>-ДБ</code> — ставишь источник «доработанные», цель — исходная категория, «Снять суффикс» = <code>-ДБ</code>, и всё возвращается',
      'Сначала снимается «снять», потом дописывается «добавить». Это позволяет в одном проходе и убрать старый суффикс, и поставить новый',
      'В режиме «Скопировать» новый артикул обязан отличаться от исходного — иначе компонент попадёт в «пропущенные» (защита от ловушки <code>UNIQUE sku</code>)',
    ],
  },
  {
    version: 'v2.45.68',
    date: '04.06.2026',
    title: 'Перенос компонентов: создать категорию прямо из модалки',
    features: [
      'В инструменте «Перенос компонентов» рядом с лейблом «Куда» появилась кнопка <b>«+ Новая»</b>',
      'Жмёшь → вводишь имя (например, «Воздухоохладители доработанные») → новая категория компонентов создаётся и сразу выбирается как целевая. Не нужно отдельно лезть в справочник',
    ],
  },
  {
    version: 'v2.45.67',
    date: '04.06.2026',
    title: 'Админ-инструменты: «Перенос компонентов»',
    features: [
      'Новый инструмент в <b>Снабжение → Админ-инструменты</b> — массовый перенос компонентов между категориями',
      'Выбираешь исходную категорию (например «Климатика») → отмечаешь чекбоксами нужные позиции (поиск работает) → выбираешь целевую категорию (например «Воздухоохладители») → опционально вписываешь суффикс артикула (например <code>-ДБ</code>)',
      'Превью показывает <b>будущий артикул</b> для каждой строки прямо в списке. Уникальность артикулов проверяется на бэке, конфликты в «пропущенных»',
    ],
  },
  {
    version: 'v2.45.66',
    date: '04.06.2026',
    title: 'Каталог: новая категория сразу видна как пустая ветка',
    features: [
      'Кнопка <b>«+ Категория»</b> в шапке подгруппы теперь привязывает новую категорию к этой подгруппе — пустая ветка появляется внутри сразу после создания, не нужно сначала привязывать модель',
      'Починили также вёрстку — кнопка «+ Категория» больше не выпадает под шапку (была невалидная вложенность button-в-button)',
    ],
  },
  {
    version: 'v2.45.65',
    date: '04.06.2026',
    title: 'Каталог: «+ Категория» прямо в шапке подгруппы',
    features: [
      'В шапке каждой подгруппы каталога (Воздухоохладители, Донагреватели и т.д.) появилась кнопка <b>«+ Категория»</b> — только для директора',
      'Жмёшь → вводишь имя (например, «Воздухоохладители доработанные») → категория создаётся в направлении и сразу видна как пустая ветка внутри подгруппы',
      'Дальше у моделей можно проставить эту категорию руками (или через bulk-инструменты)',
    ],
  },
  {
    version: 'v2.45.63',
    date: '04.06.2026',
    title: 'Каталог: «Структура», «Импорт BOM» — в Админ-инструменты',
    features: [
      'Из шапки «Номенклатура оборудования» убраны редко-кликаемые админские кнопки: <b>Структура Климатики</b>, <b>Структура Щитов</b>, <b>Импорт BOM</b>',
      'Они переехали в <b>Снабжение → Админ-инструменты</b> (под паролем директора) — там теперь 7 карточек',
      'В шапке остались только повседневные: <b>Excel</b>, <b>Новый раздел</b>, <b>Новая модель</b>',
    ],
  },
  {
    version: 'v2.45.62',
    date: '04.06.2026',
    title: 'Колокольчик: «Очистить всё» одним кликом',
    features: [
      'Клик на колокольчик в шапке открывает выпадашку уведомлений; в её шапке теперь кнопка <b>«Очистить всё»</b> — отмечает все уведомления прочитанными разом',
      'Раньше кнопка была только в авто-модалке (которая всплывает сама при новых уведомлениях). Теперь и здесь',
    ],
  },
  {
    version: 'v2.45.61',
    date: '04.06.2026',
    title: 'Красный значок уведомлений: новый стиль',
    features: [
      'Красный счётчик на колокольчике получил <b>градиент и свечение</b> вместо плоского красного квадрата. Цифры читаются чище (tabular-nums)',
      'При появлении нового уведомления или изменении счёта — лёгкий «пружинистый» pulse',
      'При наведении на колокольчик — бейдж слегка увеличивается, привлекает внимание',
    ],
  },
  {
    version: 'v2.45.60',
    date: '04.06.2026',
    title: 'Уведомления: кнопка «Очистить» в шапке',
    features: [
      'В модалке уведомлений (колокольчик) в правом верхнем углу появилась кнопка <b>«Очистить»</b> — отмечает все уведомления как прочитанные одним кликом',
      'Раньше эта кнопка была в подвале — её приходилось искать. Внизу осталась как было («Прочитал всё»), просто продублировали наверх',
    ],
  },
  {
    version: 'v2.45.59',
    date: '04.06.2026',
    title: 'Excel инвентаризации: агрегация по модели + правильный «Учёт»',
    features: [
      'Готовая продукция выгружается <b>сгруппированной по модели</b>: одна строка «ЩУ-001.003 · 6 шт» вместо шести отдельных строк с разными договорами',
      'Колонки про статус и резерв убраны — для инвентаризации важно «сколько штук есть физически»',
      'Колонка <b>«Учёт»</b> теперь правильно считает остаток (раньше везде стоял 0 из-за неверного поля)',
      'Модели с нулевым остатком в выгрузку не попадают',
    ],
  },
  {
    version: 'v2.45.58',
    date: '04.06.2026',
    title: 'Склад: экспорт Excel для инвентаризации + двойной № в резерве',
    features: [
      'В разделе <b>Склад → Готовая продукция</b> новая кнопка <b>«Excel для инвентаризации»</b>. Выгружает два листа: <b>Готовая продукция</b> (со статусом и привязкой к договору) и <b>Комплектующие</b>. Колонки «Учёт / Факт / Расхождение / Примечание» — кладовщик заполняет руками во время сверки',
      'Файл с именем <code>inventory_YYYY-MM-DD_HHMM.xlsx</code> и зафиксированной шапкой, готов к печати',
      'Убран <b>двойной №</b> в строке «Резерв» когда номер договора уже начинается с <code>№</code> (раньше получалось «№№06ТД/04.26»)',
    ],
  },
  {
    version: 'v2.45.57',
    date: '04.06.2026',
    title: 'Админ-инструменты — под паролем',
    features: [
      'Перед открытием модалки «Админ-инструменты» теперь система просит <b>пароль директора</b> (тот же, что для входа в CRM)',
      'Один раз ввёл — до перезагрузки страницы или выхода из учётки больше не спрашивает',
      'Это второй замок поверх роли — чтобы случайный клик в Снабжении не открыл массовые операции одной кнопкой',
    ],
  },
  {
    version: 'v2.45.56',
    date: '04.06.2026',
    title: 'Сайдбар Снабжения: убрал лишние пункты в «Админ-инструменты»',
    features: [
      'Четыре редко используемых пункта — <b>Массовое BOM</b>, <b>Перенумерация</b>, <b>Подгруппы каталога</b>, <b>2-уровневая иерархия</b> — теперь живут в одной модалке <b>«Админ-инструменты»</b>',
      'Доступно только директору, видно отдельным пунктом сайдбара Снабжения',
      'Сайдбар стал короче — повседневные пункты (Заявки, Заказы, Входящие счета, Приёмка УПД, Поставщики, Каталог) не теряются среди администраторской рутины',
    ],
  },
  {
    version: 'v2.45.55',
    date: '04.06.2026',
    title: '2-уровневая иерархия каталога: исполнение → 5 категорий',
    features: [
      'В каталоге оборудования теперь работает <b>двухуровневая иерархия</b>: внутри направления (напр. «Щиты управления») сначала идут подгруппы по исполнению (Стандартные / Нержавеющие / Влагозащищённые), а внутри каждой — 5 категорий (ЩУ-001.000 Камеры созревания и т.д.)',
      'В сайдбаре <b>Снабжение → 2-уровневая иерархия</b> — инструмент для применения. Выбираешь направление → проверяешь маркеры (по каким словам относить модель к исполнению) → жмёшь «Предпросмотр» → «Применить». Старые «плоские» подгруппы деактивируются',
      'В рендере каталога категории внутри подгруппы тоже сворачиваются — по одному клику на нужную ветку',
    ],
  },
  {
    version: 'v2.45.54',
    date: '04.06.2026',
    title: 'Подгруппы каталога: префикс по исполнению',
    features: [
      'В инструменте «Подгруппы каталога» появилось поле <b>Префикс</b>. Он подставляется автоматически по имени выбранного направления: <b>Стандарт → ST</b>, <b>Нерж AISI → N</b>, <b>Влагозащита → IP</b>',
      'Имена подгрупп тогда: <code>ЩУ-ST-001.000 Камеры созревания</code>, <code>ЩУ-N-001.000 …</code>, <code>ЩУ-IP-001.000 …</code>',
      'Префикс можно править вручную — если автоматика не угадала или нужен другой формат',
    ],
  },
  {
    version: 'v2.45.53',
    date: '04.06.2026',
    title: 'Подгруппы каталога: формат ЩУ-001.000',
    features: [
      'Дефолтные имена подгрупп в инструменте «Подгруппы каталога» теперь в формате <code>ЩУ-001.000 Камеры созревания</code> (с префиксом и тремя нулями)',
      'Структура: Щиты управления → Стандарт / Нерж / Влагозащита (3 раздела) → 5 подгрупп в каждом. Прокликай инструмент по очереди для каждого из трёх направлений',
    ],
  },
  {
    version: 'v2.45.52',
    date: '04.06.2026',
    title: 'Подгруппы каталога по артикулу',
    features: [
      'В сайдбаре <b>Снабжение → Подгруппы каталога</b> — инструмент для разбивки моделей направления на подгруппы по первой цифре артикула',
      'По умолчанию заполнены 5 подгрупп: 001.0 Камеры созревания, 002.0 Чиллера, 003.0 Холодильное оборудование, 004.0 Приточно-вытяжная вентиляция, 005.0 АСУ — можно править и добавлять свои',
      'Выбираешь направление → жмёшь «Предпросмотр» → видишь сколько моделей привяжется и какие не распознаются → «Применить»',
      'В каталоге моделей подгруппы уже умеют сворачиваться — после применения модели разлягутся по 5 секциям',
    ],
  },
  {
    version: 'v2.45.51',
    date: '04.06.2026',
    title: 'Перенумерация моделей по префиксу (ЩУ001.000…)',
    features: [
      'В сайдбаре <b>Снабжение → Перенумерация</b> — новый инструмент для приведения артикулов и имён моделей к единому формату',
      'Указываешь префикс (например <code>ЩУ</code>) → получаешь таблицу всех моделей этого префикса в 3 исполнениях с предложением: <code>ЩУ001.001</code> / артикул <code>ЩУ-001-001</code>. Для нержи добавляется <code>-N</code>, для влагозащиты <code>-V</code>',
      'Поля редактируемые — конфликты по UNIQUE подсвечены красным. «Применить» доступно только после устранения конфликтов',
      'Перед применением — подтверждение, действие пишется в журнал',
    ],
  },
  {
    version: 'v2.45.50',
    date: '04.06.2026',
    title: 'Массовое BOM: видимый чекбокс «Критично»',
    features: [
      'Чекбокс <b>«Критично»</b> в строке компонента теперь явно виден (18×18, с accent-цветом). Раньше прятался под глобальным стилем',
    ],
  },
  {
    version: 'v2.45.49',
    date: '04.06.2026',
    title: 'Массовое BOM: видно когда считает и почему упало',
    features: [
      'На кнопках «Предпросмотр» и «Применить» теперь крутится <b>спиннер</b> пока идёт запрос, кнопки заблокированы — не дёрнешь дважды',
      'Слева в подвале — статус: «Считаем предпросмотр…» / «Применяем…»',
      'Если бэк ответил ошибкой — она выводится <b>красной плашкой</b> в самой модалке, с подсказкой что делать (например, дождаться Railway деплоя)',
    ],
  },
  {
    version: 'v2.45.48',
    date: '04.06.2026',
    title: 'Массовое BOM: нормальный выбор компонентов',
    features: [
      'В «Массовом BOM» убран голый <code>select</code> с 500 строк — теперь <b>кнопка-picker</b> с поиском и группировкой по категориям (как при добавлении в обычный BOM)',
      'Маркер тоже можно выбрать кнопкой <b>«Из каталога»</b> — кликаешь нужный компонент, его имя само подставится в поле',
    ],
  },
  {
    version: 'v2.45.47',
    date: '04.06.2026',
    title: 'Массовое добавление в BOM по маркеру',
    features: [
      'В сайдбаре <b>Снабжение → Массовое BOM</b> — новый инструмент для директора',
      'Указываешь <b>маркер</b> (фрагмент имени компонента, напр. «KINCO»), список компонентов на добавление с qty и критичностью — система находит ВСЕ модели, где уже стоит маркер-компонент, и добавляет в их BOM указанные строки',
      'Сначала <b>предпросмотр</b>: показывает сколько моделей затронет, какие строки добавятся, какие уже есть. Только потом «Применить»',
    ],
  },
  {
    version: 'v2.45.46',
    date: '04.06.2026',
    title: 'Приёмка: куда ушли позиции — склад или договор',
    features: [
      'При приёмке заказа поставщика каждую позицию можно <b>поделить</b>: «N шт на склад, M шт под договор №…»',
      'Кнопка <i class="ti ti-plus"></i> справа от позиции — добавить ещё строку, чтобы развести между несколькими договорами',
      'В выпадашке — все договоры в работе (published / production); по умолчанию первая строка идёт «на склад»',
      'Связь сохраняется в БД — следующий этап (история закупок и блок «закуплено по договору» в карточке договора) уже на подходе',
    ],
  },
  {
    version: 'v2.45.45',
    date: '04.06.2026',
    title: 'Входящие счета: удалённые больше не возвращаются',
    features: [
      'Когда удаляешь письмо из «Входящих счетов» — оно больше не появляется заново через минуту после очередной проверки IMAP-робота',
      'Запись помечается как удалённая в БД, робот её «помнит» и не пересоздаёт. Файлы вложений всё так же стираются из хранилища',
    ],
  },
  {
    version: 'v2.45.44',
    date: '04.06.2026',
    title: 'Этикетки: превью совпадает с печатью',
    features: [
      'Превью этикетки теперь рисуется по той же формуле, что Zebra считает в ZPL — что видишь на экране, то и напечатается',
      'Размер шрифта в редакторе указывается в <b>dots</b> (как в ZPL). В подсказке к полю виден эквивалент в мм для текущего DPI',
      'Магнификация QR (1–10) — пояснение в подсказке: при магнификации 5 на 203 dpi QR будет ≈15 мм',
      'Дефолтные размеры подняты: «ATOMUS group» 40 dots (≈5 мм), «Поз. 00-00000» 32 dots (≈4 мм) — нормально читается невооружённым глазом',
    ],
  },
  {
    version: 'v2.45.42',
    date: '04.06.2026',
    title: 'Этикетки: печать на термопринтер + копии',
    features: [
      'В редакторе этикеток новая кнопка <b>«Печать на термопринтер»</b> — отправляет готовый ZPL в очередь шлюза, тот печатает на офисном Zebra',
      'Рядом с DPI принтера появилось поле <b>«Копий»</b> (1–50) — сколько штук напечатать одной кнопкой',
      'Перед печатью просит подтверждение, чтобы случайно не отправить лишнее',
    ],
  },
  {
    version: 'v2.45.41',
    date: '04.06.2026',
    title: 'Этикетки: дефолт 58×60 мм',
    features: [
      'По умолчанию редактор открывается с размером этикетки <b>58×60 мм</b> — стандартный заводской размер',
    ],
  },
  {
    version: 'v2.45.40',
    date: '04.06.2026',
    title: 'Этикетки: перетаскивание элементов мышкой',
    features: [
      'В редакторе этикеток теперь можно <b>перетаскивать</b> любой элемент (текст, QR, картинку) прямо на превью — наведи курсор, зажми, тащи',
      'Координаты X/Y в полях справа обновляются в реальном времени, шаг 0.5 мм. Не вылезает за границы этикетки',
      'Перетаскиваемый элемент выделен <b>синей рамкой</b>. На мобильном работает через касания (touch)',
    ],
  },
  {
    version: 'v2.45.39',
    date: '04.06.2026',
    title: 'Калькулятор холода: убран из «Главной»',
    features: [
      'Пункт <b>«Калькулятор холода»</b> убран из левого сайдбара «Главной» — там лишний',
      'Открывается только из <b>Продаж</b> (в их сайдбаре пункт остался)',
    ],
  },
  {
    version: 'v2.45.38',
    date: '04.06.2026',
    title: 'Редактор этикеток с QR (Zebra ZPL)',
    features: [
      'В сайдбаре <b>Склад → QR-этикетки</b> — новый мини-редактор. Указываешь размер этикетки (мм), DPI принтера, добавляешь элементы: <b>QR-код</b>, <b>текст</b>, <b>картинку/лого</b>',
      'Каждый элемент позиционируется по координатам X/Y в мм. Превью этикетки рисуется на canvas, рамка-контур показывает границы',
      'Кнопка <b>«Сгенерировать ZPL»</b> выдаёт готовый ZPL-код (для Zebra TLP/GK/ZD) — копируешь и отправляешь на принтер через шлюз',
      'Сохранение шаблонов в браузере: называешь, жмёшь «Сохранить шаблон» — он остаётся в списке слева, открывается одним кликом',
      'Также можно <b>скачать PNG</b> — для печати на обычном принтере или предпросмотра',
    ],
  },
  {
    version: 'v2.45.37',
    date: '04.06.2026',
    title: 'Несколько счетов в письме — ИИ выбирает свежий',
    features: [
      'Когда поставщик отвечает на заявку и его почтовик прикладывает <b>всю историю переписки</b> (свежий счёт + старые из ответов), робот теперь прогоняет все PDF через <b>ИИ-распознавание</b> и привязывает к заказу самый свежий по дате счёта',
      'Если автоматика ошиблась — открой письмо, рядом с каждым вложением кнопка <b>«Как счёт»</b>: жмёшь на нужный файл и он сразу становится счётом заказа',
      'Над списком вложений появилась подсказка-уведомление, что в письме их несколько',
    ],
  },
  {
    version: 'v2.45.36',
    date: '04.06.2026',
    title: 'Входящие счета: ровные кнопки в строке',
    features: [
      'Кнопки в строке входящего счёта (<b>Открыть</b>, <b>Скачать</b>, <b>Привязать</b>, корзина) теперь одной высоты — независимо от того, есть ли вложение и видит ли пользователь корзину',
      'Иконочные кнопки (скачать, удалить) стали ровными квадратами 32×32, корзина с подкрашенной обводкой',
    ],
  },
  {
    version: 'v2.45.35',
    date: '04.06.2026',
    title: 'Открепить мёртвую ссылку на счёт',
    features: [
      'Если файл счёта пропал из хранилища (например, был сохранён до того как настроили S3), при «Просмотре» появится кнопка <b>«Открепить мёртвую ссылку»</b> + <b>«Загрузить заново»</b>',
      'Только для директора. Чистит запись в БД и пытается удалить остатки из storage — после этого можно загрузить новый файл',
      'Директор также может <b>заменить счёт на любом открытом статусе</b> (даже если заказ уже на оплате/оплачен) — раньше можно было только до «Счёт пришёл»',
    ],
  },
  {
    version: 'v2.45.34',
    date: '04.06.2026',
    title: 'Заявка на закупку = наша номенклатура',
    features: [
      'В <b>«Новой заявке на закупку»</b> выпадашка «Позиция» теперь тянется из нашего справочника <b>«Номенклатура комплектующих»</b> — те же позиции, что в BOM и Складе. Никаких «1 WA 600*300» и десятков дублей',
      'Позиции <b>сгруппированы по категориям</b> — короче скроллить',
      'Старые заявки из устаревшего каталога продолжают работать; при редактировании можно перевести их на наш справочник одним кликом',
    ],
  },
  {
    version: 'v2.45.33',
    date: '04.06.2026',
    title: 'Удаление входящих счетов директору',
    features: [
      'В «Входящих счетах» у директора появилась <b>красная корзина</b> в каждой строке. Письмо и его вложения стираются безвозвратно',
      'Удалять могут только директора — остальным кнопка не показывается',
    ],
  },
  {
    version: 'v2.45.29–32',
    date: '03–04.06.2026',
    title: 'Калькулятор холода',
    features: [
      'Новый <b>«Калькулятор холода»</b> в левом сайдбаре «Главной» и «Продажах». 7-вкладочная форма: клиент, камера, стены, режим, продукт, люди/свет/двигатели, двери — на выходе кВт холода с разбивкой по статьям',
      'Сохранение результатов в <b>«История»</b>: называешь расчёт, заполняешь данные клиента (компания, контакт, телефон, ИНН), жмёшь «Сохранить». Потом открываешь обратно одним кликом',
      'Адаптация под телефон: модалка fullscreen, таблица стен в столбик, табы в иконки',
    ],
  },
  {
    version: 'v2.45.28',
    date: '03.06.2026',
    title: 'Пароли сотрудников в админке',
    features: [
      'В разделе «Сотрудники» под каждым именем — <b>статус пароля</b>: установлен (с датой) или нет',
      'Директор может <b>«Сгенерировать»</b> читабельный пароль вида <code>Kp4-Bm9-7xQ-fL2</code>. Показывается ОДИН раз с кнопкой «Копировать» — после этого в БД только хеш',
      'Кнопка <b>«Сбросить»</b> мгновенно отключает вход по паролю (Telegram-вход остаётся)',
    ],
  },
  {
    version: 'v2.45.23–27',
    date: '02–03.06.2026',
    title: 'BOM: подсборки и единицы измерения',
    features: [
      'В тех. карту модели можно добавлять не только <b>комплектующие</b>, но и <b>дочерние модели</b> (подсборки). При сборке родителя списываются N готовых сборок из стока',
      'У каждой строки BOM — <b>своя единица измерения</b>: трубки можно поставить в метрах, винты — в штуках. По умолчанию берётся из карточки комплектующего',
      'Подсборки выделены иконкой пакета и бейджем «Подсборка»',
    ],
  },
  {
    version: 'v2.45.24–25',
    date: '03.06.2026',
    title: 'Просмотр счёта прямо в карточке заказа',
    features: [
      'Рядом со «Скачать» — новая кнопка <b>«Просмотреть»</b>. PDF открывается в iframe прямо на странице заказа, картинки — как обычное превью',
      'Если файла нет в storage — теперь показывается <b>точная причина</b> и ключ из БД (раньше было просто «не удалось»)',
    ],
  },
  {
    version: 'v2.45.18–22',
    date: '01–03.06.2026',
    title: 'Снабжение: подпись писем, IMAP, скачивание',
    features: [
      'В письмах поставщикам — <b>подпись с именем и телефоном</b> того, кто запросил счёт',
      'IMAP-робот теперь привязывает счёт <b>и без «Re:» в теме</b>: ищет метку [ORD-N] в теле письма, при отсутствии — по email-поставщика, если у него ровно один открытый заказ',
      'Вложение из «Входящих» можно <b>скачать прямо из строки</b>, не открывая письмо',
    ],
  },
  {
    version: 'v2.43.68',
    date: '28.05.2026',
    title: 'Кнопки «Фото УПД» и «QR-скан» в шапке',
    features: [
      'Кнопки в шапке стали <b>информативнее</b>: «Снять» → <b>«Фото УПД»</b>, «Скан» → <b>«QR-скан»</b>. Сразу понятно, что делает каждая',
      'Кнопки <b>чуть компактнее</b>: меньше отступы и шрифт — не теснят навигацию',
      '<b>Цветовые акценты</b>: «Фото УПД» — зелёный оттенок, «QR-скан» — голубой. Различаются с одного взгляда',
    ],
  },
  {
    version: 'v2.43.67',
    date: '28.05.2026',
    title: 'Договор — рабочие или календарные дни',
    features: [
      'В сроке отгрузки договора теперь можно выбрать <b>«Рабочие дни» или «Календарные дни»</b>',
      '<b>Рабочие</b> — выходные пропускаются (как раньше). <b>Календарные</b> — считаются подряд, включая выходные',
      'Что ввёл — то и дата отгрузки: система сразу пересчитывает дату от даты оплаты (или подписания)',
    ],
  },
  {
    version: 'v2.43.66',
    date: '28.05.2026',
    title: 'Кнопки производства + дни календаря',
    features: [
      'Кнопки в шапке Производства на мобильной выстроены <b>ровной сеткой</b> 2 в ряд, «Новая работа» — на всю ширину. Не обрезаются и не растягиваются',
      '<b>В календаре день с событиями</b> помечается цветными точками (на мобильной). Нажми на день — откроется <b>карточка дня</b> со списком: отгрузки, задачи, приёмки, отпуска',
      'Клик по отгрузке/задаче в карточке дня — переход к договору/задаче',
    ],
  },
  {
    version: 'v2.43.65',
    date: '28.05.2026',
    title: 'Калькулятор поверх меню + календарь на мобильной',
    features: [
      '<b>Калькулятор</b> теперь открывается <b>поверх</b> бокового меню (раньше прятался под ним из-за слоёв). При открытии меню автоматически закрывается',
      '<b>Календарь на мобильной</b> исправлен: показывались только 2 дня недели из 7 — теперь вся неделя помещается в экран, ячейки компактные',
    ],
  },
  {
    version: 'v2.43.64',
    date: '28.05.2026',
    title: 'Калькулятор — клавиатура и НДС',
    features: [
      '<b>На компе калькулятор принимает ввод с клавиатуры:</b> цифры, + − × ÷, Enter (=), Backspace (⌫), Esc (закрыть), точка/запятая, C (сброс)',
      'Режим <b>НДС</b> приведён в порядок: кнопки «Из суммы без НДС / с НДС» крупнее и аккуратнее, поле ввода и значок ₽ выразительнее',
      'В <b>мобильной</b> кнопки в шапке Производства (План недели · Аналитика · AI-анализ · Синхронизировать) больше не надо листать вбок — они переносятся на строки',
    ],
  },
  {
    version: 'v2.43.63',
    date: '28.05.2026',
    title: 'Калькулятор — полировка + меню на Главной',
    features: [
      '<b>Кнопка с тремя полосками</b> (☰) теперь есть и на Главной мобильной — открывает боковое меню с разделом «Сервисы» (там калькулятор)',
      'Калькулятор убран из верхней панели мобильной — теперь только через меню',
      '<b>Режим «Валюты»</b> больше не растягивается — поля идут вертикально: сумма → стрелка → результат',
      '<b>Кнопки калькулятора стали симпатичнее:</b> скруглённые, с тенями, «=» с градиентом, нажатие с анимацией',
      'Селекты валют округлены и выделены фирменным цветом',
    ],
  },
  {
    version: 'v2.43.62',
    date: '28.05.2026',
    title: 'Мобильная — калькулятор + ровные карточки',
    features: [
      'На мобильной калькулятор <i class="ti ti-calculator"></i> теперь в <b>верхней панели</b> рядом с колокольчиком (на десктопе остаётся в сайдбаре «Сервисы»)',
      'Карточки на Главной («Договоров», «КП в работе», «Сборок сегодня», «Принято КП») выровнены: иконки, заголовки и цифры — на одной линии, карточки одной высоты',
    ],
  },
  {
    version: 'v2.43.61',
    date: '28.05.2026',
    title: 'Калькулятор — в сайдбар «Сервисы»',
    features: [
      'Калькулятор <i class="ti ti-calculator"></i> теперь в <b>левом меню → раздел «Сервисы»</b> (рядом с Max, Почта, Диск)',
      'Открывается модалкой поверх окна — на десктопе и на мобильной (через меню)',
      'Из шапки иконку убрали',
    ],
  },
  {
    version: 'v2.43.60',
    date: '28.05.2026',
    title: 'Калькулятор — в шапку',
    features: [
      'Калькулятор убран из блока «Инструменты» на Главной',
      'Теперь иконка <i class="ti ti-calculator"></i> в <b>верхней панели</b> рядом с колокольчиком — открывается модалкой поверх окна',
      'Работает и на десктопе, и на мобильной',
      'Все три режима на месте: Математика · НДС · Валюты',
    ],
  },
  {
    version: 'v2.43.59',
    date: '27.05.2026',
    title: 'Автогенерация работ при добавлении позиции',
    features: [
      '<b>Добавил позицию в опубликованный договор → карточки появляются в канбане автоматически.</b> По одной карточке на каждую штуку (qty=1)',
      'Раньше при добавлении новой позиции в спецификацию уже опубликованного договора — работы в очередь не попадали, приходилось вручную',
      'Также при публикации договора с qty=2 теперь создаётся 2 отдельные карточки (раньше одна с «× 2»)',
    ],
  },
  {
    version: 'v2.43.58',
    date: '27.05.2026',
    title: 'Канбан по штукам + договоры повыразительнее',
    features: [
      '<b>Канбан — каждая штука отдельной карточкой.</b> Если в новой работе qty=2 — теперь создаются <b>2 независимые карточки</b> qty=1. Можно вести параллельно: разные сборщики, разное время, разный прогресс',
      '<b>Договоры — цветная полоска слева</b> по статусу: синий = в производстве, оранжевый = готов к отгрузке, зелёный = отгружен, серый = закрыт. Сразу видно состояние',
      '<b>Номер договора</b> теперь в фоновой плашке моноширинным шрифтом — выделяется',
      '<b>Сумма</b> крупнее и жирнее, цифры в tabular-варианте — колонка ровная',
      'Все колонки точно выровнены по одной центральной линии (раньше прыгали)',
    ],
  },
  {
    version: 'v2.43.57',
    date: '27.05.2026',
    title: 'Договоры — выровнял бейджи',
    features: [
      'Бейджи статусов (в производстве / готов / отгружен) теперь точно на одной линии с номером, датой, суммой',
      'Описание контрагента (поставка · ООО ...) уходит отдельной строкой ниже — не сбивает выравнивание',
    ],
  },
  {
    version: 'v2.43.56',
    date: '27.05.2026',
    title: 'Договоры — ровные строки',
    features: [
      'В таблице <b>«Договоры»</b> номер / статус / даты / сумма / менеджер теперь идут в одной горизонтальной линии — раньше прыгали вниз когда у контрагента было длинное описание',
    ],
  },
  {
    version: 'v2.43.55',
    date: '27.05.2026',
    title: 'Удаление ошибочных сборок',
    features: [
      'В блоке <b>«Сборки этой модели»</b> у каждой сборки появилась красная кнопка <i class="ti ti-trash"></i> — удаление',
      'Если сборка готова и на складе есть остаток — при удалении создаётся <b>списание (write_off)</b> для корректировки',
      'Отгруженные сборки удалить нельзя (защита от потери истории отгрузок)',
      'Доступно мастеру и директору',
    ],
  },
  {
    version: 'v2.43.54',
    date: '27.05.2026',
    title: 'Фикс «№№» в номере договора',
    features: [
      'Убран двойной символ <b>№</b> в отображении номера договора (в модалке работы, в журнале участия, в шапке карточки). Если в БД номер уже сохранён с «№» — лишний префикс срезается',
    ],
  },
  {
    version: 'v2.43.53',
    date: '27.05.2026',
    title: 'Мобильная — фикс «кто чем занят»',
    features: [
      '<b>Бейдж «СЕЙЧАС · 1ч 23м»</b> теперь виден на мобильной — раньше прятался когда длинное ФИО',
      'Строка сборщика в Загрузке на мобильной перестроена на <b>два ряда</b>: ФИО+бейдж сверху, полоска снизу — больше места имени и бейджу',
      'Кнопки в шапке Производства (План/Аналитика/AI-анализ/...) на мобильной теперь <b>горизонтально прокручиваются</b> вместо обрезки',
    ],
  },
  {
    version: 'v2.43.52',
    date: '27.05.2026',
    title: 'Счётчик часов работы ⏱',
    features: [
      '<b>Нажал «Я работаю над этим» — часики пошли.</b> Время фиксируется поминутно и записывается в журнал участия',
      'На бейдже <b>«СЕЙЧАС»</b> в Загрузке сборщиков теперь идёт live-таймер: «СЕЙЧАС · 1ч 23м». Обновляется раз в минуту',
      'На чипах активных помощников в модалке работы — тот же таймер',
      'При нажатии <b>«Я закончил»</b> открывается мини-окошко: «Ты работал 1ч 23м над AtomW 45-78. Что делал?» — заметка идёт в журнал',
      'Если работал <b>меньше 5 минут</b> — запись в журнал не создаётся (защита от случайного нажатия)',
      '<b>Авто-стоп в 18:00</b> (по Миассу): если кто-то забыл отжать — система сама закроет таймер и запишет часы с пометкой «авто-стоп»',
      'При переключении с одной работы на другую — старая сессия автоматически закрывается и часы фиксируются',
      'Может нажимать <b>как сам сотрудник, так и мастер</b> назначить других через кнопку «Добавить»',
    ],
  },
  {
    version: 'v2.43.51',
    date: '27.05.2026',
    title: 'Загрузка сборщиков — клик и расшифровка',
    features: [
      'Бейдж <b>«СЕЙЧАС»</b> рядом с сотрудником теперь <b>кликабельный</b> — открывает ту работу, над которой он сейчас работает',
      'Рядом с заголовком «Загрузка сборщиков» появилась иконка <i class="ti ti-info-circle"></i> с подсказкой про расчёт часов: «откуда 32ч» — это 2 работы × 16ч (дефолт когда «расч. часы» не указаны). Чтобы получить точные часы — заполните «расч. часы» в карточке работы',
    ],
  },
  {
    version: 'v2.43.50',
    date: '27.05.2026',
    title: 'Чистка шапки',
    features: [
      'Убрана кнопка <b>«?»</b> из верхней панели. Раздел Помощь по-прежнему доступен через сайдбар: <i>Помощь → Что нового / База знаний / FAQ / Контакты</i>',
    ],
  },
  {
    version: 'v2.43.49',
    date: '27.05.2026',
    title: 'Фикс уведомлений — теперь приходят!',
    features: [
      '<b>Исправлен баг:</b> два endpoint\'а с одним именем перетирали друг друга, поэтому глобальные уведомления (дефекты, договоры, сборки) НИКОГДА не доходили в колокольчик',
      '<b>Колокольчик теперь объединяет два источника:</b> чаты по договорам + глобальные уведомления (замечания, новые договоры, сборки)',
      'В панели — две секции: «Уведомления» (с иконкой колокольчика) сверху и «Чаты по договорам» снизу',
      'Клик по уведомлению о замечании — открывает замечание + автоматически отмечает прочитанным',
      'Крестик на каждом уведомлении — отметить прочитанным без перехода',
      'Бейдж теперь считает <b>сумму обоих</b> источников',
    ],
  },
  {
    version: 'v2.43.48',
    date: '27.05.2026',
    title: 'Гибкое управление помощниками + уведомления о замечаниях',
    features: [
      'В блоке <b>«Кто работает прямо сейчас»</b> мастер/директор может теперь <b>добавить любого сотрудника</b> вручную — кнопка «Добавить» рядом с «Я работаю над этим»',
      'У каждого активного помощника появился <b>крестик</b> — снять одним кликом (для мастера/директора)',
      'Сотрудник автоматически добавляется в соисполнители при ручном назначении',
      '<b>Уведомления о замечаниях:</b> теперь при создании дефекта/замечания/вопроса приходит уведомление в колокольчик с типом, категорией, контекстом (по какой сборке / договору) и автором',
      '<b>Сообщения в чате замечания</b> теперь тоже отправляют уведомление — никто не пропустит ответ',
    ],
  },
  {
    version: 'v2.43.47',
    date: '27.05.2026',
    title: 'Загрузка с учётом помощи + кнопка «Я работаю сейчас»',
    features: [
      '<b>Загрузка сборщиков</b> в шапке производства теперь учитывает не только главных, но и <b>соисполнителей</b>. У Шевелева/Иванова больше не будет «свободен» если они помогают',
      'Текст в полоске показывает разбивку: «1 гл. + 2 пом.» — сразу видно где главный, где помогает',
      'Новый блок в модалке работы — <b>«Кто работает прямо сейчас»</b>. Кнопка «Я работаю над этим» — нажал, и ты подключился к этой работе',
      'Бейдж <b>«СЕЙЧАС»</b> с пульсирующей зелёной подсветкой в блоке загрузки — видно кто на руках с какой задачей',
      'При переключении на другую работу — статус с предыдущей автоматически снимается',
      'Сотрудник автоматически добавляется в соисполнители при нажатии «Я работаю»',
    ],
  },
  {
    version: 'v2.43.46',
    date: '27.05.2026',
    title: 'Кнопка «?» в шапке + переоформление',
    features: [
      'В шапке рядом с уведомлениями появилась кнопка <b>«?»</b> — быстрый доступ в Помощь',
      'Записи в журнале участия теперь редактируются (✏): часы, дата, заметка',
      'В журнале и в сводках виден тэг роли — <b>«главный»</b> (зелёный) или <b>«соисполнитель»</b> (синий)',
    ],
  },
  {
    version: 'v2.43.45',
    date: '27.05.2026',
    title: 'Активность · итог в PDF',
    features: [
      'PDF отчёта «Активность»: итоговая строка объединена через SPAN, «Всего: 24 (сборок 23, помощь 1)» помещается одной строкой',
    ],
  },
  {
    version: 'v2.43.44',
    date: '27.05.2026',
    title: 'Полировка отчётов',
    features: [
      'Кнопки экспорта в Сводках приведены к <b>одному размеру</b> (84px) — больше не «кто во что горазд»',
      '<b>«Активность» теперь спрашивает формат:</b> Excel или PDF',
      '<b>Журнал участия переоформлен:</b> 4-я карточка «В среднем за день»; полоски-индикаторы доли часов по сборщикам; группировка записей по датам',
      'Кнопки на <b>«Номенклатура оборудования»</b> приведены к единому размеру',
    ],
  },
  {
    version: 'v2.43.43',
    date: '27.05.2026',
    title: 'Произвольный период',
    features: [
      '5-й чип <b>«📅 Свой»</b> в Сводках — выбор любых двух дат «С — По»',
      'Все 4 кнопки скачивания работают за выбранный произвольный период',
    ],
  },
  {
    version: 'v2.43.42',
    date: '27.05.2026',
    title: 'Отчёт «Активность»',
    features: [
      'Новая кнопка <b>«Активность»</b> — единый хронологический список сборок + журнала за период',
      'Цветовая раскраска строк по типу: 🟢 сборка / 🔵 помощь / 🟡 журнал',
      'Лист «Итоги» со статистикой',
    ],
  },
  {
    version: 'v2.43.41',
    date: '27.05.2026',
    title: 'Журнал — в PDF сборок',
    features: [
      'В колонку <b>«Комм.»</b> PDF и Excel сборок теперь дописываются данные журнала: «Шевелев М.И. 4ч: Делал подставку из профиля 40х20»',
      'Если сотрудник не главный — пометка «(помог)»',
    ],
  },
  {
    version: 'v2.43.40',
    date: '27.05.2026',
    title: '«Полный по сборщику»',
    features: [
      'Новая кнопка — Excel с тремя листами: <b>Записи журнала · Сборки · Итоги</b>',
      'Колонка <b>«Роль»</b> в журнале: главный / соисполнитель',
    ],
  },
  {
    version: 'v2.43.36',
    date: '27.05.2026',
    title: 'Журнал участия → в Сводки',
    features: [
      'В разделе <b>«Сводки»</b> появился блок «Журнал участия» — KPI часов, таблица по сборщикам, последние записи',
      'Учитывается фильтр периода и сборщика',
      'Кнопка <b>«Журнал Excel»</b> для скачивания журнала отдельным файлом',
    ],
  },
  {
    version: 'v2.43.34',
    date: '27.05.2026',
    title: 'Журнал участия в работах',
    features: [
      'В модалке работы появился раздел <b>«Журнал участия»</b> — кто, когда, что делал, сколько часов',
      'Запись в журнал автоматически подключает сотрудника к соисполнителям',
      'Поле «Что делал» — заметка о работе того дня',
    ],
  },
  {
    version: 'v2.43.33',
    date: '27.05.2026',
    title: 'Соисполнители + цветные аватары',
    features: [
      'В работе можно <b>подключить соисполнителей</b> (помимо главного сборщика)',
      'У каждого сотрудника свой <b>цвет аватара</b> (палитра 8 цветов) — сразу узнаваемы в загрузке, на карточках, в журнале',
      'Прогресс-бар на карточке kanban теперь <b>меняет цвет</b>: 🔴 0–24% → 🟡 25–49% → 🔵 50–74% → 🟢 75–100%',
      'Иконка 💬 на карточке если у работы есть комментарий',
    ],
  },
  {
    version: 'v2.43.31',
    date: '27.05.2026',
    title: 'Прогресс и комментарий в работе',
    features: [
      'В модалке работы — <b>слайдер прогресса</b> 0–100% с пресетами 0/25/50/75/100',
      'Поле <b>«Комментарий»</b> сборщика — заметки по ходу выполнения',
      'Прогресс автоматически отражается на карточке kanban',
    ],
  },
  {
    version: 'v2.43.30',
    date: '27.05.2026',
    title: 'Цветные сборщики + оценка часов',
    features: [
      'Цветные аватары у сборщиков в блоке «Загрузка сборщиков»',
      'Если у работы не указаны часы, в загрузке используется <b>эстимейт 16ч/работа</b> (типичная assembly)',
      'Тильда <b>«~32ч»</b> в полоске когда часы оценочные',
    ],
  },
  {
    version: 'v2.20.0',
    date: '21.05.2026',
    title: 'Готовность к отгрузке + Чиллеры + Унифицированный поиск + Бейджи',
    features: [
      '<b>Проверка готовности к отгрузке:</b> при попытке поставить договор в «Отгружен» система проверяет, что все позиции готовы (сборки на складе, комплектующие в резерве, закупки получены). Если что-то не готово — открывается модалка со списком блокеров и предлагает два пути: «Отгрузить частично» (мягкий шаг) или «Всё равно отгрузить (force)»',
      '<b>Новый статус «Отгружен частично»</b> в переключателе статуса — между «Готов к отгрузке» и «Отгружен». Полезно когда часть позиций уехала, а часть ещё в производстве. Тёплый оранжевый цвет',
      '<b>Замок 🔒 на кнопке «Отгружен»</b> — если бэкенд проактивно сообщил что не все позиции готовы. Подсказка «Готово X из Y позиций» прямо под кнопками',
      '<b>Чиллеры перенесены</b> из продажной номенклатуры в производственную, под направление «Чиллера». Артикулы новых моделей: <code>ЧИЛ-NNN</code>. По чиллерам теперь можно вести спецификации (BOM), резервировать сборки и считать готовность к отгрузке',
      '<b>Унифицированный поиск</b> в спецификации договора — одно поле ищет одновременно по моделям, комплектующим и продажной номенклатуре. Бейджи: 🛠 модель / 📦 компл. / 🛒 продажа',
      '<b>Бейджи наличия в Номенклатуре:</b> 🟢 «В наличии: N» / 🔵 «Резерв: N» / 🔴 «К закупке: N компл.» / 🟡 «К сборке». Понятно с одного взгляда что есть на складе, что в резерве и что нужно докупить',
      '<b>Бейджи наличия в BOM</b> карточки модели — для каждой комплектующей сразу видно, хватает ли её, не хватает или нужно закупать',
    ],
  },
  {
    version: 'v2.18.0',
    date: '20.05.2026',
    title: 'Подсветка договоров + улучшения UX',
    features: [
      '<b>Подсветка договоров по срочности</b> — цветная полоска слева у карточки договора: 🔴 красная (просрочен или 0–3 дня до отгрузки), 🟠 оранжевая (4–10 дней), 🟢 зелёная (более 10 дней), серая (нет даты), приглушённая (отгружен/закрыт)',
      '<b>Кнопки статуса договора</b> переделаны: теперь явно выглядят как кнопки (с границей, hover-эффектом, контрастным активным состоянием). Перед сменой статуса спрашивается подтверждение',
      '<b>Кликабельная номенклатура в спецификации:</b> клик по названию позиции открывает её карточку (фото, характеристики для продажных; модель — для производственных; комплектующее — для запчастей). Свободный ввод остаётся обычным текстом',
      '<b>Новая категория «Чиллеры»</b> в продажной номенклатуре',
      '<b>Фикс нумерации коробок:</b> после удаления всех коробок счётчик сбрасывается на #1. Раньше: удалил #1 и #2, создал новую → получала #3. Теперь — #1',
    ],
  },
  {
    version: 'v2.17.0',
    date: '20.05.2026',
    title: 'Дата оплаты + Исполнение/IP + Комплектующие в договоре',
    features: [
      '<b>Дата оплаты</b> в форме договора — срок отгрузки теперь считается от неё. Пока оплаты нет — показывается прогноз от даты подписания с пометкой «уточнится после оплаты»',
      '<b>Поле «Исполнение»</b> (обычное / нержавейка) в строке спецификации для воздухоохладителей, увлажнения, щитов управления',
      '<b>Поле «Влагозащита»</b> (IP44/IP54/IP65/IP66/IP67) в строке спецификации для щитов управления',
      '<b>Вкладка «Комплектующие»</b> в picker позиций договора — теперь можно отправлять клиенту запчасти отдельно',
    ],
  },
  {
    version: 'v2.9.0',
    date: '19.05.2026',
    title: 'Уровни доступа',
    features: [
      '<b>Полная переделка системы прав:</b> вместо фиксированных 6 ролей теперь настраиваемые «Уровни доступа» — директор сам собирает галочками что видит и может делать каждый сотрудник',
      'Новый экран <b>Кадры → Уровни доступа</b> — список уровней с раскрывающимися карточками. В каждом 25 разрешений по группам: Главная, Производство, Продажи, Склад, Логистика, Снабжение, Доработки, Задачи, Кадры',
      '5 базовых системных уровней создаются автоматически: Директор / Заместитель директора / Менеджер по продажам / Бухгалтер / Работник производства. Их можно редактировать (галочки), но не удалить',
      'Можно создавать свои уровни (Электромонтажник, Сборщик-слесарь, Кладовщик, Снабженец и т.д.) — копируешь подходящий, переименовываешь, доконфигурируешь',
      'В карточке сотрудника убран блок «Роли в системе» (6 чекбоксов), вместо него — выпадашка <b>«Уровень доступа»</b> + сводка что включает',
      '<b>Защита от потери доступа:</b> нельзя снять себе галочку «настраивать уровни доступа», если ты последний у кого она есть. Системные уровни нельзя удалить. Уровни с привязанными сотрудниками удалить нельзя',
      'Миграция произошла автоматически: всем существующим сотрудникам по их старым ролям выдан соответствующий системный уровень',
      'Все существующие проверки прав в коде продолжают работать через обратную совместимость (legacy-роли derive-ятся из permissions уровня)',
    ],
  },
  {
    version: 'v2.8.2',
    date: '19.05.2026',
    title: 'Справочник должностей и память экрана',
    features: [
      'Новый справочник <b>Должности</b> в Кадрах: создавать, переименовывать, скрывать. Сидинг 12 базовых: директор, заместитель, менеджер по продажам, главбух, бухгалтер, инженер-проектировщик, мастер производства, электромонтажник, сборщик-слесарь, кладовщик, снабженец, монтажник на выезде',
      'В карточке сотрудника поле <b>«Должность»</b> теперь с автоподсказкой из справочника + можно вписать своё',
      'При <b>F5/обновлении страницы</b> система запоминает где ты был и возвращает туда же (раньше всегда падало на Главную). Срок памяти — сутки. Формы создания/редактирования из памяти исключены чтобы не возвращать в незаконченный черновик',
      'Блок <b>«Последние действия»</b> на Главной теперь видит только директор',
    ],
  },
  {
    version: 'v2.8.0',
    date: '19.05.2026',
    title: 'Вход по паролю',
    features: [
      'Новый способ входа — <b>«По паролю»</b> на экране логина, для сотрудников, у которых нет Telegram',
      'Директор задаёт пароль в карточке сотрудника при создании или потом через редактирование',
      'Кнопка <b>«Сгенерировать»</b> создаёт случайный пароль из 8 символов (без неоднозначных букв и цифр)',
      'Сотрудник вводит <b>только пароль</b>, без выбора имени и табельного — система определяет, кто это, и здоровается: «Добро пожаловать, Иванов И.И.!»',
      'Пароль уникален в системе (защита от пересечений) и хранится в виде хеша PBKDF2',
      'У сотрудников с паролем в списке «Сотрудники» появилась иконка <i class="ti ti-key"></i>',
      'Кадровик и мастер по электрике теперь могут заходить без Telegram',
      'Telegram-вход продолжает работать как раньше — сотрудник с обоими способами может выбирать любой',
    ],
  },
  {
    version: 'v2.7.2',
    date: '18.05.2026',
    title: 'Спецификация договора',
    features: [
      'В карточке договора появился блок <b>«📋 Спецификация»</b> — список позиций, которые мы должны изготовить или поставить по договору',
      'Поле <b>«Позиция»</b> с подсказками по номенклатуре прямо при вводе',
      'Кнопка <b>▦ обзор</b> справа от поля — открывает модалку с двумя вкладками: <i>Производство</i> (модели из справочника, по направлениям) и <i>Продажи</i> (продажная номенклатура)',
      'Каждая позиция: название + количество + единица измерения',
      'Позиция помнит <code>model_id</code> если выбрана из Производства — для связи со сборками в будущем',
      'Можно вписать свободный текст без выбора из номенклатуры',
      'Подробнее — в статье «Спецификация договора»',
    ],
  },
  {
    version: 'v2.7.0',
    date: '17.05.2026',
    title: 'Отгрузки по QR',
    features: [
      'Новый экран <b>«Отгрузка»</b> в карточке договора с прогресс-баром <b>N / Total</b>',
      'Кладовщик сканирует QR коробок/сборок при погрузке — система автоматически помечает их как отгруженные',
      'Два списка: <b>«Ожидают отгрузки»</b> и <b>«Отгружено»</b> с историей (кто и когда сканировал)',
      'Поддерживаются <b>QR коробок</b> (упаковка с несколькими сборками) и <b>QR сборок</b>',
      'Прогресс отгрузки сохраняется между сессиями — можно грузить частями',
      'Старая кнопка «Отгрузить по договору» по-прежнему доступна, но новый процесс через QR — рекомендуемый',
      'Подробнее — в статье «Отгрузка по QR»',
    ],
  },
  {
    version: 'v2.6.0',
    date: '16.05.2026',
    title: 'Мобильный редизайн',
    features: [
      'Новая <b>нижняя панель</b> на телефонах: Главная / Поиск / + / Уведомления / Аккаунт',
      'Центральная кнопка <b>«+»</b> открывает action sheet с 6 быстрыми действиями (сборка, договор, КП, задача, замечание, скан)',
      '<b>Drawer-бургер</b> в шапке каждого раздела — открывает боковое меню как ящик слева',
      '<b>Глобальный поиск</b>-overlay по договорам, задачам, контрагентам и доработкам',
      '<b>Уведомления</b> — отдельный overlay с последними событиями',
      'На Главной — недельный календарь и блок быстрых действий 2×2',
      'Прокручиваемые верхние табы со стрелками управления (всегда видны, приглушаются на краях)',
      'Мобильное Производство переделано под новые табы',
      'Подробнее — в статье «Мобильная навигация»',
    ],
  },
  {
    version: 'v2.5.0',
    date: '15.05.2026',
    title: 'Универсальные работы + кнопки доработки и отправки',
    features: [
      'В Производстве теперь не только сборки — <b>8 типов работ</b>: Сборка / Ремонт / Пусконаладка / Монтаж / Диагностика / Проектирование / ТО / Прочее',
      'Для не-сборок: поля <b>«Что было сделано»</b>, <b>«Где»</b> (объект), <b>«Часы работы»</b>',
      'Не-сборки <b>не попадают на склад</b> — это услуга, а не товар',
      'В карточке сборки/работы кнопка <b>«🟠 Доработка»</b> — сотрудник может сам зарегистрировать замечание (имя предзаполнено)',
      'Кнопка <b>«🟢 Монтажнику»</b> — копирование ссылки, Telegram-share или QR для отправки монтажнику',
      'Цветной бейдж типа работы в шапке карточки',
      'Поле "Описание работы" заметно подсвечено в карточке (оранжевая полоса слева)',
    ],
  },
  {
    version: 'v2.4.4',
    date: '15.05.2026',
    title: 'Мобильные табы — прокрутка с индикатором',
    features: [
      'Синяя круглая кнопка <b>→</b> на мобильных табах когда есть скрытые разделы',
      'Fade-эффект по краям подсказывает что можно листать',
      'Автоскролл активного раздела в видимую зону',
    ],
  },
  {
    version: 'v2.4.3',
    date: '15.05.2026',
    title: 'Расширенная База знаний',
    features: [
      'Новые категории: <b>QR-коды</b>, <b>Доработки</b>, <b>Кадры</b>',
      '7 новых пошаговых статей с реальными примерами',
      '9 новых вопросов в FAQ',
      'Подробное «Что нового» с timeline-релизов',
    ],
  },
  {
    version: 'v2.4.2',
    date: '15.05.2026',
    title: 'Прокручиваемые вкладки в шапке',
    features: [
      'Стрелки <i class="ti ti-chevron-left"></i> <i class="ti ti-chevron-right"></i> для прокрутки вкладок в шапке',
      'Лёгкий fade-эффект по краям — намёк что есть скрытое',
      'Колесо мыши над nav прокручивает горизонтально',
      'Свайп пальцем на сенсорных экранах',
      'Автоскролл активного таба в видимую зону',
    ],
  },
  {
    version: 'v2.4.0',
    date: '15.05.2026',
    title: 'Доработки — замечания с поля',
    features: [
      'Новый раздел <b>«Доработки»</b> для дефектов, замечаний и улучшений',
      '4 типа замечаний: дефект / замечание / улучшение / вопрос',
      'Кнопка «🔔 Сообщить о замечании» на публичных страницах сборок и договоров',
      'Замечание может оставить любой по QR — даже без логина',
      'Загрузка до 5 фото, лимит 8 МБ каждое (поддерживается HEIC для iPhone)',
      'Workflow статусов: новое → в работе → решено / отклонено',
      'Привязка к сборке и/или к договору, поля автора, локации',
      'Просмотр фото в полноэкранном лайтбоксе',
    ],
  },
  {
    version: 'v2.3.0',
    date: '15.05.2026',
    title: 'QR-коды и сканер',
    features: [
      'QR-код на каждой сборке и каждом договоре',
      'Сканер QR прямо в приложении — кнопка <b>📷 Скан</b> в шапке',
      '3 способа сканировать: камера / фото из галереи / ручной ввод',
      'Печать наклеек 58×60мм для термопринтера (одна или массово)',
      'Чекбоксы в Складе → панель «Выбрано N · Печать наклеек»',
      'Публичные страницы сборок и договоров (по QR без логина)',
      'Гибрид: сотрудник попадает в карточку CRM, посторонний — на публичную страницу',
    ],
  },
  {
    version: 'v2.2.0',
    date: '14.05.2026',
    title: 'Дизайн и навигация',
    features: [
      'Полная переработка дизайна: фирменный градиент шапки, рамка-карточка по периметру',
      'Логотип Atom CRM (вместо Atomus Group)',
      'Главная как стартовый экран при F5',
      'Большой календарь событий на Главной',
      'Виджеты сайдбара: ссылки на Max, Почту, Диск',
    ],
  },
  {
    version: 'v2.1.0',
    date: '14.05.2026',
    title: 'Снабжение',
    features: [
      'Раздел <b>Снабжение</b> с полным циклом: заявки → заказы → приёмки',
      'Справочник поставщиков с контактами и ИНН',
      'Каталог закупок (комплектующие + товары для перепродажи)',
      'Связь заявок с договорами (опционально)',
      'Автоматическое обновление статусов: заявка «в заказе» → «получена» после приёмки',
      'Частичные приёмки — можно довезти позже',
    ],
  },
  {
    version: 'v2.0.5',
    date: '14.05.2026',
    title: 'Кадры — отпуска',
    features: [
      'Новый раздел <b>«Кадры»</b>',
      '3 представления отпусков: Таймлайн / Список / Календарь',
      'Графики занятости — видно пересечения отпусков',
      'Типы отпусков: основной / без сохранения / больничный',
    ],
  },
  {
    version: 'v2.0.0',
    date: '14.05.2026',
    title: 'Склад',
    features: [
      'Новый раздел <b>Склад</b> с остатками и журналом движений',
      'Статусы сборок: «готова» / «отгружена» / «списана»',
      'Резервирование сборок за договорами',
      'Кнопка <b>«Отгрузить по договору»</b> в карточке договора — одним кликом',
      'Списание брака с указанием причины',
      'Сводка по складу: всего / свободных / зарезервировано',
    ],
  },
  {
    version: 'v1.9.0',
    date: '14.05.2026',
    title: 'Связь задач с договорами',
    features: [
      'Опциональная привязка задачи к договору',
      'В карточке договора — блок <b>«Задачи по договору»</b> со счётчиком',
      'Кнопка «+ Новая задача» из карточки договора — привязка подставляется автоматически',
      'Бейдж договора в строке задачи (кликабельный)',
    ],
  },
  {
    version: 'v1.8.1',
    date: '14.05.2026',
    title: 'Пакет хотфиксов',
    features: [
      'Новый логотип Atomus group в шапке и на странице входа',
      'Прозрачный логотип в PDF коммерческого предложения',
      'Имя пользователя корректно отображается в шапке',
      'Категории не обрезаются на узких экранах',
      'Поле поиска не залазит на иконку',
    ],
  },
  {
    version: 'v1.8.0',
    date: '13.05.2026',
    title: 'Категории продажной номенклатуры + Word-экспорт КП',
    features: [
      'Категории в продажном каталоге',
      'Экспорт КП в формат <b>.docx</b> (Word) — для дальнейших правок',
    ],
  },
  {
    version: 'v1.7.0',
    date: '12.05.2026',
    title: 'Задачи',
    features: [
      'Полноценный модуль <b>Задачи</b>: создание, исполнители, дедлайны, приоритеты',
      'Уведомления в Telegram о назначении и приближающихся дедлайнах',
      'Виджет «Мои задачи» на Главной',
    ],
  },
];

// ---------- Категории сайдбара для группировки ----------
// ============================================================
// v2.44.40: ИНТЕРАКТИВНЫЕ ГАЙДЫ ПО ШАГАМ
// ============================================================
// Туры описаны декларативно: для каждого шага можно указать
// screen (куда перевести юзера), selector (что подсветить),
// title + text (что объяснить), pos (где показывать tooltip).

const TOURS = {
  'master-first-assembly': {
    title: 'Моя первая работа (для мастера)',
    icon: 'ti-tool',
    summary: 'Пошагово: где находится канбан, как взять работу в руки, отметить прогресс и сдать на проверку.',
    steps: [
      {
        section: 'production',
        screen: 'dashboard',
        selector: '.section-tab.active, .m-section-tabs button.active, .pkb-section-header',
        title: 'Раздел «Производство»',
        text: 'Мы переключились на твою основную вкладку. Тут всё, что касается работ: канбан, сборки, сводки.',
        pos: 'bottom',
      },
      {
        section: 'production',
        screen: 'dashboard',
        selector: '.pkb-col-tabs, .pkb-board',
        title: 'Канбан производства',
        text: 'Канбан показывает все производственные работы по статусам: <b>В очереди</b> → <b>В работе</b> → <b>На проверке</b> → <b>Упаковка</b> → <b>Готово</b>.',
        pos: 'top',
      },
      {
        section: 'production',
        screen: 'dashboard',
        selector: '.pkb-col.c-queue',
        title: 'Колонка «В очереди»',
        text: 'Здесь работы ждут, пока кто-то возьмёт их в руки. Найди работу, которую делаешь, и открой её карточку кликом.',
        pos: 'right',
      },
      {
        section: 'production',
        screen: 'dashboard',
        selector: '.pkb-col.c-queue .pkb-wc, .pkb-col.c-active .pkb-wc',
        title: 'Карточка работы',
        text: 'Открой любую карточку чтобы увидеть детали: что собираем, сколько штук, к какому договору, какие комплектующие нужны.',
        pos: 'right',
      },
      {
        section: 'production',
        screen: 'dashboard',
        action: 'open-first-queue-card',
        selector: '.pkb-detail-actions .pkb-btn.primary, button[onclick*="changeProductionWorkStatus"][onclick*="in_progress"]',
        title: 'Взять в работу',
        text: 'В подвале карточки нажми <b>«Взять в работу»</b> — работа уходит из «Очереди» в «В работе» и запускается счётчик часов.',
        pos: 'right',
      },
      {
        section: 'production',
        screen: 'dashboard',
        selector: '.pwd-progress-block, .pwd-progress-presets',
        title: 'Отмечай прогресс',
        text: 'Используй кнопки <b>25 / 50 / 75 / 100%</b>, чтобы коллеги и директор видели где ты. В комментарий ниже пиши о проблемах: «не пришла крышка», «надо точить заново».',
        pos: 'right',
      },
      {
        section: 'production',
        screen: 'dashboard',
        selector: 'button[onclick*="openAddCoAssigneeModal"], .pwd-help-add',
        title: 'Соисполнители',
        text: 'Если тебе помогает кто-то ещё — нажми <b>«Подключить»</b> в строке Соисполнители и выбери его. Его часы тоже посчитаются.',
        pos: 'right',
      },
      {
        section: 'production',
        screen: 'dashboard',
        selector: '.pkb-detail-actions',
        title: 'Закончил — на проверку',
        text: 'Когда работа готова, в подвале карточки нажми <b>«На проверку»</b> (появится после взятия в работу). Кладовщик/директор примет и переведёт в «Упаковку», затем «Готово».',
        pos: 'right',
      },
      {
        title: 'Готово!',
        text: 'Это полный круг от начала до сдачи работы. Если что-то непонятно — в Помощи есть отдельные статьи по каждому шагу.',
        pos: 'center',
      },
    ],
  },
  'master-defect-report': {
    title: 'Как отметить брак / доработку',
    icon: 'ti-alert-circle',
    summary: 'Если нашёл проблему в сборке — как занести её в Сервис.',
    steps: [
      {
        section: 'defects',
        screen: 'defects-list-new',
        selector: '.page-header',
        title: 'Раздел «Сервис»',
        text: 'Тут регистрируются все доработки и претензии: и свои, и от клиентов.',
        pos: 'bottom',
      },
      {
        section: 'defects',
        screen: 'defects-list-new',
        selector: '.page-header .btn-primary, [onclick*="openNewDefect"]',
        title: 'Новая доработка',
        text: 'Нажми «Новая» и опиши проблему: что не так, какая сборка, кто заметил. К доработке можно прикрепить фото.',
        pos: 'left',
      },
      {
        title: 'Дальше',
        text: 'Директор увидит доработку в списке «Новые», назначит исполнителя и срок. Чат внутри карточки — для обсуждения.',
        pos: 'center',
      },
    ],
  },
};

let tourState = null;   // { tourId, stepIdx, tour }

function startTour(tourId) {
  const tour = TOURS[tourId];
  if (!tour) { showToast('Гайд не найден', 'error'); return; }
  tourState = { tourId, stepIdx: 0, tour };
  ensureTourDom();
  // Закроем модал помощи если открыт
  document.querySelectorAll('.modal-overlay.visible').forEach(m => m.classList.remove('visible'));
  goToTourStep(0);
}

function ensureTourDom() {
  if (document.getElementById('tour-overlay')) return;
  const o = document.createElement('div');
  o.id = 'tour-overlay';
  o.className = 'tour-overlay';
  o.innerHTML =
    '<div class="tour-mask" id="tour-mask-top"></div>' +
    '<div class="tour-mask" id="tour-mask-bottom"></div>' +
    '<div class="tour-mask" id="tour-mask-left"></div>' +
    '<div class="tour-mask" id="tour-mask-right"></div>' +
    '<div class="tour-spotlight" id="tour-spotlight" style="display:none;"></div>' +
    '<div class="tour-tooltip pos-bottom" id="tour-tooltip">' +
      '<div class="tour-tooltip-step" id="tour-step-label"></div>' +
      '<div class="tour-tooltip-title" id="tour-step-title"></div>' +
      '<div class="tour-tooltip-text" id="tour-step-text"></div>' +
      '<div class="tour-tooltip-actions">' +
        '<button class="btn-link" onclick="closeTour()">Пропустить</button>' +
        '<button class="btn btn-secondary btn-sm" id="tour-prev-btn" onclick="tourPrev()"><i class="ti ti-arrow-left"></i>Назад</button>' +
        '<button class="btn btn-primary btn-sm" id="tour-next-btn" onclick="tourNext()">Дальше<i class="ti ti-arrow-right"></i></button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(o);
}

async function goToTourStep(idx) {
  if (!tourState) return;
  const step = tourState.tour.steps[idx];
  if (!step) { closeTour(); return; }
  tourState.stepIdx = idx;

  // Переключаем section если задан (selectSection меняет sidebar + screen)
  if (step.section && typeof selectSection === 'function') {
    selectSection(step.section);
    await new Promise(r => setTimeout(r, 350));
  }
  // Переключаем конкретный экран внутри section
  if (step.screen) {
    selectSidebarItem(step.screen);
    await new Promise(r => setTimeout(r, 280));
  }

  // Дополнительное действие шага — например открыть карточку
  if (step.action === 'open-first-queue-card') {
    const card = document.querySelector('.pkb-col.c-queue .pkb-wc[data-work-id]')
              || document.querySelector('.pkb-col.c-active .pkb-wc[data-work-id]');
    if (card && typeof openProductionWorkDetail === 'function') {
      const wid = parseInt(card.getAttribute('data-work-id'), 10);
      if (wid) {
        openProductionWorkDetail(wid);
        // Не ждём фиксированное время — селектор-поллинг ниже сам дождётся.
      }
    }
  }

  // Ищем ВИДИМЫЙ элемент по селектору (пропускаем скрытые дубликаты desktop/mobile).
  // Поллим до 2.5с — модалки/контент рендерятся асинхронно после fetch.
  function _tourFindVisible(sel) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const candidates = document.querySelectorAll(sel);
    for (const el of candidates) {
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 4 || r.height <= 4) continue;
      if (r.right < 0 || r.left > vw) continue;
      if (r.bottom < 0 || r.top > vh + 800) continue;
      return el;
    }
    return null;
  }
  let target = null;
  if (step.selector && step.pos !== 'center') {
    target = _tourFindVisible(step.selector);
    // Поллим селектор — DOM может рендериться асинхронно (модалки, фетчи и т.п.).
    // С action ждём дольше (модалка только что открыта), иначе короче.
    if (!target) {
      const budget = step.action ? 2500 : 800;
      const deadline = Date.now() + budget;
      while (!target && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 120));
        target = _tourFindVisible(step.selector);
      }
    }
    // Прокрутим в видимую область и переоценим rect после скролла
    if (target) {
      try { target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); }
      catch (_) { target.scrollIntoView(); }
      // Двойной requestAnimationFrame чтобы дождаться layout после скролла
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r2 = target.getBoundingClientRect();
      const vw2 = window.innerWidth, vh2 = window.innerHeight;
      // Если после скролла rect всё ещё мусорный — отказываемся от target,
      // упадём в no-target ветку (по центру + дим всего экрана).
      if (r2.width <= 4 || r2.height <= 4 ||
          r2.right < 20 || r2.left > vw2 - 20 ||
          r2.bottom < 20 || r2.top > vh2 - 20) {
        console.warn('Tour: target rect off-screen after scroll, falling back', r2);
        target = null;
      }
    }
  }

  const overlay = document.getElementById('tour-overlay');
  if (!overlay) return;
  overlay.style.removeProperty('display');    // полностью убрать inline display, чтобы CSS-класс мог управлять
  overlay.classList.add('active');
  overlay.style.display = 'block';            // и явно покажем — на случай если CSS не применился

  // Заполняем тексты
  document.getElementById('tour-step-label').textContent =
    'Шаг ' + (idx + 1) + ' из ' + tourState.tour.steps.length;
  document.getElementById('tour-step-title').textContent = step.title || '';
  document.getElementById('tour-step-text').innerHTML = step.text || '';
  document.getElementById('tour-prev-btn').style.display = idx > 0 ? '' : 'none';
  document.getElementById('tour-next-btn').textContent =
    idx === tourState.tour.steps.length - 1 ? 'Завершить' : 'Дальше';

  positionTour(target, step.pos || 'bottom');
}

function positionTour(target, pos) {
  const spot = document.getElementById('tour-spotlight');
  const tip = document.getElementById('tour-tooltip');
  const mt = document.getElementById('tour-mask-top');
  const mb = document.getElementById('tour-mask-bottom');
  const ml = document.getElementById('tour-mask-left');
  const mr = document.getElementById('tour-mask-right');

  if (!target) {
    spot.style.display = 'none';
    mt.style.cssText = 'top:0;left:0;right:0;bottom:0;';
    mb.style.cssText = 'display:none;';
    ml.style.cssText = 'display:none;';
    mr.style.cssText = 'display:none;';
    tip.style.transform = '';
    // Если открыта модалка — паркуем tooltip правее неё, чтобы не перекрывал.
    const openModal = document.querySelector('.modal-overlay.visible .modal');
    if (openModal) {
      const mr2 = openModal.getBoundingClientRect();
      const tipW = 360, tipH = 200;
      const vw = window.innerWidth, vh = window.innerHeight;
      let tl = mr2.right + 14;
      // Не помещается справа — паркуем слева от модалки
      if (tl + tipW + 12 > vw) tl = Math.max(12, mr2.left - tipW - 14);
      let tt = Math.max(12, Math.min(vh - tipH - 12, mr2.top + 12));
      tip.style.left = tl + 'px';
      tip.style.top = tt + 'px';
      tip.className = 'tour-tooltip pos-left';
    } else {
      // Нет модалки — tooltip по центру экрана
      tip.style.left = '50%';
      tip.style.top = '50%';
      tip.style.transform = 'translate(-50%, -50%)';
      tip.className = 'tour-tooltip';
    }
    return;
  }

  const r = target.getBoundingClientRect();
  const pad = 6;
  const sx = r.left - pad;
  const sy = r.top - pad;
  const sw = r.width + pad * 2;
  const sh = r.height + pad * 2;
  spot.style.display = '';
  spot.style.left = sx + 'px';
  spot.style.top = sy + 'px';
  spot.style.width = sw + 'px';
  spot.style.height = sh + 'px';
  // Маски не нужны — spotlight даёт box-shadow на весь экран
  mt.style.cssText = 'display:none;';
  mb.style.cssText = 'display:none;';
  ml.style.cssText = 'display:none;';
  mr.style.cssText = 'display:none;';

  // Если target внутри модалки — tooltip уносим правее всей модалки,
  // чтобы он не перекрывал её содержимое.
  const inModal = target.closest('.modal-overlay.visible .modal');
  const refRect = inModal ? inModal.getBoundingClientRect() : r;

  // Позиционируем tooltip рядом
  const tipW = 360;
  const tipH = 200;
  let tl, tt, posCls = 'pos-bottom';
  if (pos === 'right') {
    tl = refRect.right + 14;
    tt = r.top;
    posCls = 'pos-left';
  } else if (pos === 'left') {
    tl = refRect.left - tipW - 14;
    tt = r.top;
    posCls = 'pos-right';
  } else if (pos === 'top') {
    tl = r.left;
    tt = r.top - tipH - 14;
    posCls = 'pos-bottom';   // arrow pointing down
  } else {
    // bottom
    tl = r.left;
    tt = r.bottom + 14;
    posCls = 'pos-top';
  }
  // Удерживаем в пределах окна
  tl = Math.max(12, Math.min(window.innerWidth - tipW - 12, tl));
  tt = Math.max(12, Math.min(window.innerHeight - tipH - 12, tt));
  tip.style.left = tl + 'px';
  tip.style.top = tt + 'px';
  tip.style.transform = '';
  tip.className = 'tour-tooltip ' + posCls;
}

function tourNext() {
  if (!tourState) return;
  const next = tourState.stepIdx + 1;
  if (next >= tourState.tour.steps.length) { closeTour(); return; }
  goToTourStep(next);
}
function tourPrev() {
  if (!tourState) return;
  if (tourState.stepIdx === 0) return;
  goToTourStep(tourState.stepIdx - 1);
}
function closeTour() {
  const o = document.getElementById('tour-overlay');
  if (o) {
    o.classList.remove('active');
    o.style.display = 'none';        // подстраховка — даже если active не снимется, гайд скроется
  }
  tourState = null;
}

/* ============ ЭТАП 48 (v2.44.46): РАЗРАБОТКА ОБОРУДОВАНИЯ ============
   Идеи, чертежи, 3D-демки, чат — всё внутри одной карточки.
   API: /api/developments, /api/developments/{id}/files, /api/developments/{id}/chat
*/
const _devState = {
  items: [],
  currentId: null,
  current: null,
  files: [],
  messages: [],
  participants: [],
  _saveTimer: null,
  _chatPollTimer: null,
};

function _devUserIsDirector() {
  return !!(state.user && state.user.roles && state.user.roles.indexOf('director') >= 0);
}

async function loadDevelopments() {
  const listEl = document.getElementById('dev-list');
  if (listEl) listEl.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const res = await fetch(API_BASE + '/api/developments', {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    _devState.items = data.items || [];
    renderDevelopmentsList();
    // если был выбран — обновим
    if (_devState.currentId && !_devState.items.find(x => x.id === _devState.currentId)) {
      _devState.currentId = null;
      renderDevelopmentDetail(null);
    }
  } catch (e) {
    if (listEl) listEl.innerHTML = '<div class="dev-list-empty">Не удалось загрузить</div>';
    console.error('loadDevelopments', e);
  }
}

function renderDevelopmentsList() {
  const listEl = document.getElementById('dev-list');
  if (!listEl) return;
  const q = (document.getElementById('dev-search')?.value || '').toLowerCase().trim();
  const items = _devState.items.filter(it =>
    !q || (it.name || '').toLowerCase().includes(q)
  );
  if (!items.length) {
    listEl.innerHTML = '<div class="dev-list-empty">' +
      (q ? 'Ничего не найдено' : 'Пока нет ни одной разработки. Нажми «Новая разработка».') +
    '</div>';
    return;
  }
  listEl.innerHTML = items.map(it => {
    const active = it.id === _devState.currentId ? ' active' : '';
    const files = parseInt(it.files_count || 0);
    const msgs  = parseInt(it.messages_count || 0);
    const date  = _devFormatDate(it.updated_at || it.created_at);
    return '<div class="dev-list-card' + active + '" onclick="openDevelopment(' + it.id + ')">' +
      '<div class="dev-list-card-title">' + escapeHtml(it.name || '—') + '</div>' +
      '<div class="dev-list-card-meta">' +
        (files ? '<span><i class="ti ti-paperclip"></i>' + files + '</span>' : '') +
        (msgs  ? '<span><i class="ti ti-message-circle"></i>' + msgs + '</span>' : '') +
        (it.demo_url ? '<span title="Есть 3D-демка"><i class="ti ti-cube"></i></span>' : '') +
        '<span class="ml-auto" style="margin-left:auto;">' + escapeHtml(date) + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function openDevelopment(devId) {
  _devState.currentId = devId;
  renderDevelopmentsList();
  const pane = document.getElementById('dev-detail-pane');
  if (pane) pane.innerHTML = '<div class="loading-block">Загружаем…</div>';
  try {
    const res = await fetch(API_BASE + '/api/developments/' + devId, {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    _devState.current  = data.development;
    _devState.files    = data.files || [];
    _devState.messages = data.messages || [];
    renderDevelopmentDetail(_devState.current);
    _startDevChatPolling();
  } catch (e) {
    if (pane) pane.innerHTML = '<div class="dev-empty"><i class="ti ti-alert-triangle"></i><div class="dev-empty-title">Не удалось загрузить</div></div>';
    console.error('openDevelopment', e);
  }
}

function renderDevelopmentDetail(dev) {
  const pane = document.getElementById('dev-detail-pane');
  if (!pane) return;
  if (!dev) {
    pane.innerHTML = '<div class="dev-empty"><i class="ti ti-bulb"></i>' +
      '<div class="dev-empty-title">Выбери разработку из списка</div>' +
      '<div class="dev-empty-sub">или создай новую кнопкой «+»</div>' +
    '</div>';
    return;
  }
  const safeName = escapeHtml(dev.name || '');
  const safeDesc = escapeHtml(dev.description || '');
  const safeUrl  = escapeHtml(dev.demo_url || '');
  const createdStr = _devFormatDate(dev.created_at);
  const updatedStr = _devFormatDate(dev.updated_at);

  pane.innerHTML =
    '<div class="dev-detail-head">' +
      '<div class="dev-detail-head-info">' +
        '<input type="text" class="dev-detail-name-input" id="dev-name-input" ' +
               'value="' + safeName + '" placeholder="Название разработки…" ' +
               'oninput="_devScheduleSave()">' +
        '<div class="dev-detail-meta">' +
          '<span><i class="ti ti-calendar"></i>Создано ' + escapeHtml(createdStr) + '</span>' +
          '<span><i class="ti ti-refresh"></i>Обновлено ' + escapeHtml(updatedStr) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="dev-detail-head-actions">' +
        '<button class="btn btn-secondary btn-sm" onclick="openDevInviteModal()" title="Пригласить на участие">' +
          '<i class="ti ti-user-plus"></i><span class="dev-btn-label"> Пригласить</span></button>' +
        (_devUserIsDirector()
          ? '<button class="icon-btn" onclick="deleteCurrentDevelopment()" title="Удалить разработку">' +
              '<i class="ti ti-trash"></i></button>'
          : ''
        ) +
      '</div>' +
    '</div>' +
    '<div class="dev-detail-body">' +
      // Описание
      '<div class="dev-section">' +
        '<div class="dev-section-title">' +
          '<i class="ti ti-align-left"></i>Описание' +
          '<button class="dev-link-btn" onclick="openDevDescriptionModal()" title="Открыть в отдельной карточке">' +
            '<i class="ti ti-arrows-diagonal"></i>Раскрыть</button>' +
        '</div>' +
        '<textarea class="dev-description-textarea" id="dev-desc-input" ' +
                  'placeholder="Что разрабатываем, зачем, кому нужно…" ' +
                  'oninput="_devScheduleSave()">' + safeDesc + '</textarea>' +
      '</div>' +
      // 3D / демка URL
      '<div class="dev-section">' +
        '<div class="dev-section-title"><i class="ti ti-cube"></i>Ссылка на 3D / демонстрацию</div>' +
        '<div class="dev-demo-row">' +
          '<input type="url" class="dev-demo-input" id="dev-demo-input" ' +
                 'value="' + safeUrl + '" placeholder="https://claude.ai/chat/… или /3d/humidifier_viewer.html" ' +
                 'oninput="_devScheduleSave();_devUpdateDemoLink();_devUpdateDemoEmbed()">' +
          (dev.demo_url
            ? '<a class="dev-demo-link" id="dev-demo-link" href="' + safeUrl + '" target="_blank" rel="noopener">' +
                '<i class="ti ti-external-link"></i>Открыть</a>'
            : '<a class="dev-demo-link" id="dev-demo-link" href="#" target="_blank" rel="noopener" style="display:none;">' +
                '<i class="ti ti-external-link"></i>Открыть</a>'
          ) +
        '</div>' +
        '<div id="dev-demo-embed">' + _devDemoEmbedHtml(dev.demo_url) + '</div>' +
      '</div>' +
      // Файлы
      '<div class="dev-section">' +
        '<div class="dev-section-title"><i class="ti ti-paperclip"></i>Файлы и чертежи</div>' +
        '<div class="dev-files-drop" id="dev-drop-zone" onclick="document.getElementById(\'dev-file-input\').click()">' +
          '<i class="ti ti-cloud-upload"></i>' +
          '<div><b>Перетащи файлы сюда</b> или нажми для выбора</div>' +
          '<div style="font-size:11.5px;margin-top:2px;">До 50 МБ на файл · 3D-модели, чертежи, PDF, фото</div>' +
          '<input type="file" id="dev-file-input" multiple style="display:none;" onchange="uploadDevelopmentFiles(this.files)">' +
        '</div>' +
        '<div class="dev-files-list" id="dev-files-list"></div>' +
      '</div>' +
      // Участники (приглашённые)
      '<div class="dev-section" id="dev-participants-section" style="display:none;">' +
        '<div class="dev-section-title">' +
          '<i class="ti ti-users"></i>Приглашённые участники' +
          '<button class="dev-link-btn" onclick="openDevInviteModal()" title="Скопировать ссылку приглашения">' +
            '<i class="ti ti-share"></i>Ссылка</button>' +
        '</div>' +
        '<div class="dev-participants-list" id="dev-participants-list"></div>' +
      '</div>' +
      // Чат
      '<div class="dev-section">' +
        '<div class="dev-section-title"><i class="ti ti-message-circle"></i>Обсуждение</div>' +
        '<div class="dev-chat">' +
          '<div class="dev-chat-messages" id="dev-chat-messages"></div>' +
          '<div class="dev-chat-input-row">' +
            '<textarea class="dev-chat-input" id="dev-chat-input" rows="1" ' +
                      'placeholder="Написать сообщение… (Ctrl+Enter — отправить)" ' +
                      'onkeydown="_devChatKeydown(event)"></textarea>' +
            '<button class="dev-chat-send" onclick="sendDevelopmentMessage()">' +
              '<i class="ti ti-send"></i>Отправить</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  _setupDevDropZone();
  renderDevelopmentFiles();
  renderDevelopmentMessages();
  // подгрузить список участников и показать, если кто-то уже регнулся
  loadDevelopmentParticipants();
}

async function loadDevelopmentParticipants() {
  if (!_devState.currentId) return;
  try {
    const res = await fetch(API_BASE + '/api/developments/' + _devState.currentId + '/participants', {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!res.ok) return;
    const j = await res.json();
    _devState.participants = j.items || [];
    renderDevelopmentParticipants();
  } catch (_) {}
}

function renderDevelopmentParticipants() {
  const section = document.getElementById('dev-participants-section');
  const list    = document.getElementById('dev-participants-list');
  if (!section || !list) return;
  const items = _devState.participants || [];
  if (!items.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  const canRemove = _devUserIsDirector();
  list.innerHTML = items.map(p => {
    const initials = (p.name || '?').trim().split(/\s+/).slice(0,2).map(w => w[0] || '').join('').toUpperCase();
    const phoneHtml = p.phone
      ? '<span><i class="ti ti-phone" style="font-size:11px;"></i><a href="tel:' + escapeHtml(p.phone) + '">' + escapeHtml(p.phone) + '</a></span>'
      : '';
    const removeBtn = canRemove
      ? '<button class="dev-participant-x" onclick="removeDevelopmentParticipant(' + p.id + ', \'' + escapeHtml(p.name).replace(/'/g, "\\'") + '\')" title="Удалить участника"><i class="ti ti-x"></i></button>'
      : '';
    return '<div class="dev-participant-row">' +
      '<div class="dev-participant-avatar">' + escapeHtml(initials || '?') + '</div>' +
      '<div class="dev-participant-info">' +
        '<div class="dev-participant-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="dev-participant-meta">' +
          phoneHtml +
          '<span><i class="ti ti-clock" style="font-size:11px;"></i>' + escapeHtml(_devFormatDate(p.joined_at)) + '</span>' +
        '</div>' +
      '</div>' +
      removeBtn +
    '</div>';
  }).join('');
}

async function removeDevelopmentParticipantFromInviteModal(participantId, name) {
  await removeDevelopmentParticipant(participantId, name);
  // перерисовать модалку — проще закрыть и переоткрыть
  const m = document.getElementById('dev-invite-modal');
  if (m) m.remove();
  setTimeout(() => openDevInviteModal(), 50);
}

async function removeDevelopmentParticipant(participantId, name) {
  if (!_devUserIsDirector()) return;
  if (!confirm('Удалить участника «' + name + '»? Его доступ к разработке будет отозван.')) return;
  try {
    const res = await fetch(API_BASE + '/api/development-participants/' + participantId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j.message || 'Не удалось удалить', 'error');
      return;
    }
    _devState.participants = _devState.participants.filter(p => p.id !== participantId);
    renderDevelopmentParticipants();
    showToast('Участник удалён', 'success');
  } catch (e) {
    showToast('Сеть: не удалось удалить', 'error');
  }
}

async function openDevInviteModal() {
  if (!_devState.currentId) return;
  // 1) получаем (или создаём) public_token
  let token = _devState.current && _devState.current.public_token;
  if (!token) {
    try {
      const res = await fetch(API_BASE + '/api/developments/' + _devState.currentId + '/invite', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
      });
      if (!res.ok) { showToast('Не удалось создать приглашение', 'error'); return; }
      const j = await res.json();
      token = j.public_token;
      if (_devState.current) _devState.current.public_token = token;
    } catch (e) { showToast('Сеть: не удалось создать приглашение', 'error'); return; }
  }
  const inviteUrl = window.location.origin + '/dev/' + token;

  // 2) Перезагрузим участников, чтобы показать актуальный список
  await loadDevelopmentParticipants();
  const participants = _devState.participants || [];
  const canRemoveInv = _devUserIsDirector();
  const participantsHtml = participants.length
    ? participants.map(p => {
        const initials = (p.name || '?').trim().split(/\s+/).slice(0,2).map(w => w[0] || '').join('').toUpperCase();
        const removeBtn = canRemoveInv
          ? '<button class="dev-participant-x" onclick="removeDevelopmentParticipantFromInviteModal(' + p.id + ', \'' + escapeHtml(p.name).replace(/'/g, "\\'") + '\')" title="Удалить участника"><i class="ti ti-x"></i></button>'
          : '';
        return '<div class="dev-participant-row">' +
          '<div class="dev-participant-avatar">' + escapeHtml(initials) + '</div>' +
          '<div class="dev-participant-info">' +
            '<div class="dev-participant-name">' + escapeHtml(p.name) + '</div>' +
            '<div class="dev-participant-meta">' +
              (p.phone ? '<span><i class="ti ti-phone" style="font-size:11px;"></i>' + escapeHtml(p.phone) + '</span>' : '') +
              '<span><i class="ti ti-clock" style="font-size:11px;"></i>' + escapeHtml(_devFormatDate(p.joined_at)) + '</span>' +
            '</div>' +
          '</div>' +
          removeBtn +
        '</div>';
      }).join('')
    : '<div style="color:var(--text-light);font-size:13px;padding:10px;text-align:center;">Пока никто не присоединился</div>';

  const overlayId = 'dev-invite-modal';
  let m = document.getElementById(overlayId);
  if (m) m.remove();
  m = document.createElement('div');
  m.id = overlayId;
  m.className = 'modal-overlay';
  m.innerHTML =
    '<div class="modal">' +
      '<div class="modal-header">' +
        '<h2><i class="ti ti-user-plus"></i> Пригласить на участие</h2>' +
        '<button class="icon-btn" onclick="document.getElementById(\'' + overlayId + '\').remove()">' +
          '<i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        '<div class="dev-invite-modal-body">' +
          '<div class="dev-invite-explain">' +
            '<b>Как это работает:</b> отправь ссылку коллеге, заказчику или любому, кого хочешь пригласить. ' +
            'Он откроет страницу, введёт имя и телефон и сможет смотреть разработку, скачивать файлы и писать в чат.' +
          '</div>' +
          '<div>' +
            '<div class="dev-invite-participants-title" style="margin-bottom:6px;">Ссылка-приглашение</div>' +
            '<div class="dev-invite-link-row">' +
              '<input type="text" id="dev-invite-url" value="' + escapeHtml(inviteUrl) + '" readonly onfocus="this.select()">' +
              '<button class="dev-invite-copy-btn" onclick="copyDevInviteUrl()">' +
                '<i class="ti ti-copy"></i>Скопировать</button>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<div class="dev-invite-participants-title" style="margin-bottom:6px;">Кто уже присоединился (' + participants.length + ')</div>' +
            '<div class="dev-participants-list">' + participantsHtml + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  m.classList.add('visible');
}

function openDevDescriptionModal() {
  if (!_devState.currentId) return;
  const dev = _devState.current || {};
  const overlayId = 'dev-desc-modal';
  const existing = document.getElementById(overlayId);
  if (existing) existing.remove();

  const m = document.createElement('div');
  m.id = overlayId;
  m.className = 'modal-overlay dev-desc-modal';
  m.innerHTML =
    '<div class="modal">' +
      '<div class="modal-header">' +
        '<h2><i class="ti ti-align-left"></i> Описание разработки</h2>' +
        '<button class="icon-btn" onclick="closeDevDescriptionModal()" title="Закрыть">' +
          '<i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        '<input type="text" class="dev-desc-title-input" id="dev-desc-modal-title" ' +
               'value="' + escapeHtml(dev.name || '') + '" placeholder="Название разработки…" ' +
               'oninput="_devDescModalChanged()">' +
        '<textarea class="dev-desc-textarea" id="dev-desc-modal-textarea" ' +
                  'placeholder="Что разрабатываем, зачем, кому нужно. Здесь можно писать длинный текст: технические требования, материалы, особенности конструкции, идеи доработок…" ' +
                  'oninput="_devDescModalChanged()">' + escapeHtml(dev.description || '') + '</textarea>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<span class="dev-desc-saved-mark" id="dev-desc-saved-mark"><i class="ti ti-check"></i>Сохранено</span>' +
        '<button class="btn btn-primary" onclick="closeDevDescriptionModal()">' +
          '<i class="ti ti-check"></i>Готово</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
  m.addEventListener('click', (e) => { if (e.target === m) closeDevDescriptionModal(); });
  m.classList.add('visible');
  // Esc закрывает
  m._escHandler = (e) => { if (e.key === 'Escape') closeDevDescriptionModal(); };
  document.addEventListener('keydown', m._escHandler);
  // Фокус в textarea, курсор в конец
  setTimeout(() => {
    const ta = document.getElementById('dev-desc-modal-textarea');
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, 60);
}

function _devDescModalChanged() {
  // Зеркалим в inline-поля на странице, чтобы при закрытии всё было сохранено через общий debounce
  const tName = document.getElementById('dev-desc-modal-title');
  const tDesc = document.getElementById('dev-desc-modal-textarea');
  const iName = document.getElementById('dev-name-input');
  const iDesc = document.getElementById('dev-desc-input');
  if (tName && iName) iName.value = tName.value;
  if (tDesc && iDesc) iDesc.value = tDesc.value;
  const mark = document.getElementById('dev-desc-saved-mark');
  if (mark) {
    mark.className = 'dev-desc-saved-mark saving';
    mark.innerHTML = '<i class="ti ti-loader-2"></i>Сохраняем…';
  }
  _devScheduleSave();
  // через 700мс отметим как «сохранено»
  if (_devState._descSavedTimer) clearTimeout(_devState._descSavedTimer);
  _devState._descSavedTimer = setTimeout(() => {
    const m = document.getElementById('dev-desc-saved-mark');
    if (m) {
      m.className = 'dev-desc-saved-mark saved';
      m.innerHTML = '<i class="ti ti-check"></i>Сохранено';
    }
  }, 900);
}

function closeDevDescriptionModal() {
  const m = document.getElementById('dev-desc-modal');
  if (!m) return;
  if (m._escHandler) document.removeEventListener('keydown', m._escHandler);
  m.remove();
}

function copyDevInviteUrl() {
  const input = document.getElementById('dev-invite-url');
  if (!input) return;
  input.select();
  input.setSelectionRange(0, 99999);
  try {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(input.value);
    } else {
      document.execCommand('copy');
    }
    showToast('Ссылка скопирована', 'success');
  } catch (_) {
    showToast('Не получилось скопировать. Выдели вручную.', 'error');
  }
}

function _devFormatDate(s) {
  if (!s) return '';
  try {
    const d = new Date(s.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return s;
    const pad = (n) => String(n).padStart(2, '0');
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + String(d.getFullYear()).slice(2) +
           ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  } catch (_) { return s; }
}

function _devFormatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
  return (bytes / 1024 / 1024).toFixed(1) + ' МБ';
}

function _devFileIcon(ct, name) {
  ct = (ct || '').toLowerCase();
  name = (name || '').toLowerCase();
  if (ct.startsWith('image/')) return 'ti-photo';
  if (ct.startsWith('video/')) return 'ti-video';
  if (ct === 'application/pdf' || name.endsWith('.pdf')) return 'ti-file-type-pdf';
  if (name.match(/\.(stl|step|stp|obj|iges|igs|fbx|dwg|dxf|3dm)$/)) return 'ti-cube';
  if (name.match(/\.(zip|rar|7z)$/)) return 'ti-file-zip';
  if (name.match(/\.(xls|xlsx|csv)$/)) return 'ti-file-type-xls';
  if (name.match(/\.(doc|docx)$/)) return 'ti-file-type-doc';
  return 'ti-file';
}

function renderDevelopmentFiles() {
  const listEl = document.getElementById('dev-files-list');
  if (!listEl) return;
  if (!_devState.files.length) {
    listEl.innerHTML = '';
    return;
  }
  listEl.innerHTML = _devState.files.map(f => {
    const icon = _devFileIcon(f.content_type, f.file_name);
    const size = _devFormatSize(f.file_size);
    const date = _devFormatDate(f.created_at);
    const url  = API_BASE + '/api/developments/' + _devState.currentId + '/files/' + f.id;
    return '<div class="dev-file-row">' +
      '<div class="dev-file-icon"><i class="ti ' + icon + '"></i></div>' +
      '<div class="dev-file-info">' +
        '<div class="dev-file-name" title="' + escapeHtml(f.file_name) + '">' + escapeHtml(f.file_name) + '</div>' +
        '<div class="dev-file-meta">' + escapeHtml(size + ' · ' + date) + '</div>' +
      '</div>' +
      '<div class="dev-file-actions">' +
        '<button onclick="downloadDevelopmentFile(' + f.id + ')" title="Скачать"><i class="ti ti-download"></i></button>' +
        '<button class="dev-file-delete" onclick="deleteDevelopmentFile(' + f.id + ')" title="Удалить"><i class="ti ti-x"></i></button>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function downloadDevelopmentFile(fileId) {
  try {
    const res = await fetch(API_BASE + '/api/developments/' + _devState.currentId + '/files/' + fileId, {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const blob = await res.blob();
    const file = _devState.files.find(f => f.id === fileId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file ? file.file_name : 'file';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    showToast('Не удалось скачать файл', 'error');
  }
}

async function deleteDevelopmentFile(fileId) {
  if (!confirm('Удалить файл?')) return;
  try {
    const res = await fetch(API_BASE + '/api/development-files/' + fileId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!res.ok) throw new Error('http ' + res.status);
    _devState.files = _devState.files.filter(f => f.id !== fileId);
    renderDevelopmentFiles();
    showToast('Файл удалён', 'success');
  } catch (e) {
    showToast('Не удалось удалить файл', 'error');
  }
}

function _setupDevDropZone() {
  const zone = document.getElementById('dev-drop-zone');
  if (!zone) return;
  ['dragenter','dragover'].forEach(ev => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.add('dragover');
  }));
  ['dragleave','drop'].forEach(ev => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.remove('dragover');
  }));
  zone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) {
      uploadDevelopmentFiles(e.dataTransfer.files);
    }
  });
}

async function uploadDevelopmentFiles(fileList) {
  if (!_devState.currentId) return;
  if (!fileList || !fileList.length) return;
  const files = Array.from(fileList);
  for (const file of files) {
    if (file.size > 50 * 1024 * 1024) {
      showToast('Файл «' + file.name + '» больше 50 МБ', 'error');
      continue;
    }
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(API_BASE + '/api/developments/' + _devState.currentId + '/files', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast(j.message || 'Не удалось загрузить ' + file.name, 'error');
        continue;
      }
      const j = await res.json();
      (j.files || []).forEach(nf => _devState.files.unshift({
        id: nf.id, file_name: nf.file_name, file_size: nf.file_size,
        content_type: nf.content_type, created_at: new Date().toISOString(),
      }));
    } catch (e) {
      showToast('Сеть: не удалось загрузить ' + file.name, 'error');
    }
  }
  renderDevelopmentFiles();
}

function renderDevelopmentMessages() {
  const box = document.getElementById('dev-chat-messages');
  if (!box) return;
  if (!_devState.messages.length) {
    box.innerHTML = '<div class="dev-chat-empty">Пока тут пусто. Напиши первое сообщение.</div>';
    return;
  }
  const myChatId = state.user && state.user.chat_id;
  box.innerHTML = _devState.messages.map(m => {
    const mine = m.author_chat_id && myChatId && m.author_chat_id === myChatId;
    const author = escapeHtml(m.author_name || 'Кто-то');
    const date   = _devFormatDate(m.created_at);
    return '<div class="dev-chat-msg' + (mine ? ' is-mine' : '') + '">' +
      '<div class="dev-chat-msg-head">' +
        '<span class="dev-chat-msg-author">' + author + '</span>' +
        '<span>' + escapeHtml(date) + '</span>' +
      '</div>' +
      '<div class="dev-chat-msg-text">' + escapeHtml(m.text || '') + '</div>' +
    '</div>';
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function _devChatKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    sendDevelopmentMessage();
  }
}

async function sendDevelopmentMessage() {
  if (!_devState.currentId) return;
  const input = document.getElementById('dev-chat-input');
  if (!input) return;
  const text = (input.value || '').trim();
  if (!text) return;
  const sendBtn = document.querySelector('.dev-chat-send');
  if (sendBtn) sendBtn.disabled = true;
  try {
    const res = await fetch(API_BASE + '/api/developments/' + _devState.currentId + '/chat', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const j = await res.json();
    _devState.messages = j.messages || _devState.messages;
    input.value = '';
    renderDevelopmentMessages();
  } catch (e) {
    showToast('Не удалось отправить сообщение', 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

function _devScheduleSave() {
  if (_devState._saveTimer) clearTimeout(_devState._saveTimer);
  _devState._saveTimer = setTimeout(_devSaveCurrent, 600);
}

function _devUpdateDemoLink() {
  const link  = document.getElementById('dev-demo-link');
  const input = document.getElementById('dev-demo-input');
  if (!link || !input) return;
  const url = (input.value || '').trim();
  if (url) {
    link.href = url;
    link.style.display = '';
  } else {
    link.style.display = 'none';
  }
}

function _devIsEmbeddableDemoUrl(url) {
  if (!url) return false;
  url = url.trim();
  if (!url) return false;
  // Относительный URL — наш домен, можно
  if (url.startsWith('/')) return true;
  try {
    const u = new URL(url, window.location.href);
    // Same origin — можно встроить
    if (u.origin === window.location.origin) return true;
  } catch (_) { return false; }
  return false;
}

function _devDemoEmbedHtml(url) {
  if (!_devIsEmbeddableDemoUrl(url)) return '';
  // Для same-origin ссылок (наши /3d/*-вьюверы) добавляем cache-buster,
  // чтобы при обновлении файла на сервере браузер не показывал старую
  // версию из кэша. Так пользователю не надо каждый раз переписывать
  // URL в разработке вручную.
  let bustedUrl = url;
  try {
    const u = new URL(url, window.location.href);
    if (u.origin === window.location.origin) {
      u.searchParams.set('v', String(Date.now()));
      bustedUrl = u.toString();
    }
  } catch (_) {}
  const safeUrl = escapeHtml(bustedUrl);
  return '<div class="dev-demo-iframe-wrap">' +
           '<button class="dev-demo-fs-btn" onclick="_devToggleDemoFullscreen(this)" title="На весь экран">' +
             '<i class="ti ti-maximize"></i>На весь экран' +
           '</button>' +
           '<iframe src="' + safeUrl + '" class="dev-demo-iframe" allowfullscreen allow="fullscreen"></iframe>' +
         '</div>';
}

function _devToggleDemoFullscreen(btn) {
  const wrap = btn.closest('.dev-demo-iframe-wrap');
  if (!wrap) return;
  const doc = document;
  const inFs = doc.fullscreenElement || doc.webkitFullscreenElement;
  if (inFs) {
    (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
  } else {
    const req = wrap.requestFullscreen || wrap.webkitRequestFullscreen;
    if (req) req.call(wrap);
  }
}

function _devUpdateDemoEmbed() {
  const box   = document.getElementById('dev-demo-embed');
  const input = document.getElementById('dev-demo-input');
  if (!box || !input) return;
  box.innerHTML = _devDemoEmbedHtml((input.value || '').trim());
}

async function _devSaveCurrent() {
  if (!_devState.currentId) return;
  const name = document.getElementById('dev-name-input')?.value || '';
  const desc = document.getElementById('dev-desc-input')?.value || '';
  const url  = document.getElementById('dev-demo-input')?.value || '';
  try {
    const res = await fetch(API_BASE + '/api/developments/' + _devState.currentId, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, description: desc, demo_url: url }),
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const j = await res.json();
    _devState.current = j.development;
    // Обновим карточку в списке
    const i = _devState.items.findIndex(x => x.id === _devState.currentId);
    if (i >= 0) {
      Object.assign(_devState.items[i], j.development);
      renderDevelopmentsList();
    }
  } catch (e) {
    /* без шума — попробуем при следующем изменении */
  }
}

async function deleteCurrentDevelopment() {
  if (!_devState.currentId) return;
  if (!_devUserIsDirector()) {
    showToast('Удалять разработки может только директор', 'error');
    return;
  }
  if (!confirm('Удалить разработку? Файлы и сообщения тоже будут удалены.')) return;
  try {
    const res = await fetch(API_BASE + '/api/developments/' + _devState.currentId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!res.ok) throw new Error('http ' + res.status);
    _devState.items = _devState.items.filter(x => x.id !== _devState.currentId);
    _devState.currentId = null;
    _devState.current = null;
    renderDevelopmentsList();
    renderDevelopmentDetail(null);
    showToast('Разработка удалена', 'success');
  } catch (e) {
    showToast('Не удалось удалить', 'error');
  }
}

function openNewDevelopmentModal() {
  const overlayId = 'dev-new-modal';
  let m = document.getElementById(overlayId);
  if (!m) {
    m = document.createElement('div');
    m.id = overlayId;
    m.className = 'modal-overlay';
    m.innerHTML =
      '<div class="modal">' +
        '<div class="modal-header">' +
          '<h2><i class="ti ti-bulb"></i> Новая разработка</h2>' +
          '<button class="icon-btn" onclick="document.getElementById(\'' + overlayId + '\').classList.remove(\'visible\')">' +
            '<i class="ti ti-x"></i></button>' +
        '</div>' +
        '<div class="modal-content">' +
          '<div class="dev-new-modal-body">' +
            '<div class="dev-new-field">' +
              '<label>Название</label>' +
              '<input type="text" id="dev-new-name" placeholder="Например: Атомус-Бриз — увлажнитель">' +
            '</div>' +
            '<div class="dev-new-field">' +
              '<label>Краткое описание (опционально)</label>' +
              '<textarea id="dev-new-desc" placeholder="Что это, зачем, требования…"></textarea>' +
            '</div>' +
            '<div class="dev-new-field">' +
              '<label>Ссылка на 3D / демонстрацию (опционально)</label>' +
              '<input type="url" id="dev-new-url" placeholder="https://claude.ai/chat/…">' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button class="btn btn-secondary" onclick="document.getElementById(\'' + overlayId + '\').classList.remove(\'visible\')">Отмена</button>' +
          '<button class="btn btn-primary" onclick="submitNewDevelopment()"><i class="ti ti-plus"></i>Создать</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);
    m.addEventListener('click', (e) => {
      if (e.target === m) m.classList.remove('visible');
    });
  }
  // очистка полей
  document.getElementById('dev-new-name').value = '';
  document.getElementById('dev-new-desc').value = '';
  document.getElementById('dev-new-url').value  = '';
  m.classList.add('visible');
  setTimeout(() => document.getElementById('dev-new-name').focus(), 50);
}

async function submitNewDevelopment() {
  const name = (document.getElementById('dev-new-name')?.value || '').trim();
  const desc = (document.getElementById('dev-new-desc')?.value || '').trim();
  const url  = (document.getElementById('dev-new-url')?.value || '').trim();
  if (!name) {
    showToast('Введи название', 'error');
    return;
  }
  try {
    const res = await fetch(API_BASE + '/api/developments', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, description: desc, demo_url: url }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(j.message || 'Не удалось создать', 'error');
      return;
    }
    const j = await res.json();
    document.getElementById('dev-new-modal').classList.remove('visible');
    await loadDevelopments();
    if (j.id) openDevelopment(j.id);
    showToast('Разработка создана', 'success');
  } catch (e) {
    showToast('Сеть: не удалось создать', 'error');
  }
}

/* === Публичная страница разработки /dev/{token} === */
const DEV_GUEST_KEY_PREFIX = 'atomus_dev_guest_';

async function showPublicDevelopment(token) {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  // Используем тот же public-page или свой контейнер
  let page = document.getElementById('public-dev-page');
  if (!page) {
    page = document.createElement('div');
    page.id = 'public-dev-page';
    page.className = 'public-dev-page';
    document.body.appendChild(page);
  }
  page.style.display = 'block';
  page.innerHTML = '<div class="public-dev-card"><div class="public-dev-body" style="padding:40px;text-align:center;color:var(--text-light);">Загружаем…</div></div>';
  try {
    const res = await fetch(API_BASE + '/api/developments/public/' + encodeURIComponent(token));
    if (!res.ok) {
      page.innerHTML = '<div class="public-dev-card"><div class="public-dev-body">' +
        renderPublicError(res.status) + '</div></div>';
      return;
    }
    const data = await res.json();
    _renderPublicDevelopment(token, data);
  } catch (e) {
    page.innerHTML = '<div class="public-dev-card"><div class="public-dev-body">' +
      renderPublicError('network') + '</div></div>';
  }
}

function _publicDevGetGuest(token) {
  try {
    const raw = localStorage.getItem(DEV_GUEST_KEY_PREFIX + token);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}
function _publicDevSetGuest(token, guest) {
  try { localStorage.setItem(DEV_GUEST_KEY_PREFIX + token, JSON.stringify(guest)); } catch (_) {}
}

function _renderPublicDevelopment(token, data) {
  const page = document.getElementById('public-dev-page');
  if (!page) return;
  const dev = data.development || {};
  const files = data.files || [];
  const messages = data.messages || [];
  const guest = _publicDevGetGuest(token);

  let body = '';
  // Регистрация — если ещё нет
  if (!guest) {
    body +=
      '<div class="public-dev-reg-form">' +
        '<div class="public-dev-reg-form-title"><i class="ti ti-user-plus"></i> Чтобы продолжить — представься</div>' +
        '<input type="text" id="public-dev-name" placeholder="Имя и фамилия" autocomplete="name">' +
        '<input type="tel"  id="public-dev-phone" placeholder="Телефон (опционально)" autocomplete="tel">' +
        '<button onclick="registerPublicDevelopmentGuest(\'' + escapeHtml(token) + '\')">' +
          '<i class="ti ti-arrow-right"></i> Войти как участник' +
        '</button>' +
        '<div class="public-reg-hello">После этого ты увидишь файлы, ссылку на 3D-демонстрацию и сможешь писать в чат.</div>' +
      '</div>';
  } else {
    body +=
      '<div class="public-dev-reg-form" style="background:rgba(37,99,235,0.04);">' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
          '<div class="dev-participant-avatar">' +
            escapeHtml((guest.name || '?').split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()) +
          '</div>' +
          '<div style="flex:1;">' +
            '<div style="font-weight:600;color:var(--text-dark);">' + escapeHtml(guest.name) + '</div>' +
            '<div style="font-size:12px;color:var(--text-light);">' +
              (guest.phone ? escapeHtml(guest.phone) + ' · ' : '') +
              'участник' +
            '</div>' +
          '</div>' +
          '<button class="dev-link-btn" onclick="logoutPublicDevelopmentGuest(\'' + escapeHtml(token) + '\')">Сменить</button>' +
        '</div>' +
      '</div>';
  }

  // Описание
  if (dev.description) {
    body +=
      '<div class="public-dev-section">' +
        '<div class="public-dev-section-title"><i class="ti ti-align-left"></i>Описание</div>' +
        '<div class="public-dev-desc">' + escapeHtml(dev.description) + '</div>' +
      '</div>';
  }

  // 3D / демка
  if (dev.demo_url) {
    const embedded = _devIsEmbeddableDemoUrl(dev.demo_url);
    // Тот же cache-buster что и в _devDemoEmbedHtml: для same-origin URL
    // приклеиваем ?v=<timestamp>, чтобы свежий 3D-файл не блокировался кэшем.
    let demoUrlBusted = dev.demo_url;
    try {
      const u = new URL(dev.demo_url, window.location.href);
      if (u.origin === window.location.origin) {
        u.searchParams.set('v', String(Date.now()));
        demoUrlBusted = u.toString();
      }
    } catch (_) {}
    body +=
      '<div class="public-dev-section">' +
        '<div class="public-dev-section-title"><i class="ti ti-cube"></i>3D-демонстрация</div>' +
        (embedded
          ? '<div class="dev-demo-iframe-wrap">' +
              '<button class="dev-demo-fs-btn" onclick="_devToggleDemoFullscreen(this)" title="На весь экран">' +
                '<i class="ti ti-maximize"></i>На весь экран</button>' +
              '<iframe src="' + escapeHtml(demoUrlBusted) + '" class="dev-demo-iframe" allowfullscreen allow="fullscreen"></iframe>' +
            '</div>'
          : '<a class="public-dev-demo-link" href="' + escapeHtml(dev.demo_url) + '" target="_blank" rel="noopener">' +
              '<i class="ti ti-external-link"></i>Открыть демонстрацию</a>'
        ) +
      '</div>';
  }

  // Файлы — список + drop-zone для зарегистрированных гостей
  body += '<div class="public-dev-section">' +
    '<div class="public-dev-section-title"><i class="ti ti-paperclip"></i>Файлы и чертежи</div>';
  if (guest) {
    body += '<div class="dev-files-drop" id="public-dev-drop-zone" onclick="document.getElementById(\'public-dev-file-input\').click()">' +
      '<i class="ti ti-cloud-upload"></i>' +
      '<div><b>Перетащи файлы сюда</b> или нажми чтобы выбрать</div>' +
      '<div style="font-size:11.5px;margin-top:2px;">До 50 МБ на файл · поделись чертежами, фото, 3D-моделями</div>' +
      '<input type="file" id="public-dev-file-input" multiple style="display:none;" onchange="uploadPublicDevelopmentFiles(\'' + escapeHtml(token) + '\', this.files)">' +
    '</div>';
  }
  if (files.length) {
    files.forEach(f => {
      const icon = _devFileIcon(f.content_type, f.file_name);
      const size = _devFormatSize(f.file_size);
      const url  = API_BASE + '/api/developments/public/' + encodeURIComponent(token) + '/files/' + f.id;
      const author = f.uploaded_by_participant_name
        ? ' · загрузил ' + escapeHtml(f.uploaded_by_participant_name)
        : '';
      body +=
        '<a class="public-dev-file-row" href="' + url + '" target="_blank">' +
          '<div class="dev-file-icon"><i class="ti ' + icon + '"></i></div>' +
          '<div class="dev-file-info">' +
            '<div class="dev-file-name">' + escapeHtml(f.file_name) + '</div>' +
            '<div class="dev-file-meta">' + escapeHtml(size) + author + '</div>' +
          '</div>' +
          '<i class="ti ti-download" style="color:var(--text-light);"></i>' +
        '</a>';
    });
  } else if (!guest) {
    body += '<div style="font-size:12.5px;color:var(--text-light);">Пока файлов нет.</div>';
  }
  body += '</div>';

  // Чат — только если гость зарегистрирован
  if (guest) {
    body += '<div class="public-dev-section">' +
      '<div class="public-dev-section-title"><i class="ti ti-message-circle"></i>Обсуждение</div>' +
      '<div class="public-dev-chat" id="public-dev-chat-box">' +
        _renderPublicDevMessages(messages, guest) +
      '</div>' +
      '<div class="public-dev-chat-input-row">' +
        '<textarea id="public-dev-chat-input" rows="1" placeholder="Написать сообщение…"></textarea>' +
        '<button onclick="sendPublicDevelopmentMessage(\'' + escapeHtml(token) + '\')"><i class="ti ti-send"></i></button>' +
      '</div>' +
    '</div>';
  }

  page.innerHTML =
    '<div class="public-dev-card">' +
      '<div class="public-dev-head">' +
        '<div class="public-brand">Atom CRM · Разработка</div>' +
        '<h1>' + escapeHtml(dev.name || '—') + '</h1>' +
        '<div class="public-dev-tagline">Совместная работа над оборудованием — Атомус Групп</div>' +
      '</div>' +
      '<div class="public-dev-body">' + body + '</div>' +
    '</div>';

  // автоскролл чата
  const box = document.getElementById('public-dev-chat-box');
  if (box) box.scrollTop = box.scrollHeight;
  // drop-zone для гостя
  _setupPublicDevDropZone(token);
}

function _setupPublicDevDropZone(token) {
  const zone = document.getElementById('public-dev-drop-zone');
  if (!zone) return;
  ['dragenter','dragover'].forEach(ev => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.add('dragover');
  }));
  ['dragleave','drop'].forEach(ev => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.remove('dragover');
  }));
  zone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) {
      uploadPublicDevelopmentFiles(token, e.dataTransfer.files);
    }
  });
}

async function uploadPublicDevelopmentFiles(token, fileList) {
  if (!fileList || !fileList.length) return;
  const guest = _publicDevGetGuest(token);
  if (!guest) { alert('Сначала зарегистрируйся'); return; }
  const files = Array.from(fileList);
  let okCount = 0, errCount = 0;
  for (const file of files) {
    if (file.size > 50 * 1024 * 1024) {
      alert('Файл «' + file.name + '» больше 50 МБ');
      continue;
    }
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(API_BASE + '/api/developments/public/' + encodeURIComponent(token) + '/files', {
        method: 'POST',
        headers: { 'X-Guest-Token': guest.guest_token },
        body: fd,
      });
      if (!res.ok) { errCount++; continue; }
      okCount++;
    } catch (_) { errCount++; }
  }
  // перерисуем страницу
  showPublicDevelopment(token);
}

function _renderPublicDevMessages(messages, guest) {
  if (!messages || !messages.length) {
    return '<div class="public-dev-chat-empty">Пока пусто. Напиши первое сообщение.</div>';
  }
  return messages.map(m => {
    const mine = guest && m.author_participant_id && guest.participant_id === m.author_participant_id;
    return '<div class="public-dev-chat-msg' + (mine ? ' is-mine' : '') + '">' +
      '<div class="public-dev-chat-msg-head">' +
        '<span class="public-dev-chat-author">' + escapeHtml(m.author_name || 'Кто-то') + '</span>' +
        '<span>' + escapeHtml(_devFormatDate(m.created_at)) + '</span>' +
      '</div>' +
      '<div>' + escapeHtml(m.text || '') + '</div>' +
    '</div>';
  }).join('');
}

async function registerPublicDevelopmentGuest(token) {
  const name  = (document.getElementById('public-dev-name')?.value || '').trim();
  const phone = (document.getElementById('public-dev-phone')?.value || '').trim();
  if (!name) { alert('Введите имя'); return; }
  try {
    const res = await fetch(API_BASE + '/api/developments/public/' + encodeURIComponent(token) + '/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.message || 'Не удалось зарегистрироваться');
      return;
    }
    const j = await res.json();
    _publicDevSetGuest(token, {
      name: j.participant.name,
      phone: j.participant.phone,
      participant_id: j.participant.id,
      guest_token: j.guest_token,
    });
    // перерисуем страницу
    showPublicDevelopment(token);
  } catch (e) {
    alert('Сеть: не удалось зарегистрироваться');
  }
}

function logoutPublicDevelopmentGuest(token) {
  try { localStorage.removeItem(DEV_GUEST_KEY_PREFIX + token); } catch (_) {}
  showPublicDevelopment(token);
}

async function sendPublicDevelopmentMessage(token) {
  const input = document.getElementById('public-dev-chat-input');
  if (!input) return;
  const text = (input.value || '').trim();
  if (!text) return;
  const guest = _publicDevGetGuest(token);
  if (!guest) return;
  input.disabled = true;
  try {
    const res = await fetch(API_BASE + '/api/developments/public/' + encodeURIComponent(token) + '/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Guest-Token': guest.guest_token,
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.message || 'Не удалось отправить');
      return;
    }
    const j = await res.json();
    input.value = '';
    // перерисуем сообщения
    const box = document.getElementById('public-dev-chat-box');
    if (box) {
      box.innerHTML = _renderPublicDevMessages(j.messages || [], guest);
      box.scrollTop = box.scrollHeight;
    }
  } catch (e) {
    alert('Сеть: не удалось отправить');
  } finally {
    input.disabled = false;
    input.focus();
  }
}

/* ============ ЭТАП 49 (v2.44.56): ИНВЕНТАРИЗАЦИЯ ПО ФОТО ============ */
const _invState = {
  sessions: [],
  currentSession: null,
  _pollTimer: null,
  _selectedIds: new Set(),
  _overrides: {},   // component_id → new_qty (если пользователь поправил)
};

async function loadInventory() {
  await _invFetchSessions();
  _invRenderHome();
}

async function _invFetchSessions() {
  try {
    const res = await fetch(API_BASE + '/api/inventory/sessions', {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const j = await res.json();
    _invState.sessions = j.items || [];
  } catch (e) {
    _invState.sessions = [];
  }
}

function _invRenderHome() {
  const body = document.getElementById('inventory-screen-body');
  if (!body) return;
  const apiBase = API_BASE;
  const token = localStorage.getItem(TOKEN_KEY) || '';

  let html = '';
  // Быстрая сверка по фото товара (стоя у полки)
  html +=
    '<div style="background:linear-gradient(135deg,rgba(16,185,129,0.10),rgba(5,150,105,0.06));' +
    'border:1px solid rgba(16,185,129,0.25);border-radius:12px;padding:14px 16px;margin-bottom:16px;' +
    'display:flex;align-items:center;gap:14px;flex-wrap:wrap;">' +
      '<i class="ti ti-camera-plus" style="font-size:26px;color:#059669;"></i>' +
      '<div style="flex:1;min-width:200px;">' +
        '<div style="font-weight:700;color:var(--text-dark);font-size:15px;">Сверка по фото товара</div>' +
        '<div style="font-size:12.5px;color:var(--text-light);">Фоткай коробку у полки, пиши количество — система сверит с остатком (сходится / расхождение / нет позиции).</div>' +
      '</div>' +
      '<button class="btn btn-primary" onclick="openBoxCheck()"><i class="ti ti-camera"></i> Начать сверку</button>' +
    '</div>';
  // Баннер «у тебя есть незавершённый черновик ручной инвентаризации»
  const draft = _invLoadManualDraft();
  if (draft && draft.values && Object.keys(draft.values).length) {
    const cnt = Object.keys(draft.values).length;
    const savedAtFmt = (function() {
      try {
        const d = new Date(draft.savedAt);
        const pad = (n) => String(n).padStart(2, '0');
        return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      } catch (_) { return ''; }
    })();
    html +=
      '<div style="background:linear-gradient(135deg,rgba(37,99,235,0.07),rgba(124,58,237,0.05));' +
      'border:1px solid rgba(37,99,235,0.2);border-radius:10px;padding:12px 16px;margin-bottom:16px;' +
      'display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
        '<i class="ti ti-file-text" style="font-size:22px;color:var(--brand);"></i>' +
        '<div style="flex:1;min-width:200px;">' +
          '<div style="font-weight:600;color:var(--text-dark);font-size:14px;">Незавершённая ручная инвентаризация</div>' +
          '<div style="font-size:12px;color:var(--text-light);">' + cnt + ' заполненных позиций · сохранено ' + escapeHtml(savedAtFmt) + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="btn btn-primary" onclick="_invRestoreManualDraft()"><i class="ti ti-rotate-clockwise"></i> Восстановить</button>' +
          '<button class="btn btn-secondary" onclick="_invDiscardManualDraft()"><i class="ti ti-trash"></i> Удалить</button>' +
        '</div>' +
      '</div>';
  }
  // 3 шага
  html += '<div class="inv-steps">' +
    '<div class="inv-step-card">' +
      '<div class="step-n">1</div>' +
      '<h3>Открой бланк</h3>' +
      '<p>Выбери разделы (например, без УТМ). Дальше — либо заполни прямо здесь в браузере, либо скачай Excel для распечатки.</p>' +
      '<div class="step-action">' +
        '<button class="btn btn-primary" onclick="openInventoryBlankPicker()">' +
          '<i class="ti ti-list-check"></i> Выбрать разделы' +
        '</button>' +
      '</div>' +
    '</div>' +
    '<div class="inv-step-card">' +
      '<div class="step-n">2</div>' +
      '<h3>Распечатай и заполни</h3>' +
      '<p>Пройди по складу с распечаткой, в колонке «Фактически» впиши реальное количество каждой позиции. Можно несколько листов.</p>' +
    '</div>' +
    '<div class="inv-step-card">' +
      '<div class="step-n">3</div>' +
      '<h3>Загрузи фото</h3>' +
      '<p>Сфотографируй заполненные листы или отсканируй в PDF (можно сразу несколько) и загрузи сюда. Claude разберёт почерк и предложит обновить остатки.</p>' +
      '<div class="inv-drop" id="inv-drop-zone" onclick="document.getElementById(\'inv-photo-input\').click()">' +
        '<i class="ti ti-camera"></i>' +
        '<div><b>Перетащи файлы сюда</b> или нажми чтобы выбрать</div>' +
        '<div style="font-size:11.5px;margin-top:3px;">JPG/PNG/HEIC до 12 МБ · PDF до 32 МБ (многостраничный)</div>' +
        '<input type="file" id="inv-photo-input" multiple accept="image/*,application/pdf,.pdf" style="display:none;" onchange="uploadInventoryPhotos(this.files)">' +
      '</div>' +
    '</div>' +
  '</div>';

  // История
  html += '<div class="inv-history-title">История инвентаризаций</div>';
  if (!_invState.sessions.length) {
    html += '<div style="color:var(--text-light);font-size:13px;padding:18px;text-align:center;border:1px dashed var(--border);border-radius:10px;">Пока инвентаризаций не было</div>';
  } else {
    html += '<div class="inv-history-list">';
    _invState.sessions.forEach(s => {
      const statusKey = (s.status || '').toLowerCase();
      const statusLabel =
        statusKey === 'recognizing' ? 'Распознаём…' :
        statusKey === 'ready'       ? 'Готова к проверке' :
        statusKey === 'applied'     ? 'Применена' :
        statusKey === 'error'       ? 'Ошибка ИИ' : (s.status || '—');
      const dt = _devFormatDate(s.created_at);
      const appliedText = s.applied_at
        ? '<span style="color:var(--text-light);font-size:12px;">' + escapeHtml(_devFormatDate(s.applied_at)) + '</span>'
        : '<span></span>';
      const ctaLabel = statusKey === 'applied' ? 'Посмотреть' : 'Открыть';
      html += '<div class="inv-session-row">' +
        '<span class="inv-id">#' + s.id + '</span>' +
        '<span>' + escapeHtml(dt) + '</span>' +
        '<span class="inv-status s-' + statusKey + '">' + escapeHtml(statusLabel) + '</span>' +
        appliedText +
        '<div class="inv-row-actions">' +
          '<button class="btn btn-secondary" onclick="openInventorySession(' + s.id + ')">' + ctaLabel + '</button>' +
          '<button class="inv-delete-btn" title="Удалить" onclick="deleteInventorySession(' + s.id + ', \'' + statusKey + '\')">' +
            '<i class="ti ti-trash"></i>' +
          '</button>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
  }

  body.innerHTML = html;
  _invSetupDropZone();
}

function _invSetupDropZone() {
  const zone = document.getElementById('inv-drop-zone');
  if (!zone) return;
  ['dragenter','dragover'].forEach(ev => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.add('dragover');
  }));
  ['dragleave','drop'].forEach(ev => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.remove('dragover');
  }));
  zone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) {
      uploadInventoryPhotos(e.dataTransfer.files);
    }
  });
}

async function openInventoryBlankPicker() {
  // 1) Тянем список разделов комплектующих + список самих позиций (для счётчика)
  let categories = [];
  let allComponents = [];
  try {
    const [catsRes, compsRes] = await Promise.all([
      fetch(API_BASE + '/api/components/categories', {
        headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
      }),
      fetch(API_BASE + '/api/components?only_active=1', {
        headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
      }),
    ]);
    const catsJ = await catsRes.json();
    categories = catsJ.categories || catsJ.items || [];
    const compsJ = await compsRes.json();
    allComponents = compsJ.components || compsJ.items || [];
  } catch (_) {
    showToast('Не удалось загрузить разделы', 'error');
    return;
  }

  // Считаем сколько позиций в каждом разделе
  const countByCat = {};
  let withStockTotal = 0;
  allComponents.forEach(c => {
    countByCat[c.category_id] = (countByCat[c.category_id] || 0) + 1;
    if ((c.qty_on_stock || 0) > 0) withStockTotal++;
  });

  const overlayId = 'inv-blank-picker';
  let m = document.getElementById(overlayId);
  if (m) m.remove();
  m = document.createElement('div');
  m.id = overlayId;
  m.className = 'modal-overlay';
  const rows = categories.map(c => {
    const cnt = countByCat[c.id] || 0;
    return '<label class="inv-cat-row">' +
      '<input type="checkbox" data-cid="' + c.id + '" checked onchange="_invUpdateBlankCount()">' +
      '<span class="inv-cat-name">' + escapeHtml(c.name || '—') + '</span>' +
      '<span class="inv-cat-cnt">' + cnt + '</span>' +
    '</label>';
  }).join('');
  m.innerHTML =
    '<div class="modal" style="max-width:560px;">' +
      '<div class="modal-header">' +
        '<h2><i class="ti ti-list-check"></i> Что включить в бланк</h2>' +
        '<button class="icon-btn" onclick="document.getElementById(\'' + overlayId + '\').remove()">' +
          '<i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="modal-content">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
          '<div style="font-size:12px;color:var(--text-light);text-transform:uppercase;letter-spacing:0.4px;font-weight:600;">Разделы</div>' +
          '<div style="display:flex;gap:8px;">' +
            '<button class="dev-link-btn" onclick="_invBlankToggleAll(true)">Все</button>' +
            '<button class="dev-link-btn" onclick="_invBlankToggleAll(false)">Снять</button>' +
          '</div>' +
        '</div>' +
        '<div id="inv-cat-list" class="inv-cat-list">' + rows + '</div>' +
        '<label class="inv-only-stock">' +
          '<input type="checkbox" id="inv-only-with-stock" onchange="_invUpdateBlankCount()">' +
          '<span>Только позиции с ненулевым остатком (' + withStockTotal + ')</span>' +
        '</label>' +
      '</div>' +
      '<div class="modal-footer" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid var(--border);flex-wrap:wrap;">' +
        '<div id="inv-blank-count" style="font-size:13px;color:var(--text-mid);"></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="btn btn-secondary" onclick="document.getElementById(\'' + overlayId + '\').remove()">Отмена</button>' +
          '<button class="btn btn-secondary" id="inv-blank-download-btn" onclick="downloadInventoryBlank()">' +
            '<i class="ti ti-download"></i> Скачать Excel' +
          '</button>' +
          '<button class="btn btn-primary" id="inv-blank-manual-btn" onclick="openInventoryManualEntry()">' +
            '<i class="ti ti-keyboard"></i> Заполнить здесь' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(m);
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  m.classList.add('visible');
  window._invBlankComps = allComponents;
  _invUpdateBlankCount();
}

function _invBlankToggleAll(checked) {
  document.querySelectorAll('#inv-cat-list input[type="checkbox"]').forEach(cb => {
    cb.checked = checked;
  });
  _invUpdateBlankCount();
}

function _invUpdateBlankCount() {
  const selected = new Set();
  document.querySelectorAll('#inv-cat-list input[type="checkbox"]:checked').forEach(cb => {
    selected.add(parseInt(cb.dataset.cid, 10));
  });
  const onlyStock = document.getElementById('inv-only-with-stock')?.checked;
  const all = window._invBlankComps || [];
  let cnt = 0;
  all.forEach(c => {
    if (selected.size > 0 && !selected.has(c.category_id)) return;
    if (onlyStock && !((c.qty_on_stock || 0) > 0)) return;
    cnt++;
  });
  const label = document.getElementById('inv-blank-count');
  if (label) label.textContent = 'Будет в бланке: ' + cnt + ' позиций';
  const btn = document.getElementById('inv-blank-download-btn');
  if (btn) btn.disabled = (cnt === 0);
  const btn2 = document.getElementById('inv-blank-manual-btn');
  if (btn2) btn2.disabled = (cnt === 0);
}

async function downloadInventoryBlank() {
  // Если открыта модалка — берём фильтры из неё
  const selected = [];
  document.querySelectorAll('#inv-cat-list input[type="checkbox"]:checked').forEach(cb => {
    selected.push(parseInt(cb.dataset.cid, 10));
  });
  const onlyStock = document.getElementById('inv-only-with-stock')?.checked;
  const params = new URLSearchParams();
  if (selected.length) params.set('category_ids', selected.join(','));
  if (onlyStock) params.set('only_with_stock', '1');
  const qs = params.toString();
  const url = API_BASE + '/api/inventory/components-blank.xlsx' + (qs ? ('?' + qs) : '');

  // Закрыть модалку
  const m = document.getElementById('inv-blank-picker');
  if (m) m.remove();

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || '') },
    });
    if (!res.ok) {
      let detail = 'HTTP ' + res.status;
      try {
        const j = await res.json();
        if (j && (j.message || j.error)) detail = j.message || j.error;
      } catch (_) {}
      throw new Error(detail);
    }
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    const dt = new Date();
    const pad = (n) => String(n).padStart(2,'0');
    a.download = 'inventory_blank_' + dt.getFullYear() + pad(dt.getMonth()+1) + pad(dt.getDate()) + '.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    showToast('Бланк скачан. Распечатай — заполни — сфотографируй.', 'success');
  } catch (e) {
    showToast('Не удалось скачать бланк: ' + (e && e.message ? e.message : String(e)), 'error');
    console.error('downloadInventoryBlank failed', e);
  }
}

