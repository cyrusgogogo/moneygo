'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { L, copy, planning, base, tx, AT } = require('./income-boundary-helpers.cjs');
const R = require('../dist/relations'), O = require('../dist/organizer'), C = require('../dist/obligations');
const H = require('./held-c-frozen-helpers.cjs');
const review = s => ({ confirmed: true, expectedRevision: s.obligations?.revision || 0, reason: 'Synthetic review' });
function preserved(before, after) { assert.equal(after.version, 7); assert.equal(JSON.stringify(after.incomePlanning), JSON.stringify(before.incomePlanning)); assert.equal(JSON.stringify(L.validateState(after)), JSON.stringify(after)); return after; }
function step(state, fn) { return preserved(state, fn(state)); }
const contractFields = { accountId: 'credit', name: 'Contract', principalCents: 1000, feeCents: 0, source: 'Synthetic', purchaseTransactionId: null, status: 'active', schedule: [{ id: 'installment-1', dueDate: '2026-11-01', principalCents: 1000, feeCents: 0 }], note: '' };
function vmModule(name, additions) { const filename = path.join(__dirname, '../dist/' + name + '.js'), sandbox = { module: { exports: {} }, require: p => require(path.join(__dirname, '../dist', p)), TextEncoder, ...additions }; vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename }); return sandbox.module.exports; }

test('core transaction/account/category writers preserve annotation bytes and permit correction/delete/restore', () => {
  let s = planning(base([tx('salary')]), { receipt: true });
  s = step(s, s => L.putTransaction(s, { ...s.transactions[0], amountCents: 9000 }, 'salary'));
  s = step(s, s => L.deleteTransaction(s, 'salary')); s = step(s, s => L.undoDelete(s, 'salary'));
  s = step(s, s => L.putTransaction(s, { ...tx('ignored'), amountCents: 500 }));
  s = step(s, s => L.putAccount(s, { name: 'Fresh', openingBalanceCents: 0 })); const account = s.accounts.at(-1).id;
  s = step(s, s => L.putAccount(s, { name: 'Renamed', openingBalanceCents: 100 }, account)); s = step(s, s => L.removeAccount(s, account));
  s = step(s, s => L.putCategory(s, { name: 'Fresh', type: 'income' })); const category = s.categories.at(-1).id;
  s = step(s, s => L.putCategory(s, { name: 'Renamed', type: 'income' }, category)); s = step(s, s => L.removeCategory(s, category));
});
test('all Relations writer funnels preserve v7 on create/update/unlink and snapshot', () => {
  let s = planning(base([tx('expense', 'expense', 10000), tx('income', 'income', 10000), tx('shadow', 'income', 10000), tx('pairout', 'expense', 500, { accountId: 'bank' }), tx('pairin', 'income', 500)]), { receipt: true, sourceId: 'income' });
  s = step(s, s => R.linkEvidence(s, { primaryId: 'income', shadowId: 'shadow', reason: 'Duplicate' })); s = step(s, s => R.unlink(s, 'link', s.bookkeeping.links[0].id, 'Unlink'));
  s = step(s, s => R.pairTransfer(s, { expenseId: 'pairout', incomeId: 'pairin', reason: 'Pair' })); s = step(s, s => R.unlink(s, 'transferPair', s.bookkeeping.transferPairs[0].id, 'Unpair'));
  s = step(s, s => R.createClaim(s, { expenseId: 'expense', amountCents: 1000, kind: 'advance', name: 'Claim', status: 'unsubmitted', note: '' }));
  s = step(s, s => R.updateClaim(s, s.bookkeeping.claims[0].id, { name: 'Updated', status: 'submitted', note: '' }, 'Update'));
  s = step(s, s => R.settleClaim(s, { incomeId: 'income', claimId: s.bookkeeping.claims[0].id, amountCents: 1000, reason: 'Settlement' }));
  s = step(s, s => R.unlink(s, 'settlement', s.bookkeeping.settlements[0].id, 'Undo')); s = step(s, s => R.unlink(s, 'claim', s.bookkeeping.claims[0].id, 'Undo'));
  s = step(s, s => R.allocateRefund(s, { incomeId: 'income', expenseId: 'expense', amountCents: 1000, reason: 'Refund' })); s = step(s, s => R.unlink(s, 'refund', s.bookkeeping.refunds[0].id, 'Undo'));
  s = step(s, s => R.addRefundPlan(s, { expenseId: 'expense', expectedAmountCents: 1000, status: 'waiting', note: '' }));
  s = step(s, s => R.updateRefundPlan(s, s.bookkeeping.refundPlans[0].id, { status: 'closed', note: 'Confirmed' }, 'Update')); s = step(s, s => R.unlink(s, 'refundPlan', s.bookkeeping.refundPlans[0].id, 'Undo'));
  s = step(s, s => R.addSnapshot(s, { accountId: 'account-cash', date: '2026-10-14', actualBalanceCents: 10000, note: '' })); s = step(s, s => R.unlink(s, 'snapshot', s.bookkeeping.snapshots[0].id, 'Undo'));
});
test('Organizer rule/alias/apply/rollback/scope/review/close funnels preserve planning', () => {
  let s = planning(base([tx('expense', 'expense', 1000, { note: 'Coffee' })]));
  s = step(s, s => O.saveRule(s, { name: 'Rule', conditions: { type: 'expense' }, actions: { categoryId: 'expense-food' }, at: AT }));
  let p = O.previewRules(s); s = step(s, s => O.applyPreview(s, p, { transactionIds: ['expense'], at: AT })); s = step(s, s => O.rollbackBatch(s, s.organizer.batches[0].id, { at: AT }));
  s = step(s, s => O.removeRule(s, s.organizer.rules[0].id, { at: AT }));
  s = step(s, s => O.saveAlias(s, { from: 'Coffee', to: 'Cafe', at: AT })); p = O.previewAliases(s); s = step(s, s => O.applyPreview(s, p, { transactionIds: ['expense'], at: AT })); s = step(s, s => O.rollbackBatch(s, s.organizer.batches.at(-1).id, { at: AT })); s = step(s, s => O.removeAlias(s, s.organizer.aliases[0].id, { at: AT }));
  s = step(s, s => O.setScope(s, { sourceKey: 'Synthetic', accountId: 'account-cash', included: true, reason: 'Declared', confirmed: true, at: AT }));
  s = step(s, s => O.closeMonth(s, { month: '2026-10', reason: 'Close', at: AT }));
  assert.equal(JSON.parse(O.exportBackup(s)).version, 7);
});
test('Obligations create/update/remove/revert funnels preserve v7 and existing normalized fields', () => {
  let s = planning(base()); s = step(s, s => C.putProfile(s, { accountId: 'credit', role: 'credit', creditLimitCents: null, note: '' }, review(s)));
  const profile = s.obligations.profiles[0]; s = step(s, s => C.putProfile(s, { accountId: 'credit', role: 'credit', creditLimitCents: 10000, note: 'Updated' }, review(s), profile.id));
  s = step(s, s => C.putContract(s, contractFields, review(s))); const id = s.obligations.contracts[0].id;
  s = step(s, s => C.putContract(s, { ...contractFields, name: 'Updated' }, review(s), id)); s = step(s, s => C.remove(s, 'contract', id, review(s))); s = step(s, s => C.revert(s, s.obligations.audit.at(-1).id, review(s)));
});
test('Held transitions and frozen personal-month closes preserve planning byte-for-byte', () => {
  let s = planning(H.base(), { receipt: true, sourceId: 'receipt' }); s = step(s, H.fund); s = step(s, H.use); s = step(s, H.returned); s = step(s, s => H.close(s, '2026-02'));
  const frozen = JSON.stringify(s.organizer.closes);
  for (const [kind, key] of [['reverse-recognition', 'recognitionId'], ['reverse-return', 'returnId']]) s = step(s, s => H.command(s, { action: kind, [key]: kind === 'reverse-recognition' ? s.bookkeeping.heldRecognitions[0].id : s.bookkeeping.heldReturns[0].id }));
  s = step(s, s => H.command(s, { action: 'reverse-position', positionId: s.bookkeeping.heldPositions[0].id })); assert.equal(JSON.stringify(s.organizer.closes), frozen);
});
test('Ledger random generated IDs avoid planning-only retained foreign identities', () => {
  const choices = ['retained', 'new']; const api = vmModule('ledger', { crypto: { randomUUID: () => choices.shift() } });
  const s = planning(base(), { expectedAccountId: 'account-retained' }), next = api.putAccount(s, { name: 'New', openingBalanceCents: 0 });
  assert.equal(next.accounts.at(-1).id, 'account-new'); preserved(s, next);
});
test('Obligations generated IDs and audit IDs reserve before-state once, without half-journal validation', () => {
  class FixedDate extends Date { static now() { return 0; } }
  const holder = { exports: {} }; Function('module', 'require', 'Date', fs.readFileSync(path.join(__dirname, '../dist/obligations.js'), 'utf8'))(holder, p => require(path.join(__dirname, '../dist', p)), FixedDate); const api = holder.exports;
  const s = planning(base(), { expectedAccountId: 'obl-profile-0-1', auditId: 'obl-audit-0-3' });
  const next = api.putProfile(s, { accountId: 'credit', role: 'credit', creditLimitCents: null, note: '' }, review(s));
  assert.equal(next.obligations.profiles[0].id, 'obl-profile-0-2'); assert.equal(next.obligations.audit[0].id, 'obl-audit-0-4'); preserved(s, next);
});

test('each public legacy command reserves once from a complete valid before-state', () => {
  for (const [name, write] of [
    ['relations', (api, s) => api.createClaim(s, { expenseId: 'expense', amountCents: 100, kind: 'advance', name: 'Claim', status: 'unsubmitted', note: '' })],
    ['organizer', (api, s) => api.saveRule(s, { name: 'Rule', conditions: { type: 'expense' }, actions: { categoryId: 'expense-food' } })],
    ['obligations', (api, s) => api.putProfile(s, { accountId: 'credit', role: 'credit', creditLimitCents: null, note: '' }, review(s))]
  ]) {
    const holder = { exports: {} }; let collections = 0;
    const wrapped = { ...L, collectRetainedIdentities(s) { collections++; assert.equal(s.bookkeeping?.revision || 0, 0); assert.equal(s.organizer?.revision || 0, 0); assert.equal(s.obligations?.revision || 0, 0); return L.collectRetainedIdentities(s); } };
    Function('module', 'require', fs.readFileSync(path.join(__dirname, '../dist/' + name + '.js'), 'utf8'))(holder, p => p === './ledger.js' ? wrapped : require(path.join(__dirname, '../dist', p)));
    const s = planning(base([tx('expense', 'expense')])); preserved(s, write(holder.exports, s)); assert.equal(collections, 1, name);
  }
});

test('composite create/remove retains planning and snapshot nested proof remains reserved', () => {
  let s = planning(base([tx('a', 'expense', 3000), tx('b', 'expense', 7000), tx('fund', 'expense', 10000, { accountId: 'bank' })]));
  const p = R.previewComposite(s, { name: 'Order', personalIds: ['a', 'b'], fundingIds: ['fund'], paidCents: 10000, grossCents: null, discountCents: null });
  s = step(s, s => R.createComposite(s, p, { confirmed: true, reason: 'Reviewed' })); const id = s.bookkeeping.composites[0].id;
  s = step(s, s => R.addSnapshot(s, { accountId: 'bank', date: '2026-10-14', actualBalanceCents: -10000, note: '' })); const snap = s.bookkeeping.snapshots[0].id;
  s = step(s, s => R.unlink(s, 'snapshot', snap, 'Remove snapshot')); const remove = R.previewCompositeRemoval(s, id); s = step(s, s => R.unlinkComposite(s, remove, { confirmed: true, reason: 'Reviewed removal' }));
  assert.ok(L.collectRetainedIdentities(s).some(r => r.id === id && r.kind === 'composite' && r.usage === 'reference' && r.paths.some(p => p.includes('.before.basis.composites'))));
});
test('Obligations statement/repayment/inclusion/fee writes all cross the full v7 result boundary', () => {
  let s = planning(base([tx('fee', 'expense', 100, { accountId: 'credit' }), { id: 'repay', type: 'transfer', amountCents: 2000, date: '2026-10-10', accountId: 'bank', toAccountId: 'credit', note: '' }]));
  s = step(s, s => C.putProfile(s, { accountId: 'credit', role: 'credit', creditLimitCents: null, note: '' }, review(s)));
  const bill = { accountId: 'credit', provenance: 'official', periodStart: '2026-09-01', periodEnd: '2026-09-30', statementDate: '2026-10-01', dueDate: '2026-10-20', amountCents: 2000, source: 'Synthetic bill', note: '' };
  s = step(s, s => C.putStatement(s, bill, review(s))); const statementId = s.obligations.statements[0].id;
  s = step(s, s => C.putStatement(s, { ...bill, note: 'Updated' }, review(s), statementId));
  s = step(s, s => C.putContract(s, contractFields, review(s))); const contractId = s.obligations.contracts[0].id;
  s = step(s, s => C.allocateRepayment(s, { statementId, sourceKind: 'native', sourceId: 'repay', amountCents: 2000 }, review(s)));
  s = step(s, s => C.includeInstallment(s, { statementId, contractId, installmentId: 'installment-1' }, review(s)));
  s = step(s, s => C.markFee(s, { transactionId: 'fee', kind: 'handling', statementId, contractId: null, note: '' }, review(s)));
  for (const [kind, collection] of [['fee', 'fees'], ['inclusion', 'inclusions'], ['repayment', 'repayments'], ['contract', 'contracts'], ['statement', 'statements'], ['profile', 'profiles']]) s = step(s, s => C.remove(s, kind, s.obligations[collection][0].id, review(s)));
});
test('Organizer explicit review writes preserve v7 without treating opaque queue keys as owned identities', () => {
  let s = planning(base([tx('a', 'expense', 500), tx('b', 'expense', 500)])); const key = O.reviewQueue(s, { asOf: '2026-10-14' })[0].key;
  s = step(s, s => O.setReview(s, { key, rank: 0, deferUntil: null, reason: 'Review', at: AT }));
  assert.equal(L.collectRetainedIdentities(s).some(r => r.id === key && r.usage === 'definition'), false);
});
