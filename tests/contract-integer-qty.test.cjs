const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-2.js'), 'utf8');

function functionBlock(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start);
  assert.notEqual(start, -1, `Не найдена функция ${name}`);
  assert.notEqual(end, -1, `Не найден конец функции ${name}`);
  return source.slice(start, end);
}

test('штучные, комплектные и упаковочные позиции требуют целого количества', () => {
  const context = {};
  vm.runInNewContext(
    functionBlock('_specUnitRequiresWholeQty', '_syncSpecQtyRules'),
    context
  );

  for (const unit of ['шт.', 'шт', 'ШТУК', 'компл.', 'комплект', 'упак.']) {
    assert.equal(context._specUnitRequiresWholeQty(unit), true, unit);
  }
  for (const unit of ['м', 'м²', 'кг', 'т', 'л']) {
    assert.equal(context._specUnitRequiresWholeQty(unit), false, unit);
  }
});

test('поле количества получает шаг 1 для шт. и сохраняет дробный шаг для метров', () => {
  const qty = { value: '0.99' };
  const unit = { value: 'шт.' };
  const context = {
    document: {
      getElementById(id) {
        return id === 'spec-form-qty' ? qty : unit;
      },
    },
  };
  vm.runInNewContext(
    functionBlock('_specUnitRequiresWholeQty', 'selectUnifiedSpec'),
    context
  );

  context._syncSpecQtyRules(true);
  assert.equal(qty.value, '1');
  assert.equal(qty.min, '1');
  assert.equal(qty.step, '1');
  assert.equal(qty.inputMode, 'numeric');

  unit.value = 'м';
  qty.value = '0.99';
  context._syncSpecQtyRules(true);
  assert.equal(qty.value, '0.99');
  assert.equal(qty.min, '0.01');
  assert.equal(qty.step, '0.01');
  assert.equal(qty.inputMode, 'decimal');
});

test('сохранение не пропускает дробное количество для счётной единицы', () => {
  const submit = functionBlock('submitSpecForm', '_toggleSpecAlt');
  assert.match(submit, /_specUnitRequiresWholeQty\(unit\) && !Number\.isInteger\(qty\)/);
  assert.match(submit, /укажите целое количество: 1, 2, 3…/);
  assert.match(submit, /qty: qty/);
  assert.match(submit, /unit: unit/);
});
