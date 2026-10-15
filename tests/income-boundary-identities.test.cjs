'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { L, copy, planning, base, tx, AT } = require('./income-boundary-helpers.cjs');
const R = require('../dist/relations'), O = require('../dist/organizer'), C = require('../dist/obligations'), S = require('../dist/scenario');
const { buildFullBackupFixture } = require('./full-backup-fixture.cjs');
const H = require('./held-c-frozen-helpers.cjs');
const review = s => ({ confirmed: true, expectedRevision: s.obligations?.revision || 0, reason: 'Synthetic review' });
const contract = (id = 'installment-1') => ({ accountId: 'credit', name: 'Contract', principalCents: 10000, feeCents: 0, source: 'Synthetic', purchaseTransactionId: null, status: 'active', schedule: [{ id, dueDate: '2026-11-01', principalCents: 10000, feeCents: 0 }], note: '' });
const credit = s => C.putProfile(s, { accountId: 'credit', role: 'credit', creditLimitCents: null, note: '' }, review(s));
const fields = row => Object.fromEntries(C.FIELDS.contract.map(k => [k, copy(row[k])]));

test('public collector validates input, deep-freezes detached typed records and groups owner aliases', () => {
  const s = planning(base([tx('salary')]), { receipt: true }); const records = L.collectRetainedIdentities(s), row = records.find(r => r.namespace === 'incomePlanning' && r.kind === 'plan' && r.usage === 'definition');
  assert.equal(row.ownerKey, '["incomePlanning","plan","income-plan-fixture"]'); assert.deepEqual(row.paths, ['$.incomePlanning.audit[0].after.id', '$.incomePlanning.plans[0].id']);
  assert.ok(Object.isFrozen(records)); assert.ok(Object.isFrozen(row)); assert.ok(Object.isFrozen(row.paths)); assert.ok(!Object.isFrozen(s));
  assert.ok(records.some(r => r.namespace === 'core' && r.kind === 'transaction' && r.id === 'salary' && r.usage === 'reference' && r.paths.includes('$.incomePlanning.receipts[0].proof.source.id')));
  const broken = copy(s); broken.incomePlanning.audit = []; assert.throws(() => L.collectRetainedIdentities(broken));
});
test('planning-owned IDs reject every retained foreign identity in a complete all-extension fixture', () => {
  const s = buildFullBackupFixture().state, records = L.collectRetainedIdentities(s), ids = [...new Set(records.map(r => r.id))];
  assert.ok(ids.length > 50);
  for (const id of ids) assert.throws(() => planning(s, { id }), { code: 'IDENTITY_COLLISION' }, id);
});
test('removed relation and nested snapshot identities remain reserved with exact schema paths', () => {
  let s = base([tx('expense', 'expense')]); s = R.createClaim(s, { expenseId: 'expense', amountCents: 5000, kind: 'advance', name: 'Claim', status: 'unsubmitted', note: '' });
  const claimId = s.bookkeeping.claims[0].id; s = R.unlink(s, 'claim', claimId, 'remove'); s = L.deleteTransaction(s, 'expense');
  const ids = L.collectRetainedIdentities(planning(s));
  assert.ok(ids.some(r => r.id === claimId && r.usage === 'definition' && r.paths.some(p => p.includes('.audit[') && p.includes('.before.id'))));
  const transaction = ids.find(r => r.id === 'expense' && r.kind === 'transaction' && r.usage === 'definition'); assert.equal(transaction.paths.length, 2);
  assert.throws(() => planning(s, { id: claimId }), { code: 'IDENTITY_COLLISION' });
});
test('frozen personal-event close references reserve held proofs, event IDs and categories', () => {
  let s = H.returned(H.use(H.fund(H.base()))); s = H.close(s, '2026-02');
  const ids = L.collectRetainedIdentities(planning(s));
  const recognition = s.bookkeeping.heldRecognitions[0].id;
  assert.ok(ids.some(r => r.id === recognition && r.namespace === 'relations' && r.kind === 'heldRecognition' && r.usage === 'reference' && r.paths.some(p => p.includes('.manifest.personalEventKeys'))));
  assert.ok(ids.some(r => r.id === 'expense-food' && r.paths.some(p => p.includes('.heldProof.recognitions') && p.includes('.categoryProof.id'))));
  assert.ok(ids.some(r => r.id === 'fund' && r.paths.some(p => p.includes('.rawProofs'))));
});
test('stale simulation event references and missing historical receipt source/account are reserved', () => {
  const s = base(); s.version = 2; s.simulation = S.defaultSettings(); s.simulation.version = 2; s.simulation.exclusions = [{ kind: 'held-recognition', id: 'retired-held-event' }, { kind: 'transaction-expense', id: 'removed-expense' }];
  const next = planning(s, { receipt: true, reversed: true, sourceId: 'missing-source', expectedAccountId: 'missing-account' });
  for (const id of ['retired-held-event', 'removed-expense', 'missing-source', 'missing-account']) assert.ok(L.collectRetainedIdentities(next).some(r => r.id === id), id);
  assert.throws(() => planning(s, { id: 'retired-held-event' }), { code: 'IDENTITY_COLLISION' });
});
test('R4 old account/local-installment names coexist, account deletion and v7 restore remain legal', () => {
  let s = base(); s.accounts.push({ id: 'installment-1', name: 'Independent account', openingBalanceCents: 0 }); s = credit(s); s = C.putContract(s, contract(), review(s)); s = C.putContract(s, contract(), review(s));
  s = planning(s, { expectedAccountId: 'installment-1' }); assert.equal(require('../dist/income-planning').view(s, { asOfDate: '2026-10-14' }).plans[0].expectedAccountStatus, 'known'); const records = L.collectRetainedIdentities(s).filter(r => r.id === 'installment-1');
  assert.equal(new Set(records.filter(r => r.kind === 'installment' && r.usage === 'definition').map(r => r.ownerKey)).size, 2);
  s = L.removeAccount(s, 'installment-1'); assert.equal(s.incomePlanning.plans[0].expectedAccountId, 'installment-1'); assert.deepEqual(L.parseBackup(L.backup(s)), s);
  assert.equal(require('../dist/income-planning').view(L.parseBackup(L.backup(s)), { asOfDate: '2026-10-14' }).plans[0].expectedAccountStatus, 'missing'); assert.ok(!s.accounts.some(a => a.id === 'installment-1')); assert.equal(s.obligations.contracts.length, 2);
});
test('new schedule owner cannot reuse planning-owned or borrowed retained strings; same owner update/revert can', () => {
  for (const item of ['income-plan-fixture', 'income-audit-fixture', 'missing-account']) { const s = planning(credit(base()), { expectedAccountId: 'missing-account' }), before = JSON.stringify(s); assert.throws(() => C.putContract(s, contract(item), review(s)), { code: 'IDENTITY_COLLISION' }); assert.equal(JSON.stringify(s), before); }
  let s = credit(base()); s = C.putContract(s, contract(), review(s)); s = planning(s, { expectedAccountId: 'installment-1' });
  const row = s.obligations.contracts[0]; s = C.putContract(s, { ...fields(row), name: 'Updated' }, review(s), row.id); s = C.revert(s, s.obligations.audit.at(-1).id, review(s)); assert.equal(s.obligations.contracts[0].name, 'Contract');
  assert.throws(() => C.putContract(s, contract(), review(s)), { code: 'IDENTITY_COLLISION' });
});
test('restore deliberately accepts foreign cross-namespace reuse without claiming chronology', () => {
  let s = credit(base()); s = C.putContract(s, contract('missing-account'), review(s)); s = planning(s, { expectedAccountId: 'missing-account' });
  assert.doesNotThrow(() => L.parseBackup(L.backup(s)));
  assert.equal(s.accounts.some(a => a.id === 'missing-account'), false);
});
test('deterministic Relations and Organizer generated IDs skip planning current/history/borrowed reservations', () => {
  for (const [id, auditId, expectedAccountId] of [['relation-claim-1', undefined, null], ['retired', 'relation-audit-1', null], ['plan', undefined, 'relation-claim-1']]) {
    const s = planning(base([tx('expense', 'expense')]), { id, auditId, expectedAccountId, retired: id === 'retired' });
    const n = R.createClaim(s, { expenseId: 'expense', amountCents: 100, kind: 'advance', name: 'Claim', status: 'unsubmitted', note: '' });
    assert.ok(!L.collectRetainedIdentities(s).some(r => r.id === n.bookkeeping.claims[0].id)); assert.ok(!L.collectRetainedIdentities(s).some(r => r.id === n.bookkeeping.audit[0].id));
  }
  const s = planning(base(), { expectedAccountId: 'organizer-rule-1', auditId: 'organizer-audit-1' }); const n = O.saveRule(s, { name: 'Rule', conditions: { type: 'expense' }, actions: { categoryId: 'expense-food' } }); assert.equal(n.organizer.rules[0].id, 'organizer-rule-2'); assert.equal(n.organizer.audit[0].id, 'organizer-audit-2');
});
