/* Прайсы поставщика в штатной форме «Оформить заказ». */
window.openSupplyPriceCatalog = async function (supplierId, supplierName, onPick, getCart) {
  if (document.querySelector('.supply-price-dialog')) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'supply-price-dialog';
  dialog.setAttribute('aria-labelledby', 'supply-price-title');
  dialog.innerHTML = `
    <header class="supply-price-head">
      <div><h2 id="supply-price-title">Прайсы поставщика</h2><div data-supplier></div></div>
      <button type="button" class="btn btn-secondary" data-close>К заказу</button>
    </header>
    <div class="supply-price-workspace">
    <div class="supply-price-content">
      <nav class="supply-price-files" aria-label="Файлы прайсов"></nav>
      <p data-message role="status">Загружаем прайсы…</p>
      <div data-catalog hidden>
        <div class="supply-price-filters">
          <label>Модель, код НС или серия<input data-query type="search" maxlength="120" placeholder="Например, EH-1700"></label>
          <label>Лист Excel<select data-sheet></select></label>
          <label>Исполнение<select data-form></select></label>
          <label>Тип системы<select data-mode></select></label>
        </div>
        <table class="supply-price-table">
          <thead><tr><th scope="col">Артикул / модель</th><th scope="col">Дилерская цена</th><th scope="col"><span class="sr-only">В заказ</span></th></tr></thead>
          <tbody data-rows></tbody>
        </table>
        <div class="supply-price-pager">
          <span data-page role="status"></span>
          <button type="button" class="btn btn-secondary" data-prev>Назад</button>
          <button type="button" class="btn btn-secondary" data-next>Дальше</button>
        </div>
      </div>
    </div>
    <aside class="supply-price-cart" aria-labelledby="supply-price-cart-title">
      <h3 id="supply-price-cart-title">В заказе</h3>
      <ul data-cart></ul>
    </aside>
    </div>
    <footer class="supply-price-footer" data-picked role="status"></footer>`;
  const element = name => dialog.querySelector('[data-' + name + ']');
  const query = element('query'), sheet = element('sheet'), form = element('form'), mode = element('mode');
  const esc = escapeHtml;
  const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 });
  const base = '/api/suppliers/' + supplierId;
  const pageSize = 20;
  const workbookCache = new Map();
  let saved = [], items = [], visible = [], page = 0, activeId = null, request = 0;
  element('supplier').textContent = supplierName;
  element('close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  dialog.showModal();
  renderCart();

  function renderCart() {
    const rows = getCart();
    element('cart').innerHTML = rows.map(row =>
      '<li><span>' + esc(row.name) + '</span><strong>' + esc(row.qty + ' ' + row.unit) + '</strong></li>'
    ).join('') || '<li><span>Выберите позиции из прайса</span></li>';
  }

  function options(control, values, all, previous = '') {
    control.replaceChildren(new Option(all, ''), ...Array.from(new Set(values.filter(Boolean)),
      value => new Option(value, value)));
    if (Array.from(control.options).some(option => option.value === previous)) control.value = previous;
  }

  function fillTypes() {
    const rows = items.filter(item => !sheet.value || item.sheet === sheet.value);
    options(form, rows.flatMap(item => [item.form, item.role === 'Наружный блок' ? 'Наружные блоки' : '']), 'Все исполнения', form.value);
    options(mode, rows.map(item => item.mode), 'Все типы', mode.value);
  }

  function renderSpecifications(item) {
    if (!item.specifications?.length) return '';
    const groups = new Map();
    for (const spec of item.specifications) {
      const scope = spec.scope || '';
      if (!groups.has(scope)) groups.set(scope, []);
      groups.get(scope).push(spec);
    }
    const fields = Array.from(groups, ([scope, specs]) =>
      (scope ? '<h4>' + esc(scope) + '</h4>' : '') +
      '<dl>' + specs.map(spec => '<div><dt>' + esc(spec.label) + '</dt><dd>' +
        esc(spec.value) + '</dd></div>').join('') + '</dl>'
    ).join('');
    return '<details class="supply-price-specs"><summary aria-label="' +
      esc('Характеристики — ' + item.name) + '">Характеристики</summary>' +
      '<div class="supply-price-spec-fields">' + fields + '<small>Лист Excel · ' +
      esc(item.sheet) + '</small></div></details>';
  }

  function render() {
    const terms = query.value.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = items.filter(item => (!sheet.value || item.sheet === sheet.value) &&
      (!form.value || item.form === form.value || (form.value === 'Наружные блоки' && item.role === 'Наружный блок')) &&
      (!mode.value || item.mode === mode.value) &&
      terms.every(term => [item.name, item.code, item.series, item.form, item.mode, item.role, item.bundle]
        .join(' ').toLowerCase().includes(term)));
    visible = matches.slice(page * pageSize, (page + 1) * pageSize);
    element('rows').innerHTML = visible.map((item, i) => {
      const tags = [...new Set([item.form, item.mode, item.role, item.series].filter(Boolean))];
      return '<tr><td><strong>' + esc(item.name) + '</strong>' +
        (item.code ? '<small>' + esc(item.code) + '</small>' : '') +
        (tags.length ? '<div class="supply-price-tags">' + tags.map(tag => '<span>' + esc(tag) + '</span>').join('') + '</div>' : '') +
        (item.bundle ? '<small>В Excel в составе: ' + esc(item.bundle) + '</small>' : '') +
        renderSpecifications(item) +
        '</td><td>' + (item.price == null ? 'Уточнить' : money.format(item.price)) +
        '</td><td><button type="button" class="btn btn-secondary" data-pick="' + i +
        '" aria-label="' + esc('В заказ — ' + item.name) + '">В заказ</button></td></tr>';
    }).join('') || '<tr><td colspan="3">Позиции не найдены</td></tr>';
    element('page').textContent = matches.length
      ? (page * pageSize + 1) + '–' + (page * pageSize + visible.length) + ' из ' + matches.length
      : '0 позиций';
    element('prev').disabled = page === 0;
    element('next').disabled = (page + 1) * pageSize >= matches.length;
  }

  async function showFile(file) {
    const id = file?.id ?? null;
    const sequence = ++request;
    activeId = id;
    items = [];
    for (const btn of dialog.querySelectorAll('[data-file]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.file === String(id)));
    }
    element('catalog').hidden = true;
    element('message').textContent = file?.file_name || '';
    try {
      if (file && !workbookCache.has(id)) {
        element('message').textContent = 'Читаем Excel…';
        const result = await apiGet(base + '/price-files/' + id + '/catalog');
        workbookCache.set(id, result.items || []);
      }
      if (sequence !== request || !dialog.open) return;
      items = file ? workbookCache.get(id) : saved;
      query.value = '';
      options(sheet, items.map(item => item.sheet), 'Все листы');
      form.value = '';
      mode.value = '';
      fillTypes();
      element('message').textContent = file?.file_name || '';
      element('catalog').hidden = false;
      page = 0;
      render();
    } catch (error) {
      if (sequence !== request || !dialog.open) return;
      element('message').textContent = error.message || 'Не удалось открыть прайс';
    }
  }

  element('rows').addEventListener('click', event => {
    const button = event.target.closest('[data-pick]');
    if (!button) return;
    const item = visible[Number(button.dataset.pick)];
    const qty = item && onPick(item);
    if (qty) {
      renderCart();
      element('picked').textContent = 'Добавлено в заказ: ' + item.name;
    }
  });
  query.addEventListener('input', () => { page = 0; render(); });
  sheet.addEventListener('change', () => { fillTypes(); page = 0; render(); });
  form.addEventListener('change', () => { page = 0; render(); });
  mode.addEventListener('change', () => { page = 0; render(); });
  element('prev').onclick = () => { page--; render(); };
  element('next').onclick = () => { page++; render(); };

  try {
    const data = await apiGet(base + '/price-items');
    if (!dialog.open) return;
    saved = (data.items || []).map(name => ({ name, price: null }));
    // Несколько старых записей могут ссылаться на листы одной и той же книги.
    // Для полного просмотра нужен только её последний загруженный оригинал.
    const files = Array.from(new Map((data.files || []).map(file => [file.file_name || file.label, file])).values());
    for (const file of files.concat(saved.length ? [null] : [])) {
      const title = String(file?.file_name || file?.label || '');
      const brand = /^royal[ _]+clima/i.test(title) ? 'ROYAL Clima' :
        /^xigma\b|^xigma_/i.test(title) ? 'XIGMA' : title.replace(/\.xls[xm]?$/i, '');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary';
      btn.dataset.file = String(file?.id ?? null);
      btn.textContent = file ? brand : 'Сохранённые позиции';
      btn.title = title;
      btn.onclick = () => { if (activeId !== (file?.id ?? null) || !items.length) showFile(file); };
      dialog.querySelector('.supply-price-files').appendChild(btn);
    }
    if (!files.length && !saved.length) {
      element('message').textContent = 'В карточке поставщика пока нет прайсов. Их можно загрузить в «Снабжение → Поставщики».';
      return;
    }
    await showFile(files[0] || null);
  } catch (error) {
    if (dialog.open) element('message').textContent = error.message || 'Не удалось загрузить прайсы';
  }
};
