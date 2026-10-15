'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const Core = require('../dist/income-core.js');
const F = require('./income-core-fixtures.cjs');
function limit(fn, pattern) { assert.throws(fn, e => e instanceof Core.IncomeCoreError && e.code === 'INCOME_LIMIT' && (!pattern || pattern.test(e.message))); }
function measure(t, name, input) {
  const before = process.memoryUsage().heapUsed, started = performance.now(), result = Core.validateExtension(input);
  t.diagnostic(JSON.stringify({ name, elapsedMs: +(performance.now() - started).toFixed(2), heapDeltaBytes: process.memoryUsage().heapUsed - before, ...Core.metricsOf(result) }));
  return result;
}
function manyReceipts(plans, each) {
  const b = F.builder();
  for (let p = 0; p < plans; p++) b.createPlan(F.plan({ id: 'p-' + p, expectedAmountCents: null }));
  for (let p = 0; p < plans; p++) for (let i = 0; i < each; i++) b.createReceipt(F.receipt({ id: 'r-' + p + '-' + i, planId: 'p-' + p, amountCents: 1 }));
  return b;
}
function history(events) {
  const b = F.builder().createPlan();
  for (let i = 1; i < events; i++) b.updatePlan('plan-1', { name: i % 2 ? 'A' : 'B' });
  return b.finish();
}
test('active Plan200 boundary and historical201 prefix reject even after retirement', t => {
  const b = F.builder(); for (let i = 0; i < 200; i++) b.createPlan(F.plan({ id: 'p-' + i }));
  assert.equal(measure(t, 'plans-200', b.finish()).plans.length, 200);
  b.createPlan(F.plan({ id: 'p-200' })); limit(() => Core.validateExtension(b.finish()));
  b.retirePlan('p-200'); limit(() => Core.validateExtension(b.finish()), /prefix/);
});
test('per-Plan100 boundary and101 prefix remain bounded across basis groups', t => {
  const b = manyReceipts(1, 100); assert.equal(measure(t, 'receipts-per-plan-100', b.finish()).receipts.length, 100);
  const alternate = F.proof({ source: F.signature({ amountCents: 100001 }) });
  b.createReceipt(F.receipt({ id: 'r-over', planId: 'p-0', amountCents: 1, proof: alternate }));
  limit(() => Core.validateExtension(b.finish()), /per plan/);
  b.reverseReceipt('r-over'); limit(() => Core.validateExtension(b.finish()), /per plan/);
});
test('active Receipt1000 boundary and1001 prefix reject despite later reversal', t => {
  const b = manyReceipts(10, 100); assert.equal(measure(t, 'receipts-1000', b.finish()).receipts.length, 1000);
  b.createPlan(F.plan({ id: 'p-extra' })).createReceipt(F.receipt({ id: 'r-over', planId: 'p-extra', amountCents: 1 }));
  limit(() => Core.validateExtension(b.finish()));
  b.reverseReceipt('r-over'); limit(() => Core.validateExtension(b.finish()), /prefix/);
});
test('ever6000 historical entities accepted and6001 rejects independently of event/current bounds', t => {
  const b = F.builder();
  for (let i = 0; i < 5800; i++) b.createPlan(F.plan({ id: 'old-' + i })).retirePlan('old-' + i);
  for (let i = 0; i < 200; i++) b.createPlan(F.plan({ id: 'live-' + i }));
  const x = b.finish(), result = measure(t, 'ever-6000', x);
  assert.equal(Core.metricsOf(result).planCreates, 6000); assert.equal(result.audit.length, 11800);
  // Insert a retired entity before the live group: active<=200, events11802.
  const addition = F.builder().createPlan(F.plan({ id: 'one-too-many' }), { id: 'extra-create' })
    .retirePlan('one-too-many', { id: 'extra-retire' }).finish().audit;
  x.audit.splice(11600, 0, ...addition); x.audit.forEach((e,i) => { e.revision = i + 1; }); x.revision = x.audit.length;
  limit(() => Core.validateExtension(x), /Ever-created/);
});
test('12000 journal event boundary,12001 reject, exact normalized8MiB and plus1 byte', t => {
  const x = history(12000), base = measure(t, 'events-12000', x);
  assert.equal(Core.metricsOf(base).journalEvents, 12000);
  const tooMany = history(12001); limit(() => Core.validateExtension(tooMany));
  let remaining = Core.LIMITS.planningBytes - Buffer.byteLength(JSON.stringify(x)); assert.ok(remaining > 0);
  for (const event of x.audit) { const n = Math.min(500 - event.reason.length, remaining); event.reason += 'x'.repeat(n); remaining -= n; if (!remaining) break; }
  assert.equal(remaining, 0); assert.equal(Buffer.byteLength(JSON.stringify(x)), Core.LIMITS.planningBytes);
  const exact = measure(t, 'planning-8MiB-exact', x); assert.equal(Core.metricsOf(exact).jsonBytes, Core.LIMITS.planningBytes);
  const available = x.audit.find(e => e.reason.length < 498);
  const oldReason = available.reason; available.reason = ' ' + oldReason + ' ';
  assert.equal(Core.inspectData(x).jsonBytes, Core.LIMITS.planningBytes + 2);
  assert.equal(Core.metricsOf(Core.validateExtension(x)).jsonBytes, Core.LIMITS.planningBytes, 'raw over8MiB may normalize exactly to the persisted limit');
  available.reason = oldReason + 'x';
  limit(() => Core.validateExtension(x), /byte budget/);
});
test('proof component200 combined boundary accepted;201 rejected before normalization', () => {
  assert.equal(Core.normalizeProof(F.reductionProof(200)).reductions.length, 200);
  assert.equal(Core.normalizeProof(F.duplicateProof(200)).duplicateEvidence.length, 200);
  limit(() => Core.normalizeProof(F.reductionProof(201)), /budget/);
  limit(() => Core.normalizeProof(F.duplicateProof(201)), /budget/);
  const mixed = F.duplicateProof(100); mixed.reductions = F.reductionProof(100).reductions; mixed.ordinaryIncomeCents -= 100;
  assert.equal(Core.normalizeProof(mixed).duplicateEvidence.length + mixed.reductions.length, 200);
  mixed.reductions.push(F.reductionProof(101).reductions[100]); mixed.ordinaryIncomeCents--;
  limit(() => Core.normalizeProof(mixed), /component budget/);
});
test('proof cells charge current plus historical occurrences, without basis deduplication', () => {
  const b = F.builder().createPlan(F.plan({ expectedAmountCents: null }));
  const p = F.duplicateProof(2); p.reductions = F.reductionProof(3).reductions; p.ordinaryIncomeCents -= 3;
  b.createReceipt(F.receipt({ proof: p })).createReceipt(F.receipt({ id: 'second', proof: p }));
  let m = Core.metricsOf(Core.validateExtension(b.finish()));
  assert.equal(m.proofOccurrences, 4); assert.equal(m.proofComponents, 20); assert.equal(m.proofCells, 32);
  b.reverseReceipt('receipt-1'); m = Core.metricsOf(Core.validateExtension(b.finish()));
  assert.equal(m.proofOccurrences, 4); assert.equal(m.proofCells, 32);
});
test('100000 signature-cell preflight boundary yields byte rejection;100001 yields cell rejection', t => {
  // Each valid Receipt occurs twice (create plus current or reverse). 124*401+276=50000.
  // A signature alone needs at least97 JSON bytes, so100000 signatures cannot fit8MiB.
  const b = F.builder().createPlan(F.plan({ id: 'p-0', expectedAmountCents: null })).createPlan(F.plan({ id: 'p-1', expectedAmountCents: null }));
  const big = F.duplicateProof(200);
  for (let i = 0; i < 124; i++) b.createReceipt(F.receipt({ id: 'r-' + i, planId: i < 100 ? 'p-0' : 'p-1', amountCents: 1, proof: big }));
  const last = F.duplicateProof(137); last.reductions = F.reductionProof(1).reductions; last.ordinaryIncomeCents--;
  b.createReceipt(F.receipt({ id: 'r-last', planId: 'p-1', amountCents: 1, proof: last }));
  const x = b.finish(); const start = performance.now();
  limit(() => Core.validateExtension(x), /JSON UTF-8 byte budget/);
  t.diagnostic(JSON.stringify({ name: 'proof-cells-100000-preflight', rawBytes: Buffer.byteLength(JSON.stringify(x)), elapsedMs: +(performance.now()-start).toFixed(2), outcome: 'Independent normalized8MiB limit rejects after exact100000 cell preflight' }));
  x.receipts[x.receipts.length - 1].proof.reductions.push(F.reductionProof(2).reductions[1]);
  x.receipts[x.receipts.length - 1].proof.ordinaryIncomeCents--;
  limit(() => Core.validateExtension(x), /signature occurrences/);
});
test('explicit8MiB and32MiB generic canonical budgets count UTF-8 and JSON escapes exactly', t => {
  for (const maxBytes of [Core.LIMITS.planningBytes, Core.LIMITS.backupBytes]) {
    const value = 'x'.repeat(maxBytes - 2), start = performance.now();
    assert.equal(Core.inspectData(value).jsonBytes, maxBytes);
    assert.equal(Buffer.byteLength(Core.canonicalData(value, { maxBytes })), maxBytes);
    limit(() => Core.canonicalData(value + 'x', { maxBytes }));
    t.diagnostic(JSON.stringify({ name: 'canonical-byte-boundary', maxBytes, elapsedMs: +(performance.now() - start).toFixed(2) }));
  }
  const target = Core.LIMITS.planningBytes, han = '汉'.repeat(Math.floor((target - 2) / 3)), residue = target - 2 - Buffer.byteLength(han);
  const exact = han + 'x'.repeat(residue); assert.equal(Core.inspectData(exact).jsonBytes, target);
  assert.equal(Buffer.byteLength(Core.canonicalData(exact, { maxBytes: target })), target);
  limit(() => Core.canonicalData(exact + 'x', { maxBytes: target }));
  const escapes = '\0'.repeat(Math.floor((target - 2) / 6)), rest = target - 2 - escapes.length * 6;
  assert.equal(Core.inspectData(escapes + 'x'.repeat(rest)).jsonBytes, target);
  limit(() => Core.canonicalData(escapes + 'x'.repeat(rest + 1), { maxBytes: target }));
});
test('oversized sparse arrays reject by length before index access or copying', () => {
  const x = new Array(Core.LIMITS.dataNodes); let touched = 0;
  Object.defineProperty(x, '0', { enumerable: true, get() { touched++; return null; } });
  limit(() => Core.inspectData(x)); assert.equal(touched, 0);
});
test('deep ordinary data inspection/serialization is iterative and never relies on call stack recursion', () => {
  let x = null; for (let i = 0; i < 20000; i++) x = [x];
  assert.equal(Core.inspectData(x).nodeCount, 20001);
  assert.equal(Core.canonicalData(x, { maxBytes: Core.LIMITS.planningBytes }).length, 40004);
});
test('journal and proof work counters grow by occurrences, without per-prefix receipt scans', t => {
  const observed = [];
  for (const each of [10, 50, 100]) {
    const result = measure(t, 'linear-' + each, manyReceipts(1, each).finish()), m = Core.metricsOf(result);
    assert.equal(m.journalEvents, each + 1); assert.equal(m.proofOccurrences, 2 * each); assert.equal(m.proofCells, 2 * each);
    observed.push([m.journalEvents, m.proofComponents, m.proofCells]);
  }
  assert.deepEqual(observed, [[11,0,20],[51,0,100],[101,0,200]]);
});

test('safety-only raw inspection reports over32MiB before a caller normalizes harmless whitespace', () => {
  const spaces = ' '.repeat(16 * 1024 * 1024), raw = { left: spaces + 'x', right: spaces + 'y' };
  assert.ok(Core.inspectData(raw).jsonBytes > Core.LIMITS.backupBytes);
  const normalized = { left: raw.left.trim(), right: raw.right.trim() };
  assert.equal(Core.canonicalData(normalized, { maxBytes: Core.LIMITS.backupBytes }), '{\"left\":\"x\",\"right\":\"y\"}');
  limit(() => Core.canonicalData(raw, { maxBytes: Core.LIMITS.backupBytes }));
});
