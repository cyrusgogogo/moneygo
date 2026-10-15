'use strict';
const clone = value => JSON.parse(JSON.stringify(value));
const AT = '2026-10-14T12:00:00.000Z', AS_OF = '2026-10-14';
function signature(overrides = {}) { return { id: 'source-1', type: 'expense', date: '2026-10-01', amountCents: 100000, accountId: 'account-1', toAccountId: null, ...overrides }; }
function proof(overrides = {}) {
  const source = signature(overrides.source || {});
  return { version: 1, source, role: 'cash-primary-payment', cashProfile: { id: 'cash-profile-1', accountId: source.accountId, role: 'cash' }, duplicateEvidence: [], refunds: [], claims: [], grossPaymentCents: source.amountCents, ...overrides, source };
}
function confirmation(amountCents = 100000, paymentIds = [], reviewedAsOfDate = AS_OF) { return amountCents === null ? null : { amountCents, reviewedAsOfDate, paymentIds: [...paymentIds].sort() }; }
function plan(overrides = {}) { return { id: 'plan-1', createdAt: AT, name: 'Synthetic spending', stage: 'planned', status: 'open', targetAmountCents: 100000, expectedDate: '2026-10-31', expectedAccountId: 'account-1', commitmentBasis: '', note: '', remainingConfirmation: confirmation(), ...overrides }; }
function payment(overrides = {}) { return { id: 'payment-1', createdAt: AT, reviewedAsOfDate: AS_OF, planId: 'plan-1', transactionId: 'source-1', amountCents: 10000, proof: proof(), reference: '', ...overrides }; }
function duplicateProof(count, overrides = {}) {
  const source = signature(overrides.source || {});
  const duplicateEvidence = Array.from({ length: count }, (_, i) => ({ id: 'duplicate-' + i, primaryId: source.id, shadowId: 'shadow-' + i, primarySignature: clone(source), shadowSignature: { ...source, id: 'shadow-' + i } }));
  return proof({ ...overrides, source, duplicateEvidence });
}
function claimProof(count, overrides = {}) {
  const source = signature(overrides.source || {}), claims = Array.from({ length: count }, (_, i) => ({ id: 'claim-' + i, expenseId: source.id, amountCents: 1, expenseSignature: clone(source) }));
  return proof({ ...overrides, source, claims });
}
function refundProof(count, overrides = {}) {
  const source = signature(overrides.source || {}), income = signature({ id: 'refund-income-1', type: 'income', amountCents: source.amountCents });
  const refunds = Array.from({ length: count }, (_, i) => ({ id: 'refund-' + i, expenseId: source.id, incomeId: income.id, amountCents: 1, expenseSignature: clone(source), incomeSignature: clone(income) }));
  return proof({ ...overrides, source, refunds });
}
function builder() {
  const extension = { version: 1, revision: 0, plans: [], payments: [], audit: [] };
  let next = 1;
  function change(kind, before, after, reverses = null) { return { kind, recordId: (after || before).id, before: clone(before), after: clone(after), reverses }; }
  function append(action, changes, options = {}) {
    const op = { id: 'operation-' + next++, revision: extension.audit.length + 1, at: AT, asOfDate: AS_OF, action, reason: 'Synthetic explicit review', changes, ...options };
    extension.audit.push(op); extension.revision = extension.audit.length; return op;
  }
  function findPlan(key) { const value = extension.plans.find(p => p.id === key); if (!value) throw new Error('Fixture plan missing: ' + key); return value; }
  function remainingFor(key, amount, options) { return confirmation(amount, extension.payments.filter(p => p.planId === key).map(p => p.id), options.asOfDate || AS_OF); }
  const api = {
    extension,
    createPlan(value = plan(), options = {}) { extension.plans.push(clone(value)); append('create-plan', [change('plan', null, value)], options); return api; },
    updatePlan(key, patch, options = {}) { return api.transition('update-plan', key, patch, options); },
    transition(action, key, patch = {}, options = {}) { const before = clone(findPlan(key)), after = { ...before, ...clone(patch) }; extension.plans[extension.plans.findIndex(p => p.id === key)] = after; append(action, [change('plan', before, after)], options); return api; },
    commitPlan(key = 'plan-1', amount = 100000, options = {}) { return api.transition('commit-plan', key, { stage: 'committed', commitmentBasis: 'Synthetic merchant agreement', remainingConfirmation: remainingFor(key, amount, options) }, options); },
    cancelPlan(key = 'plan-1', options = {}) { return api.transition('cancel-plan', key, { status: 'cancelled' }, options); },
    reopenPlan(key = 'plan-1', amount = null, options = {}) { return api.transition('reopen-plan', key, { status: 'open', remainingConfirmation: remainingFor(key, amount, options) }, options); },
    returnToPlan(key = 'plan-1', amount = null, options = {}) { return api.transition('return-to-plan', key, { stage: 'planned', status: 'open', commitmentBasis: '', remainingConfirmation: remainingFor(key, amount, options) }, options); },
    confirmRemaining(key = 'plan-1', amount = null, options = {}) { return api.transition('confirm-remaining', key, { remainingConfirmation: remainingFor(key, amount, options) }, options); },
    retirePlan(key = 'plan-1', options = {}) { const index = extension.plans.findIndex(p => p.id === key), before = extension.plans.splice(index, 1)[0]; append('retire-plan', [change('plan', before, null)], options); return api; },
    allocate(value = payment(), amount = null, options = {}) {
      const before = clone(findPlan(value.planId)); extension.payments.push(clone(value));
      const after = { ...before, remainingConfirmation: remainingFor(value.planId, amount, options) };
      extension.plans[extension.plans.findIndex(p => p.id === value.planId)] = after;
      append('allocate-payment', [change('payment', null, value), change('plan', before, after)], options); return api;
    },
    reverse(key = 'payment-1', amount = null, options = {}) {
      const index = extension.payments.findIndex(p => p.id === key), old = extension.payments.splice(index, 1)[0], before = clone(findPlan(old.planId));
      const after = { ...before, remainingConfirmation: remainingFor(old.planId, amount, options) }, created = extension.audit.find(op => op.changes.some(c => c.kind === 'payment' && c.after && c.after.id === key));
      extension.plans[extension.plans.findIndex(p => p.id === old.planId)] = after;
      append('reverse-payment', [change('payment', old, null, created.id), change('plan', before, after)], options); return api;
    },
    reconfirm(key, replacement, amount = null, options = {}) {
      const index = extension.payments.findIndex(p => p.id === key), old = extension.payments.splice(index, 1)[0], before = clone(findPlan(old.planId));
      extension.payments.push(clone(replacement));
      const after = { ...before, remainingConfirmation: remainingFor(old.planId, amount, options) }, created = extension.audit.find(op => op.changes.some(c => c.kind === 'payment' && c.after && c.after.id === key));
      extension.plans[extension.plans.findIndex(p => p.id === old.planId)] = after;
      append('reconfirm-payment', [change('payment', old, null, created.id), change('payment', null, replacement), change('plan', before, after)], options); return api;
    },
    finish() { return clone(extension); }
  };
  return api;
}
module.exports = { clone, AT, AS_OF, signature, proof, confirmation, plan, payment, duplicateProof, refundProof, claimProof, builder };
