'use strict';
const L = require('../dist/ledger.js');
const copy = value => JSON.parse(JSON.stringify(value));
const AT = '2026-10-14T09:00:00.000Z';
const tx = (id, type = 'income', amountCents = 10000, extra = {}) => ({ id, type, amountCents, date: '2026-10-01', accountId: 'account-cash', categoryId: type === 'income' ? 'income-other' : 'expense-other', note: '', ...extra });
function base(rows = []) { const s = L.createEmpty(); s.accounts.push({ id: 'bank', name: 'Bank', openingBalanceCents: 0 }, { id: 'credit', name: 'Credit', openingBalanceCents: 0 }); s.transactions = rows; return L.validateState(s); }
function planning(input = base(), options = {}) {
  const s = copy(input), id = options.id || 'income-plan-fixture';
  const p = { id, createdAt: AT, name: 'Synthetic income', certainty: 'expectation', expectedAmountCents: 10000, expectedDate: '2026-10-20', expectedAccountId: options.expectedAccountId ?? null, status: options.cancelled ? 'cancelled' : 'open', basis: '', note: '' };
  const audit = [{ id: options.auditId || 'income-audit-fixture', revision: 1, at: AT, kind: 'plan', recordId: p.id, action: 'create', reason: 'Synthetic fixture', before: null, after: copy(p), reverses: null }];
  const plans = [p], receipts = [];
  if (options.receipt) {
    const source = { id: options.sourceId || 'salary', type: 'income', date: '2026-10-01', amountCents: 10000, accountId: 'account-cash', toAccountId: null };
    const r = { id: 'income-receipt-fixture', createdAt: AT, reviewedAsOfDate: '2026-10-14', planId: p.id, transactionId: source.id, amountCents: 4000, proof: { version: 1, source, role: 'ordinary-primary', duplicateEvidence: [], reductions: [], ordinaryIncomeCents: 10000 }, reference: '' };
    receipts.push(r); audit.push({ id: 'income-audit-receipt-fixture', revision: 2, at: AT, kind: 'receipt', recordId: r.id, action: 'create', reason: 'Synthetic fixture', before: null, after: copy(r), reverses: null });
    if (options.reversed) { receipts.pop(); audit.push({ id: 'income-audit-reverse-fixture', revision: 3, at: AT, kind: 'receipt', recordId: r.id, action: 'reverse', reason: 'Synthetic reverse', before: copy(r), after: null, reverses: 'income-audit-receipt-fixture' }); }
  }
  if (options.retired) { plans.pop(); audit.push({ id: 'income-audit-retire-fixture', revision: audit.length + 1, at: AT, kind: 'plan', recordId: p.id, action: 'retire', reason: 'Synthetic retire', before: copy(p), after: null, reverses: null }); }
  s.version = 7; s.incomePlanning = { version: 1, revision: audit.length, plans, receipts, audit };
  return L.validateState(s);
}
module.exports = { L, copy, AT, tx, base, planning };
