'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const L = require('../dist/ledger.js'), R = require('../dist/relations.js'), O = require('../dist/organizer.js');
const copy = value => JSON.parse(JSON.stringify(value));
const at = '2026-10-14T10:00:00.000Z';
const error = code => e => e.code === code;
function tx(id, amountCents, date = '2026-10-01', accountId = 'account-cash', extra = {}) {
  return { id, type: 'expense', amountCents, date, accountId, categoryId: 'expense-other', note: 'Synthetic composite evidence', ...extra };
}
function fixture(crossMonth = false, rows) {
  const state = L.createEmpty();
  state.accounts.push({ id: 'bank', name: 'Synthetic bank', openingBalanceCents: 100000 });
  state.transactions = rows || [tx('aggregate', 10000, crossMonth ? '2026-09-30' : '2026-10-01', 'bank'), tx('detail-30', 3000), tx('detail-70', 7000, '2026-10-02')];
  return L.validateState(state);
}
function composite(state = fixture(), extra = {}) {
  const preview = R.previewComposite(state, { name: 'Synthetic confirmed order', personalIds: ['detail-30', 'detail-70'], fundingIds: ['aggregate'], paidCents: 10000, grossCents: 12000, discountCents: 2000, ...extra });
  return R.createComposite(state, preview, { confirmed: true, reason: 'Synthetic manually verified personal and funding records' });
}
function close(state, extra = {}) { return O.closeMonth(state, { month: '2026-10', reason: 'Synthetic frozen month', at, ...extra }); }
function mutateClose(state, change) {
  const next = copy(state), saved = next.organizer.closes.at(-1);
  change(saved);
  const entry = next.organizer.audit.find(a => a.changes.some(c => c.collection === 'closes' && c.key === saved.id));
  change(entry.changes.find(c => c.collection === 'closes' && c.key === saved.id).after);
  return next;
}
function rawProof() {
  const rows = fixture().transactions;
  return { id: 'synthetic-composite', createdAt: at, name: 'Synthetic proof', personalIds: ['detail-30', 'detail-70'], fundingIds: ['aggregate'], paidCents: 10000, grossCents: null, discountCents: null, reason: 'Synthetic', signatures: rows.map(t => ({ id: t.id, type: t.type, date: t.date, amountCents: t.amountCents, accountId: t.accountId, toAccountId: null })) };
}

test('composite close freezes one compact proof and separate 100 cash / 30+70 personal authorities', () => {
  const original = fixture(), grouped = composite(original), state = close(grouped), saved = state.organizer.closes[0], live = R.calculate(state, '2026-10');
  assert.equal(O.VERSION, 2); assert.equal(O.COMPOSITE_VERSION, 3); assert.equal(O.defaultState().version, 2);
  assert.equal(state.version, 5); assert.equal(state.organizer.version, 3);
  assert.deepEqual(state.transactions, original.transactions);
  assert.equal(saved.rows.length, 3); assert.equal(saved.compositeProofs.length, 1);
  assert.deepEqual(saved.compositeProofs[0], grouped.bookkeeping.composites[0]);
  assert.deepEqual(saved.totals.cash, live.cash); assert.deepEqual(saved.totals.personal, live.personal);
  assert.equal(saved.totals.cash.expenseCents, 10000); assert.equal(saved.totals.personal.expenseCents, 10000);
  for (const row of saved.rows) { assert.equal(row.compositeId, saved.compositeProofs[0].id); assert.equal(row.compositeProof, undefined); assert.equal(row.transferPair, undefined); }
  const funding = saved.rows.find(r => r.transaction.id === 'aggregate');
  assert.equal(funding.impact.cashExpenseCents, 10000); assert.equal(funding.impact.personalExpenseCents, 0);
  for (const row of saved.rows.filter(r => r !== funding)) { assert.equal(row.impact.cashExpenseCents, 0); assert.equal(row.impact.personalExpenseCents, row.transaction.amountCents); }
  assert.equal(O.compareMonth(state, saved.id).changed, false);
  assert.deepEqual(L.parseBackup(L.backup(state)), L.validateState(state));
});

test('organizer promotion is lazy and later operations preserve version 3', () => {
  let state = O.saveRule(composite(), { name: 'Synthetic rule', conditions: { type: 'expense' }, actions: { categoryId: 'expense-other' }, at });
  assert.equal(state.organizer.version, 2);
  state = close(state); assert.equal(state.organizer.version, 3);
  state = O.saveAlias(state, { from: 'Synthetic exact note', to: 'Synthetic merchant', at });
  assert.equal(state.organizer.version, 3);
  state = R.unlinkComposite(state, R.previewCompositeRemoval(state, state.bookkeeping.composites[0].id), { confirmed: true, reason: 'Synthetic correction' });
  state = close(state, { month: '2026-11' });
  assert.equal(state.organizer.version, 3); assert.equal(state.organizer.closes.at(-1).compositeProofs, undefined);
});

test('cross-month freezes include every full signature but recognize members on their own dates', () => {
  const state = composite(fixture(true));
  for (const month of ['2026-09', '2026-10']) {
    const closed = close(state, { month }), saved = closed.organizer.closes[0], live = R.calculate(state, month);
    assert.equal(saved.rows.length, month === '2026-09' ? 1 : 2);
    assert.equal(saved.compositeProofs[0].signatures.length, 3);
    assert.deepEqual(saved.totals.cash, live.cash); assert.deepEqual(saved.totals.personal, live.personal);
    assert.equal(saved.totals.cash.expenseCents, month === '2026-09' ? 10000 : 0);
    assert.equal(saved.totals.personal.expenseCents, month === '2026-09' ? 0 : 10000);
    assert.equal(O.compareMonth(closed, saved.id).changed, false);
    assert.deepEqual(L.parseBackup(L.backup(closed)).organizer.closes[0], saved);
  }
});

test('selected closes retain the full proof and explicitly allow partial personal or funding rows', () => {
  const state = composite();
  for (const [ids, cash, personal] of [[['aggregate'], 10000, 0], [['detail-30'], 0, 3000], [['detail-30', 'detail-70'], 0, 10000]]) {
    const selected = close(state, { transactionIds: ids }), saved = selected.organizer.closes[0];
    assert.equal(saved.selection, 'selected'); assert.equal(saved.compositeProofs[0].signatures.length, 3);
    assert.equal(saved.totals.cash.expenseCents, cash); assert.equal(saved.totals.personal.expenseCents, personal);
    assert.doesNotThrow(() => L.validateState(selected));
    assert.throws(() => L.validateState(mutateClose(selected, c => { c.selection = 'all-month'; })), error('INVALID_CLOSE'));
    assert.throws(() => L.validateState(mutateClose(selected, c => { delete c.selection; })), error('INVALID_CLOSE'));
  }
  const empty = close(state, { transactionIds: [] });
  assert.equal(empty.organizer.version, 2); assert.equal(empty.organizer.closes[0].compositeProofs, undefined);
});

test('one transaction may hold both authorities without duplicating a proof signature', () => {
  const state = close(composite(fixture(false, [tx('shared', 10000)]), { personalIds: ['shared'], fundingIds: ['shared'], grossCents: null, discountCents: null }));
  const saved = state.organizer.closes[0];
  assert.equal(saved.compositeProofs[0].signatures.length, 1); assert.equal(saved.rows.length, 1);
  assert.equal(saved.rows[0].impact.cashExpenseCents, 10000); assert.equal(saved.rows[0].impact.personalExpenseCents, 10000);
  assert.throws(() => L.validateState(mutateClose(state, c => { delete c.rows[0].compositeId; })), error('INVALID_CLOSE'));
});

test('full cross-month proof remains immutable after unlink, source edits, deletion and backup', () => {
  let state = close(composite(fixture(true)), { month: '2026-09' });
  const saved = copy(state.organizer.closes[0]), bytes = JSON.stringify(saved);
  state = R.unlinkComposite(state, R.previewCompositeRemoval(state, state.bookkeeping.composites[0].id), { confirmed: true, reason: 'Synthetic correction' });
  state = L.putTransaction(state, { ...state.transactions.find(t => t.id === 'detail-30'), amountCents: 4000, date: '2026-11-01' }, 'detail-30');
  for (const id of ['aggregate', 'detail-30', 'detail-70']) state = L.deleteTransaction(state, id);
  assert.equal(JSON.stringify(state.organizer.closes[0]), bytes);
  assert.deepEqual(L.parseBackup(L.backup(state)).organizer.closes[0], saved);
  const comparison = O.compareMonth(state, saved.id);
  assert.equal(comparison.changed, true); assert.deepEqual(comparison.frozen, saved);
  assert.equal(comparison.current.rows.length, 0); assert.equal(comparison.delta.cash.expenseCents, -10000);
});

test('personal refunds and claims conserve personal authority independently of cash authority', () => {
  let state = composite(fixture(false, [...fixture().transactions, tx('refund-receipt', 1000, '2026-11-01', 'bank', { type: 'income', categoryId: 'income-other' })]));
  state = R.allocateRefund(state, { expenseId: 'detail-30', incomeId: 'refund-receipt', amountCents: 1000, reason: 'Synthetic partial refund' });
  state = R.createClaim(state, { expenseId: 'detail-70', amountCents: 2000, kind: 'advance', name: 'Synthetic shared expense' });
  const closed = close(state), saved = closed.organizer.closes[0];
  assert.equal(saved.totals.cash.expenseCents, 10000); assert.equal(saved.totals.personal.expenseCents, 7000);
  assert.equal(saved.totals.personal.refundCents, 1000); assert.equal(saved.totals.personal.claimCents, 2000);
  assert.deepEqual(saved.totals.personal, R.calculate(state, '2026-10').personal);
  assert.deepEqual(L.parseBackup(L.backup(closed)).organizer.closes[0], saved);
});

test('corrupt row references, signatures and role impacts cannot weaken frozen invariants', () => {
  const state = close(composite());
  const changes = [
    c => { c.rows[0].compositeId = 'unknown-composite'; },
    c => { delete c.rows[0].compositeId; },
    c => { c.rows[0].transaction.amountCents++; },
    c => { c.rows[0].transaction.date = '2026-10-03'; },
    c => { c.rows[0].transaction.accountId = 'account-cash'; },
    c => { c.rows[0].impact.personalExpenseCents = 10000; },
    c => { c.rows[0].impact.cashExpenseCents = 0; },
    c => { c.rows[1].impact.cashExpenseCents = 3000; },
    c => { c.rows[1].impact.personalExpenseCents = 0; },
    c => { c.rows[0].compositeProof = copy(c.compositeProofs[0]); },
    c => { delete c.compositeProofs; },
    c => { c.compositeProofs = []; }
  ];
  for (const change of changes) assert.throws(() => L.validateState(mutateClose(state, change)));
});

test('frozen proof validation rejects arithmetic, membership, duplicate and unknown-field tampering', () => {
  const state = close(composite());
  for (const change of [
    p => { p.paidCents++; }, p => { p.grossCents++; }, p => { p.discountCents++; },
    p => { p.personalIds.push(p.personalIds[0]); }, p => { p.fundingIds = ['unknown']; },
    p => { p.signatures.pop(); }, p => { p.signatures.push(copy(p.signatures[0])); },
    p => { p.signatures[0].type = 'income'; }, p => { p.signatures[0].toAccountId = 'bank'; },
    p => { p.trusted = true; }
  ]) assert.throws(() => L.validateState(mutateClose(state, c => { change(c.compositeProofs[0]); })));
});

test('proof IDs, shared members and unused proofs are rejected independently of frozen totals', () => {
  const state = close(composite(fixture(false, [...fixture().transactions, tx('ordinary', 500)])));
  for (const change of [
    c => { c.compositeProofs.push(copy(c.compositeProofs[0])); },
    c => { const p = copy(c.compositeProofs[0]); p.id = 'other-composite'; c.compositeProofs.push(p); },
    c => { c.compositeProofs[0].id = 'ordinary'; for (const r of c.rows) if (r.compositeId) r.compositeId = 'ordinary'; },
    c => { const p = copy(c.compositeProofs[0]); p.id = 'unused-composite'; p.personalIds = ['ghost-personal']; p.fundingIds = ['ghost-funding']; p.signatures = [{ ...p.signatures[0], id: 'ghost-personal', amountCents: 10000 }, { ...p.signatures[0], id: 'ghost-funding', amountCents: 10000 }]; c.compositeProofs.push(p); }
  ]) assert.throws(() => L.validateState(mutateClose(state, change)), error('INVALID_CLOSE'));
});

test('all-month proof enforces every same-month member and all counterpart frozen accounts', () => {
  const state = close(composite(fixture(true)), { month: '2026-09' });
  assert.throws(() => L.validateState(mutateClose(state, c => { c.compositeProofs[0].signatures.find(s => s.id === 'detail-30').date = '2026-09-30'; })), error('INVALID_CLOSE'));
  assert.throws(() => L.validateState(mutateClose(state, c => { c.compositeProofs[0].signatures.find(s => s.id === 'detail-30').accountId = 'missing-account'; })), error('INVALID_CLOSE'));
});

test('current and historical composite fields require organizer 3 even when the other copy is absent', () => {
  const state = close(composite());
  for (const version of [1, 2]) {
    for (const remove of [() => {}, s => { s.organizer.closes = []; }, s => { s.organizer.audit = []; }]) {
      const bad = copy(state); bad.organizer.version = version; remove(bad);
      assert.throws(() => O.validate(bad.organizer, bad), error('INVALID_ORGANIZER_VERSION'));
    }
  }
});

test('legacy organizer migration and ordinary closes never gain new proof fields or require Relations', () => {
  const old = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/organizer-v1-close.json'), 'utf8'));
  const beforeCloses = JSON.stringify(old.organizer.closes), beforeAudit = JSON.stringify(old.organizer.audit);
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/organizer.js'), 'utf8'), { window, TextEncoder });
  const restored = window.MoneygoOrganizer.validate(old.organizer, old);
  assert.equal(restored.version, 2); assert.equal(JSON.stringify(restored.closes), beforeCloses); assert.equal(JSON.stringify(restored.audit), beforeAudit);
  const ordinary = close(fixture()); assert.equal(ordinary.organizer.version, 2);
  assert.equal(ordinary.organizer.closes[0].compositeProofs, undefined);
  assert.ok(ordinary.organizer.closes[0].rows.every(r => r.compositeId === undefined));
});

test('proof-cell caps reject close and history expansion before any proof normalization', () => {
  let calls = 0;
  const window = { MoneygoRelations: { compositeProof() { calls++; throw new Error('Proof normalization must not start'); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/organizer.js'), 'utf8'), { window, TextEncoder });
  const engine = window.MoneygoOrganizer, base = close(fixture()), proof = rawProof();
  const large = copy(base); large.organizer.version = 3;
  large.organizer.closes[0].compositeProofs = Array(6000).fill(proof);
  assert.throws(() => engine.validate(large.organizer, large), error('ORGANIZER_LIMIT')); assert.equal(calls, 0);
  const history = copy(base); history.organizer.version = 3;
  const snapshot = history.organizer.closes[0]; snapshot.compositeProofs = Array(5700).fill(proof);
  history.organizer.closes = Array(5).fill(snapshot);
  assert.throws(() => engine.validate(history.organizer, history), error('ORGANIZER_LIMIT')); assert.equal(calls, 0);
  const audit = copy(base); audit.organizer.version = 3;
  const after = audit.organizer.audit[0].changes[0].after; after.compositeProofs = Array(5700).fill(proof);
  audit.organizer.audit = Array(5).fill(audit.organizer.audit[0]);
  assert.throws(() => engine.validate(audit.organizer, audit), error('ORGANIZER_LIMIT')); assert.equal(calls, 0);
});

test('undefined new proof fields cannot be smuggled into legacy or composite formats', () => {
  for (const change of [c => { c.compositeProofs = undefined; }, c => { c.rows[0].compositeId = undefined; }]) {
    const old = mutateClose(close(fixture()), change);
    assert.throws(() => O.validate(old.organizer, old), error('INVALID_ORGANIZER_VERSION'));
    const current = mutateClose(close(composite()), change);
    assert.throws(() => O.validate(current.organizer, current));
  }
});

test('composite and paired-transfer proofs coexist but cannot share relation IDs or members', () => {
  let state = composite(fixture(false, [...fixture().transactions, tx('transfer-out', 500, '2026-10-03', 'bank'), tx('transfer-in', 500, '2026-10-03', 'account-cash', { type: 'income', categoryId: 'income-other' })]));
  state = R.pairTransfer(state, { expenseId: 'transfer-out', incomeId: 'transfer-in', reason: 'Synthetic transfer' });
  state = close(state);
  assert.equal(state.organizer.closes[0].totals.cash.expenseCents, 10000);
  assert.equal(state.organizer.closes[0].totals.cash.transferCents, 500);
  assert.doesNotThrow(() => L.validateState(state));
  assert.throws(() => L.validateState(mutateClose(state, c => {
    const pair = c.rows.find(r => r.transferPair).transferPair;
    c.compositeProofs[0].id = pair.id;
    for (const row of c.rows) if (row.compositeId) row.compositeId = pair.id;
  })), error('INVALID_CLOSE'));
});
