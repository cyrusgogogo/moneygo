'use strict';
const clone = value => JSON.parse(JSON.stringify(value));
const AT = '2026-10-14T12:00:00.000Z';
function signature(overrides = {}) {
  return { id: 'source-1', type: 'income', date: '2026-10-01', amountCents: 100000,
    accountId: 'account-1', toAccountId: null, ...overrides };
}
function proof(overrides = {}) {
  const source = signature(overrides.source || {});
  return { version: 1, source, role: 'ordinary-primary', duplicateEvidence: [], reductions: [],
    ordinaryIncomeCents: source.amountCents, ...overrides, source };
}
function plan(overrides = {}) {
  return { id: 'plan-1', createdAt: AT, name: 'Salary', certainty: 'confirmed-plan',
    expectedAmountCents: 100000, expectedDate: '2026-10-31', expectedAccountId: 'account-1',
    status: 'open', basis: 'Synthetic confirmed amount', note: '', ...overrides };
}
function receipt(overrides = {}) {
  return { id: 'receipt-1', createdAt: AT, reviewedAsOfDate: '2026-10-14', planId: 'plan-1',
    transactionId: 'source-1', amountCents: 10000, proof: proof(), reference: '', ...overrides };
}
function reductionProof(count, options = {}) {
  const source = signature(options.source || {}), kind = options.kind || 'refund';
  const reductions = Array.from({ length: count }, (_, i) => ({ id: 'reduction-' + i, kind,
    amountCents: 1, incomeSignature: clone(source) }));
  return proof({ source, reductions, ordinaryIncomeCents: source.amountCents - count });
}
function duplicateProof(count, options = {}) {
  const source = signature(options.source || {});
  const duplicateEvidence = Array.from({ length: count }, (_, i) => ({ id: 'duplicate-' + i,
    primaryId: source.id, shadowId: 'shadow-' + i, primarySignature: clone(source),
    shadowSignature: { ...source, id: 'shadow-' + i, date: options.shadowDate || source.date } }));
  return proof({ source, duplicateEvidence });
}
function builder() {
  const extension = { version: 1, revision: 0, plans: [], receipts: [], audit: [] };
  let next = 1;
  function event(kind, action, before, after, options = {}) {
    const record = after || before;
    const row = { id: 'event-' + next++, revision: extension.audit.length + 1,
      at: action === 'create' ? record.createdAt : AT, kind, recordId: record.id, action,
      reason: 'Synthetic test', before: clone(before), after: clone(after), reverses: null, ...options };
    extension.audit.push(row); extension.revision = extension.audit.length; return row;
  }
  const api = {
    extension,
    createPlan(value = plan(), options) { extension.plans.push(clone(value)); event('plan', 'create', null, value, options); return api; },
    updatePlan(key, patch, options) {
      const index = extension.plans.findIndex(row => row.id === key), before = clone(extension.plans[index]);
      const after = { ...before, ...patch }; extension.plans[index] = clone(after);
      event('plan', 'update', before, after, options); return api;
    },
    retirePlan(key, options) {
      const index = extension.plans.findIndex(row => row.id === key), before = extension.plans.splice(index, 1)[0];
      event('plan', 'retire', before, null, options); return api;
    },
    createReceipt(value = receipt(), options) { extension.receipts.push(clone(value)); event('receipt', 'create', null, value, options); return api; },
    reverseReceipt(key, options = {}) {
      const index = extension.receipts.findIndex(row => row.id === key), before = extension.receipts.splice(index, 1)[0];
      const create = extension.audit.find(row => row.kind === 'receipt' && row.action === 'create' && row.recordId === key);
      event('receipt', 'reverse', before, null, { reverses: create.id, ...options }); return api;
    },
    finish() { return clone(extension); }
  };
  return api;
}
module.exports = { AT, clone, signature, proof, plan, receipt, reductionProof, duplicateProof, builder };
