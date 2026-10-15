'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { L, copy, planning, base, tx } = require('./income-boundary-helpers.cjs');
const { buildFullBackupFixture } = require('./full-backup-fixture.cjs');
const R = require('../dist/relations'), O = require('../dist/organizer'), C = require('../dist/obligations');

test('v7 preserves complete normalized old bytes and every absent optional extension', () => {
  for (const input of [L.createEmpty(), buildFullBackupFixture().state]) {
    const before = L.validateState(input), next = planning(before), old = copy(next); delete old.incomePlanning; old.version = before.version;
    assert.deepEqual(old, before);
    for (const key of ['imports', 'bookkeeping', 'organizer', 'obligations', 'simulation']) assert.equal(Object.hasOwn(next, key), Object.hasOwn(before, key));
  }
});
test('v7 is required for planning and cannot omit or invent its extension version', () => {
  const s = planning(); for (const version of [1, 2, 3, 4, 5, 6, 8]) { const bad = copy(s); bad.version = version; assert.throws(() => L.validateState(bad)); }
  const missing = copy(s); delete missing.incomePlanning; assert.throws(() => L.validateState(missing), { code: 'INVALID_VERSION' });
  const bad = copy(s); bad.incomePlanning.version = 2; assert.throws(() => L.validateState(bad));
});
test('backup wrapper/data gates, history counts and independent copies are exact', () => {
  const s = planning(base(), { receipt: true, reversed: true, retired: true, sourceId: 'missing-source' });
  const text = L.backup(s), result = L.verifyBackup(text);
  assert.deepEqual(result.incomePlanningCounts, { currentPlans: 0, cancelledPlans: 0, retiredPlans: 1, currentReceipts: 0, reversedReceipts: 1, auditOperations: 4 });
  assert.deepEqual(result.state, s); assert.notEqual(result.state.incomePlanning.audit, s.incomePlanning.audit);
  const bad = JSON.parse(text); bad.version = 6; assert.throws(() => L.parseBackup(JSON.stringify(bad)));
  assert.equal(Object.hasOwn(L.verifyBackup(L.backup(base())), 'incomePlanningCounts'), false);
});
test('full preflight rejects executable and hidden v7 data without invoking it or writing storage', () => {
  let executed = 0, writes = 0; const storage = { setItem() { writes++; } };
  for (const mutate of [s => Object.defineProperty(s.transactions, '0', { get() { executed++; return tx('x'); }, enumerable: true }), s => Object.defineProperty(s.accounts[0], 'hidden', { value: true }), s => { s.incomePlanning.audit[0].after.toJSON = () => { executed++; }; }, s => { Object.setPrototypeOf(s.accounts[0], { dangerous: true }); }]) {
    const s = copy(planning(base([tx('x')]))); mutate(s); assert.throws(() => L.save(storage, s)); assert.throws(() => L.collectRetainedIdentities(s));
  }
  assert.equal(executed, 0); assert.equal(writes, 0);
});
test('all direct old writer families reject corrupt v7 before touching raw legacy getters', () => {
  const writers = [s => R.createClaim(s, { expenseId: 'expense', amountCents: 100, kind: 'advance', name: 'Claim', status: 'unsubmitted', note: '' }), s => O.saveRule(s, { name: 'Rule', conditions: { type: 'expense' }, actions: { categoryId: 'expense-food' } }), s => C.putProfile(s, { accountId: 'credit', role: 'credit', creditLimitCents: null, note: '' }, { confirmed: true, expectedRevision: 0, reason: 'Test' })];
  let executed = 0;
  for (const write of writers) { const s = copy(planning(base([tx('expense', 'expense')]))); Object.defineProperty(s.transactions[0], 'type', { enumerable: true, get() { executed++; return 'expense'; } }); assert.throws(() => write(s)); }
  assert.equal(executed, 0);
});
