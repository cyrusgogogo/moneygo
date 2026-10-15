'use strict';
const L = require('../dist/ledger');
const H = require('../dist/held-funds');
const R = require('../dist/relations');
const O = require('../dist/obligations');
const I = require('../dist/importer');
const S = require('../dist/scenario');
const clock = '2026-04-15T12:00:00.000Z';
const day = '2026-04-15';
const copy = value => JSON.parse(JSON.stringify(value));
const engine = () => H.createCoordinator({ now: () => clock });
const tx = (id, type = 'expense', amountCents = 10000, date = '2026-01-10', accountId = 'account-cash') => ({ id, type, amountCents, date, accountId, categoryId: type === 'expense' ? 'expense-other' : 'income-other', note: 'Synthetic source ' + id });
function base(rows = [tx('pay'), tx('receipt', 'income', 5000, '2026-03-10')]) { const s = L.createEmpty(); s.accounts.push({ id: 'cash-b', name: 'Synthetic receipt account', openingBalanceCents: 0 }); s.categories.push({ id: 'recognition-category', name: 'Synthetic recognition only', type: 'expense' }); s.transactions = copy(rows); return L.validateState(s); }
function position(patch = {}) { return { action: 'create-position', asOfDate: day, expenseId: 'pay', amountCents: 10000, kind: 'deposit', name: 'Synthetic position', purpose: '', reference: '', expiry: { kind: 'unknown', date: null }, refundability: 'unknown', terms: '', termsSource: '', confirmations: { paidPrincipalOnly: true, noTrackedWalletOverlap: true }, ...patch }; }
function recognition(positionId, patch = {}) { return { action: 'recognize', asOfDate: day, positionId, kind: 'use', amountCents: 2000, effectiveDate: '2026-03-15', categoryId: 'recognition-category', merchant: 'Synthetic explicit merchant', reference: '', confirmations: { notAlreadyRecordedAsExpense: true }, ...patch }; }
function returned(positionId, patch = {}) { return { action: 'allocate-return', asOfDate: day, positionId, incomeId: 'receipt', amountCents: 3000, reference: '', ...patch }; }
function apply(state, command, h = engine(), reason = 'Synthetic reviewed classification') { return h.commit(state, h.preview(state, command), { confirmed: true, reason }); }
function fund(state = base(), patch = {}) { return apply(state, position(patch)); }
const pid = state => state.bookkeeping.heldPositions.at(-1).id;
const review = state => ({ confirmed: true, expectedRevision: state.obligations?.revision || 0, reason: 'Synthetic credit evidence review' });
const fee = (state, transactionId = 'pay') => O.markFee(state, { transactionId, kind: 'service', statementId: null, contractId: null, note: '' }, review(state));
const imported = (state = base([]), csv = 'Date,Amount,Type,Id,Status,Note\n2026-01-10,100.00,expense,SYN-PAY,completed,Synthetic payment\n') => { const p = I.preview(state, csv, { sourceKey: 'synthetic-held', accountId: 'account-cash', delimiter: ',', columns: { date: 'Date', amount: 'Amount', direction: 'Type', stableId: 'Id', status: 'Status', note: 'Note' }, dateFormat: 'YYYY-MM-DD' }); return I.commit(state, p, p.rows.filter(row => row.action === 'new').map(row => row.key)); };
module.exports = { L, H, R, O, I, S, clock, day, copy, engine, tx, base, position, recognition, returned, apply, fund, pid, review, fee, imported };
