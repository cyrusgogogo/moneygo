'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const L = require('../dist/ledger.js'), R = require('../dist/relations.js'), H = require('../dist/held-funds.js'), P = require('../dist/income-planning.js');
const oldL = require('./fixtures/income-readers-v015/ledger.js'), oldR = require('./fixtures/income-readers-v015/relations.js');
const clone = value => JSON.parse(JSON.stringify(value));
const options = { asOfDate: '2026-10-14', horizonEnd: '2027-01-31', mode: 'planned' };
const coordinator = () => P.createCoordinator({ now: () => '2026-10-14T12:00:00.000Z', today: () => '2026-10-14' });
function oldState(state) { const value = clone(state); delete value.incomePlanning; value.version = value.obligations ? 6 : value.organizer ? 5 : value.bookkeeping ? 4 : value.imports ? 3 : value.simulation ? 2 : 1; return oldL.validateState(value); }
function economicOracle(state) { return oldR.calculate(oldState(state)); }
function run(api, state, command) {
  const before = economicOracle(state), beforeSubtrees = oldState(state);
  const ticket = api.preview(state, command, options), next = api.commit(state, ticket, { confirmed: true, reason: 'SYNTHETIC explicit income review' });
  assert.deepEqual(oldState(next), beforeSubtrees, 'Each planning command preserves every legacy subtree');
  assert.deepEqual(economicOracle(next), before, 'Frozen financial oracle remains exactly unchanged');
  return { state: next, ticket };
}
function plan(api, state, name, overrides = {}) {
  const result = run(api, state, { action: 'create-plan', plan: {
    name, certainty: 'confirmed-plan', expectedAmountCents: 100000, expectedDate: '2026-11-01',
    expectedAccountId: 'account-cash', basis: 'SYNTHETIC supplied planning terms', note: '', ...overrides
  } });
  return { ...result, id: result.ticket.review.plans[0].planId };
}
function transaction(id, type, cents, date) { return { id, type, amountCents: cents, date, accountId: 'account-cash', categoryId: type === 'expense' ? 'expense-other' : 'income-other', note: 'SYNTHETIC root combined fixture' }; }
let cached;
function combined() {
  if (cached) return clone(cached);
  let state = L.parseBackup(fs.readFileSync(path.join(__dirname, 'fixtures/all-extensions-v6.json'), 'utf8'));
  const original = clone(state), originalFinancial = economicOracle(state);
  state.transactions.push(transaction('income-root-a', 'income', 120000, '2026-10-02'), transaction('income-root-missing', 'income', 10000, '2026-10-03'),
    transaction('income-root-held-paid', 'expense', 50000, '2026-10-01'), transaction('income-root-held-return', 'income', 20000, '2026-10-08'),
    transaction('income-root-mixed-paid', 'expense', 30000, '2026-10-01'), transaction('income-root-mixed-receipt', 'income', 50000, '2026-10-08'));
  state = L.validateState(state);
  const held = H.createCoordinator({ now: () => '2026-10-14T12:00:00.000Z' });
  const heldRun = command => { const ticket = held.preview(state, command); state = held.commit(state, ticket, { confirmed: true, reason: 'SYNTHETIC held classification' }); };
  heldRun({ action: 'create-position', asOfDate: options.asOfDate, expenseId: 'income-root-held-paid', amountCents: 50000, kind: 'deposit', name: 'SYNTHETIC combined principal', purpose: '', reference: '', expiry: { kind: 'unknown', date: null }, refundability: 'unknown', terms: '', termsSource: '', confirmations: { paidPrincipalOnly: true, noTrackedWalletOverlap: true } });
  const positionId = state.bookkeeping.heldPositions.find(row => row.expenseId === 'income-root-held-paid').id;
  heldRun({ action: 'recognize', asOfDate: options.asOfDate, positionId, kind: 'use', amountCents: 5000, effectiveDate: '2026-10-08', categoryId: 'expense-food', merchant: 'SYNTHETIC held merchant', reference: '', confirmations: { notAlreadyRecordedAsExpense: true } });
  heldRun({ action: 'allocate-return', asOfDate: options.asOfDate, positionId, incomeId: 'income-root-held-return', amountCents: 5000, reference: '' });
  state = R.allocateRefund(state, { incomeId: 'income-root-mixed-receipt', expenseId: 'income-root-mixed-paid', amountCents: 10000, reason: 'SYNTHETIC mixed refund' });
  state = R.createClaim(state, { expenseId: 'income-root-mixed-paid', amountCents: 10000, name: 'SYNTHETIC mixed claim', kind: 'advance' });
  const claimId = state.bookkeeping.claims.find(row => row.expenseId === 'income-root-mixed-paid').id;
  state = R.settleClaim(state, { claimId, incomeId: 'income-root-mixed-receipt', amountCents: 5000, reason: 'SYNTHETIC mixed settlement' });
  const api = coordinator(), ids = {};
  let created = plan(api, state, 'SYNTHETIC reconfirmed income'); state = created.state; ids.main = created.id;
  for (const amountCents of [40000, 60000]) state = run(api, state, { action: 'allocate-receipt', planId: ids.main, transactionId: 'income-root-a', amountCents, reference: 'SYNTHETIC partial' }).state;
  const a = state.transactions.find(row => row.id === 'income-root-a'); state = L.putTransaction(state, { ...a, amountCents: 100000 }, a.id);
  const oldReceipts = state.incomePlanning.receipts.filter(row => row.planId === ids.main).map(row => row.id);
  for (const receiptId of oldReceipts) state = run(api, state, { action: 'reconfirm-receipt', receiptId }).state;
  created = plan(api, state, 'SYNTHETIC missing actual source', { expectedAmountCents: 5000 }); state = created.state; ids.missing = created.id;
  state = run(api, state, { action: 'allocate-receipt', planId: ids.missing, transactionId: 'income-root-missing', amountCents: 5000, reference: '' }).state;
  state = L.deleteTransaction(state, 'income-root-missing');
  created = plan(api, state, 'SYNTHETIC cancelled expectation', { certainty: 'expectation', expectedAmountCents: null, expectedDate: null, expectedAccountId: null, basis: '' }); state = created.state; ids.cancelled = created.id;
  state = run(api, state, { action: 'update-plan', planId: ids.cancelled, patch: { status: 'cancelled' } }).state;
  created = plan(api, state, 'SYNTHETIC retired plan'); state = created.state; ids.retired = created.id;
  state = run(api, state, { action: 'retire-plan', planId: ids.retired }).state;
  created = plan(api, state, 'SYNTHETIC reversed residual annotation', { certainty: 'expectation', expectedAmountCents: 2000, basis: '' }); state = created.state; ids.reversed = created.id;
  state = run(api, state, { action: 'allocate-receipt', planId: ids.reversed, transactionId: 'income-root-held-return', amountCents: 1000, reference: '' }).state;
  state = run(api, state, { action: 'reverse-receipt', receiptId: state.incomePlanning.receipts.find(row => row.planId === ids.reversed).id }).state;
  created = plan(api, state, 'SYNTHETIC changed mixed basis', { expectedAmountCents: 10000 }); state = created.state; ids.mixed = created.id;
  state = run(api, state, { action: 'allocate-receipt', planId: ids.mixed, transactionId: 'income-root-mixed-receipt', amountCents: 5000, reference: '' }).state;
  state = R.allocateRefund(state, { incomeId: 'income-root-mixed-receipt', expenseId: 'income-root-mixed-paid', amountCents: 1000, reason: 'SYNTHETIC valid later correction' });
  created = plan(api, state, 'SYNTHETIC future confirmed plan', { expectedAmountCents: 30000 }); state = created.state; ids.future = created.id;
  assert.deepEqual(state.organizer.closes, original.organizer.closes, 'Original frozen closes unchanged');
  cached = { state: L.validateState(state), ids, originalFinancial };
  return clone(cached);
}
module.exports = { L, R, H, P, oldL, oldR, oldState, economicOracle, clone, options, coordinator, run, plan, combined };
