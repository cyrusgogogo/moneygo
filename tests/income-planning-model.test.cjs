'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const f = require('./income-planning-model-fixtures.cjs');
const { L, R, P, day, options, copy, tx, base, coordinator, plan, apply, pid, rid, allocate, change, seeded, linked } = f;
const view = state => P.view(state, { asOfDate: day });
const row = state => view(state).plans[0];
const error = code => e => e.code === code;

test('public module is a five-function detached frozen boundary', () => {
  assert.deepEqual(Object.keys(P).sort(), ['createCoordinator', 'eligibility', 'project', 'validateExtension', 'view']);
  const s = base(), initial = JSON.stringify(s), v = view(s);
  assert.equal(s.version, 1); assert.equal(JSON.stringify(s), initial); assert.ok(!Object.isFrozen(s));
  assert.ok(Object.isFrozen(v) && Object.isFrozen(v.sources[0].currentTransaction));
});

test('C2 complete source membership, economic cutoff, missing and changed-type zero/null', () => {
  let s = base([tx('source'), tx('future', 'income', 20000, '2026-10-15')]);
  assert.deepEqual(view(s).sources.map(v => [v.transactionId, v.ordinaryIncomeCents, v.applicableAttributedCents, v.unassociatedOrdinaryCents]), [['future', 0, 0, 0], ['source', 100000, 0, 100000]]);
  s = allocate(apply(s, plan()), 40000);
  const changed = change(s, 'source', { type: 'expense', categoryId: 'expense-other' });
  const cv = view(changed); assert.equal(cv.receipts[0].applicability, 'source-changed'); assert.equal(cv.receipts[0].currentOrdinaryIncomeCents, 0); assert.equal(cv.sources[1].currentTransaction.type, 'expense'); assert.equal(cv.plans[0].receivedCents, null);
  const gone = copy(s); gone.transactions = gone.transactions.filter(v => v.id !== 'source'); const g = L.validateState(gone);
  assert.deepEqual([view(g).sources[1].ordinaryIncomeCents, view(g).sources[1].applicableAttributedCents, view(g).sources[1].unassociatedOrdinaryCents], [null, null, null]);
  const reversed = apply(g, { action: 'reverse-receipt', receiptId: rid(g) }); assert.deepEqual(view(reversed).sources.map(v => v.transactionId), ['future']);
});

test('fixed T01 scenarios and real financial 0 changes with two plans', () => {
  let s = apply(base(), plan({ certainty: 'expectation', expectedAmountCents: 100000 })); s = apply(s, plan({ name: 'Confirmed', expectedAmountCents: 300000 }));
  assert.deepEqual(['confirmed-only', 'planned', 'conservative'].map(mode => P.project(s, { ...options, mode }).scheduledTotalCents), [300000, 400000, 0]);
  assert.equal(R.calculate(s).personal.incomeCents, 100000); assert.equal(s.transactions.length, 1);
});

test('fixed T02 partial then complete, no raw income creation or deduction', () => {
  let s = apply(base([tx('a', 'income', 40000), tx('b', 'income', 60000)]), plan());
  s = allocate(s, 40000, 'a'); assert.deepEqual([row(s).receivedCents, row(s).remainingCents, row(s).progress], [40000, 60000, 'partial']);
  s = allocate(s, 60000, 'b'); assert.deepEqual([row(s).receivedCents, row(s).remainingCents, row(s).progress], [100000, 0, 'complete']);
  assert.equal(R.calculate(s).personal.incomeCents, 100000); assert.throws(() => allocate(s, 1, 'a'));
});

test('R01 same Plan source120000→100000 repairs40000 then60000 despite remaining stale', () => {
  let s = allocate(allocate(apply(base([tx('source', 'income', 120000)]), plan()), 40000), 60000);
  s = change(s, 'source', { amountCents: 100000 }); const ids = s.incomePlanning.receipts.map(r => r.id);
  assert.deepEqual([row(s).receivedCents, row(s).remainingCents], [null, null]);
  s = apply(s, { action: 'reconfirm-receipt', receiptId: ids[0] });
  assert.deepEqual([row(s).knownApplicableCents, row(s).unresolvedCapturedCents, row(s).receivedCents, row(s).remainingCents], [40000, 60000, null, null]);
  s = apply(s, { action: 'reconfirm-receipt', receiptId: ids[1] });
  assert.deepEqual([row(s).receivedCents, row(s).remainingCents], [100000, 0]); assert.equal(R.calculate(s).personal.incomeCents, 100000);
});

test('R02 source90000 keeps60000 unchanged until explicit reverse and allocation50000', () => {
  let s = allocate(allocate(apply(base([tx('source', 'income', 120000)]), plan()), 40000), 60000);
  s = change(s, 'source', { amountCents: 90000 }); const ids = s.incomePlanning.receipts.map(r => r.id);
  s = apply(s, { action: 'reconfirm-receipt', receiptId: ids[0] });
  const eligibility = P.eligibility(s, { action: 'reconfirm-receipt', receiptId: ids[1], asOfDate: day });
  assert.equal(eligibility.sourceCapacityCents, 50000); assert.equal(eligibility.amountToReconfirmCents, 60000); assert.equal(eligibility.maxAdditionalCents, null);
  const previous = JSON.stringify(s); assert.throws(() => apply(s, { action: 'reconfirm-receipt', receiptId: ids[1] })); assert.equal(JSON.stringify(s), previous);
  s = apply(s, { action: 'reverse-receipt', receiptId: ids[1] }); s = allocate(s, 50000);
  assert.deepEqual([row(s).receivedCents, row(s).remainingCents], [90000, 10000]);
});

test('cancelled repair is allowed but new allocation requires explicit reopen', () => {
  let s = allocate(apply(base(), plan()), 40000), receipt = rid(s);
  s = change(s, 'source', { amountCents: 90000 }); s = apply(s, { action: 'update-plan', planId: pid(s), patch: { status: 'cancelled' } });
  assert.equal(P.project(s, options).scheduledTotalCents, 0); s = apply(s, { action: 'reconfirm-receipt', receiptId: receipt });
  assert.throws(() => allocate(s, 10000), error('plan-cancelled'));
  s = apply(s, { action: 'update-plan', planId: pid(s), patch: { status: 'open' } }); s = allocate(s, 10000); assert.equal(row(s).receivedCents, 50000);
});

test('unknown target and account remain explicit, account removal adds warning only', () => {
  let s = allocate(apply(base(), plan({ expectedAmountCents: null, expectedDate: null, expectedAccountId: 'bank' })), 10000);
  assert.deepEqual([row(s).receivedCents, row(s).remainingCents, row(s).progress], [10000, null, 'target-unknown']);
  s = L.removeAccount(s, 'bank'); assert.equal(row(s).expectedAccountStatus, 'missing'); assert.equal(row(s).receivedCents, 10000);
  s = apply(s, { action: 'update-plan', planId: pid(s), patch: { name: 'Still valid' } }); assert.equal(row(s).plan.expectedAccountId, 'bank');
  assert.throws(() => apply(s, plan({ expectedAccountId: 'bank' })));
});

test('target change blocked by unresolved; unchanged target may accompany metadata edits', () => {
  const s = seeded({ receipt: 'stale' }); assert.throws(() => apply(s, { action: 'update-plan', planId: pid(s), patch: { expectedAmountCents: null } }), error('plan-unresolved'));
  const t = apply(s, { action: 'update-plan', planId: pid(s), patch: { expectedAmountCents: 100000, name: 'Changed name' } }); assert.equal(row(t).receivedCents, null);
  assert.throws(() => allocate(s, 1), error('plan-unresolved'));
});

test('mixed refund20000+settlement10000 yields authoritative70000, then60000 stale', () => {
  let s = base([tx('source'), tx('expense', 'expense', 100000, '2026-09-01')]);
  s = R.allocateRefund(s, { incomeId: 'source', expenseId: 'expense', amountCents: 20000, reason: 'Synthetic refund' });
  s = R.createClaim(s, { expenseId: 'expense', amountCents: 20000, kind: 'advance', name: 'Synthetic claim', dueDate: null, status: 'submitted', note: '' });
  s = R.settleClaim(s, { incomeId: 'source', claimId: s.bookkeeping.claims[0].id, amountCents: 10000, reason: 'Synthetic settlement' });
  s = allocate(apply(s, plan()), 70000); const proof = s.incomePlanning.receipts[0].proof;
  assert.equal(proof.source.amountCents, 100000); assert.equal(proof.ordinaryIncomeCents, 70000); assert.deepEqual(proof.reductions.map(r => r.amountCents).sort((a,b)=>a-b), [10000, 20000]);
  s = R.allocateRefund(s, { incomeId: 'source', expenseId: 'expense', amountCents: 10000, reason: 'Another valid refund' });
  assert.equal(R.calculate(s).impacts.source.ordinaryIncomeCents, 60000); assert.equal(row(s).receivedCents, null); assert.equal(view(s).receipts[0].applicability, 'role-changed');
});

test('duplicate primary permits different shadow date, shadow and transfer are zero', () => {
  let s = linked(1); s.transactions.push(tx('transfer', 'transfer', 10000)); s = L.validateState(s);
  const v = view(s); assert.equal(v.sources.find(x => x.transactionId === 'shadow-0').ordinaryIncomeCents, 0);
  s = allocate(apply(s, plan()), 40000); assert.equal(s.incomePlanning.receipts[0].proof.duplicateEvidence[0].shadowSignature.date, '2026-10-20');
  assert.equal(P.eligibility(s, { action: 'allocate-receipt', planId: pid(s), transactionId: 'transfer', asOfDate: day }).sourceCapacityCents, 0);
});

test('current200→201 proof-limit leaves lawful finances and unknown attribution, reverse remains possible', () => {
  let s = allocate(apply(linked(200), plan()), 40000); assert.equal(s.incomePlanning.receipts[0].proof.duplicateEvidence.length, 200);
  s = linked(201, s); const v = view(s), source = v.sources.find(r => r.transactionId === 'source');
  assert.equal(source.ordinaryIncomeCents, 100000); assert.equal(source.unassociatedOrdinaryCents, null); assert.equal(source.basisStatus, 'unsupported'); assert.equal(v.receipts[0].applicability, 'unsupported-basis');
  assert.equal(v.plans[0].receivedCents, null); assert.equal(R.calculate(s).personal.incomeCents, 100000);
  assert.throws(() => apply(s, { action: 'reconfirm-receipt', receiptId: rid(s) }));
  const c = coordinator(), ticket = c.preview(s, { action: 'reverse-receipt', receiptId: rid(s) }, options);
  assert.equal(ticket.review.sources[0].duplicateLinks.length, 201); assert.equal(ticket.review.sources[0].currentProof, null); assert.equal(ticket.review.sources[0].currentBasis, 'proof-limit');
  const after = c.commit(s, ticket, { confirmed: true, reason: 'Synthetic reverse' }); assert.equal(after.incomePlanning.receipts.length, 0);
});

test('current key restoration matches old group; source capacity remains strict', () => {
  let s = allocate(apply(base(), plan()), 60000); const original = copy(s); s = change(s, 'source', { amountCents: 90000 });
  assert.equal(row(s).receivedCents, null); s = change(s, 'source', { amountCents: 100000 }); assert.equal(row(s).receivedCents, 60000);
  assert.deepEqual(view(s), view(original)); assert.throws(() => apply(s, { action: 'reconfirm-receipt', receiptId: rid(s) }), error('reconfirm-unnecessary'));
});

test('not-found query has exact null shape before guessing source capacity', () => {
  const s = base(); for (const query of [{ action: 'allocate-receipt', planId: 'missing', transactionId: 'source', asOfDate: day }, { action: 'reconfirm-receipt', receiptId: 'missing', asOfDate: day }]) {
    const e = P.eligibility(s, query); assert.equal(e.eligible, false); assert.deepEqual(e.planTargetCapacity, { kind: 'unresolved', cents: null }); assert.equal(e.sourceCapacityCents, null); assert.equal(e.maxAdditionalCents, null); assert.equal(e.amountToReconfirmCents, null);
  }
});

for (const mode of ['confirmed-only', 'planned', 'conservative']) for (const status of ['open', 'cancelled']) for (const certainty of ['confirmed-plan', 'expectation']) for (const target of [100000, null]) for (const expectedDate of [null, day, '2026-10-20', '2027-01-31', '2027-02-01']) for (const receipt of ['applicable', 'stale', 'future']) {
  test(`matrix ${mode}/${status}/${certainty}/${target}/${expectedDate}/${receipt}`, () => {
    const s = seeded({ expectedAmountCents: target, expectedDate, status, certainty, receipt });
    const v = P.project(s, { ...options, mode }), r = v.rows[0], unresolved = receipt !== 'applicable';
    const excluded = status === 'cancelled' ? 'cancelled' : mode === 'confirmed-only' && certainty === 'expectation' ? 'expectation' : mode === 'conservative' ? 'conservative-assumption' : null;
    const dateState = expectedDate === null ? 'undated' : expectedDate <= day ? 'due' : expectedDate > options.horizonEnd ? 'tail' : 'in-window';
    const bucket = excluded ? 'excluded' : dateState === 'tail' ? 'tail' : unresolved ? 'blocked' : dateState === 'undated' ? 'undated' : dateState === 'due' ? 'overdue' : 'dated';
    const remaining = unresolved || target === null ? null : 50000;
    const contribution = excluded ? 0 : bucket === 'blocked' ? null : remaining;
    const window = excluded || bucket === 'tail' ? 0 : bucket === 'dated' ? contribution : null;
    assert.equal(r.dateState, dateState); assert.equal(r.bucket, bucket); assert.equal(r.exclusionReason, excluded); assert.equal(r.contributionCents, contribution); assert.equal(r.windowContributionCents, window); assert.equal(r.blocksWindowTotal, window === null); assert.equal(v.scheduledTotalCents, window);
    assert.deepEqual(r.planView, view(s).plans[0]); assert.equal(r.receivedCents, unresolved ? null : 50000);
  });
}

test('complete known Plan excluded even undated; unknown zero-receipt is not complete', () => {
  assert.equal(P.project(seeded({ receipt: 'complete', expectedDate: null }), options).rows[0].exclusionReason, 'fulfilled');
  const s = seeded({ expectedAmountCents: null, receipt: 'none' }); assert.equal(row(s).receivedCents, 0); assert.equal(row(s).progress, 'target-unknown');
});

test('economic cutoff uses source date independently of review/audit dates', () => {
  const s = seeded({ receipt: 'applicable' }); assert.equal(P.view(s, { asOfDate: '2026-10-10' }).plans[0].receivedCents, 50000);
  assert.equal(P.view(s, { asOfDate: '2026-09-30' }).receipts[0].applicability, 'future-at-cutoff');
  for (const opt of [{ ...options, horizonEnd: day }, { ...options, mode: 'other' }, { ...options, asOfDate: '2026-02-29' }, { ...options, asOfDate: '0000-01-01' }]) assert.throws(() => P.project(s, opt));
});

test('held-return authoritative residual excludes principal without lifetime income exclusion', () => {
  const h = require('./held-b-fixture.cjs'); let s = h.fund(); s = h.apply(s, h.returned(h.pid(s)));
  assert.equal(R.calculate(s).impacts.receipt.ordinaryIncomeCents, 2000);
  s = allocate(apply(s, plan({ expectedAmountCents: 2000 })), 2000, 'receipt'); const proof = s.incomePlanning.receipts[0].proof;
  assert.equal(proof.ordinaryIncomeCents, 2000); assert.equal(proof.source.amountCents, 5000); assert.equal(proof.reductions[0].kind, 'held-return'); assert.equal(proof.reductions[0].amountCents, 3000); assert.equal(row(s).progress, 'complete');
});

test('paired incoming and native transfer are known zero and remain ineligible', () => {
  let s = base([tx('outgoing', 'expense', 10000, '2026-10-01'), tx('incoming', 'income', 10000, '2026-10-02', 'bank'), tx('move', 'transfer', 10000)]);
  s = R.pairTransfer(s, { expenseId: 'outgoing', incomeId: 'incoming', reason: 'Synthetic own transfer' }); s = apply(s, plan());
  assert.equal(view(s).sources.find(r => r.transactionId === 'incoming').ordinaryIncomeCents, 0);
  for (const transactionId of ['incoming', 'move']) { const e = P.eligibility(s, { action: 'allocate-receipt', planId: pid(s), transactionId, asOfDate: day }); assert.equal(e.eligible, false); assert.equal(e.sourceCapacityCents, 0); assert.ok(e.reasonCodes.includes('source-ineligible')); }
});

test('input order and unrelated sources do not change source applicability or sorted members', () => {
  let s = allocate(apply(linked(3), plan()), 40000); const v = view(s), raw = copy(s);
  raw.transactions.reverse(); raw.bookkeeping.links.reverse(); raw.incomePlanning.receipts.reverse();
  assert.deepEqual(view(raw), v); raw.transactions.push(tx('unrelated', 'income', 1234, '2026-10-01'));
  const extra = view(raw); assert.deepEqual(extra.receipts, v.receipts); assert.deepEqual(extra.plans, v.plans); assert.deepEqual(extra.sources.filter(r => r.transactionId !== 'unrelated'), v.sources);
});

test('sources crossing cutoff keep proof status but zero all three current amounts', () => {
  const s = linked(201); const past = P.view(s, { asOfDate: '2026-09-30' }); const source = past.sources.find(r => r.transactionId === 'source');
  assert.equal(source.basisStatus, 'unsupported'); assert.ok(source.reasonCodes.includes('proof-limit')); assert.deepEqual([source.ordinaryIncomeCents, source.applicableAttributedCents, source.unassociatedOrdinaryCents], [0, 0, 0]);
});

test('source-only amount/date/account changes do not claim an ordinary role/composition change', () => {
  const original = allocate(apply(base(), plan()), 40000);
  for (const patch of [{ amountCents: 120000 }, { date: '2026-10-02' }, { accountId: 'bank' }]) {
    const s = change(original, 'source', patch), v = view(s), receipt = v.receipts[0];
    assert.equal(receipt.applicability, 'source-changed'); assert.deepEqual(receipt.reasonCodes, ['source-changed']); assert.deepEqual(v.plans[0].warnings, ['source-changed']); assert.equal(v.plans[0].receivedCents, null);
  }
  const mixed = copy(original); mixed.transactions.push(tx('expense', 'expense', 20000, '2026-09-01'));
  const changed = R.allocateRefund(L.validateState(mixed), { incomeId: 'source', expenseId: 'expense', amountCents: 10000, reason: 'Actual component change' });
  assert.equal(view(changed).receipts[0].applicability, 'role-changed'); assert.deepEqual(view(changed).receipts[0].reasonCodes, ['role-changed']);
});
