'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const Core = require('../dist/income-core.js');
const F = require('./income-core-fixtures.cjs');
const check = value => Core.validateExtension(value);
const bad = (value, code) => assert.throws(() => check(value), error => error instanceof Core.IncomeCoreError && (!code || error.code === code));
function full() { return F.builder().createPlan().createReceipt().finish(); }
function allFrozen(value) { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(allFrozen); } }
function rewriteAll(value, mutate) {
  for (const row of [value, ...(value.audit || []).flatMap(e => [e.before, e.after])].filter(Boolean)) mutate(row);
}

test('income core exports only the bounded pure API', () => {
  assert.deepEqual(Object.keys(Core).sort(), ['validateExtension','normalizeProof','basisKey','normalizePlan','normalizeReason','inspectData','canonicalData','metricsOf','LIMITS','IncomeCoreError'].sort());
  assert.ok(Object.isFrozen(Core)); assert.ok(Object.isFrozen(Core.LIMITS));
});
test('empty extension exact round trip, detached data and immutable observations', () => {
  const input = F.builder().finish(), result = check(input);
  assert.deepEqual(result, input); assert.notEqual(result, input); allFrozen(result);
  assert.ok(!Object.isFrozen(input)); allFrozen(Core.metricsOf(result));
  assert.throws(() => Core.metricsOf(F.clone(result)), { code: 'INVALID_INCOME_EXTENSION' });
  assert.equal(Core.metricsOf(result).proofCells, 0); assert.equal(Core.metricsOf(result).journalEvents, 0);
});
test('create, partial receipt, update, cancel, reverse and retire preserve exact history', () => {
  const input = F.builder().createPlan().createReceipt().updatePlan('plan-1', { name: 'New name', status: 'cancelled' })
    .reverseReceipt('receipt-1').retirePlan('plan-1').finish();
  const result = check(input), m = Core.metricsOf(result);
  assert.deepEqual(result, input); assert.deepEqual(result.plans, []); assert.deepEqual(result.receipts, []);
  assert.equal(m.retiredPlans, 1); assert.equal(m.reversedReceipts, 1); assert.equal(m.auditOperations, 5);
  assert.equal(m.proofOccurrences, 2); assert.equal(m.proofCells, 2); assert.equal(m.journalEvents, 5);
  allFrozen(result); result.audit[1].after.proof.source.amountCents;
  input.audit[1].after.proof.source.amountCents = 3;
  assert.equal(result.audit[1].after.proof.source.amountCents, 100000);
});
test('known targets, null targets, cancelled plans and missing foreign IDs are locally valid', () => {
  for (const target of [null, 10000]) {
    const input = F.builder().createPlan(F.plan({ expectedAmountCents: target, expectedDate: null, expectedAccountId: 'missing-account', status: 'cancelled' })).createReceipt().finish();
    assert.equal(check(input).plans[0].expectedAmountCents, target);
  }
  const ownAndForeignSame = F.builder().createPlan(F.plan({ id: 'account-1' })).finish();
  assert.equal(check(ownAndForeignSame).plans[0].id, 'account-1', 'global ownership belongs to Ledger, not this kernel');
});
test('normalization preserves free text but trims name and reason only', () => {
  const p = Core.normalizePlan(F.plan({ name: '  薪水  ', basis: '  agreement\n', note: '\tfirst\r\nsecond ' }));
  assert.equal(p.name, '薪水'); assert.equal(p.basis, '  agreement\n'); assert.equal(p.note, '\tfirst\r\nsecond ');
  assert.equal(Core.normalizeReason(' \n review\t '), 'review');
  assert.throws(() => Core.normalizeReason(' '));
  assert.throws(() => Core.normalizePlan(F.plan({ certainty: 'confirmed-plan', basis: ' \t' })));
  assert.equal(Core.normalizePlan(F.plan({ certainty: 'expectation', basis: '' })).basis, '');
});
test('current rows use UTF-16 code-unit ID sorting, not locale sorting; audit remains ordered', () => {
  const input = F.builder().createPlan(F.plan({ id: 'z' })).createPlan(F.plan({ id: 'Z' })).createPlan(F.plan({ id: 'a' })).finish();
  input.audit[1].at = input.audit[1].after.createdAt = '0001-01-01T00:00:00.000Z';
  input.plans[1].createdAt = input.audit[1].at;
  const result = check(input);
  assert.deepEqual(result.plans.map(p => p.id), ['Z', 'a', 'z']);
  assert.deepEqual(result.audit.map(a => a.recordId), ['z', 'Z', 'a']);
});
test('proof canonical equality removes property and relationship order, not economic facts', () => {
  const original = F.reductionProof(3), input = F.clone(original);
  input.reductions.reverse(); input.source = Object.fromEntries(Object.entries(input.source).reverse());
  assert.equal(Core.basisKey(input), Core.basisKey(original));
  assert.deepEqual(Core.normalizeProof(input).reductions.map(r => r.id), ['reduction-0', 'reduction-1', 'reduction-2']);
  input.reductions[0].kind = 'settlement'; assert.notEqual(Core.basisKey(input), Core.basisKey(original));
});
test('duplicate shadow dates may differ and may exceed receipt review cutoff', () => {
  const p = F.duplicateProof(2, { shadowDate: '2027-02-01' });
  const ext = F.builder().createPlan().createReceipt(F.receipt({ proof: p })).finish();
  assert.equal(check(ext).receipts[0].proof.duplicateEvidence[0].shadowSignature.date, '2027-02-01');
});
for (const kind of ['refund', 'settlement', 'held-return']) {
  test('proof arithmetic accepts positive residual for ' + kind, () => {
    const p = F.reductionProof(2, { kind });
    assert.equal(Core.normalizeProof(p).ordinaryIncomeCents, 99998);
  });
}
test('mixed refund and settlement residual has exact 70000 cents', () => {
  const p = F.reductionProof(2); p.reductions[0].amountCents = 20000; p.reductions[1].amountCents = 10000;
  p.reductions[1].kind = 'settlement'; p.ordinaryIncomeCents = 70000;
  assert.equal(Core.normalizeProof(p).ordinaryIncomeCents, 70000);
});
const proofMutations = {
  'bad version': p => { p.version = 2; }, 'bad role': p => { p.role = 'shadow'; },
  'zero residual': p => { p.ordinaryIncomeCents = 0; }, 'inconsistent residual': p => { p.ordinaryIncomeCents++; },
  'source transfer': p => { p.source.type = 'transfer'; }, 'source destination': p => { p.source.toAccountId = 'other'; },
  'duplicate reduction identity': p => { p.reductions[1].id = p.reductions[0].id; },
  'relationship source collision': p => { p.reductions[0].id = p.source.id; },
  'different reduction source': p => { p.reductions[0].incomeSignature.id = 'other'; },
  'different reduction date': p => { p.reductions[0].incomeSignature.date = '2026-10-02'; },
  'held plus refund': p => { p.reductions[0].kind = 'held-return'; }
};
for (const [name, mutate] of Object.entries(proofMutations)) test('invalid proof rejects: ' + name, () => {
  const p = F.reductionProof(2); mutate(p); assert.throws(() => Core.normalizeProof(p), Core.IncomeCoreError);
});
for (const [name, mutate] of Object.entries({
  'duplicate shadow': p => { p.duplicateEvidence[1].shadowId = p.duplicateEvidence[0].shadowId; p.duplicateEvidence[1].shadowSignature.id = p.duplicateEvidence[0].shadowId; },
  'shadow is primary': p => { p.duplicateEvidence[0].shadowId = p.source.id; p.duplicateEvidence[0].shadowSignature.id = p.source.id; },
  'primary differs': p => { p.duplicateEvidence[0].primarySignature.date = '2026-10-02'; },
  'shadow amount differs': p => { p.duplicateEvidence[0].shadowSignature.amountCents++; },
  'relation shadows transaction': p => { p.duplicateEvidence[0].id = p.duplicateEvidence[1].shadowId; },
  'held with duplicate': p => { p.reductions = F.reductionProof(1, { kind: 'held-return' }).reductions; p.ordinaryIncomeCents--; },
  'relation cross-kind duplicate': p => { p.reductions = F.reductionProof(1).reductions; p.reductions[0].id = p.duplicateEvidence[0].id; p.ordinaryIncomeCents--; }
})) test('invalid duplicate proof rejects: ' + name, () => {
  const p = F.duplicateProof(2); mutate(p); assert.throws(() => Core.normalizeProof(p), Core.IncomeCoreError);
});
const journalMutations = {
  'revision gap': x => { x.audit[1].revision++; }, 'revision length mismatch': x => { x.revision++; },
  'missing current receipt': x => { x.receipts = []; }, 'extra current receipt': x => { x.receipts.push(F.receipt({ id: 'extra' })); },
  'missing current plan': x => { x.plans = []; }, 'extra current plan': x => { x.plans.push(F.plan({ id: 'extra' })); },
  'duplicate current plan': x => { x.plans.push(F.clone(x.plans[0])); }, 'duplicate current receipt': x => { x.receipts.push(F.clone(x.receipts[0])); },
  'duplicate event ID': x => { x.audit[1].id = x.audit[0].id; }, 'event equals record ID': x => { x.audit[1].id = x.audit[1].recordId; },
  'create has before': x => { x.audit[1].before = F.clone(x.audit[1].after); }, 'create has no after': x => { x.audit[1].after = null; },
  'create time differs': x => { x.audit[1].at = '2026-10-14T12:00:00.001Z'; }, 'record ID differs': x => { x.audit[1].recordId = 'other'; },
  'receipt update': x => { x.audit[1].action = 'update'; }, 'receipt retire': x => { x.audit[1].action = 'retire'; },
  'plan reverse': x => { x.audit[0].action = 'reverse'; }, 'create reverses event': x => { x.audit[1].reverses = x.audit[0].id; },
  'receipt source mismatch': x => { x.audit[1].after.transactionId = 'other'; },
  'receipt source after cutoff': x => { x.audit[1].after.reviewedAsOfDate = '2026-09-30'; }
};
for (const [name, mutate] of Object.entries(journalMutations)) test('invalid journal rejects: ' + name, () => { const x = full(); mutate(x); bad(x); });
test('receipt cannot borrow a plan created at a later prefix', () => {
  const x = full(); x.audit.reverse(); x.audit.forEach((e, i) => { e.revision = i + 1; }); bad(x, 'INCOME_HISTORY');
});
test('retirement cannot borrow a later reversal', () => {
  const x = F.builder().createPlan().createReceipt().reverseReceipt('receipt-1').retirePlan('plan-1').finish();
  [x.audit[2], x.audit[3]] = [x.audit[3], x.audit[2]]; x.audit.forEach((e, i) => { e.revision = i + 1; }); bad(x);
});
test('receipt reversal exact original audit ID, current existence and before snapshot', () => {
  const valid = F.builder().createPlan().createReceipt().reverseReceipt('receipt-1').finish(); check(valid);
  for (const ref of ['receipt-1', 'event-1', 'event-3', null]) { const x = F.clone(valid); x.audit[2].reverses = ref; bad(x); }
  const mismatch = F.clone(valid); mismatch.audit[2].before.reference = 'tamper'; bad(mismatch);
  const twice = F.clone(valid); const reverse = F.clone(twice.audit[2]); reverse.id = 'event-4'; reverse.revision = 4; twice.audit.push(reverse); twice.revision++; bad(twice);
});
test('plan update retains identity/creation timestamp, exact before and rejects normalized no-op', () => {
  const valid = F.builder().createPlan().updatePlan('plan-1', { name: 'Different' }).finish(); check(valid);
  for (const mutate of [x => { x.audit[1].before.note = 'tamper'; }, x => { x.audit[1].after.id = 'changed'; },
    x => { x.audit[1].after.createdAt = '2026-10-13T12:00:00.000Z'; }, x => { x.audit[1].after.name = ' Salary '; },
    x => { x.audit[1].reverses = 'event-1'; }]) { const x = F.clone(valid); mutate(x); bad(x); }
});
test('IDs are never reused across retired entities and audit history in either direction', () => {
  const first = F.builder().createPlan().retirePlan('plan-1').createPlan(F.plan()).finish(); bad(first, 'DUPLICATE_ID');
  const second = F.builder().createPlan().retirePlan('plan-1').createPlan(F.plan({ id: 'plan-2' }), { id: 'plan-1' }).finish(); bad(second, 'DUPLICATE_ID');
  const third = F.builder().createPlan().retirePlan('plan-1').createPlan(F.plan({ id: 'event-1' })).finish(); bad(third, 'DUPLICATE_ID');
  const fourth = F.builder().createPlan(F.plan({ id: 'future' }), { id: 'claimed' }).retirePlan('future').createPlan(F.plan({ id: 'claimed' })).finish(); bad(fourth, 'DUPLICATE_ID');
});
test('same basis capacity includes every plan and cannot be fixed by a later reverse', () => {
  const b = F.builder().createPlan().createPlan(F.plan({ id: 'plan-2' })).createReceipt(F.receipt({ amountCents: 60000 }))
    .createReceipt(F.receipt({ id: 'receipt-2', planId: 'plan-2', amountCents: 50000 })).reverseReceipt('receipt-2');
  bad(b.finish(), 'INCOME_CAPACITY');
});
test('target capacity at every prefix cannot be fixed by a later increase or null target', () => {
  for (const target of [100000, null]) {
    const x = F.builder().createPlan(F.plan({ expectedAmountCents: 50000 })).createReceipt(F.receipt({ amountCents: 60000 }))
      .updatePlan('plan-1', { expectedAmountCents: target }).finish(); bad(x, 'INCOME_CAPACITY');
  }
});
test('all basis groups still consume a plan target, while distinct groups have source capacities', () => {
  const second = F.proof({ source: F.signature({ amountCents: 110000 }) });
  const x = F.builder().createPlan(F.plan({ expectedAmountCents: null })).createReceipt(F.receipt({ amountCents: 100000 }))
    .createReceipt(F.receipt({ id: 'receipt-2', proof: second, amountCents: 110000 })).finish();
  assert.equal(check(x).receipts.length, 2);
  const y = F.clone(x); y.plans[0].expectedAmountCents = y.audit[0].after.expectedAmountCents = 200000; bad(y, 'INCOME_CAPACITY');
});
test('timestamp/reference/review changes cannot manufacture same-basis capacity', () => {
  const b = F.builder().createPlan(F.plan({ expectedAmountCents: null })).createReceipt(F.receipt({ amountCents: 100000 }))
    .createReceipt(F.receipt({ id: 'receipt-2', createdAt: '2026-10-15T12:00:00.000Z', reviewedAsOfDate: '2026-10-15', reference: 'different', amountCents: 1 }));
  bad(b.finish(), 'INCOME_CAPACITY');
});
test('bounded generated same-basis valid histories always respect source and target capacity', () => {
  let cases = 0;
  for (let a = 1; a <= 10; a++) for (let b = 1; b <= 10; b++) {
    const cap = a + b, source = F.signature({ amountCents: cap }), p = F.proof({ source });
    const x = F.builder().createPlan(F.plan({ expectedAmountCents: null })).createReceipt(F.receipt({ proof: p, amountCents: a }))
      .createReceipt(F.receipt({ id: 'receipt-2', proof: p, amountCents: b })).finish();
    const result = check(x); assert.ok(result.receipts.reduce((sum, row) => sum + row.amountCents, 0) <= cap); cases++;
    x.receipts[1].amountCents++; x.audit[2].after.amountCents++; bad(x, 'INCOME_CAPACITY');
  }
  assert.equal(cases, 100);
});
test('all schema fields required and unknown fields reject at every persisted level', () => {
  const original = F.builder().createPlan().createReceipt(F.receipt({ proof: F.duplicateProof(1) })).finish();
  const paths = [[], ['plans',0], ['receipts',0], ['audit',0], ['audit',0,'after'], ['audit',1,'after'], ['receipts',0,'proof'], ['receipts',0,'proof','source'], ['receipts',0,'proof','duplicateEvidence',0], ['receipts',0,'proof','duplicateEvidence',0,'shadowSignature']];
  const get = (x, path) => path.reduce((r,k) => r[k], x);
  for (const path of paths) {
    for (const key of Object.keys(get(original,path))) { const x = F.clone(original); delete get(x,path)[key]; bad(x); }
    const x = F.clone(original); get(x,path).unexpected = null; bad(x);
  }
  const reduction = F.builder().createPlan().createReceipt(F.receipt({ proof: F.reductionProof(1) })).finish();
  for (const key of Object.keys(reduction.receipts[0].proof.reductions[0])) { const x = F.clone(reduction); delete x.receipts[0].proof.reductions[0][key]; bad(x); }
});
for (const [name, value] of Object.entries({ negativeZero: -0, NaN: NaN, Infinity: Infinity, fraction: 1.5, unsafe: Number.MAX_SAFE_INTEGER + 1 })) {
  test('invalid numeric ' + name + ' rejects in every new numeric field', () => {
    const mutations = [x => { x.version = value; }, x => { x.revision = value; }, x => { x.plans[0].expectedAmountCents = value; },
      x => { x.audit[0].revision = value; }, x => { x.receipts[0].amountCents = value; }, x => { x.receipts[0].proof.version = value; },
      x => { x.receipts[0].proof.source.amountCents = value; }, x => { x.receipts[0].proof.ordinaryIncomeCents = value; }];
    for (const mutate of mutations) { const x = full(); mutate(x); bad(x); }
    const p = F.reductionProof(1); p.reductions[0].amountCents = value; assert.throws(() => Core.normalizeProof(p));
  });
}
test('amount field boundary, identifiers and text validation preserve exact rules', () => {
  for (const value of [0, -1, 1000000000000, '1']) assert.throws(() => Core.normalizePlan(F.plan({ expectedAmountCents: value })));
  assert.equal(Core.normalizePlan(F.plan({ expectedAmountCents: 999999999999 })).expectedAmountCents, 999999999999);
  for (const value of ['', ' a', 'a ', 'constructor', 'prototype', '_id', 'a'.repeat(101)]) assert.throws(() => Core.normalizePlan(F.plan({ id: value })));
  assert.equal(Core.normalizePlan(F.plan({ id: 'a'.repeat(100) })).id.length, 100);
  for (const value of ['', ' ', 'a'.repeat(81), 'a\n', 'a\x7f']) assert.throws(() => Core.normalizePlan(F.plan({ name: value })));
  for (const value of ['a'.repeat(501), 'x\0', 'x\x0b', 'x\x7f']) assert.throws(() => Core.normalizePlan(F.plan({ note: value })));
});
test('calendar and UTC canonical timestamp boundaries without wall clock', () => {
  for (const date of ['0001-01-01', '2000-02-29', '2024-02-29', '9999-12-31']) assert.equal(Core.normalizePlan(F.plan({ expectedDate: date })).expectedDate, date);
  for (const date of ['0000-01-01', '1900-02-29', '2023-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '2026-1-01']) assert.throws(() => Core.normalizePlan(F.plan({ expectedDate: date })));
  for (const at of ['2026-10-14T12:00:00Z', '2026-10-14T12:00:00.000+00:00', '2026-10-14T24:00:00.000Z', '2026-10-14T12:60:00.000Z', '2026-10-14T12:00:60.000Z', '0000-01-01T00:00:00.000Z', '2023-02-29T00:00:00.000Z']) assert.throws(() => Core.normalizePlan(F.plan({ createdAt: at })));
});
test('descriptor preflight rejects getters, hidden fields, symbols, functions, sparse arrays, cycles and custom prototypes', () => {
  let invoked = 0;
  const mutations = [x => { Object.defineProperty(x, 'plans', { enumerable: true, get() { invoked++; return []; } }); },
    x => { Object.defineProperty(x.audit[1].after.proof, 'hidden', { value: null }); },
    x => { x[Symbol('x')] = null; }, x => { x.toJSON = () => { invoked++; return {}; }; },
    x => { delete x.audit[0]; }, x => { x.audit.extra = null; }, x => { x.audit[1].after.proof.loop = x; },
    x => { Object.setPrototypeOf(x.plans[0], { inherited: true }); }, x => { Object.setPrototypeOf(x.receipts, []); },
    x => { Object.defineProperty(x.receipts, '0', { enumerable: true, get() { invoked++; return F.receipt(); } }); }];
  for (const mutate of mutations) { const x = full(); mutate(x); bad(x); }
  assert.equal(invoked, 0);
});
test('genuine cross-realm objects and null-prototype records are supported', () => {
  const x = vm.runInNewContext('JSON.parse(' + JSON.stringify(JSON.stringify(full())) + ')'); assert.equal(check(x).revision, 2);
  const raw = full(); Object.setPrototypeOf(raw, null); Object.setPrototypeOf(raw.plans[0], null); assert.equal(check(raw).revision, 2);
});
test('canonical primitive/UTF-8 byte counts match native JSON across escaping and Unicode', () => {
  for (const value of [null, true, false, 1.5, 1e30, '', '汉字😀', '\0\b\t\n\f\r\\"', '\ud800', '\udc00', '\ud800\udc00', { z: 3, A: '字', a: [null, true, '😀'] }]) {
    const size = Core.inspectData(value); assert.equal(size.jsonBytes, Buffer.byteLength(JSON.stringify(value)));
    const canonical = Core.canonicalData(value, { maxBytes: Core.LIMITS.planningBytes }); assert.equal(Buffer.byteLength(canonical), size.jsonBytes);
  }
  assert.equal(Core.canonicalData({ z: 1, A: 2, a: 3 }, { maxBytes: Core.LIMITS.planningBytes }), '{"A":2,"a":3,"z":1}');
  for (const options of [undefined, {}, { maxBytes: 100 }, { maxBytes: Core.LIMITS.planningBytes, extra: true }]) assert.throws(() => Core.canonicalData({}, options));
});
test('shared objects are counted by occurrence, not mistaken for cycles or deduplicated', () => {
  const shared = { a: 'x' }, value = [shared, shared];
  assert.equal(Core.inspectData(value).nodeCount, 5); assert.equal(Core.inspectData(value).jsonBytes, Buffer.byteLength(JSON.stringify(value)));
  assert.equal(Core.canonicalData(value, { maxBytes: Core.LIMITS.planningBytes }), '[{"a":"x"},{"a":"x"}]');
});

test('browser UMD remains pure without Ledger, Relations, clock, network or storage access', () => {
  const fs = require('node:fs'), source = fs.readFileSync(require.resolve('../dist/income-core.js'), 'utf8');
  const sandbox = {};
  for (const key of ['MoneygoLedger', 'MoneygoRelations', 'Date', 'fetch', 'localStorage', 'sessionStorage']) Object.defineProperty(sandbox, key, { get() { throw new Error('Forbidden capability read: ' + key); } });
  const context = vm.createContext(sandbox); vm.runInContext(source, context);
  const browser = context.MoneygoIncomeCore;
  assert.equal(browser.validateExtension(full()).receipts.length, 1);
  assert.equal(browser.normalizePlan(F.plan()).createdAt, F.AT);
  assert.equal(browser.basisKey(F.proof()), Core.basisKey(F.proof()));
});
test('descriptor-safe inspection never invokes Proxy property reads and catches changing accessors', () => {
  let reads = 0;
  const raw = new Proxy({ a: 'x' }, { get() { reads++; throw new Error('Property read'); } });
  assert.equal(Core.canonicalData(raw, { maxBytes: Core.LIMITS.planningBytes }), '{"a":"x"}'); assert.equal(reads, 0);
  let descriptors = 0, getterCalls = 0;
  const changing = new Proxy({ a: 'x' }, { getOwnPropertyDescriptor(target, key) {
    if (key === 'a' && ++descriptors > 1) return { enumerable: true, configurable: true, get() { getterCalls++; return 'x'; } };
    return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  assert.throws(() => Core.canonicalData(changing, { maxBytes: Core.LIMITS.planningBytes }), Core.IncomeCoreError);
  assert.equal(getterCalls, 0);
});
