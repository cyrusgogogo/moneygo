'use strict';
const L = require('../dist/ledger'), R = require('../dist/relations'), O = require('../dist/obligations'), P = require('../dist/spending-planning'), C = require('../dist/spending-core');
const now = '2026-10-14T12:00:00.000Z', day = '2026-10-14', options = { asOfDate: day };
const copy = value => JSON.parse(JSON.stringify(value));
const tx = (id, type = 'expense', amountCents = 100000, date = '2026-10-01', accountId = 'account-cash', extra = {}) => ({ id, type, amountCents, date, accountId, ...(type === 'transfer' ? { toAccountId: 'bank' } : { categoryId: type === 'expense' ? 'expense-other' : 'income-other' }), note: '', ...extra });
const obReview = state => ({ confirmed: true, expectedRevision: state.obligations?.revision || 0, reason: 'Synthetic reviewed role' });
function profile(state, accountId = 'account-cash', role = 'cash', key) { return O.putProfile(state, { accountId, role, creditLimitCents: null, note: '' }, obReview(state), key); }
function base(rows = [tx('source')], role = 'cash') { let state = L.createEmpty(); state.accounts.push({ id: 'bank', name: 'Synthetic bank', openingBalanceCents: 0 }); state.transactions = rows; state = L.validateState(state); return role === null ? state : profile(state, 'account-cash', role); }
const coordinator = (at = now, today = day) => P.createCoordinator({ now: () => at, today: () => today });
const plan = (patch = {}, remainingAfterCents = 100000) => ({ action: 'create-plan', plan: { name: 'Synthetic purchase', targetAmountCents: 100000, expectedDate: '2026-10-20', expectedAccountId: 'account-cash', note: '', ...patch }, remainingAfterCents });
function apply(state, command, opt = options, c = coordinator()) { return c.commit(state, c.preview(state, command, opt), { confirmed: true, reason: 'Synthetic explicit user confirmation' }); }
const pid = state => state.spendingPlanning.plans[0].id;
const paymentId = state => state.spendingPlanning.payments[0].id;
function committed(state = base(), patch = {}, remainingAfterCents = 100000) { state = apply(state, plan(patch, remainingAfterCents)); return apply(state, { action: 'commit-plan', planId: pid(state), commitmentBasis: 'Synthetic merchant confirmation', remainingAfterCents }); }
const allocate = (state, amountCents = 40000, remainingAfterCents = 60000, transactionId = 'source', planId = pid(state)) => apply(state, { action: 'allocate-payment', planId, transactionId, amountCents, reference: 'Synthetic recorded payment', remainingAfterCents });
const pv = state => P.view(state, options).plans[0];
function change(state, key, patch) { return L.putTransaction(state, { ...state.transactions.find(row => row.id === key), ...patch }, key); }
function refund(state, amountCents = 20000, incomeId = 'refund') { return R.allocateRefund(state, { incomeId, expenseId: 'source', amountCents, reason: 'Synthetic refund evidence', planId: null }); }
function claim(state, amountCents = 30000) { return R.createClaim(state, { expenseId: 'source', amountCents, kind: 'reimbursement', name: 'Synthetic claim', dueDate: null, status: 'unsubmitted', note: '' }); }
function linked(count, inherited) {
  const state = inherited ? copy(inherited) : base(), data = R.defaultState();
  for (let i = 0; i < count; i++) {
    const key = 'shadow-' + i; if (!state.transactions.some(row => row.id === key)) state.transactions.push(tx(key));
    const signature = row => ({ type: row.type, date: row.date, amountCents: row.amountCents, accountId: row.accountId, toAccountId: null });
    const row = { id: 'link-' + i, createdAt: now, primaryId: 'source', shadowId: key, reason: 'Synthetic duplicate proof', primarySignature: signature(state.transactions.find(v => v.id === 'source')), shadowSignature: signature(state.transactions.find(v => v.id === key)) };
    data.links.push(row); data.audit.push({ id: 'link-audit-' + i, revision: i + 1, at: now, kind: 'link', recordId: row.id, action: 'create', reason: 'Synthetic', before: null, after: copy(row) });
  }
  data.revision = count; state.bookkeeping = data; return L.validateState(state);
}
// Linear synthetic journal builder, independently validated by the full Ledger.
function seeded({ links = 1, operations = 2 + links } = {}) {
  const state = base(), proof = P.source(state, { ...options, transactionId: 'source' }).currentProof;
  const ext = { version: 1, revision: 0, plans: [], payments: [], audit: [] };
  let current = { id: 'fixture-plan', createdAt: now, name: 'Synthetic indexed history', stage: 'planned', status: 'open', targetAmountCents: 100000, expectedDate: null, expectedAccountId: null, commitmentBasis: '', note: '', remainingConfirmation: null };
  function append(action, changes) { ext.audit.push({ id: 'fixture-event-' + (++ext.revision), revision: ext.revision, at: now, asOfDate: day, action, reason: 'Synthetic review', changes }); }
  append('create-plan', [{ kind: 'plan', recordId: current.id, before: null, after: copy(current), reverses: null }]);
  if (links || operations > 1) { const old = copy(current); current.stage = 'committed'; current.commitmentBasis = 'Synthetic merchant confirmation';
  append('commit-plan', [{ kind: 'plan', recordId: current.id, before: old, after: copy(current), reverses: null }]); }
  for (let i = 0; i < links; i++) {
    const payment = { id: 'fixture-payment-' + i, createdAt: now, reviewedAsOfDate: day, planId: current.id, transactionId: 'source', amountCents: 1, proof: copy(proof), reference: '' };
    ext.payments.push(payment); append('allocate-payment', [{ kind: 'payment', recordId: payment.id, before: null, after: copy(payment), reverses: null }, { kind: 'plan', recordId: current.id, before: copy(current), after: copy(current), reverses: null }]);
  }
  while (ext.audit.length < operations) { const old = copy(current); current.note = 'Synthetic edit ' + ext.revision; append('update-plan', [{ kind: 'plan', recordId: current.id, before: old, after: copy(current), reverses: null }]); }
  ext.plans.push(current); return L.validateState({ ...state, version: 8, spendingPlanning: ext });
}
module.exports = { L, R, O, P, C, now, day, options, copy, tx, obReview, profile, base, coordinator, plan, apply, pid, paymentId, committed, allocate, pv, change, refund, claim, linked, seeded };
