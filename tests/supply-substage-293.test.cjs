const test=require('node:test'),assert=require('node:assert/strict');
const board=require('../supply-board.js'),sb=require('../supply-buy.js');
test('ORD-464 «В изготовлении» в «Что закупить», а не «Оплачено, едет»',()=>{
  const input={orders:[{id:464,status:'paid',paid_substage:'manufacturing',supplier_id:21,purpose:'ТЭНы на Абхазию',invoice_number:'3384',invoice_items:[{name:'ТЭН',qty:30,unit:'шт'}]}],shop:{groups:[]}};
  const rows=board.decorateRows(sb.sbBuildRows(input),{});
  assert.equal(rows.length,1);
  assert.match(board.badge(rows[0]),/В изготовлении/);
  assert.doesNotMatch(board.badge(rows[0]),/Оплачено, едет/);
});
test('без подстатуса оплаченный остаётся «Оплачено, едет»; «Едет» сильнее',()=>{
  assert.match(board.badge({stage:'go',status:'paid',_raw:{}}),/Оплачено, едет/);
  assert.match(board.badge({stage:'go',status:'shipping',_raw:{paid_substage:'manufacturing'}}),/Едет/);
  assert.match(board.badge({stage:'go',status:'paid',_raw:{order_paid_substage:'manufacturing'}}),/В изготовлении/);
  assert.match(board.badge({stage:'pay',status:'to_pay',_raw:{paid_substage:'manufacturing'}}),/На оплату/);
});
