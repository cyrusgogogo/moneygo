'use strict';
const { L, copy, AT, tx, base, planning: income } = require('./income-boundary-helpers.cjs');
const C = require('../dist/obligations.js');
const ASOF = '2026-10-14';
const confirmation = state => ({ confirmed: true, expectedRevision: state.obligations?.revision || 0, reason: 'Synthetic boundary review' });
function spending(input = base(), options = {}) {
  let s = copy(input);
  if (options.both && !s.incomePlanning) s = income(s);
  if (options.payment) {
    const source = s.transactions.find(row => row.id === options.sourceId);
    if (source && !s.obligations?.profiles.some(row => row.accountId === source.accountId)) s = C.putProfile(s, { accountId: source.accountId, role: 'cash', creditLimitCents: null, note: '' }, confirmation(s));
  }
  s = copy(s);
  const plan = { id: options.id || 'spending-plan-fixture', createdAt: AT, name: 'Synthetic spending', stage: 'planned', status: 'open', targetAmountCents: 10000, expectedDate: '2026-10-20', expectedAccountId: options.expectedAccountId ?? null, commitmentBasis: '', note: '', remainingConfirmation: { amountCents: 10000, reviewedAsOfDate: ASOF, paymentIds: [] } };
  const data = { version: 1, revision: 0, plans: [plan], payments: [], audit: [] };
  const append = (action, changes, id) => { data.revision++; const operation = { id: id || 'spending-fixture-event-' + data.revision, revision: data.revision, at: AT, asOfDate: ASOF, action, reason: 'Synthetic boundary review', changes: copy(changes) }; data.audit.push(operation); return operation; };
  const change = (kind, before, after, reverses = null) => ({ kind, recordId: (before || after).id, before: before && copy(before), after: after && copy(after), reverses });
  append('create-plan', [change('plan', null, plan)], options.auditId || 'spending-audit-fixture');
  if (options.payment) {
    let before = copy(plan); plan.stage = 'committed'; plan.commitmentBasis = 'Synthetic purchase commitment'; append('commit-plan', [change('plan', before, plan)]);
    const source = s.transactions.find(row => row.id === options.sourceId), profile = s.obligations.profiles.find(row => row.accountId === source.accountId);
    const signature = { id: source.id, type: source.type, date: source.date, amountCents: source.amountCents, accountId: source.accountId, toAccountId: null };
    const payment = { id: options.paymentId || 'spending-payment-fixture', createdAt: AT, reviewedAsOfDate: ASOF, planId: plan.id, transactionId: source.id, amountCents: options.amountCents || 500, proof: { version: 1, source: signature, role: 'cash-primary-payment', cashProfile: { id: profile.id, accountId: profile.accountId, role: 'cash' }, duplicateEvidence: [], refunds: [], claims: [], grossPaymentCents: source.amountCents }, reference: 'Synthetic payment annotation' };
    before = copy(plan); plan.remainingConfirmation = { amountCents: 9500, reviewedAsOfDate: ASOF, paymentIds: [payment.id] }; data.payments.push(payment);
    const created = append('allocate-payment', [change('payment', null, payment), change('plan', before, plan)]);
    if (options.reversed) { before = copy(plan); plan.remainingConfirmation = null; data.payments.pop(); append('reverse-payment', [change('payment', payment, null, created.id), change('plan', before, plan)]); }
  }
  if (options.cancelled || options.retired) { const before = copy(plan); plan.status = 'cancelled'; append('cancel-plan', [change('plan', before, plan)]); }
  if (options.retired) { data.plans.pop(); append('retire-plan', [change('plan', plan, null)]); }
  s.version = 8; s.spendingPlanning = data;
  return L.validateState(s);
}
module.exports = { L, copy, AT, ASOF, tx, base, spending, confirmation };
