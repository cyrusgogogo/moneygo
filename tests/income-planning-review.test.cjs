'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const f = require('./income-planning-model-fixtures.cjs');
const { L, R, P, now, day, options, copy, tx, base, coordinator, plan, apply, pid, rid, allocate, change, seeded, linked } = f;
const exact = (value, keys) => assert.deepEqual(Object.keys(value).sort(), keys.slice().sort());
const deepFrozen = value => { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(deepFrozen); } };
function reviewShape(ticket) {
  exact(ticket, ['review']); const r = ticket.review;
  exact(r, ['version', 'command', 'options', 'confirmationStamp', 'newEvents', 'plans', 'receipts', 'sources', 'operationEligibility', 'scenarioImpacts', 'financialDeltas', 'unchangedSubtrees']);
  exact(r.confirmationStamp, ['status', 'previewAt', 'reason']); assert.equal(r.confirmationStamp.status, 'pending-confirmation'); assert.equal(r.confirmationStamp.reason, null);
  for (const e of r.newEvents) exact(e, ['id', 'revision', 'kind', 'recordId', 'action', 'reverses']);
  for (const p of r.plans) exact(p, ['planId', 'before', 'after', 'targetHeadroomBefore', 'targetHeadroomAfter']);
  for (const receipt of r.receipts) { exact(receipt, ['receipt', 'before', 'after', 'proofComparison', 'planMatchBefore', 'planMatchAfter']); exact(receipt.proofComparison, ['result', 'differentFields']); }
  for (const source of r.sources) exact(source, ['transactionId', 'currentTransaction', 'currentBasis', 'currentProof', 'ordinaryResidualCents', 'reductionComponents', 'duplicateLinks', 'before', 'after', 'applicableAllocationsBefore', 'applicableAllocationsAfter']);
  exact(r.scenarioImpacts, ['confirmedOnly', 'planned', 'conservative']);
  for (const [key, mode] of [['confirmedOnly', 'confirmed-only'], ['planned', 'planned'], ['conservative', 'conservative']]) {
    const impact = r.scenarioImpacts[key]; exact(impact, ['mode', 'before', 'after', 'rows']); assert.equal(impact.mode, mode);
    for (const side of [impact.before, impact.after]) exact(side, ['knownDatedTotalCents', 'scheduledTotalCents', 'knownTailTotalCents', 'unknownTailCount', 'blockingPlanIds', 'warnings']);
    assert.equal(impact.rows.length, 1); exact(impact.rows[0], ['planId', 'before', 'after']);
  }
  exact(r.financialDeltas, ['scope', 'ordinaryIncomeCents', 'personalExpenseCents', 'cashInCents', 'cashOutCents', 'accounts']);
  for (const key of ['ordinaryIncomeCents', 'personalExpenseCents', 'cashInCents', 'cashOutCents']) assert.equal(r.financialDeltas[key], 0);
  for (const account of r.financialDeltas.accounts) { exact(account, ['accountId', 'inflowCents', 'outflowCents', 'balanceCents']); assert.equal(account.inflowCents, 0); assert.equal(account.outflowCents, 0); assert.equal(account.balanceCents, 0); }
  assert.deepEqual(r.unchangedSubtrees, { basis: 'normalized-persisted-full-ledger', allowedChangedPaths: ['version', 'incomePlanning'], allOtherSubtreesEqual: true }); deepFrozen(ticket);
}

test('C1 create/update/retire previews have exact review shape and mandatory full before/after', () => {
  let s = base(); const c = coordinator(), ticket = c.preview(s, plan(), options); reviewShape(ticket);
  assert.equal(ticket.review.plans.length, 1); assert.equal(ticket.review.plans[0].before, null); assert.equal(ticket.review.plans[0].after.plan.basis, 'Synthetic confirmation'); assert.deepEqual(ticket.review.receipts, []); assert.deepEqual(ticket.review.sources, []); assert.equal(ticket.review.newEvents.length, 1); assert.equal(s.version, 1);
  s = c.commit(s, ticket, { confirmed: true, reason: 'Synthetic confirmation' });
  const update = c.preview(s, { action: 'update-plan', planId: pid(s), patch: { name: 'Changed', expectedDate: null } }, options); reviewShape(update); assert.equal(update.review.plans[0].before.plan.expectedDate, '2026-10-20'); assert.equal(update.review.plans[0].after.plan.expectedDate, null);
  assert.equal(c.cancel(update), true);
  const retire = c.preview(s, { action: 'retire-plan', planId: pid(s) }, options); reviewShape(retire); assert.equal(retire.review.plans[0].after, null); assert.equal(retire.review.plans[0].before.plan.basis, 'Synthetic confirmation');
});

test('C1 allocation shows raw/proof residual, every source allocation and before/after capacity', () => {
  let s = apply(base([tx('source'), tx('expense', 'expense', 100000, '2026-09-01')]), plan({ name: 'A', expectedAmountCents: 100000 })); const first = pid(s);
  s = R.allocateRefund(s, { incomeId: 'source', expenseId: 'expense', amountCents: 20000, reason: 'Synthetic refund' });
  s = R.createClaim(s, { expenseId: 'expense', amountCents: 10000, kind: 'advance', name: 'Claim', dueDate: null, status: 'submitted', note: '' });
  s = R.settleClaim(s, { incomeId: 'source', claimId: s.bookkeeping.claims[0].id, amountCents: 10000, reason: 'Synthetic settlement' });
  s = allocate(s, 40000, 'source', first); s = apply(s, plan({ name: 'B', expectedAmountCents: 50000, expectedDate: null, expectedAccountId: 'bank' })); const second = s.incomePlanning.plans.find(v => v.id !== first).id;
  const ticket = coordinator().preview(s, { action: 'allocate-receipt', planId: second, transactionId: 'source', amountCents: 30000, reference: '' }, options); reviewShape(ticket);
  const source = ticket.review.sources[0]; assert.equal(source.currentTransaction.amountCents, 100000); assert.equal(source.ordinaryResidualCents, 70000); assert.equal(source.currentProof.reductions.length, 2); assert.equal(source.before.unassociatedOrdinaryCents, 30000); assert.equal(source.after.unassociatedOrdinaryCents, 0); assert.equal(source.applicableAllocationsBefore[0].planId, first); assert.equal(source.applicableAllocationsAfter.length, 2);
  assert.equal(ticket.review.operationEligibility.maxAdditionalCents, 30000); assert.equal(ticket.review.plans[0].targetHeadroomAfter.cents, 20000);
  assert.deepEqual(ticket.review.receipts[0].planMatchAfter, { captured: { date: 'expected-unspecified', account: 'different' }, current: { date: 'expected-unspecified', account: 'different' } });
});

test('C1 update exposes all target receipts and preserves immutable capture/current comparisons', () => {
  let s = allocate(apply(base(), plan()), 40000); s = change(s, 'source', { date: '2026-10-02', accountId: 'bank' });
  const t = coordinator().preview(s, { action: 'update-plan', planId: pid(s), patch: { expectedDate: '2026-10-02', expectedAccountId: 'bank' } }, options); reviewShape(t);
  const r = t.review.receipts[0]; assert.ok(r.before && r.after); assert.equal(r.proofComparison.result, 'different'); assert.ok(r.proofComparison.differentFields.includes('source'));
  assert.deepEqual(r.planMatchAfter, { captured: { date: 'different', account: 'different' }, current: { date: 'same', account: 'same' } }); assert.equal(r.after.applicability, 'source-changed'); assert.equal(r.receipt.proof.source.accountId, 'account-cash');
});

test('C1 reverse deleted source preserves full capture and exact original create reference', () => {
  let s = allocate(apply(base(), plan()), 40000), receipt = rid(s); const create = s.incomePlanning.audit.find(e => e.kind === 'receipt' && e.action === 'create').id;
  const raw = copy(s); raw.transactions = []; s = L.validateState(raw);
  const c = coordinator(), t = c.preview(s, { action: 'reverse-receipt', receiptId: receipt }, options); reviewShape(t);
  assert.equal(t.review.receipts[0].after, null); assert.equal(t.review.receipts[0].receipt.proof.source.amountCents, 100000); assert.equal(t.review.sources[0].currentProof, null); assert.equal(t.review.sources[0].currentBasis, 'missing'); assert.equal(t.review.newEvents[0].reverses, create); assert.equal(t.review.receipts[0].planMatchBefore.current.date, 'source-unavailable');
  assert.equal(c.commit(s, t, { confirmed: true, reason: 'Synthetic reverse' }).transactions.length, 0);
});

test('C1 reconfirm has three fresh IDs, two events and immutable before/new after captures', () => {
  let s = allocate(apply(base([tx('source', 'income', 120000)]), plan()), 40000); s = change(s, 'source', { amountCents: 100000 });
  const oldAudit = JSON.stringify(s.incomePlanning.audit), oldReceipt = s.incomePlanning.receipts[0], oldCreate = s.incomePlanning.audit.find(e => e.kind === 'receipt' && e.action === 'create');
  let stamp = now; const c = P.createCoordinator({ now: () => stamp, today: () => day }); const t = c.preview(s, { action: 'reconfirm-receipt', receiptId: oldReceipt.id }, options); reviewShape(t);
  assert.equal(t.review.receipts.length, 2); assert.equal(t.review.newEvents.length, 2); const created = t.review.receipts.find(r => r.before === null); const reversed = t.review.receipts.find(r => r.after === null);
  assert.equal(reversed.receipt.id, oldReceipt.id); assert.equal(created.receipt.amountCents, oldReceipt.amountCents); assert.equal(created.receipt.reference, oldReceipt.reference); assert.equal(created.receipt.proof.ordinaryIncomeCents, 100000);
  const ids = [...t.review.newEvents.map(e => e.id), created.receipt.id]; assert.equal(new Set(ids).size, 3); assert.equal(t.review.newEvents[0].reverses, oldCreate.id); assert.equal(t.review.newEvents[1].reverses, null);
  stamp = '2026-10-14T13:00:00.000Z'; const after = c.commit(s, t, { confirmed: true, reason: 'Actual user reason' });
  assert.equal(JSON.stringify(after.incomePlanning.audit.slice(0, s.incomePlanning.audit.length)), oldAudit);
  for (const e of after.incomePlanning.audit.slice(-2)) { assert.equal(e.at, stamp); assert.equal(e.reason, 'Actual user reason'); }
  assert.equal(after.incomePlanning.receipts[0].createdAt, stamp);
});

test('all failed commit attempts consume, copies/cross-coordinator capabilities fail', () => {
  const s = base(), c = coordinator();
  const invalids = [{ confirmed: false, reason: 'No' }, { confirmed: true, reason: '' }, { confirmed: true, reason: 'ok', extra: true }, null];
  for (const confirmation of invalids) { const t = c.preview(s, plan(), options); assert.throws(() => c.commit(s, t, confirmation)); assert.throws(() => c.commit(s, t, { confirmed: true, reason: 'retry' })); }
  const t = c.preview(s, plan(), options); assert.throws(() => c.commit(s, copy(t), { confirmed: true, reason: 'copy' })); assert.throws(() => coordinator().commit(s, t, { confirmed: true, reason: 'foreign' })); assert.ok(c.commit(s, t, { confirmed: true, reason: 'original still valid' })); assert.equal(c.cancel(t), false);
});

test('cancel/invalidateAll and malformed-state failed commits consume exact ticket', () => {
  const s = base(), c = coordinator(); let t = c.preview(s, plan(), options); assert.equal(c.cancel(t), true); assert.equal(c.cancel(t), false); assert.throws(() => c.commit(s, t, { confirmed: true, reason: 'cancelled' }));
  t = c.preview(s, plan(), options); c.invalidateAll(); assert.equal(c.cancel(t), false); assert.throws(() => c.commit(s, t, { confirmed: true, reason: 'invalidated' }));
  t = c.preview(s, plan(), options); const broken = copy(s); broken.currency = 'USD'; assert.throws(() => c.commit(broken, t, { confirmed: true, reason: 'bad state' })); assert.throws(() => c.commit(s, t, { confirmed: true, reason: 'retry' }));
});

test('full normalized note/history binding and exact masks do not excuse old fields', () => {
  const s = seeded({ receipt: 'applicable' }), c = coordinator();
  const mutation = [raw => { raw.transactions[0].note = 'Changed note'; }, raw => { raw.incomePlanning.audit[0].reason = 'Changed historical reason'; }, raw => { raw.incomePlanning.audit[0].at = '2026-10-13T12:00:00.000Z'; raw.incomePlanning.audit[0].after.createdAt = raw.incomePlanning.audit[0].at; raw.incomePlanning.plans[0].createdAt = raw.incomePlanning.audit[0].at; }];
  for (const change of mutation) { const t = c.preview(s, { action: 'update-plan', planId: pid(s), patch: { name: 'new' } }, options), other = copy(s); change(other); assert.throws(() => c.commit(other, t, { confirmed: true, reason: 'new reason' })); }
});

test('midnight later allows same explicit cutoff; rollback denies and consumes', () => {
  let today = day, stamp = now; const c = P.createCoordinator({ now: () => stamp, today: () => today }), s = base();
  let t = c.preview(s, plan(), options); today = '2026-10-15'; stamp = '2026-10-15T00:00:01.000Z'; assert.ok(c.commit(s, t, { confirmed: true, reason: 'Same review' }));
  t = c.preview(s, plan(), options); today = '2026-10-13'; assert.throws(() => c.commit(s, t, { confirmed: true, reason: 'Clock rolled back' })); today = day; assert.throws(() => c.commit(s, t, { confirmed: true, reason: 'Retry' }));
});

test('every public state entry preflights getters/toJSON/hidden/symbol/sparse/cyclic/custom prototype', () => {
  let invoked = 0; const entries = [s => P.view(s, { asOfDate: day }), s => P.project(s, options), s => P.eligibility(s, { action: 'allocate-receipt', planId: 'missing', transactionId: 'source', asOfDate: day }), s => coordinator().preview(s, plan(), options), s => coordinator().commit(s, {}, { confirmed: true, reason: 'test' })];
  const variants = [s => Object.defineProperty(s, 'trap', { enumerable: true, get() { invoked++; return null; } }), s => { s.toJSON = () => { invoked++; return {}; }; return s; }, s => Object.defineProperty(s, 'hidden', { value: 1 }), s => { s[Symbol('hidden')] = 1; return s; }, s => { s.transactions = new Array(1); return s; }, s => { s.loop = s; return s; }, s => Object.setPrototypeOf(s, { inherited: 1 })];
  for (const run of entries) for (const bad of variants) assert.throws(() => run(bad(base())));
  assert.equal(invoked, 0);
});

test('commands/options/confirmation cannot execute getters or admit unknown fields', () => {
  const s = base(), c = coordinator(); let invoked = 0;
  const cmd = {}; Object.defineProperty(cmd, 'action', { enumerable: true, get() { invoked++; return 'create-plan'; } }); assert.throws(() => c.preview(s, cmd, options));
  for (const bad of [{ ...options, now }, { asOfDate: day, horizonEnd: options.horizonEnd }, { ...options, mode: 'cash' }]) assert.throws(() => c.preview(s, plan(), bad));
  const t = c.preview(s, plan(), options), confirm = { reason: 'test' }; Object.defineProperty(confirm, 'confirmed', { enumerable: true, get() { invoked++; return true; } }); assert.throws(() => c.commit(s, t, confirm)); assert.equal(invoked, 0);
  assert.throws(() => P.createCoordinator(Object.assign(Object.create({ inherited: true }), { now: () => now, today: () => day })));
});

test('read APIs require full valid old and planning state; no damaged-ledger downgrade', () => {
  const s = seeded({ receipt: 'applicable' }); for (const damage of [raw => { raw.incomePlanning.receipts = []; }, raw => { raw.incomePlanning.receipts[0].proof.version = 2; }, raw => { raw.transactions[0].amountCents = 0; }, raw => { raw.version = 6; }]) { const raw = copy(s); damage(raw); assert.throws(() => P.view(raw, { asOfDate: day })); }
});

function instrument() {
  const counts = { ledger: 0, relations: 0, indexes: 0, probes: 0, currentKeys: 0 };
  let source = fs.readFileSync(require.resolve('../dist/income-planning'), 'utf8');
  source = source.replace('const components = new Map();', 'counts.indexes++; const components = new Map();');
  source = source.replace('const tx = transactions.get(key), part', 'counts.probes++; const tx = transactions.get(key), part');
  source = source.replace('p.key = core().basisKey(p.proof)', 'counts.currentKeys++; p.key = core().basisKey(p.proof)');
  const ledgerModule = { exports: {} };
  const countedRelations = { ...R, calculate(...args) { counts.relations++; return R.calculate(...args); } };
  const load = name => name === './relations.js' ? countedRelations : require('../dist/' + name.replace('./', ''));
  const ledgerSource = fs.readFileSync(require.resolve('../dist/ledger'), 'utf8').replace('function validateState(input) {', 'function validateState(input) { counts.ledger++;');
  new Function('require', 'counts', 'module', ledgerSource)(load, counts, ledgerModule);
  const result = { exports: {} };
  new Function('require', 'counts', 'module', source)(name => { const mod = load(name); if (name === './ledger.js') return ledgerModule.exports; return mod; }, counts, result);
  return { api: result.exports, counts };
}

test('constant full-model work and one source probe/key at1 versus100 receipt rows', () => {
  const observations = [];
  for (const n of [1, 100]) {
    const { api, counts } = instrument(), s = seeded({ receipt: 'applicable', count: n }); api.view(s, { asOfDate: day });
    assert.deepEqual(counts, { ledger: 1, relations: 1, indexes: 1, probes: 1, currentKeys: 1 });
    Object.keys(counts).forEach(k => counts[k] = 0); const c = api.createCoordinator({ now: () => now, today: () => day });
    const start = performance.now(), t = c.preview(s, { action: 'update-plan', planId: pid(s), patch: { note: 'Count test' } }, options);
    observations.push({ receipts: n, elapsedMs: Math.round((performance.now() - start) * 100) / 100, ...counts });
    assert.deepEqual(counts, { ledger: 3, relations: 2, indexes: 2, probes: 2, currentKeys: 2 });
    Object.keys(counts).forEach(k => counts[k] = 0); c.commit(s, t, { confirmed: true, reason: 'Count test' }); assert.deepEqual(counts, { ledger: 3, relations: 2, indexes: 2, probes: 2, currentKeys: 2 });
  }
  console.log('Income coordinator counters (includes collector full validation):', JSON.stringify(observations));
});

test('private fault injection: every gross financial component and unchanged subtree is independently checked', () => {
  const s = base();
  const mutations = [r => { r.personal.incomeCents++; r.personal.expenseCents++; }, r => { r.cash.incomeCents++; r.cash.expenseCents++; }, r => { r.accountBalances['account-cash']++; }, r => { r.drilldown.accountFlows[0].movements.push({ accountId: 'account-cash', signedCents: 1 }, { accountId: 'account-cash', signedCents: -1 }); }];
  for (const mutate of mutations) {
    let calls = 0; const mod = { exports: {} };
    new Function('module', 'require', fs.readFileSync(require.resolve('../dist/income-planning'), 'utf8'))(mod, name => { const actual = require('../dist/' + name.replace('./', '')); return name === './relations.js' ? { ...actual, calculate(state) { const r = actual.calculate(state); if (++calls === 2) mutate(r); return r; } } : actual; });
    const c = mod.exports.createCoordinator({ now: () => now, today: () => day }); assert.throws(() => c.preview(s, plan(), options), e => e.code === 'INCOME_FINANCIAL_MUTATION');
  }
  let calls = 0; const mod = { exports: {} };
  new Function('module', 'require', fs.readFileSync(require.resolve('../dist/income-planning'), 'utf8'))(mod, name => { const actual = require('../dist/' + name.replace('./', '')); return name === './ledger.js' ? { ...actual, validateState(state) { const r = actual.validateState(state); if (++calls === 2) r.transactions[0].note = 'Injected unrelated mutation'; return r; } } : actual; });
  assert.throws(() => mod.exports.createCoordinator({ now: () => now, today: () => day }).preview(s, plan(), options), e => e.code === 'INCOME_FINANCIAL_MUTATION'); assert.equal(s.transactions[0].note, '');
});


test('full-model counters also include Relations.calculate inside full Ledger validation', () => {
  for (const count of [1, 100]) {
    const s = linked(3, seeded({ receipt: 'applicable', count })), { api, counts } = instrument();
    api.view(s, { asOfDate: day }); assert.deepEqual(counts, { ledger: 1, relations: 2, indexes: 1, probes: 4, currentKeys: 1 });
    Object.keys(counts).forEach(k => counts[k] = 0); const c = api.createCoordinator({ now: () => now, today: () => day }), ticket = c.preview(s, { action: 'update-plan', planId: pid(s), patch: { note: 'Complete financial counter' } }, options);
    assert.deepEqual(counts, { ledger: 3, relations: 5, indexes: 2, probes: 8, currentKeys: 2 });
    Object.keys(counts).forEach(k => counts[k] = 0); c.commit(s, ticket, { confirmed: true, reason: 'Complete financial counter' });
    assert.deepEqual(counts, { ledger: 3, relations: 5, indexes: 2, probes: 8, currentKeys: 2 });
  }
});
