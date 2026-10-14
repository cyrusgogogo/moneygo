'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ledgerPath = path.join(__dirname, '../dist/ledger.js');
const relationPath = fs.existsSync(path.join(__dirname, 'relations.js')) ? path.join(__dirname, 'relations.js') : path.join(__dirname, '../dist/relations.js');
const L = require(ledgerPath);
const R = require(relationPath);
const copy = value => JSON.parse(JSON.stringify(value));
const err = code => error => error.code === code;
const frozen = value => { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) frozen(child); } return value; };
function transaction(id, type, amountCents, date = '2026-10-01', accountId = 'account-cash', extra = {}) {
  return { id, type, date, amountCents, accountId, ...(type === 'transfer' ? { toAccountId: 'bank' } : { categoryId: type === 'expense' ? 'expense-food' : 'income-other' }), note: '', ...extra };
}
function fixture(rows = []) { const s = L.createEmpty(); s.accounts.push({ id: 'bank', name: '银行卡', openingBalanceCents: 100000 }); s.transactions = rows; return L.validateState(s); }
function validateFull(state) { return L.validateState(state); }
function updateTransaction(state, id, patch) { const next = copy(state); Object.assign(next.transactions.find(t => t.id === id), patch); return validateFull(next); }
function deleteTransaction(state, id) { const next = copy(state); next.transactions = next.transactions.filter(t => t.id !== id); return validateFull(next); }
function claim(state, amount = 8000, extra = {}) { return R.createClaim(state, { expenseId: 'expense', amountCents: amount, kind: 'advance', name: '朋友份额', status: 'unsubmitted', note: '', ...extra }); }
function refund(state, incomeId = 'refund', amount = 3000, extra = {}) { return R.allocateRefund(state, { incomeId, expenseId: 'expense', amountCents: amount, reason: '确认原订单退款', ...extra }); }
function settle(state, incomeId, amount, claimId = state.bookkeeping.claims[0].id) { return R.settleClaim(state, { incomeId, claimId, amountCents: amount, reason: '核实实际回款' }); }
function inputWithReceipt() { return fixture([transaction('expense', 'expense', 10000), transaction('refund', 'income', 3000, '2026-11-01'), transaction('refund2', 'income', 2000, '2026-12-01')]); }

test('standalone UMD loads with no Ledger, DOM, network or timers', () => {
  const window = {}; vm.runInNewContext(fs.readFileSync(relationPath, 'utf8'), { window });
  assert.equal(window.MoneygoRelations.VERSION, 1); assert.ok(Object.isFrozen(R)); assert.ok(Object.isFrozen(R.LIMITS));
  const a = R.defaultState(), b = R.defaultState(); a.links.push({}); assert.equal(b.links.length, 0);
});

test('legacy ledger totals retain their meanings without extension', () => {
  const state = fixture([transaction('expense', 'expense', 1234), transaction('salary', 'income', 8000), transaction('move', 'transfer', 500)]);
  const result = R.calculate(state);
  assert.deepEqual(result.cash, L.summary(state));
  for (const key of Object.keys(result.cash)) assert.equal(result.personal[key], result.cash[key]);
  assert.deepEqual({ ...result.accountBalances }, { ...L.balances(state) });
  assert.equal(result.receivables.outstandingCents, 0);
  assert.equal(state.bookkeeping, undefined);
});

test('same-day same-amount coffees remain independent until explicit confirmation', () => {
  const state = fixture([transaction('coffee1', 'expense', 2800), transaction('coffee2', 'expense', 2800), transaction('coffee3', 'expense', 2800)]);
  const before = JSON.stringify(state), matches = R.candidates(state, 'coffee1');
  assert.equal(matches.length, 2); assert.ok(matches.every(v => v.confirmed === false && v.eligible && v.warnings.length));
  assert.equal(R.calculate(state).personal.expenseCents, 8400); assert.equal(JSON.stringify(state), before);
  const linked = R.linkEvidence(state, { primaryId: 'coffee1', shadowId: 'coffee2', reason: '人工核对订单' });
  assert.equal(linked.transactions.length, 3); assert.equal(R.calculate(linked).personal.expenseCents, 5600);
  assert.equal(R.calculate(linked).excludedEvidence.length, 1); assert.equal(R.candidates(linked, 'coffee1').length, 1);
});

test('manual paid canonical retains notes and category, original imported evidence is intact', () => {
  const state = fixture([transaction('manual', 'expense', 5000, '2026-10-01', 'bank', { note: '手写重要说明', categoryId: 'expense-shopping' }), transaction('imported', 'expense', 5000, '2026-10-02', 'bank')]);
  state.imports = { marker: 'opaque preserved data', evidence: [{ id: 'evidence-1', transactionId: 'imported', sourceKey: '用户文件', status: 'unknown', mapped: { channel: '微信' } }] };
  state.simulation = { marker: 'opaque preserved data' };
  const before = copy(state); frozen(state);
  const linked = R.linkEvidence(state, { primaryId: 'manual', shadowId: 'imported', reason: '核对后保留手记为主' });
  assert.deepEqual(linked.imports, before.imports); assert.deepEqual(linked.simulation, before.simulation);
  assert.deepEqual(linked.transactions, before.transactions); assert.equal(linked.transactions[0].note, '手写重要说明');
  assert.equal(R.calculate(linked).cash.expenseCents, 5000); assert.deepEqual(state, before);
});

test('channels never identify funding and mismatched accounts are ineligible', () => {
  const state = fixture([transaction('a', 'expense', 200), transaction('b', 'expense', 200, '2026-10-01', 'bank')]);
  const matches = R.candidates(state, 'a'); assert.equal(matches[0].eligible, false);
  assert.throws(() => R.linkEvidence(state, { primaryId: 'a', shadowId: 'b', reason: '相同渠道' }), err('RELATION_MISMATCH'));
});

test('evidence links block self-links, overlaps, chains, cycles and duplicate confirmations', () => {
  const state = fixture(['a', 'b', 'c', 'd'].map(key => transaction(key, 'expense', 200)));
  assert.throws(() => R.linkEvidence(state, { primaryId: 'a', shadowId: 'a', reason: 'x' }), err('RELATION_OVERLAP'));
  const linked = R.linkEvidence(state, { primaryId: 'a', shadowId: 'b', reason: 'x' });
  for (const pair of [['b', 'c'], ['c', 'b'], ['b', 'a'], ['a', 'b']]) assert.throws(() => R.linkEvidence(linked, { primaryId: pair[0], shadowId: pair[1], reason: 'x' }), err('RELATION_OVERLAP'));
  assert.equal(R.linkEvidence(linked, { primaryId: 'c', shadowId: 'd', reason: 'x' }).bookkeeping.links.length, 2);
});

test('wrong amounts, types, transfer destinations and nonexistent rows are rejected', () => {
  const state = fixture([transaction('a', 'expense', 200), transaction('b', 'income', 200), transaction('c', 'expense', 201), transaction('t1', 'transfer', 500), transaction('t2', 'transfer', 500, '2026-10-01', 'bank', { toAccountId: 'account-cash' })]);
  for (const key of ['b', 'c']) assert.throws(() => R.linkEvidence(state, { primaryId: 'a', shadowId: key, reason: 'x' }), err('RELATION_MISMATCH'));
  assert.throws(() => R.linkEvidence(state, { primaryId: 't1', shadowId: 't2', reason: 'x' }), err('RELATION_MISMATCH'));
  assert.throws(() => R.linkEvidence(state, { primaryId: 'a', shadowId: 'missing', reason: 'x' }), err('NOT_FOUND'));
});

test('transfer duplicate counts both account legs exactly once without personal consumption', () => {
  const state = R.linkEvidence(fixture([transaction('t1', 'transfer', 500), transaction('t2', 'transfer', 500)]), { primaryId: 't1', shadowId: 't2', reason: '同一笔还款双份证据' });
  const r = R.calculate(state); assert.equal(r.cash.transferCents, 500); assert.equal(r.personal.expenseCents, 0); assert.equal(r.cash.netCents, 0);
  assert.deepEqual({ ...r.accountBalances }, { 'account-cash': -500, bank: 100500 });
});

test('linked financial edits and deletions block; note/category corrections remain permitted', () => {
  let state = R.linkEvidence(fixture([transaction('a', 'expense', 200), transaction('b', 'expense', 200)]), { primaryId: 'a', shadowId: 'b', reason: '同一购买' });
  for (const key of ['a', 'b']) {
    assert.throws(() => updateTransaction(state, key, { date: '2026-10-02' }), err('RELATION_CHANGED'));
    assert.throws(() => updateTransaction(state, key, { amountCents: 201 }), err('RELATION_MISMATCH'));
    assert.throws(() => deleteTransaction(state, key), err('RELATION_REFERENCED'));
  }
  const both = copy(state); both.transactions.forEach(v => { v.amountCents = 300; }); assert.throws(() => validateFull(both), err('RELATION_CHANGED'));
  state = updateTransaction(state, 'a', { note: '补充说明', categoryId: 'expense-shopping' }); assert.equal(R.calculate(state).personal.expenseCents, 200);
  state = R.unlink(state, 'link', state.bookkeeping.links[0].id, '发现其实是两杯咖啡');
  assert.equal(R.calculate(state).personal.expenseCents, 400); assert.equal(state.transactions.length, 2);
  assert.equal(state.bookkeeping.audit.at(-1).action, 'unlink'); assert.equal(state.bookkeeping.audit.at(-1).before.primaryId, 'a');
});

test('100 purchase with 30 and 20 received refunds yields consumption50 cash receipts50', () => {
  const state = refund(refund(inputWithReceipt()), 'refund2', 2000), all = R.calculate(state);
  assert.equal(all.cash.incomeCents, 5000); assert.equal(all.cash.expenseCents, 10000); assert.equal(all.personal.incomeCents, 0); assert.equal(all.personal.expenseCents, 5000);
  assert.equal(all.impacts.expense.refundCents, 5000); assert.equal(all.impacts.refund.availableIncomeCents, 0);
  assert.equal(R.calculate(state, '2026-10').personal.expenseCents, 5000);
  assert.equal(R.calculate(state, '2026-10').cash.expenseCents, 10000);
  assert.equal(R.calculate(state, '2026-11').cash.incomeCents, 3000);
  assert.equal(R.calculate(state, '2026-11').personal.expenseCents, 0);
  assert.equal(R.calculate(state, '2026-12').personal.incomeCents, 0);
  assert.ok(all.assumptions.some(v => v.includes('历史')));
});

test('many-to-many refunds split one income across purchases and multiple receipts per purchase', () => {
  let state = fixture([transaction('expense', 'expense', 10000), transaction('expense2', 'expense', 7000), transaction('receipt', 'income', 12000, '2026-10-03')]);
  state = refund(state, 'receipt', 9000);
  state = R.allocateRefund(state, { incomeId: 'receipt', expenseId: 'expense2', amountCents: 3000, reason: '同批退款另一订单' });
  assert.equal(R.calculate(state).personal.expenseCents, 5000); assert.equal(R.calculate(state).personal.incomeCents, 0);
});

test('refund income remainder remains ordinary income and allocations expose availability', () => {
  let state = fixture([transaction('expense', 'expense', 10000), transaction('receipt', 'income', 12000, '2026-10-03')]);
  state = refund(state, 'receipt', 5000); const report = R.calculate(state);
  assert.equal(report.personal.incomeCents, 7000); assert.equal(report.impacts.receipt.availableIncomeCents, 7000); assert.equal(report.impacts.expense.refundableExpenseCents, 5000);
});

test('claim80 against expense100 yields own20, receivable80, cash still minus100', () => {
  const state = claim(fixture([transaction('expense', 'expense', 10000)])); const report = R.calculate(state);
  assert.equal(report.cash.netCents, -10000); assert.equal(report.personal.expenseCents, 2000); assert.equal(report.receivables.outstandingCents, 8000); assert.equal(report.accountBalances['account-cash'], -10000);
  assert.equal(report.receivables.claims[0].status, 'unsubmitted'); assert.equal(report.receivables.claims[0].settledCents, 0);
});

test('split repayments30+50 settle claim80 without adding ordinary income', () => {
  let state = claim(fixture([transaction('expense', 'expense', 10000), transaction('paid1', 'income', 3000, '2026-11-01'), transaction('paid2', 'income', 5000, '2026-12-01')]));
  state = settle(state, 'paid1', 3000); assert.equal(R.calculate(state).receivables.outstandingCents, 5000);
  state = settle(state, 'paid2', 5000); const report = R.calculate(state);
  assert.equal(report.cash.netCents, -2000); assert.equal(report.personal.incomeCents, 0); assert.equal(report.personal.expenseCents, 2000); assert.equal(report.receivables.outstandingCents, 0);
  assert.equal(R.calculate(state, '2026-11').cash.incomeCents, 3000); assert.equal(R.calculate(state, '2026-11').personal.incomeCents, 0);
});

test('one repayment can cover several claims; claim balances remain separate', () => {
  let state = fixture([transaction('expense', 'expense', 10000), transaction('e2', 'expense', 10000), transaction('receipt', 'income', 14000, '2026-10-04')]);
  state = claim(state, 8000); const first = state.bookkeeping.claims[0].id;
  state = claim(state, 6000, { expenseId: 'e2', kind: 'reimbursement', name: '出差项目' }); const second = state.bookkeeping.claims[1].id;
  state = settle(state, 'receipt', 8000, first); state = settle(state, 'receipt', 6000, second);
  assert.equal(R.calculate(state).receivables.outstandingCents, 0); assert.equal(R.calculate(state).personal.expenseCents, 6000);
});

test('claims plus refunds cannot consume the same expense share', () => {
  const state = claim(inputWithReceipt()); const before = JSON.stringify(state);
  assert.throws(() => refund(state), err('EXPENSE_OVERALLOCATED')); assert.equal(JSON.stringify(state), before);
  const refunded = refund(inputWithReceipt()); assert.throws(() => claim(refunded), err('EXPENSE_OVERALLOCATED'));
  assert.throws(() => claim(claim(inputWithReceipt(), 6000), 5000), err('EXPENSE_OVERALLOCATED'));
});

test('income cannot fund both refund and settlement above receipt amount', () => {
  let state = claim(inputWithReceipt(), 5000); state = refund(state, 'refund', 2000);
  assert.throws(() => settle(state, 'refund', 1001), err('INCOME_OVERALLOCATED'));
  state = settle(state, 'refund', 1000); assert.equal(R.calculate(state).impacts.refund.availableIncomeCents, 0);
});

test('overpayment, negative, zero, fractions, NaN, infinity and coercion fail atomically', () => {
  const state = claim(fixture([transaction('expense', 'expense', 10000), transaction('receipt', 'income', 20000)]), 8000);
  assert.throws(() => settle(state, 'receipt', 8001), err('CLAIM_OVERPAID'));
  assert.throws(() => refund(state, 'receipt', 20001), err('INCOME_OVERALLOCATED'));
  for (const value of [-1, 0, 0.1, NaN, Infinity, '100', null, true, R.MAX_AMOUNT_CENTS + 1, Number.MAX_SAFE_INTEGER + 1]) {
    const before = JSON.stringify(state); assert.throws(() => settle(state, 'receipt', value), err('INVALID_AMOUNT')); assert.equal(JSON.stringify(state), before);
  }
});

test('referenced income/expense/claims cannot disappear or change direction', () => {
  let state = claim(inputWithReceipt()); state = settle(state, 'refund', 3000);
  for (const key of ['expense', 'refund']) assert.throws(() => deleteTransaction(state, key), err('RELATION_REFERENCED'));
  assert.throws(() => updateTransaction(state, 'expense', { type: 'income', categoryId: 'income-other' }), err('RELATION_REFERENCED'));
  assert.throws(() => R.unlink(state, 'claim', state.bookkeeping.claims[0].id, '删除'), err('RELATION_REFERENCED'));
  assert.throws(() => R.updateClaim(state, state.bookkeeping.claims[0].id, { amountCents: 2000 }, '核减'), err('CLAIM_OVERPAID'));
  assert.throws(() => updateTransaction(state, 'refund', { amountCents: 2000 }), err('RELATION_CHANGED'));
});

test('claim reductions explicitly move unpaid difference to own consumption, with full audit', () => {
  let state = claim(inputWithReceipt()); state = settle(state, 'refund', 3000); const claimId = state.bookkeeping.claims[0].id;
  state = R.updateClaim(state, claimId, { amountCents: 5000, status: 'submitted', note: '差额3000确认自付' }, '报销核减3000，转为自付');
  assert.equal(R.calculate(state).personal.expenseCents, 5000); assert.equal(R.calculate(state).receivables.outstandingCents, 2000);
  const audit = state.bookkeeping.audit.at(-1); assert.equal(audit.action, 'update'); assert.equal(audit.before.amountCents, 8000); assert.equal(audit.after.amountCents, 5000);
  state = R.unlink(state, 'settlement', state.bookkeeping.settlements[0].id, '回款归属待核实'); assert.equal(R.calculate(state).personal.incomeCents, 5000);
  state = R.unlink(state, 'claim', claimId, '确认全部自付'); assert.equal(R.calculate(state).personal.expenseCents, 10000);
});

test('shadow transactions cannot receive refunds, claims or repayments, in either operation order', () => {
  let state = fixture([transaction('expense', 'expense', 10000), transaction('shadow', 'expense', 10000), transaction('refund', 'income', 3000)]);
  state = R.linkEvidence(state, { primaryId: 'expense', shadowId: 'shadow', reason: '核对同一支出' });
  assert.throws(() => R.createClaim(state, { expenseId: 'shadow', amountCents: 100, kind: 'advance', name: 'x' }), err('RELATION_SHADOW'));
  assert.throws(() => R.allocateRefund(state, { incomeId: 'refund', expenseId: 'shadow', amountCents: 100, reason: 'x' }), err('RELATION_SHADOW'));
  const prior = claim(fixture([transaction('expense', 'expense', 10000), transaction('shadow', 'expense', 10000)]));
  assert.throws(() => R.linkEvidence(prior, { primaryId: 'shadow', shadowId: 'expense', reason: 'x' }), err('RELATION_SHADOW'));
  let receipt = fixture([transaction('expense', 'expense', 10000), transaction('refund', 'income', 3000), transaction('shadow', 'income', 3000)]);
  receipt = R.linkEvidence(receipt, { primaryId: 'refund', shadowId: 'shadow', reason: 'x' });
  assert.throws(() => refund(receipt, 'shadow', 100), err('RELATION_SHADOW'));
});

test('received allocations cannot precede original cash outlay', () => {
  const state = fixture([transaction('expense', 'expense', 10000, '2026-10-02'), transaction('refund', 'income', 3000, '2026-10-01')]);
  assert.throws(() => refund(state), err('RELATION_DATE'));
  assert.throws(() => settle(claim(state), 'refund', 3000), err('RELATION_DATE'));
});

test('pending refund plans are nonfinancial, receipt allocation controls actual progress', () => {
  const original = inputWithReceipt(); let state = R.addRefundPlan(original, { expenseId: 'expense', expectedAmountCents: 5000, dueDate: '2026-11-10', note: '退货已寄出' });
  const planId = state.bookkeeping.refundPlans[0].id;
  assert.deepEqual(R.calculate(state).cash, R.calculate(original).cash); assert.deepEqual(R.calculate(state).personal, R.calculate(original).personal);
  assert.equal(R.calculate(state).refundPlans[0].receivedCents, 0);
  state = refund(state, 'refund', 3000, { planId }); assert.equal(R.calculate(state).refundPlans[0].receiptStatus, 'partial'); assert.equal(R.calculate(state).refundPlans[0].remainingCents, 2000);
  state = refund(state, 'refund2', 2000, { planId }); assert.equal(R.calculate(state).refundPlans[0].receiptStatus, 'received');
  assert.throws(() => R.unlink(state, 'refundPlan', planId, '删除'), err('RELATION_REFERENCED'));
  state = R.updateRefundPlan(state, planId, { status: 'closed', note: '已核对' }, '退款核对结束'); assert.equal(state.bookkeeping.refundPlans[0].status, 'closed');
});

test('refund plan constraints, status validation, cancellation and expected reductions are explicit', () => {
  const state = inputWithReceipt();
  for (const patch of [{ expectedAmountCents: 10001 }, { dueDate: '2026-09-30' }]) assert.throws(() => R.addRefundPlan(state, { expenseId: 'expense', expectedAmountCents: 5000, ...patch }), err('INVALID_REFUND_PLAN'));
  assert.throws(() => R.addRefundPlan(state, { expenseId: 'expense', expectedAmountCents: 5000, status: 'guaranteed' }), err('INVALID_RELATION_STATUS'));
  let planned = R.addRefundPlan(state, { expenseId: 'expense', expectedAmountCents: 5000 }); const id = planned.bookkeeping.refundPlans[0].id;
  planned = refund(planned, 'refund', 3000, { planId: id });
  assert.throws(() => R.updateRefundPlan(planned, id, { expectedAmountCents: 2999 }, 'x'), err('REFUND_PLAN_OVERPAID'));
  planned = R.updateRefundPlan(planned, id, { status: 'cancelled' }, '剩余退款放弃'); assert.equal(R.calculate(planned).personal.expenseCents, 7000);
});

test('same-date balance snapshots include end-of-day flow and ignore future transactions', () => {
  const original = fixture([transaction('past', 'expense', 500, '2026-10-01'), transaction('day', 'income', 200, '2026-10-02'), transaction('future', 'expense', 700, '2026-10-03')]);
  const state = R.addSnapshot(original, { accountId: 'account-cash', date: '2026-10-02', actualBalanceCents: -300, note: '核对当日日终' });
  const id = state.bookkeeping.snapshots[0].id, result = R.reconciliation(state, id);
  assert.equal(result.ledgerBalanceCents, -300); assert.equal(result.differenceCents, 0); assert.equal(result.reconciled, true); assert.equal(result.changed, false);
  const edited = updateTransaction(state, 'future', { amountCents: 900 }); assert.equal(R.reconciliation(edited, id).changed, false);
  assert.equal(state.transactions.length, original.transactions.length); assert.equal(R.calculate(state).accountBalances['account-cash'], -1000);
});

test('snapshot detects exact prior financial changes even when net difference cancels out', () => {
  let state = fixture([transaction('out', 'expense', 500), transaction('in', 'income', 500)]);
  state = R.addSnapshot(state, { accountId: 'account-cash', date: '2026-10-02', actualBalanceCents: 0 }); const id = state.bookkeeping.snapshots[0].id;
  let changed = updateTransaction(updateTransaction(state, 'out', { amountCents: 600 }), 'in', { amountCents: 600 });
  const result = R.reconciliation(changed, id); assert.equal(result.differenceCents, 0); assert.equal(result.changed, true); assert.equal(result.reconciled, true);
  const noteOnly = updateTransaction(state, 'out', { note: '仅备注' }); assert.equal(R.reconciliation(noteOnly, id).changed, false);
  changed = copy(state); changed.accounts[0].openingBalanceCents = 100; assert.equal(R.reconciliation(changed, id).changed, true); assert.equal(R.reconciliation(changed, id).differenceCents, -100);
});

test('snapshot reconciliation changes after evidence link; no balancing transaction is created', () => {
  let state = fixture([transaction('a', 'expense', 500), transaction('b', 'expense', 500)]);
  state = R.addSnapshot(state, { accountId: 'account-cash', date: '2026-10-02', actualBalanceCents: -500 }); const id = state.bookkeeping.snapshots[0].id;
  assert.equal(R.reconciliation(state, id).differenceCents, 500);
  state = R.linkEvidence(state, { primaryId: 'a', shadowId: 'b', reason: '发现重复证据' });
  const report = R.reconciliation(state, id); assert.equal(report.differenceCents, 0); assert.equal(report.changed, true); assert.equal(report.capturedDifferenceCents, 500); assert.equal(state.transactions.length, 2);
});

test('snapshot historical basis survives transaction deletion, account deletion stays blocked', () => {
  let state = R.addSnapshot(fixture([transaction('a', 'expense', 500)]), { accountId: 'account-cash', date: '2026-10-02', actualBalanceCents: -500 }); const id = state.bookkeeping.snapshots[0].id;
  state = deleteTransaction(state, 'a'); assert.equal(R.reconciliation(state, id).changed, true);
  const missing = copy(state); missing.accounts = missing.accounts.filter(v => v.id !== 'account-cash'); assert.throws(() => R.validate(missing.bookkeeping, missing), err('RELATION_REFERENCED'));
});

test('dependencies enumerate direct blockers and keep snapshots historical, not transaction locks', () => {
  let state = claim(inputWithReceipt(), 5000); state = refund(state); state = R.addRefundPlan(state, { expenseId: 'expense', expectedAmountCents: 5000 });
  assert.deepEqual(new Set(R.dependencies(state, 'expense').map(v => v.kind)), new Set(['claim', 'refund', 'refundPlan']));
  assert.deepEqual(R.dependencies(state, 'refund').map(v => v.kind), ['refund']);
  assert.deepEqual(R.dependencies(state, 'missing'), []);
});

test('strict extension schema rejects unknown fields, unknown statuses and malicious identifiers', () => {
  const state = fixture(), original = R.defaultState();
  for (const mutate of [v => { v.version = 2; }, v => { v.extra = true; }, v => { v.revision = 1; }, v => { delete v.links; }, v => { v.refunds = [undefined]; }, v => { v.links = new Array(1); }]) { const v = copy(original); mutate(v); assert.throws(() => R.validate(v, state)); }
  for (const key of ['__proto__', 'constructor', 'prototype', '', 'x/y', 'x'.repeat(101)]) assert.throws(() => R.dependencies(state, key), err('INVALID_ID'));
  assert.throws(() => claim(fixture([transaction('expense', 'expense', 10000)]), 1000, { status: 'paid' }), err('INVALID_RELATION_STATUS'));
  assert.throws(() => claim(fixture([transaction('expense', 'expense', 10000)]), 1000, { kind: 'guaranteed' }), err('INVALID_RELATION_STATUS'));
});

test('full strict audit detects unlogged edits, dropped records, journal gaps and identifier reuse', () => {
  const state = claim(inputWithReceipt(), 5000);
  for (const mutate of [
    v => { v.bookkeeping.claims[0].amountCents = 4000; },
    v => { v.bookkeeping.claims = []; },
    v => { v.bookkeeping.audit = []; v.bookkeeping.revision = 0; },
    v => { v.bookkeeping.audit[0].revision = 2; },
    v => { v.bookkeeping.audit[0].after.expenseId = 'refund'; },
    v => { v.bookkeeping.audit[0].id = v.bookkeeping.claims[0].id; },
    v => { v.bookkeeping.audit[0].action = 'approve'; },
    v => { v.bookkeeping.audit[0].after.newField = true; }
  ]) { const tampered = copy(state); mutate(tampered); assert.throws(() => R.validate(tampered.bookkeeping, tampered)); }
  let next = R.unlink(state, 'claim', state.bookkeeping.claims[0].id, '撤销'); next = claim(next, 5000);
  assert.notEqual(next.bookkeeping.claims[0].id, state.bookkeeping.claims[0].id);
  assert.equal(next.bookkeeping.audit.length, 3);
});

test('numeric, date, text and capacity boundaries are enforced', () => {
  const state = fixture([transaction('expense', 'expense', 10000)]);
  for (const value of ['2026-02-29', '0000-01-01', '2026-13-01', '2026-01-00', '2026-1-1', '2026-10-01T00:00:00Z']) assert.throws(() => claim(state, 100, { dueDate: value }), err('INVALID_DATE'));
  assert.ok(claim(state, 100, { dueDate: '2028-02-29' }));
  assert.throws(() => claim(state, 100, { name: 'x'.repeat(81) })); assert.throws(() => claim(state, 100, { note: 'x'.repeat(501) }));
  assert.throws(() => claim(state, 100, { note: 'bad\u0000note' }));
  for (const value of ['', '2026-13', '0000-10', 202610, '2026-1']) assert.throws(() => R.calculate(state, value), err('INVALID_MONTH'));
  assert.throws(() => R.updateClaim(claim(state), 'not-found', {}, 'x'), err('NOT_FOUND'));
  assert.throws(() => R.unlink(claim(state), 'alien', 'x', 'x'), err('INVALID_RELATION_KIND'));
  assert.throws(() => R.unlink(claim(state), 'claim', 'not-found', 'x'), err('NOT_FOUND'));
});

test('maximum individual cents remain exact; unsafe positive cumulative totals are rejected', () => {
  const max = R.MAX_AMOUNT_CENTS;
  const state = fixture([transaction('expense', 'expense', max), transaction('receipt', 'income', max)]);
  const refunded = refund(state, 'receipt', max); assert.equal(R.calculate(refunded).personal.expenseCents, 0); assert.equal(R.calculate(refunded).cash.netCents, 0);
  const tooLarge = L.createEmpty(); tooLarge.transactions = Array.from({ length: 9010 }, (_, i) => transaction('x' + i, 'income', max));
  assert.throws(() => R.calculate(tooLarge), err('AMOUNT_OVERFLOW'));
});

test('BigInt accumulation preserves safe final balances despite large cancelling transfer sums', () => {
  // Each account remains bounded while transfers move balances back and forth.
  const state = fixture(Array.from({ length: 100 }, (_, i) => transaction('t' + i, 'transfer', R.MAX_AMOUNT_CENTS, '2026-10-01', i % 2 ? 'bank' : 'account-cash', { toAccountId: i % 2 ? 'account-cash' : 'bank' })));
  const result = R.calculate(state); assert.equal(result.accountBalances['account-cash'], 0); assert.equal(result.accountBalances.bank, 100000); assert.equal(result.cash.transferCents, 99999999999900);
});

test('frozen inputs stay unchanged across all successful and rejected mutation APIs', () => {
  const original = frozen(inputWithReceipt()), before = JSON.stringify(original);
  const created = claim(original, 5000); assert.equal(JSON.stringify(original), before);
  const current = frozen(created), before2 = JSON.stringify(current);
  const updated = R.updateClaim(current, current.bookkeeping.claims[0].id, { status: 'submitted' }, '已提交');
  assert.equal(JSON.stringify(current), before2); assert.equal(updated.bookkeeping.claims[0].status, 'submitted');
  assert.throws(() => refund(current, 'refund', 999999)); assert.equal(JSON.stringify(current), before2);
});

test('v4 extension JSON round trip preserves references, audit, snapshots and all views', () => {
  let state = claim(inputWithReceipt(), 5000); state = refund(state); state = settle(state, 'refund2', 2000); state = R.addSnapshot(state, { accountId: 'account-cash', date: '2026-12-01', actualBalanceCents: -5000 });
  const restored = validateFull(copy(state)); assert.deepEqual(restored.bookkeeping, state.bookkeeping); assert.deepEqual(R.calculate(restored), R.calculate(state));
  assert.deepEqual(R.reconciliation(restored, state.bookkeeping.snapshots[0].id), R.reconciliation(state, state.bookkeeping.snapshots[0].id));
});

test('deterministic generated allocation permutations preserve conservation and reversibility', () => {
  let seed = 719; const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let trial = 0; trial < 80; trial++) {
    const total = 100 + random(50000), refundAmount = random(total), claimAmount = random(total - refundAmount + 1), receipt = refundAmount + claimAmount;
    let state = fixture([transaction('expense', 'expense', total), transaction('receipt', 'income', Math.max(1, receipt))]);
    if (refundAmount) state = refund(state, 'receipt', refundAmount);
    if (claimAmount) { state = claim(state, claimAmount); state = settle(state, 'receipt', claimAmount); }
    const result = R.calculate(state);
    assert.equal(result.personal.expenseCents, total - refundAmount - claimAmount);
    assert.equal(result.cash.netCents, Math.max(1, receipt) - total);
    assert.equal(result.personal.incomeCents, receipt ? 0 : 1);
    assert.equal(result.receivables.outstandingCents, 0);
    assert.equal(result.impacts.expense.personalExpenseCents + result.impacts.expense.refundCents + result.impacts.expense.claimCents, total);
    const stable = copy(state); assert.deepEqual(R.calculate(stable), result);
    if (claimAmount) { state = R.unlink(state, 'settlement', state.bookkeeping.settlements[0].id, '回滚测试'); state = R.unlink(state, 'claim', state.bookkeeping.claims[0].id, '回滚测试'); }
    if (refundAmount) state = R.unlink(state, 'refund', state.bookkeeping.refunds[0].id, '回滚测试');
    assert.deepEqual(R.calculate(state).cash, result.cash); assert.equal(R.calculate(state).personal.expenseCents, total);
  }
});

test('returned mutable ledger arrays do not alias inputs or prior audit versions', () => {
  const input = inputWithReceipt(), before = copy(input), output = claim(input, 5000);
  output.transactions[0].note = 'later edit'; output.accounts[0].name = 'changed'; output.bookkeeping.claims[0].amountCents = 100;
  assert.deepEqual(input, before); assert.equal(output.bookkeeping.audit[0].after.amountCents, 5000);
});

test('claim dates and name control characters reject misleading metadata', () => {
  const input = inputWithReceipt();
  assert.throws(() => claim(input, 1000, { dueDate: '2026-09-30' }), err('RELATION_DATE'));
  for (const name of ['line\nbreak', 'tab\tname', '\rname']) assert.throws(() => claim(input, 1000, { name }));
});

test('limit checks reject oversized collections before trusting any entries', () => {
  const input = fixture();
  for (const collection of ['links', 'refunds', 'claims', 'settlements', 'refundPlans']) {
    const data = R.defaultState(); data[collection] = Array(10001).fill(null); assert.throws(() => R.validate(data, input), err('RELATION_LIMIT'));
  }
  const snapshots = R.defaultState(); snapshots.snapshots = Array(101).fill(null); assert.throws(() => R.validate(snapshots, input), err('RELATION_LIMIT'));
  const journal = R.defaultState(); journal.audit = Array(50001).fill(null); assert.throws(() => R.validate(journal, input), err('RELATION_LIMIT'));
});

test('received refunds and settlements expose separate income drilldown without double counting', () => {
  let state = claim(inputWithReceipt(), 5000); state = refund(state, 'refund', 2000); state = settle(state, 'refund', 1000);
  const item = R.calculate(state).impacts.refund;
  assert.equal(item.receivedRefundCents, 2000); assert.equal(item.settlementCents, 1000); assert.equal(item.cashIncomeCents, 3000);
  assert.equal(item.ordinaryIncomeCents + item.receivedRefundCents + item.settlementCents, item.cashIncomeCents);
});

test('invalid snapshot basis, snapshot timestamps and missing audit fields fail closed', () => {
  const original = R.addSnapshot(fixture([transaction('a', 'expense', 500)]), { accountId: 'account-cash', date: '2026-10-02', actualBalanceCents: -500 });
  // Alter both copies so the financial basis validator, not only journal equality, is exercised.
  for (const mutate of [
    row => { row.ledgerBalanceCents = 0; },
    row => { row.basis.transactions[0].date = '2026-11-01'; },
    row => { row.basis.transactions[0].accountId = 'bank'; },
    row => { row.basis.transactions.push(copy(row.basis.transactions[0])); },
    row => { row.actualBalanceCents = 1.5; }
  ]) {
    const altered = copy(original); mutate(altered.bookkeeping.snapshots[0]); mutate(altered.bookkeeping.audit[0].after);
    assert.throws(() => R.validate(altered.bookkeeping, altered));
  }
  const altered = copy(original); altered.bookkeeping.audit[0].at = '2026-02-30T00:00:00.000Z'; assert.throws(() => R.validate(altered.bookkeeping, altered), err('INVALID_DATE'));
});

test('unlinked old evidence IDs stay in history and cannot be reused as ledger transaction IDs', () => {
  let state = claim(inputWithReceipt(), 5000); const id = state.bookkeeping.claims[0].id;
  state = R.unlink(state, 'claim', id, '撤销后保留历史'); state.transactions.push(transaction(id, 'expense', 100));
  assert.throws(() => R.validate(state.bookkeeping, state), err('DUPLICATE_ID'));
});

test('three or more source evidences form a canonical star and count one actual movement', () => {
  let state = fixture(['main', 'card', 'channel', 'manual'].map(id => transaction(id, 'expense', 10000)));
  state = R.linkEvidence(state, { primaryId: 'main', shadowId: 'card', reason: '核对银行卡证据' });
  assert.ok(R.candidates(state, 'main').some(v => v.transactionId === 'channel' && v.eligible));
  state = R.linkEvidence(state, { primaryId: 'main', shadowId: 'channel', reason: '核对支付渠道证据' });
  state = R.linkEvidence(state, { primaryId: 'main', shadowId: 'manual', reason: '核对手记证据' });
  const report = R.calculate(state);
  assert.equal(report.cash.expenseCents, 10000); assert.equal(report.personal.expenseCents, 10000); assert.equal(report.excludedEvidence.length, 3); assert.equal(state.transactions.length, 4);
  const firstLink = state.bookkeeping.links[0].id;
  state = R.unlink(state, 'link', firstLink, '银行卡这笔实际为独立消费');
  assert.equal(R.calculate(state).cash.expenseCents, 20000); assert.equal(state.bookkeeping.links.length, 2);
});

test('star primary cannot become a shadow; link order cannot create hidden chains or cycles', () => {
  const rows = ['main', 'a', 'b', 'other', 'child'].map(id => transaction(id, 'expense', 10000));
  let state = R.linkEvidence(fixture(rows), { primaryId: 'main', shadowId: 'a', reason: 'x' });
  state = R.linkEvidence(state, { primaryId: 'main', shadowId: 'b', reason: 'x' });
  for (const pair of [['other', 'main'], ['a', 'other'], ['b', 'main'], ['main', 'a']]) assert.throws(() => R.linkEvidence(state, { primaryId: pair[0], shadowId: pair[1], reason: 'x' }), err('RELATION_OVERLAP'));
  assert.equal(R.candidates(state, 'other').find(v => v.transactionId === 'main').eligible, false);
  state = R.linkEvidence(state, { primaryId: 'other', shadowId: 'child', reason: 'x' });
  assert.throws(() => R.linkEvidence(state, { primaryId: 'main', shadowId: 'other', reason: 'x' }), err('RELATION_OVERLAP'));
  assert.equal(R.calculate(state).cash.expenseCents, 20000);
});

test('three-source canonical refund is allocated once, all shadows stay unallocatable', () => {
  let state = fixture([transaction('expense', 'expense', 10000), transaction('a', 'expense', 10000), transaction('b', 'expense', 10000), transaction('refund', 'income', 3000)]);
  state = refund(state);
  state = R.linkEvidence(state, { primaryId: 'expense', shadowId: 'a', reason: 'x' });
  state = R.linkEvidence(state, { primaryId: 'expense', shadowId: 'b', reason: 'x' });
  assert.equal(R.calculate(state).personal.expenseCents, 7000);
  for (const key of ['a', 'b']) assert.throws(() => R.createClaim(state, { expenseId: key, amountCents: 1000, kind: 'advance', name: 'x' }), err('RELATION_SHADOW'));
  assert.equal(R.calculate(state).impacts.a.personalExpenseCents, 0); assert.equal(R.calculate(state).impacts.b.personalExpenseCents, 0);
});

test('all active dependency financial signatures reject amount increases, date shifts and account changes', () => {
  const base = inputWithReceipt();
  const refundState = refund(base), claimState = claim(base, 5000), settlementState = settle(claimState, 'refund', 3000);
  const planState = R.addRefundPlan(base, { expenseId: 'expense', expectedAmountCents: 4000 });
  const cases = [[refundState, ['expense', 'refund']], [claimState, ['expense']], [settlementState, ['expense', 'refund']], [planState, ['expense']]];
  for (const [state, ids] of cases) for (const id of ids) {
    const original = state.transactions.find(t => t.id === id);
    const changes = [{ amountCents: original.amountCents + 1000 }, { date: original.type === 'expense' ? '2026-10-02' : '2026-11-02' }, { accountId: 'bank' }];
    for (const patch of changes) {
      const modified = copy(state); Object.assign(modified.transactions.find(t => t.id === id), patch);
      assert.throws(() => R.validate(modified.bookkeeping, modified), err('RELATION_CHANGED'), id + ' ' + JSON.stringify(patch));
      assert.throws(() => updateTransaction(state, id, patch), err('RELATION_CHANGED'));
    }
  }
});

test('dependency signature locks permit notes/categories and unrelated economic edits', () => {
  let state = settle(claim(refund(inputWithReceipt()), 5000), 'refund2', 2000);
  state = updateTransaction(state, 'expense', { note: '补充原订单说明', categoryId: 'expense-shopping' });
  state = updateTransaction(state, 'refund', { note: '核对收入说明', categoryId: 'income-salary' });
  assert.equal(R.calculate(state).personal.expenseCents, 2000);
  const extra = copy(state); extra.transactions.push(transaction('unrelated', 'expense', 100, '2026-12-02'));
  const changed = updateTransaction(validateFull(extra), 'unrelated', { amountCents: 300, date: '2026-12-03', accountId: 'bank' });
  assert.equal(R.calculate(changed).personal.expenseCents, 2300);
});

test('claim and plan updates preserve economic signatures and recorded settlements bind the original expense', () => {
  let state = settle(claim(inputWithReceipt(), 5000), 'refund', 3000);
  const before = copy(state.bookkeeping.claims[0].expenseSignature), claimId = state.bookkeeping.claims[0].id;
  state = R.updateClaim(state, claimId, { amountCents: 6000, status: 'submitted' }, '确认新增可报销份额');
  assert.deepEqual(state.bookkeeping.claims[0].expenseSignature, before);
  assert.equal(state.bookkeeping.settlements[0].expenseId, 'expense');
  assert.deepEqual(state.bookkeeping.settlements[0].expenseSignature, before);
  assert.throws(() => R.updateClaim(state, claimId, { expenseSignature: { ...before, amountCents: 11000 } }, '试图改写'), err('INVALID_RELATIONS'));
  let plan = R.addRefundPlan(inputWithReceipt(), { expenseId: 'expense', expectedAmountCents: 5000 }); const planId = plan.bookkeeping.refundPlans[0].id;
  plan = R.updateRefundPlan(plan, planId, { expectedAmountCents: 6000, status: 'closed' }, '调整计划');
  assert.deepEqual(plan.bookkeeping.refundPlans[0].expenseSignature, before);
  assert.throws(() => R.addRefundPlan(inputWithReceipt(), { expenseId: 'expense', expectedAmountCents: 5000, expenseSignature: before }), err('INVALID_RELATIONS'));
});

test('unlinking every dependency restores financial editing while audit retains original economic signatures', () => {
  let state = settle(claim(inputWithReceipt(), 5000), 'refund', 3000);
  state = R.unlink(state, 'settlement', state.bookkeeping.settlements[0].id, '撤销错误回款归属');
  state = updateTransaction(state, 'refund', { amountCents: 4000, date: '2026-11-02', accountId: 'bank' });
  assert.throws(() => updateTransaction(state, 'expense', { amountCents: 11000 }), err('RELATION_CHANGED'));
  state = R.unlink(state, 'claim', state.bookkeeping.claims[0].id, '重新核对原支出');
  state = updateTransaction(state, 'expense', { amountCents: 11000, date: '2026-10-02', accountId: 'bank' });
  assert.equal(state.bookkeeping.audit[0].after.expenseSignature.amountCents, 10000);
  assert.equal(state.bookkeeping.audit[1].after.incomeSignature.amountCents, 3000);
  assert.equal(R.calculate(state).personal.expenseCents, 11000);
});

test('strict schema rejects absent captured signatures instead of silently adopting edited economic data', () => {
  const states = [refund(inputWithReceipt()), claim(inputWithReceipt(), 5000), settle(claim(inputWithReceipt(), 5000), 'refund', 3000), R.addRefundPlan(inputWithReceipt(), { expenseId: 'expense', expectedAmountCents: 5000 })];
  for (const state of states) {
    const altered = copy(state), audit = altered.bookkeeping.audit.at(-1), collection = { refund: 'refunds', claim: 'claims', settlement: 'settlements', refundPlan: 'refundPlans' }[audit.kind];
    delete altered.bookkeeping[collection].at(-1).expenseSignature; delete audit.after.expenseSignature;
    assert.throws(() => R.validate(altered.bookkeeping, altered), err('INVALID_RELATIONS'));
  }
});

test('snapshot captured difference overflow fails before a valid state or backup can be returned', () => {
  const max = R.MAX_AMOUNT_CENTS, state = L.createEmpty(); state.accounts[0].openingBalanceCents = -max;
  state.transactions = Array.from({ length: 9006 }, (_, i) => transaction('large-' + i, 'expense', max));
  const valid = L.validateState(state); assert.equal(R.calculate(valid).cash.expenseCents, 9006 * max);
  assert.throws(() => R.addSnapshot(valid, { accountId: 'account-cash', date: '2026-10-02', actualBalanceCents: max }), err('AMOUNT_OVERFLOW'));
  assert.equal(valid.bookkeeping, undefined);
});

test('snapshot current difference overflow rejects backdated changes even when recorded captured difference was safe', () => {
  const max = R.MAX_AMOUNT_CENTS, state = L.createEmpty(); state.accounts[0].openingBalanceCents = -max;
  state.transactions = Array.from({ length: 9005 }, (_, i) => transaction('large-' + i, 'expense', max));
  const captured = R.addSnapshot(L.validateState(state), { accountId: 'account-cash', date: '2026-10-02', actualBalanceCents: max });
  const snapId = captured.bookkeeping.snapshots[0].id; assert.ok(Number.isSafeInteger(R.reconciliation(captured, snapId).differenceCents));
  const backdated = copy(captured); backdated.transactions.push(transaction('extra-large', 'expense', max));
  assert.throws(() => R.validate(backdated.bookkeeping, backdated), err('AMOUNT_OVERFLOW'));
  assert.throws(() => L.backup(backdated), err('AMOUNT_OVERFLOW'));
  const afterSnapshot = copy(captured); afterSnapshot.transactions.push(transaction('extra-future', 'expense', max, '2026-10-03'));
  assert.equal(R.reconciliation(afterSnapshot, snapId).changed, false);
});

test('removed snapshot audit still validates exact original balance basis and captured difference', () => {
  let state = R.addSnapshot(fixture(), { accountId: 'account-cash', date: '2026-10-02', actualBalanceCents: 0 });
  state = R.unlink(state, 'snapshot', state.bookkeeping.snapshots[0].id, '撤销快照');
  const altered = copy(state); altered.bookkeeping.audit[0].after.ledgerBalanceCents = 1; altered.bookkeeping.audit[1].before.ledgerBalanceCents = 1;
  assert.throws(() => R.validate(altered.bookkeeping, altered), err('INVALID_RELATIONS'));
});

test('journal cannot reorder claim deletion ahead of its still-active settlement', () => {
  let state = settle(claim(inputWithReceipt(), 5000), 'refund', 3000);
  state = R.unlink(state, 'settlement', state.bookkeeping.settlements[0].id, '撤销回款'); state = R.unlink(state, 'claim', state.bookkeeping.claims[0].id, '撤销应收');
  const reordered = copy(state); [reordered.bookkeeping.audit[2], reordered.bookkeeping.audit[3]] = [reordered.bookkeeping.audit[3], reordered.bookkeeping.audit[2]];
  reordered.bookkeeping.audit.forEach((v, i) => { v.revision = i + 1; });
  assert.throws(() => R.validate(reordered.bookkeeping, reordered), err('INVALID_RELATIONS_AUDIT'));
});

test('journal cannot reorder refund plan deletion ahead of still-linked received refund', () => {
  let state = R.addRefundPlan(inputWithReceipt(), { expenseId: 'expense', expectedAmountCents: 5000 });
  const planId = state.bookkeeping.refundPlans[0].id; state = refund(state, 'refund', 3000, { planId });
  state = R.unlink(state, 'refund', state.bookkeeping.refunds[0].id, '撤销退款分配'); state = R.unlink(state, 'refundPlan', planId, '撤销计划');
  const reordered = copy(state); [reordered.bookkeeping.audit[2], reordered.bookkeeping.audit[3]] = [reordered.bookkeeping.audit[3], reordered.bookkeeping.audit[2]];
  reordered.bookkeeping.audit.forEach((v, i) => { v.revision = i + 1; });
  assert.throws(() => R.validate(reordered.bookkeeping, reordered), err('INVALID_RELATIONS_AUDIT'));
});

test('candidate warnings expose existing financial dependencies without changing matching facts', () => {
  let state = fixture([transaction('expense', 'expense', 10000), transaction('independent', 'expense', 10000)]);
  state = claim(state, 5000);
  const candidate = R.candidates(state, 'independent').find(v => v.transactionId === 'expense');
  assert.equal(candidate.eligible, true); assert.equal(candidate.mustBePrimary, true);
  assert.ok(candidate.warnings.some(v => v.includes('必须选它为主记录')));
  const linked = R.linkEvidence(state, { primaryId: 'expense', shadowId: 'independent', reason: '保留已有应收归属' });
  assert.equal(R.calculate(linked).personal.expenseCents, 5000);
});
