/* Run with NODE_PATH pointing at Playwright. All API calls stay in the fixture. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = process.env.WTB_QA_OUTPUT;
const executablePath = process.env.WTB_CHROMIUM_PATH;

async function check(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<body style="font:14px system-ui;margin:0;background:#f4f6fa"><main id="supply" style="max-width:1160px;margin:18px auto;padding:12px"></main></body></html>',
  }));
  await page.goto('http://127.0.0.1:8311/arrival');
  await page.addStyleTag({ path: path.join(root, 'app.css') });
  await page.addStyleTag({ path: path.join(root, 'supply-what.css') });
  await page.evaluate(() => {
    const original = { component_id: 22, name: 'Kinco CV20-4T-0022G', unit: 'шт.', need: 2,
      in_transit_allocated: 2, remaining_need: 2, stock_on_hand: 0, reserved_qty: 0, to_buy: 0 };
    const ready = { component_id: 37, name: 'Kinco CV20-4T-0037G', unit: 'шт.', need: 1,
      in_transit_allocated: 0, stock_on_hand: 2, reserved_qty: 1, remaining_need: 0, to_buy: 0,
      arrivals: [{ invoice_id: 51, document_number: '55001', qty: 1 }] };
    const controller = { component_id: 41, name: 'Контроллер EPK3DSR', unit: 'шт.', need: 1,
      in_transit_allocated: 0, stock_on_hand: 0, remaining_need: 0, issued_qty: 1, issued_work_ids: [91], to_buy: 0 };
    const card = { contract_id: 73, number: 'Демо', contractor_name: 'Тестовый договор', items_count: 1,
      summary: { stock_lines: 0, to_buy_lines: 0, in_transit_lines: 1 } };
    const item = { id: 'ci:682', contract_id: 73, contract_item_id: 682, contract_number: 'Демо',
      model_article: 'ЩУ-DEMO', name: 'Щит управления', qty: 1, unit: 'шт.',
      status: 'in_transit', production: { state: 'running', progress: 10 },
      children: [controller, original], warnings: [], data_errors: [] };
    window.savedArrival = null;
    window.showToast = () => {};
    window.openSupplyInvoiceFile = id => { window.openedUPD = id; };
    window.apiGet = async url => {
      const address = new URL(url, location.origin);
      if (address.pathname.endsWith('/arrivals')) {
        return { lines: address.searchParams.get('q') === '55001' ? [{
          id: 799, invoice_id: 51, document_number: '55001', document_date: '2026-11-13',
          name_raw: ready.name, supplier_name: 'Поставщик', component_id: 37, sku: 'CV20-4T-0037G',
          available: 2, component_unit: 'шт.'
        }] : [] };
      }
      return { contracts: [card], contract: card, min_stock: { items: [] }, in_transit: [],
        items: address.searchParams.has('contract_id') ? [item] : [] };
    };
    window.apiPost = async (url, data) => {
      if (!url.endsWith('/arrivals')) throw Error(url);
      window.savedArrival = data;
      item.children = [controller, { ...original, in_transit_allocated: 1, remaining_need: 1, need: 1 }, ready];
      return { ok: true, data: { qty: 1, work_id: 91 } };
    };
  });
  await page.addScriptTag({ path: path.join(root, 'supply-what.js') });
  await page.evaluate(() => wtbTryLoad(document.getElementById('supply')));
  await page.locator('[data-wtb-contract="73"]').click();
  await page.locator('.wtb-heading-toggle').click();
  await page.getByText('Выдано в работу №91', { exact: true }).waitFor();
  await page.locator('[data-wtb-arrival]').click();
  await page.getByLabel('Номер УПД, артикул или наименование').fill('55001');
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await page.getByLabel('Строка УПД').selectOption('799');
  const confirm = page.getByRole('button', { name: 'Принять замену', exact: true });
  await confirm.waitFor();
  await page.getByLabel('Количество').fill('1');
  await page.getByLabel('Причина замены').fill('Исходного артикула не было');
  assert.match(await page.locator('[data-arrival-source]').innerText(), /УПД №55001/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
  assert.ok(await page.locator('.wtb-arrival .wtb-modal-b').evaluate(el => el.scrollWidth <= el.clientWidth + 1),
    'no horizontal scroll inside the arrival dialog');
  if (output) {
    fs.mkdirSync(output, { recursive: true });
    await page.locator('.wtb-arrival').screenshot({ path: path.join(output, 'arrival-' + width + '.png') });
  }
  await confirm.click();
  await page.locator('[data-wtb-arrival-file="51"]').waitFor();
  const payload = await page.evaluate(() => window.savedArrival);
  assert.equal(payload.mode, 'replace');
  assert.equal(payload.qty, 1);
  assert.equal(payload.invoice_item_id, 799);
  assert.match(payload.request_id, /^[0-9a-f-]{36}$/);
  await page.locator('[data-wtb-arrival-file="51"]').click();
  assert.equal(await page.evaluate(() => window.openedUPD), 51);
  assert.deepEqual(errors, []);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    await check(browser, 1200);
    await check(browser, 390);
    console.log('Приход с заменой, частичное количество и ссылка на УПД проверены на 1200 и 390 px');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
