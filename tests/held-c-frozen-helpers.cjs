'use strict';
const L = require('../dist/ledger.js'), R = require('../dist/relations.js'), O = require('../dist/organizer.js');
const AT = '2026-04-15T12:00:00.000Z', ASOF = '2026-04-15';
const copy = value => JSON.parse(JSON.stringify(value));
function tx(id, amountCents, date = '2026-01-10', type = 'expense', extra = {}) { return { id, type, amountCents, date, accountId: 'account-cash', categoryId: type === 'expense' ? 'expense-other' : 'income-other', note: 'Synthetic ' + id, ...extra }; }
function base(rows = [tx('fund', 12001), tx('receipt', 2222, '2026-03-10', 'income')]) { const state = L.createEmpty(); state.accounts.push({ id: 'bank', name: 'Synthetic bank', openingBalanceCents: 0 }); state.transactions = rows; return L.validateState(state); }
function command(state, value, reason = 'Synthetic reviewed operation') { return R.applyHeldTransition(state, { asOfDate: ASOF, ...value }, { at: AT, reason }); }
function fund(state, amountCents = 10000, expenseId = 'fund', extra = {}) { return command(state, { action: 'create-position', expenseId, amountCents, kind: 'deposit', name: 'Synthetic deposit', purpose: '', reference: '', expiry: { kind: 'unknown', date: null }, refundability: 'unknown', terms: '', termsSource: '', confirmations: { paidPrincipalOnly: true, noTrackedWalletOverlap: true }, ...extra }); }
function use(state, amountCents = 3333, effectiveDate = '2026-02-10', extra = {}) { return command(state, { action: 'recognize', positionId: state.bookkeeping.heldPositions[0].id, kind: 'use', amountCents, effectiveDate, categoryId: 'expense-food', merchant: 'Explicit recognition merchant', reference: '', confirmations: { notAlreadyRecordedAsExpense: true }, ...extra }); }
function returned(state, amountCents = 2222, extra = {}) { return command(state, { action: 'allocate-return', positionId: state.bookkeeping.heldPositions[0].id, incomeId: 'receipt', amountCents, reference: '', ...extra }); }
function close(state, month = '2026-03', extra = {}) { return O.closeMonth(state, { month, reason: 'Synthetic frozen review', at: AT, ...extra }); }
function selected(state, month, actualTransactionIds, personalEventKeys) { return O.closePersonalMonth(state, { month, selection: 'selected', actualTransactionIds, personalEventKeys, reason: 'Synthetic partial review', at: AT }); }
function mutate(state, change, index = 0) { const next = copy(state), row = next.organizer.closes[index]; change(row); const audit = next.organizer.audit.find(a => a.changes.some(c => c.collection === 'closes' && c.key === row.id)); change(audit.changes.find(c => c.collection === 'closes' && c.key === row.id).after); return next; }
function valid(state) { return O.validate(state.organizer, state); }
module.exports = { L, R, O, AT, ASOF, copy, tx, base, command, fund, use, returned, close, selected, mutate, valid };
