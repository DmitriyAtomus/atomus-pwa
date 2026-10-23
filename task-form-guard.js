/* fix(tasks): anti-double + 20s timeout — overrides submitTaskForm from app-2.js */
async function submitTaskForm() {
  const errEl = document.getElementById('tf-error');
  const btn = document.getElementById('tf-submit');
  errEl.innerHTML = '';

  if (btn && btn.dataset.busy) return;

  const f = state.taskForm;
  if (!f.title.trim()) {
    errEl.innerHTML = '<div class="sales-error">Укажите название задачи</div>';
    return;
  }

  const payload = {
    title: f.title.trim(),
    description: f.description.trim(),
    assignee_ids: (f.assignee_ids || []).map(Number).filter(Boolean),
    deadline: f.deadline || null,
    priority: f.priority || 'normal',
    source: f.source.trim(),
    contract_id: f.contract_id || null,        // ЭТАП 16В-2
    category: f.category || '',                // v2.46.139: автоматика
    panel: (f.panel || '').trim(),
  };

  const isEdit = state.taskFormMode === 'edit';
  const btnLabel = '<i class="ti ti-check"></i> ' + (isEdit ? 'Сохранить' : 'Создать задачу');
  if (btn) {
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader"></i> Сохраняем…';
  }

  const ac = new AbortController();
  const timer = setTimeout(function () { try { ac.abort(); } catch (_) {} }, 20000);

  let succeeded = false;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const url = isEdit
      ? API_BASE + '/api/tasks/' + state.currentTaskId
      : API_BASE + '/api/tasks';
    const r = await fetch(url, {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      errEl.innerHTML = '<div class="sales-error">' + escapeHtml(d.message || 'Не удалось сохранить') + '</div>';
      return;
    }
    const created = await r.json();
    succeeded = true;
    if (!isEdit) clearTaskDraft();   // задача создана — черновик больше не нужен
    showToast(isEdit ? 'Задача обновлена' : 'Задача создана', 'success');
    cache.tasks = {};
    cache.myTasks = null;
    cache.homeKpi = null;
    cache.contractTasks = {};                          // ЭТАП 16В-2: инвалидация задач договора
    state.currentTaskId = created.id;
    // Сначала сброс кнопки/формы, потом уход на карточку
    if (btn) {
      delete btn.dataset.busy;
      btn.disabled = false;
      btn.innerHTML = btnLabel;
    }
    selectSidebarItem('task-detail');
  } catch (e) {
    const aborted = (e && e.name === 'AbortError') || (ac.signal && ac.signal.aborted);
    if (aborted) {
      errEl.innerHTML = '<div class="sales-error">Сервер не ответил. Проверьте список задач — возможно, задача уже создалась — и попробуйте ещё раз.</div>';
    } else {
      errEl.innerHTML = '<div class="sales-error">Ошибка соединения: ' + escapeHtml(String(e)) + '</div>';
    }
  } finally {
    clearTimeout(timer);
    if (!succeeded && btn) {
      delete btn.dataset.busy;
      btn.disabled = false;
      btn.innerHTML = btnLabel;
    }
  }
}
