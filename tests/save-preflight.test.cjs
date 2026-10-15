'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const F = require('./save-preflight-fixtures.cjs'), { L, P, base, clone } = F;
const code = fs.readFileSync(path.join(__dirname, '../dist/save-preflight.js'), 'utf8');
function rejects(fn, expectedCode, phase, cause) {
  assert.throws(fn, error => {
    assert.ok(error instanceof Error); assert.equal(error.name, 'SavePreflightError');
    assert.equal(error.code, expectedCode); assert.equal(error.phase, phase);
    for (const key of ['name', 'code', 'phase', 'message']) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(error, key), 'value'));
    assert.match(error.message, /未保存/); assert.match(error.message, /原始恢复数据/);
    if (arguments.length > 3) assert.equal(error.cause, cause);
    return true;
  });
}
function echo(overrides = {}) { return { validateState: x => x, backup: x => JSON.stringify(x), parseBackup: x => JSON.parse(x), ...overrides }; }
function reordered(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(reordered);
  return Object.fromEntries(Object.keys(value).reverse().map(key => [key, reordered(value[key])]));
}
test('save preflight: frozen one-method API returns only a detached frozen state and exact compact bytes', () => {
  assert.ok(Object.isFrozen(P)); assert.deepEqual(Object.keys(P), ['prepare']);
  const input = base(), prior = F.freezeEvidence(input), { ledger, calls } = F.forwardingLedger();
  const result = P.prepare(input, ledger);
  assert.ok(Object.isFrozen(result)); assert.deepEqual(Object.keys(result), ['state', 'compactRaw']);
  F.assertDetachedFrozen(result.state, input); F.assertPreserved(input, prior);
  assert.equal(result.compactRaw, JSON.stringify(result.state));
  assert.deepEqual(calls.map(x => x.name), ['validateState', 'validateState', 'backup', 'parseBackup']);
  assert.equal(calls[0].args[0], input);
  for (const n of [1, 2]) assert.equal(calls[n].args[0], result.state);
  assert.equal(calls[3].args[0], calls[2].out);
  const envelope = JSON.parse(calls[2].out);
  assert.equal(envelope.format, 'moneygo-backup'); assert.equal(new Date(envelope.exportedAt).toISOString(), envelope.exportedAt);
  const attempted = []; const saved = L.save({ setItem(k, raw) { attempted.push([k, raw]); } }, result.state);
  assert.deepEqual(attempted, [[L.STORAGE_KEY, result.compactRaw]]); F.assertDataEqual(saved, result.state);
});
test('save preflight: supported legacy defaults and original optional undefined normalize once', () => {
  const input = base(); input.accounts[0].name = '  Legacy cash  '; input.accounts[0].openingBalanceCents = -0;
  input.transactions.push({ id: 'legacy-transaction', type: 'expense', date: '2026-10-14', amountCents: 1, accountId: 'account-cash', categoryId: 'expense-other' });
  input.simulation = undefined; input.imports = undefined; input.bookkeeping = undefined;
  const prior = F.freezeEvidence(input), observed = F.forwardingLedger();
  const prepared = P.prepare(input, observed.ledger);
  assert.equal(prepared.state.accounts[0].name, 'Legacy cash'); assert.equal(prepared.state.accounts[0].openingBalanceCents, 0); assert.equal(prepared.state.transactions[0].note, '');
  assert.equal(Object.hasOwn(prepared.state, 'simulation'), false); F.assertPreserved(input, prior);
  assert.equal(observed.calls.filter(c => c.args[0] === input).length, 1);
});
test('save preflight: actual full version-eight extensions and frozen close/planning/audit/trash data survive', () => {
  const input = F.combined(), prior = F.freezeEvidence(input), { ledger, calls } = F.forwardingLedger();
  const output = P.prepare(input, ledger);
  for (const key of ['simulation', 'imports', 'bookkeeping', 'organizer', 'obligations', 'incomePlanning', 'spendingPlanning']) assert.ok(Object.hasOwn(output.state, key), key);
  assert.equal(output.state.version, 8); assert.ok(output.state.trash.length); assert.ok(output.state.organizer.closes.length);
  assert.ok(output.state.incomePlanning.audit.length); assert.ok(output.state.spendingPlanning.audit.length);
  F.assertDataEqual(output.state, L.validateState(input)); F.assertDataEqual(output.state, calls.at(-1).out);
  F.assertDetachedFrozen(output.state, input); F.assertPreserved(input, prior);
});
test('save preflight: actual frozen refund commit stays frozen and content-identical while prepared graph detaches', () => {
  const R = require('./refund-receipts-independent-fixtures.cjs');
  const input = R.allocate(R.base()).state, prior = F.freezeEvidence(input);
  assert.ok(prior.nodes.every(([, frozen]) => frozen));
  const prepared = P.prepare(input, L); F.assertDataEqual(prepared.state, input); F.assertPreserved(input, prior); F.assertDetachedFrozen(prepared.state, input);
});
for (const fixture of ['node-input-to-vm-helper', 'vm-input-to-node-helper', 'null-prototype-record', 'shared-normalized-subtree']) test('save preflight: cross-realm and ownership ' + fixture, () => {
  let input = base(), prepare = P.prepare, ledger = L;
  if (fixture === 'node-input-to-vm-helper') { const context = vm.createContext({}); vm.runInContext(code, context); prepare = context.MoneygoSavePreflight.prepare; }
  if (fixture === 'vm-input-to-node-helper') input = vm.runInNewContext('JSON.parse(raw)', { raw: JSON.stringify(input) });
  if (fixture === 'null-prototype-record') input = Object.assign(Object.create(null), input);
  if (fixture === 'shared-normalized-subtree') ledger = echo();
  const prior = F.freezeEvidence(input), prepared = prepare(input, ledger);
  F.assertDetachedFrozen(prepared.state, input); F.assertPreserved(input, prior); F.assertDataEqual(prepared.state, L.validateState(input));
});
test('save preflight: object-key reorder in real parsed data is harmless but array order remains exact', () => {
  const input = base(), observed = F.forwardingLedger({ parseBackup(raw) { return reordered(L.parseBackup(raw)); } });
  const result = P.prepare(input, observed.ledger); F.assertDataEqual(result.state, L.validateState(input));
});
const changes = {
  'drop optional field': s => { delete s.categories[0].name; },
  'add unexpected field': s => { s.additional = null; },
  'absent becomes null': s => { s.simulation = null; },
  'null becomes absent': s => { delete s.proof.optional; },
  'scalar type changes': s => { s.proof.amount = '1'; },
  'scalar value changes': s => { s.proof.amount = 2; },
  'array order changes': s => { s.categories.reverse(); },
  'audit timestamp changes': s => { s.proof.audit[0].at = '2026-10-15T00:00:00.000Z'; },
  'source proof changes': s => { s.proof.audit[0].before.source.timestamp = 'changed'; },
  'history reorders': s => { s.proof.audit.reverse(); }
};
for (const [name, change] of Object.entries(changes)) test('save preflight: complete equality rejects ' + name, () => {
  const input = base(); input.proof = { optional: null, amount: 1, audit: [{ at: '2026-10-14T00:00:00.000Z', before: { source: { timestamp: 'original' } }, after: { yes: true } }, { at: '2026-10-14T01:00:00.000Z' }] };
  rejects(() => P.prepare(input, echo({ parseBackup(raw) { const result = JSON.parse(raw); change(result); return result; } })), 'SAVE_PREFLIGHT_ROUND_TRIP_MISMATCH', 'compare');
});
for (const method of ['validateState', 'backup', 'parseBackup']) for (const kind of ['missing', 'inherited', 'accessor', 'nonfunction']) test('save preflight: capability ' + method + ' ' + kind + ' is refused without getter invocation', () => {
  let hits = 0; const ledger = { ...L }; delete ledger[method];
  if (kind === 'inherited') Object.setPrototypeOf(ledger, { [method]: L[method] });
  if (kind === 'accessor') Object.defineProperty(ledger, method, { get() { hits++; throw Error('getter'); } });
  if (kind === 'nonfunction') ledger[method] = 1;
  rejects(() => P.prepare(base(), ledger), 'SAVE_PREFLIGHT_UNAVAILABLE', 'capability'); assert.equal(hits, 0);
});
test('save preflight: capability reflection exceptions fail closed and retain cause', () => {
  const cause = Error('reflection'), ledger = new Proxy({}, { getOwnPropertyDescriptor() { throw cause; } });
  rejects(() => P.prepare(base(), ledger), 'SAVE_PREFLIGHT_UNAVAILABLE', 'capability', cause);
});
const unsafe = {
  getter: hit => Object.defineProperty({}, 'field', { enumerable: true, get() { hit(); return 1; } }),
  toJSON: hit => ({ toJSON() { hit(); return {}; } }),
  hidden: () => Object.defineProperty({}, 'hidden', { value: 1 }),
  symbol: () => ({ [Symbol('payload')]: 1 }),
  function: () => ({ method() {} }), bigint: () => ({ amount: 1n }),
  date: () => new Date(), map: () => new Map(), set: () => new Set(), typedArray: () => new Uint8Array(2), boxed: () => Object(1),
  customPrototype: () => Object.create({ inherited: 1 }),
  cycle: () => { const x = {}; x.x = x; return x; },
  hole: () => Array(1), arrayExtra: () => Object.assign([1], { extra: 2 }),
  arrayHidden: () => Object.defineProperty([1], 'extra', { value: 2 }),
  infinity: () => ({ amount: Infinity }), nan: () => ({ amount: NaN }),
  reflection: () => new Proxy({}, { ownKeys() { throw Error('own keys'); } })
};
for (const [name, make] of Object.entries(unsafe)) test('save preflight: descriptor-safe original rejection ' + name, () => {
  let hits = 0, validations = 0; const input = base(); input.unsafe = make(() => hits++);
  rejects(() => P.prepare(input, echo({ validateState() { validations++; return base(); } })), 'SAVE_PREFLIGHT_INVALID_CANDIDATE', 'input');
  assert.equal(hits, 0); assert.equal(validations, 0);
});
for (const [name, make] of Object.entries({ ...unsafe, undefined: () => ({ value: undefined }), negativeZero: () => ({ value: -0 }) })) test('save preflight: normalized snapshot refuses lossy or unsafe ' + name, () => {
  let hits = 0;
  rejects(() => P.prepare(base(), echo({ validateState() { return make(() => hits++); } })), 'SAVE_PREFLIGHT_INVALID_CANDIDATE', 'normalize'); assert.equal(hits, 0);
});
for (const kind of ['content', 'key-order', 'timestamp', 'unsafe', 'throw', 'repeat-capacity']) test('save preflight: repeated normalization fails closed for ' + kind, () => {
  let count = 0; const original = { first: 1, second: 2 }, cause = Object.assign(Error('repeat'), { code: 'BACKUP_TOO_LARGE' });
  const ledger = echo({ validateState(x) { if (++count === 1) return original;
    if (kind === 'content') return { ...x, first: 3 }; if (kind === 'key-order') return { second: 2, first: 1 };
    if (kind === 'timestamp') return { ...x, generatedAt: new Date().toISOString() };
    if (kind === 'unsafe') return { first: undefined }; throw cause;
  } });
  rejects(() => P.prepare({}, ledger), 'SAVE_PREFLIGHT_NORMALIZATION_CHANGED', 'fixed-point'); assert.equal(count, 2);
});
for (const phase of ['normalize', 'backup', 'parse']) test('save preflight: hostile exception accessors are never inspected in ' + phase, () => {
  let hits = 0; const cause = {};
  for (const key of ['code', 'name', 'message', 'cause']) Object.defineProperty(cause, key, { get() { hits++; throw Error('hostile getter'); } });
  const ledger = echo({ [phase === 'normalize' ? 'validateState' : phase === 'parse' ? 'parseBackup' : 'backup']() { throw cause; } });
  rejects(() => P.prepare({}, ledger), phase === 'normalize' ? 'SAVE_PREFLIGHT_INVALID_CANDIDATE' : 'SAVE_PREFLIGHT_ROUND_TRIP_FAILED', phase, cause); assert.equal(hits, 0);
});
for (const phase of ['normalize', 'backup']) test('save preflight: real-method reported capacity stays format capacity in ' + phase, () => {
  const cause = Object.assign(Error('real method capacity refusal'), { code: 'BACKUP_TOO_LARGE' });
  rejects(() => P.prepare({}, echo({ [phase === 'normalize' ? 'validateState' : 'backup']() { throw cause; } })), 'SAVE_BACKUP_CAPACITY', phase, cause);
});
test('save preflight: first real financial validation code is preserved without changing its semantics', () => {
  const input = base(); input.currency = 'USD';
  assert.throws(() => P.prepare(input, L), e => e.code === 'SAVE_PREFLIGHT_INVALID_CANDIDATE' && e.phase === 'normalize' && e.sourceCode === 'INVALID_CURRENCY' && e.cause.code === 'INVALID_CURRENCY');
});
test('save preflight: malformed parser output and nonstring writer result use round-trip failure phases', () => {
  rejects(() => P.prepare({}, echo({ backup() { return {}; } })), 'SAVE_PREFLIGHT_ROUND_TRIP_FAILED', 'backup');
  rejects(() => P.prepare({}, echo({ parseBackup() { return { amount: undefined }; } })), 'SAVE_PREFLIGHT_ROUND_TRIP_FAILED', 'parse');
});
test('save preflight: simulated invalid-clock writer refusal uses the backup phase without a Date seam', () => {
  const observed = F.forwardingLedger({ backup() { throw new RangeError('Invalid time value'); } });
  rejects(() => P.prepare(base(), observed.ledger), 'SAVE_PREFLIGHT_ROUND_TRIP_FAILED', 'backup');
});
test('save preflight: iterative traversal accepts supported depth beyond unrelated refund guard limits', () => {
  const input = { value: null }; let tail = input; for (let i = 0; i < 256; i++) tail = tail.value = { value: null };
  const result = P.prepare(input, echo()); F.assertDetachedFrozen(result.state, input); F.assertDataEqual(result.state, input);
});
test('save preflight: inherited JSON hook is refused descriptor-safely across realms', () => {
  const context = vm.createContext({}); const input = vm.runInContext('globalThis.hits=0; Object.defineProperty(Object.prototype,"toJSON",{get(){hits++;throw Error("hook");}}); ({value:1})', context);
  rejects(() => P.prepare(input, echo()), 'SAVE_PREFLIGHT_INVALID_CANDIDATE', 'input'); assert.equal(context.hits, 0);
});

test('save preflight: supported version-one relation defaults materialize without demanding original equality', () => {
  const input = base(), R = require('../dist/relations.js'); input.version = 4; input.bookkeeping = R.defaultState(); input.bookkeeping.version = 1; delete input.bookkeeping.transferPairs;
  const before = F.freezeEvidence(input), prepared = P.prepare(input, L);
  assert.equal(prepared.state.bookkeeping.version, 2); assert.deepEqual(prepared.state.bookkeeping.transferPairs, []); F.assertPreserved(input, before);
});
for (const operation of ['freeze', 'stringify']) test('save preflight: first snapshot ' + operation + ' exception is safely classified', () => {
  const context = vm.createContext({}); vm.runInContext(code, context);
  vm.runInContext(operation === 'freeze' ? 'Object.freeze = () => { throw Error("freeze failed"); }' : 'JSON.stringify = () => { throw Error("serialization failed"); }', context);
  assert.throws(() => context.MoneygoSavePreflight.prepare(base(), L), error => error.code === 'SAVE_PREFLIGHT_INVALID_CANDIDATE' && error.phase === 'normalize');
});

test('save preflight: function call member accessors are never consulted when invoking captured methods', () => {
  let hits = 0; const ledger = echo();
  for (const method of Object.values(ledger)) Object.defineProperty(method, 'call', { get() { hits++; throw Error('call getter'); } });
  const result = P.prepare({ value: 1 }, ledger); assert.equal(result.state.value, 1); assert.equal(hits, 0);
});
