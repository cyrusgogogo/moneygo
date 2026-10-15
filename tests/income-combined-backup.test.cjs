'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const F = require('./income-root-fixture.cjs');

test('combined v7 has every existing extension and fixed financial totals match the frozen v0.15 oracle', () => {
  const { state, originalFinancial: before } = F.combined(), after = F.R.calculate(state);
  for (const key of ['simulation', 'imports', 'bookkeeping', 'organizer', 'obligations', 'incomePlanning']) assert.ok(state[key], key);
  assert.equal(state.version, 7);
  assert.equal(state.bookkeeping.version, 4);
  assert.deepEqual(after, F.economicOracle(state));
  assert.equal(after.cash.incomeCents - before.cash.incomeCents, 170000);
  assert.equal(after.cash.expenseCents - before.cash.expenseCents, 80000);
  assert.equal(after.personal.incomeCents - before.personal.incomeCents, 149000);
  assert.equal(after.personal.expenseCents - before.personal.expenseCents, 14000);
  assert.equal(after.accountBalances['account-cash'] - before.accountBalances['account-cash'], 90000);
  assert.equal(after.impacts['income-root-a'].ordinaryIncomeCents, 100000);
  assert.equal(after.impacts['income-root-mixed-receipt'].ordinaryIncomeCents, 34000);
  assert.equal(after.impacts['income-root-held-return'].ordinaryIncomeCents, 15000);
});

test('combined plans preserve reconfirmed, missing, changed, cancelled, retired and reversed histories', () => {
  const { state, ids } = F.combined(), view = F.P.view(state, { asOfDate: F.options.asOfDate });
  const byId = id => view.plans.find(row => row.plan.id === id);
  assert.equal(byId(ids.main).receivedCents, 100000);
  assert.equal(byId(ids.main).remainingCents, 0);
  for (const id of [ids.missing, ids.mixed]) {
    assert.equal(byId(id).receivedCents, null);
    assert.equal(byId(id).remainingCents, null);
    assert.equal(byId(id).progress, 'unresolved');
  }
  assert.equal(byId(ids.cancelled).plan.status, 'cancelled');
  assert.equal(byId(ids.retired), undefined);
  assert.equal(byId(ids.reversed).receivedCents, 0);
  assert.equal(byId(ids.reversed).remainingCents, 2000);
  assert.equal(view.receipts.find(row => row.planId === ids.missing).applicability, 'source-missing');
  assert.equal(view.receipts.find(row => row.planId === ids.mixed).applicability, 'role-changed');
  for (const [mode, known, total] of [['planned', 32000, null], ['confirmed-only', 30000, null], ['conservative', 0, 0]]) {
    const projected = F.P.project(state, { ...F.options, mode });
    assert.equal(projected.knownDatedTotalCents, known);
    assert.equal(projected.scheduledTotalCents, total);
  }
});

test('full v7 verified round trip has exact history counts and independent nested copies', () => {
  const { state } = F.combined(), verified = F.L.verifyBackup(F.L.backup(state));
  assert.deepEqual(verified.state, state);
  assert.deepEqual(verified.incomePlanningCounts, {
    currentPlans: 6, cancelledPlans: 1, retiredPlans: 1,
    currentReceipts: 4, reversedReceipts: 3, auditOperations: 19
  });
  assert.deepEqual(F.economicOracle(verified.state), F.economicOracle(state));
  const original = JSON.stringify(state);
  assert.notEqual(verified.state.incomePlanning, state.incomePlanning);
  assert.notEqual(verified.state.incomePlanning.receipts[0].proof, state.incomePlanning.receipts[0].proof);
  if (Object.isFrozen(verified.state.incomePlanning.receipts[0].proof.source)) {
    assert.throws(() => { verified.state.incomePlanning.receipts[0].proof.source.amountCents++; }, TypeError);
  } else {
    verified.state.incomePlanning.receipts[0].proof.source.amountCents++;
  }
  assert.equal(JSON.stringify(state), original);
  // A caller's parsed JSON copy is mutable and cannot alias the accepted state.
  const mutable = JSON.parse(F.L.backup(state)).data;
  mutable.incomePlanning.receipts[0].proof.source.amountCents++;
  assert.equal(JSON.stringify(state), original);
  assert.throws(() => F.L.validateState(mutable));
});

test('corrupt v7 proof, hidden old wrapper and malformed current journal never overwrite a stored ledger', () => {
  const { state } = F.combined(), saved = JSON.stringify(state);
  const damaged = [];
  let value = F.clone(state); value.incomePlanning.receipts[0].proof.ordinaryIncomeCents++; damaged.push(value);
  value = F.clone(state); value.version = 6; damaged.push(value);
  value = F.clone(state); value.incomePlanning.receipts.pop(); damaged.push(value);
  value = F.clone(state); value.incomePlanning.audit[0].extra = true; damaged.push(value);
  for (const candidate of damaged) {
    const writes = [], storage = { getItem: () => saved, setItem: (...args) => writes.push(args) };
    assert.throws(() => F.L.save(storage, candidate));
    assert.deepEqual(writes, []);
    assert.equal(storage.getItem(F.L.STORAGE_KEY), saved);
  }
});
