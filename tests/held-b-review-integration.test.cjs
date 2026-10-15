'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { L, H, R, O, S, day, clock, copy, engine, tx, base, position, recognition, returned, apply, fund, pid, review } = require('./held-b-fixture.cjs');
const Organizer = require('../dist/organizer');
function close(state, month = '2026-03') { return Organizer.closeMonth(state, { month, reason: 'Synthetic existing frozen close', at: clock }); }

test('B: recognition with prior close commits differing reason/time and exact typed zero-cash driver', () => { let s = close(fund()); const h = H.createCoordinator({ now: (() => { let n = 0; return () => n++ ? '2026-04-17T03:00:00.000Z' : clock; })() }), t = h.preview(s, recognition(pid(s))), comparison = t.review.frozenComparisons[0], recognitionId = t.review.after.positions[0].recognitions[0].id; assert.equal(comparison.delta.cash.expenseCents, 0); assert.equal(comparison.delta.personal.expenseCents, 2000); assert.ok(comparison.drivers.some(row => row.stream === 'personal' && row.key.kind === 'held-recognition' && row.key.id === recognitionId)); const next = h.commit(s, t, { confirmed: true, reason: 'Synthetic actual confirmation after review' }); assert.equal(next.bookkeeping.heldRecognitions[0].id, recognitionId); assert.equal(next.bookkeeping.heldRecognitions[0].reason, 'Synthetic actual confirmation after review'); assert.deepEqual(next.organizer, s.organizer); });
test('B: creation against a legacy close adapts comparison without rewriting old row format', () => { const s = close(base(), '2026-01'), h = engine(), t = h.preview(s, position()); assert.equal(s.organizer.closes[0].format, undefined); assert.equal(t.review.frozenComparisons[0].delta.personal.expenseCents, -10000); const next = h.commit(s, t, { confirmed: true, reason: 'Synthetic legacy comparison' }); assert.deepEqual(next.organizer, s.organizer); });
test('B: real Scenario review matches public arithmetic and isolates raw funding exclusions', () => { let s = fund(base([tx('pay')])); s.simulation = { ...S.defaultSettings(), completeMonths: ['2026-03'], exclusions: ['pay'] }; s = L.validateState(s); const h = engine(), t = h.preview(s, recognition(pid(s))); assert.equal(t.review.scenario.before.baseline.monthlyCents, 0); assert.equal(t.review.scenario.after.baseline.monthlyCents, 2000); assert.equal(t.review.scenario.impactedEventKeys[0].kind, 'held-recognition'); const next = h.commit(s, t, { confirmed: true, reason: 'Synthetic scenario comparison' }); assert.deepEqual(t.review.scenario.after, S.calculate(next, next.simulation, day)); });
test('B: stale Organizer alias and unrelated Obligation edits invalidate a reviewed command', () => { for (const kind of ['organizer', 'obligation']) { const s = fund(), h = engine(), t = h.preview(s, recognition(pid(s))); const modified = kind === 'organizer' ? Organizer.saveAlias(s, { from: 'Synthetic source pay', to: 'Synthetic alias', reason: 'Synthetic alias' }) : O.putProfile(s, { accountId: 'cash-b', role: 'cash', creditLimitCents: null, note: 'Synthetic profile' }, review(s)); assert.equal(modified.bookkeeping.revision, s.bookkeeping.revision); assert.throws(() => h.commit(modified, t, { confirmed: true, reason: 'Synthetic stale submit' }), error => error.code === 'STALE_HELD_REVIEW'); } });

function instrumented() {
  const context = vm.createContext({ __heldTraversals: 0, TextEncoder, TextDecoder }), modules = new Map();
  function load(name) {
    name = name.replace(/^\.\//, '').replace(/\.js$/, '');
    if (modules.has(name)) return modules.get(name).exports;
    const module = { exports: {} }; modules.set(name, module);
    let source = fs.readFileSync(path.join(__dirname, '../dist', name + '.js'), 'utf8');
    if (name === 'relations') { assert.ok(source.includes('function validate(input, state) {')); source = source.replace('function validate(input, state) {', 'function validate(input, state) { globalThis.__heldTraversals++;'); }
    vm.runInContext('(function(require,module,exports){' + source + '\n})', context, { filename: name + '.js' })(load, module, module.exports);
    return module.exports;
  }
  function detached(value) { context.__json = JSON.stringify(value); const out = vm.runInContext('JSON.parse(__json)', context); delete context.__json; return out; }
  return { context, load, detached };
}
test('B: full Relations traversal count is fixed across 1/36 closes and 1/12 recognition months', t => {
  let s = fund(base([tx('pay', 'expense', 10000, '2025-01-01')])); const positionId = pid(s);
  // Direct internal fixture transitions still enforce all real Relations invariants.
  for (let index = 0; index < 12; index++) s = R.applyHeldTransition(s, recognition(positionId, { effectiveDate: '2025-' + String(index + 1).padStart(2, '0') + '-15', amountCents: 1 }), { at: clock, reason: 'Synthetic fixture use' });
  s.simulation = { ...S.defaultSettings(), completeMonths: ['2025-12'] }; s = L.validateState(s);
  const variants = [], oneMonthState = fund(base([tx('pay', 'expense', 10000, '2025-01-01')]));
  oneMonthState.simulation = { ...S.defaultSettings(), completeMonths: ['2025-12'] };
  for (const [events, original] of [[1, oneMonthState], [12, s]]) {
    let current = original;
    for (let index = 0; index < 36; index++) { current = close(current, '2025-' + String(index % 12 + 1).padStart(2, '0')); if (index === 0 || index === 35) variants.push({ events, closes: index + 1, state: current }); }
  }
  const measured = [];
  for (const variant of variants) {
    const harness = instrumented(), H2 = harness.load('held-funds'), state = harness.detached(variant.state), command = harness.detached(recognition(positionId, { effectiveDate: '2026-02-01', amountCents: 1 })), coordinator = H2.createCoordinator({ now: () => clock });
    harness.context.__heldTraversals = 0; const begin = performance.now(), ticket = coordinator.preview(state, command), previewMs = performance.now() - begin, previewTraversals = harness.context.__heldTraversals;
    harness.context.__heldTraversals = 0; const startCommit = performance.now(); coordinator.commit(state, ticket, harness.detached({ confirmed: true, reason: 'Synthetic actual confirmation' }));
    measured.push({ events: variant.events, closes: variant.closes, previewTraversals, commitTraversals: harness.context.__heldTraversals, previewMs: Math.round(previewMs), commitMs: Math.round(performance.now() - startCommit) });
  }
  assert.equal(new Set(measured.map(row => row.previewTraversals)).size, 1); assert.equal(new Set(measured.map(row => row.commitTraversals)).size, 1);
  assert.ok(measured[0].previewTraversals > 0); assert.ok(measured[0].previewTraversals < 25);
  t.diagnostic(JSON.stringify({ fixedPipeline: measured, memory: process.memoryUsage(), scope: 'local model timing; no maximum-size latency guarantee or browser acceptance' }));
});
