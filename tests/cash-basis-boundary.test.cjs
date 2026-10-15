'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../dist/cash-basis.js');
const f = require('./cash-basis-model/boundary-fixtures.cjs');
const { L, R, S, DAY, NOW, copy, bytes, fixture, legacy, queryFor, consent, engine, confirmed, cashError } = f;
const EXPECTED_LIMITS = {
  inputBytes: 33554432, queryBytes: 8388608, resultBytes: 8388608, accounts: 100, accountDecisions: 200,
  transactions: 10000, movements: 20000, nonfundingRecords: 10000, snapshots: 100, importSources: 10000,
  manualSources: 100, sourceDecisions: 10100, dependencyPairs: 1010000, blockerRows: 100000,
  importConflicts: 10000, conflictPossibilities: 4, proofRecords: 100000, depth: 128,
  dataNodes: 33554432, stringCodeUnits: 33554432, reasonCodeUnits: 500, pageRows: 50,
  mountedDataRows: 200, proofTextPageCodeUnits: 4000
};
const keys = value => Reflect.ownKeys(value).sort();
const methods = ['cancel', 'confirm', 'inspect', 'invalidateAll', 'isCurrent', 'preview'];
const expectThrow = (action, code) => assert.throws(action, cashError(code));
const stateBytes = state => JSON.stringify(state);
const support = report => report.totals.supportedSelectedCents;

// The constants are independently transcribed from the approved, closed schema.
test('closed CommonJS surface, exact limits, opaque ticket, and six coordinator methods', () => {
  assert.deepEqual(keys(C), ['LIMITS', 'VERSION', 'createCoordinator']);
  assert.equal(C.VERSION, 1); assert.deepEqual(C.LIMITS, EXPECTED_LIMITS);
  assert.ok(Object.isFrozen(C)); f.assertFrozen(C.LIMITS);
  const { coordinator: c } = engine(C), { state, query } = fixture();
  assert.deepEqual(keys(c), methods);
  for (const name of methods) assert.equal(typeof c[name], 'function');
  const p = c.preview(state, query);
  assert.deepEqual(keys(p), ['report', 'ticket']); assert.deepEqual(Reflect.ownKeys(p.ticket), []);
  assert.equal(JSON.stringify(p.ticket), '{}'); f.assertFrozen(p);
});

test('browser UMD surface matches CommonJS without accessing DOM, storage, or network', () => {
  const counters = { calls: 0 };
  const window = new Proxy({}, { get(target, key) { if (['document', 'localStorage', 'sessionStorage', 'fetch'].includes(key)) { counters.calls++; throw new Error('Not a capability'); } return target[key]; } });
  vm.runInNewContext(fs.readFileSync(path.join(f.root, 'dist/cash-basis.js'), 'utf8'), { window, TextEncoder });
  assert.deepEqual(keys(window.MoneygoCashBasis), keys(C));
  assert.equal(window.MoneygoCashBasis.VERSION, 1); assert.deepEqual(copy(window.MoneygoCashBasis.LIMITS), EXPECTED_LIMITS);
  assert.equal(counters.calls, 0);
});

for (let version = 1; version <= 8; version++) test('valid v' + version + ' without optional extensions stays unknown and byte-identical', () => {
  const state = legacy(version), query = queryFor(state), before = stateBytes(state), exported = f.exportsOf(state);
  const present = f.extensions.filter(key => Object.hasOwn(state, key));
  const { coordinator: c } = engine(C);
  const catalog = c.inspect(state, { asOfDate: DAY });
  assert.equal(catalog.reviewStatus, 'unreviewed'); assert.equal(catalog.query, null); assert.equal(catalog.consent, null); assert.equal(catalog.reviewedAt, null);
  const a = catalog.accounts[0]; assert.equal(a.role, 'unknown');
  for (const code of ['role-unknown', 'snapshot-missing']) assert.ok(a.reasonCodes.includes(code));
  for (const key of ['observedSnapshotCents', 'knownBridgeDeltaCents', 'arithmeticCandidateCents', 'supportedBasisCents']) assert.equal(a[key], null);
  assert.equal(catalog.sources.length, 1); assert.equal(catalog.sources[0].source.kind, 'manual');
  const p = c.preview(state, query), report = c.confirm(state, p.ticket, query, consent());
  assert.equal(support(report), null); assert.equal(c.isCurrent(state, report, query), true);
  c.cancel(p.ticket); c.invalidateAll(); assert.equal(c.isCurrent(state, report, query), false);
  assert.equal(stateBytes(state), before); assert.equal(f.exportsOf(state), exported);
  assert.deepEqual(f.extensions.filter(key => Object.hasOwn(state, key)), present); assert.equal(state.version, version);
});

test('strict capability initialization accepts exactly now and today data-valued functions', () => {
  let getters = 0;
  const getter = { today: () => DAY }; Object.defineProperty(getter, 'now', { enumerable: true, get() { getters++; return () => NOW; } });
  for (const value of [undefined, null, {}, { now: () => NOW }, { now: NOW, today: () => DAY }, { now: () => NOW, today: DAY }, { now: () => NOW, today: () => DAY, storage: {} }, getter]) expectThrow(() => C.createCoordinator(value), 'CASH_INVALID_DATA');
  assert.equal(getters, 0);
  for (const patch of [{ now: () => { throw new Error('clock unavailable'); } }, { today: () => { throw new Error('calendar unavailable'); } }, { now: () => '2026-10-14T12:00:00Z' }, { now: () => '2026-02-30T12:00:00.000Z' }, { now: () => '2026-10-14T12:00:00.000+00:00' }, { today: () => '2026-02-30' }]) expectThrow(() => C.createCoordinator({ now: () => NOW, today: () => DAY, ...patch }), 'CASH_INVALID_DATA');
});

const hostileStateCases = [
  ['getter on account', (s, hit) => Object.defineProperty(s.accounts[0], 'name', { enumerable: true, get() { hit(); return 'Synthetic'; } })],
  ['getter on root', (s, hit) => Object.defineProperty(s, 'currency', { enumerable: true, get() { hit(); return 'CNY'; } })],
  ['hidden getter', (s, hit) => Object.defineProperty(s, 'hidden', { get() { hit(); } })],
  ['toJSON callable', (s, hit) => { s.toJSON = () => { hit(); return {}; }; }],
  ['own symbol', s => { s[Symbol('private')] = 1; }],
  ['symbol value', s => { s.extra = Symbol('value'); }],
  ['undefined', s => { s.extra = undefined; }],
  ['function', s => { s.extra = () => 1; }],
  ['BigInt', s => { s.extra = 1n; }],
  ['NaN', s => { s.extra = NaN; }],
  ['Infinity', s => { s.extra = Infinity; }],
  ['negative zero', s => { s.extra = -0; }],
  ['custom prototype', s => { Object.setPrototypeOf(s.accounts[0], { custom: true }); }],
  ['custom array prototype', s => { Object.setPrototypeOf(s.accounts, Object.create(Array.prototype)); }],
  ['sparse array', s => { s.transactions.length = 1; }],
  ['array extra own field', s => { s.accounts.extra = 1; }],
  ['hidden data field', s => { Object.defineProperty(s, 'hidden', { value: 'not JSON-visible' }); }],
  ['cycle', s => { s.extra = s; }],
  ['shared alias', s => { s.extra = s.accounts[0]; }],
  ['Date', s => { s.extra = new Date(NOW); }],
  ['Map', s => { s.extra = new Map(); }],
  ['Set', s => { s.extra = new Set(); }],
  ['RegExp', s => { s.extra = /synthetic/; }],
  ['boxed number', s => { s.extra = new Number(1); }],
  ['typed array', s => { s.extra = new Uint8Array(2); }]
];
for (const [name, mutate] of hostileStateCases) test('descriptor-first state rejection: ' + name, () => {
  const { api, counts } = f.loadInstrumented(), { coordinator: c } = engine(api);
  const state = legacy(1); let executions = 0; mutate(state, () => executions++);
  expectThrow(() => c.inspect(state, { asOfDate: DAY }), 'CASH_INVALID_DATA');
  assert.equal(counts.validation, 0); assert.equal(counts.calculate, 0); assert.equal(executions, 0);
});

test('revoked and throwing proxies fail atomically; no promise that traps cannot run', () => {
  const revoked = Proxy.revocable(legacy(1), {}); revoked.revoke();
  const hostile = new Proxy(legacy(1), { ownKeys() { throw new Error('hostile trap'); } });
  for (const state of [revoked.proxy, hostile]) {
    const { coordinator: c } = engine(C); expectThrow(() => c.inspect(state, { asOfDate: DAY }), 'CASH_INVALID_DATA');
  }
});

test('safe snapshot never passes a caller-owned raw object to pinned validation', () => {
  const { api, validated } = f.loadInstrumented(), { coordinator: c } = engine(api), state = legacy(1);
  let propertyReads = 0;
  state.accounts[0] = new Proxy(state.accounts[0], { get() { propertyReads++; throw new Error('Original must not be read'); } });
  const report = c.inspect(state, { asOfDate: DAY });
  assert.equal(report.accounts.length, 1); assert.equal(propertyReads, 0); assert.ok(validated.length);
  assert.ok(validated.every(value => value !== state && value.accounts !== state.accounts && value.accounts[0] !== state.accounts[0]));
});

test('cross-realm plain state, query, and consent are accepted and realm-detached', () => {
  const original = fixture(), state = f.crossRealm(original.state), query = f.crossRealm(original.query), review = f.crossRealm(original.consent);
  const { coordinator: c } = engine(C), p = c.preview(state, query), report = c.confirm(state, p.ticket, query, review);
  assert.equal(support(report), 90000); assert.equal(c.isCurrent(f.crossRealm(original.state), report, f.crossRealm(original.query)), true);
  f.assertDetached(report, state, query, review); f.assertFrozen(report);
});

test('state/query/consent ordinary-data preflight never invokes getters or toJSON', () => {
  for (const target of ['query', 'consent']) for (const kind of ['getter', 'toJSON', 'symbol', 'alias']) {
    const { api, counts } = f.loadInstrumented(), { coordinator: c } = engine(api), { state, query } = fixture();
    let executions = 0;
    const input = target === 'query' ? copy(query) : consent();
    if (kind === 'getter') Object.defineProperty(input, target === 'query' ? 'asOfDate' : 'reason', { enumerable: true, get() { executions++; return target === 'query' ? DAY : 'Synthetic'; } });
    if (kind === 'toJSON') input.toJSON = () => { executions++; return {}; };
    if (kind === 'symbol') input[Symbol('hidden')] = true;
    if (kind === 'alias') { const shared = {}; input.first = shared; input.second = shared; }
    if (target === 'query') expectThrow(() => c.preview(state, input), 'CASH_INVALID_QUERY');
    else { const p = c.preview(state, query), before = counts.validation; expectThrow(() => c.confirm(state, p.ticket, query, input), 'CASH_INVALID_CONSENT'); assert.equal(counts.validation, before, 'hostile consent must be detached before pinned validation'); expectThrow(() => c.confirm(state, p.ticket, query, consent()), 'CASH_REVIEW_USED'); }
    assert.equal(executions, 0, target + ' ' + kind);
  }
});

const queryMutations = [
  ['missing root field', q => { delete q.sources; }], ['unknown root field', q => { q.complete = true; }],
  ['unknown decision field', q => { q.accounts[0].approved = true; }], ['missing decision reason', q => { delete q.accounts[0].reason; }],
  ['unknown decision enum', q => { q.accounts[0].decision = 'yes'; }], ['empty exclusion reason', q => { q.accounts[0].decision = 'exclude'; q.accounts[0].reason = ' \t\n'; }],
  ['duplicate account', q => { q.accounts.push(copy(q.accounts[0])); }], ['duplicate source', q => { q.sources.push(copy(q.sources[0])); }],
  ['unknown source owner', q => { q.sources[0].source.accountId = 'missing'; }],
  ['source shape extra', q => { q.sources[0].source.name = 'extra'; }], ['source decision extra', q => { q.sources[0].approved = true; }],
  ['manual key not null', q => { q.sources[0].source.sourceKey = ''; }], ['unknown source kind', q => { q.sources[0].source.kind = 'bank'; }],
  ['blank imported source key', q => { q.sources[0].source.kind = 'import'; q.sources[0].source.sourceKey = ' \t'; q.sources[0].manualCoverage = null; }],
  ['import manual coverage', q => { q.sources[0].source.kind = 'import'; q.sources[0].source.sourceKey = 'bank'; }],
  ['missing manualCoverage', q => { delete q.sources[0].manualCoverage; }], ['reversed manual interval', q => { q.sources[0].manualCoverage.start = '2026-10-15'; }],
  ['invalid manual date', q => { q.sources[0].manualCoverage.start = '2026-02-30'; }],
  ['manual assertion false', q => { q.sources[0].manualCoverage.allUnimportedMovementsRecorded = false; }], ['manual empty reason', q => { q.sources[0].manualCoverage.reason = '\n'; }],
  ['manual extra field', q => { q.sources[0].manualCoverage.official = true; }], ['reason too long', q => { q.accounts[0].reason = 'x'.repeat(501); }],
  ['reason disallowed control', q => { q.accounts[0].reason = 'x\u0000y'; }], ['source exclusion blank', q => { q.sources[0].decision = 'exclude'; q.sources[0].reason = ''; }]
];
for (const [name, mutate] of queryMutations) test('closed query rejects ' + name, () => {
  const { state, query } = fixture(), { coordinator: c } = engine(C); mutate(query);
  expectThrow(() => c.preview(state, query), 'CASH_INVALID_QUERY');
});
for (const id of ['', 'prototype', 'constructor', '__proto__', '-first', 'a b', '汉', 'a'.repeat(101)]) test('query account ID rejects ' + JSON.stringify(id), () => {
  const { state, query } = fixture(), { coordinator: c } = engine(C); query.accounts[0].accountId = id;
  expectThrow(() => c.preview(state, query), 'CASH_INVALID_QUERY');
});

test('query reasons preserve permitted whitespace and 500 UTF-16 code units exactly', () => {
  const { state, query } = fixture(), { coordinator: c } = engine(C);
  query.accounts[0].reason = '🙂'.repeat(250); query.sources[0].reason = ' \tSynthetic\nreason\r ';
  const p = c.preview(state, query), review = consent({ reason: ' \tReviewed all\nlisted sources\r ' });
  const report = c.confirm(state, p.ticket, query, review);
  assert.equal(report.query.accounts[0].reason, query.accounts[0].reason); assert.equal(report.query.sources[0].reason, query.sources[0].reason);
  assert.equal(report.consent.reason, review.reason); assert.equal(support(report), 90000);
});

test('typed source identity preserves spaces and separator characters rather than trimming or concatenating', () => {
  const { state, query } = fixture({ anchorDate: DAY, transaction: false }), { coordinator: c } = engine(C);
  const sourceKeys = [' bank ', 'bank', 'import|account-cash|manual', 'a:b', 'a|b', '中'.repeat(100)];
  query.sources.push(...sourceKeys.map(sourceKey => ({ source: { kind: 'import', accountId: 'account-cash', sourceKey }, decision: 'include', reason: '', manualCoverage: null })));
  const p = c.preview(state, query), report = c.confirm(state, p.ticket, query, consent());
  assert.deepEqual(report.sources.filter(row => row.source.kind === 'import').map(row => row.source.sourceKey), [...sourceKeys].sort());
  assert.equal(support(report), 100000);
});

test('omitted accounts/sources remain unreviewed, unknown declared accounts are explicit even when excluded', () => {
  const { state, query } = fixture(), { coordinator: c } = engine(C);
  let q = { ...query, accounts: [], sources: [] }, p = c.preview(state, q), report = c.confirm(state, p.ticket, q, consent());
  assert.equal(report.accounts[0].decision, 'unreviewed'); assert.equal(report.sources[0].decision, 'unreviewed'); assert.equal(support(report), null);
  q = copy(query); q.accounts.push({ accountId: 'missing-account', decision: 'exclude', reason: 'Synthetic unknown declaration' });
  p = c.preview(state, q); report = c.confirm(state, p.ticket, q, consent());
  const missing = report.accounts.find(a => a.accountId === 'missing-account'); assert.equal(missing.role, 'missing'); assert.ok(missing.reasonCodes.includes('account-not-found')); assert.equal(support(report), null);
});

for (const date of ['0000-01-01', '10000-01-01', '1900-02-29', '2023-02-29', '2026-02-30', '2026-13-01', '2026-1-01', '2026-01-01T00:00:00.000Z', '', null]) test('strict invalid cutoff ' + JSON.stringify(date), () => {
  const { coordinator: c } = engine(C), state = legacy(1), query = queryFor(state); query.asOfDate = date;
  expectThrow(() => c.inspect(state, { asOfDate: date }), 'CASH_INVALID_DATE'); expectThrow(() => c.preview(state, query), 'CASH_INVALID_DATE');
});
for (const date of ['0001-01-01', '2000-02-29', '2024-02-29', '9999-12-31']) test('valid Gregorian boundary cutoff ' + date, () => {
  const { coordinator: c } = engine(C, NOW, '9999-12-31'), state = legacy(1);
  assert.equal(c.inspect(state, { asOfDate: date }).asOfDate, date);
});
test('future cutoff and closed inspect options fail without inventing an alternative date', () => {
  const { coordinator: c } = engine(C), state = legacy(1);
  expectThrow(() => c.inspect(state, { asOfDate: '2026-10-15' }), 'CASH_CUTOFF_IN_FUTURE');
  for (const options of [{}, { asOfDate: DAY, includeAll: true }, { asOfDate: DAY, accounts: [] }]) expectThrow(() => c.inspect(state, options), 'CASH_INVALID_QUERY');
});

const consentMutations = [
  ['missing reason', c => { delete c.reason; }], ['blank reason', c => { c.reason = ' \n'; }], ['501-unit reason', c => { c.reason = 'x'.repeat(501); }],
  ['control in reason', c => { c.reason = '\u007f'; }], ['extra field', c => { c.confirmed = true; }],
  ...['accountUniverseReviewed', 'sourceUniverseReviewed', 'userDeclarationsNotBankVerification', 'dayEndNotRealtime'].flatMap(key => [
    [key + ' false', c => { c[key] = false; }], [key + ' absent', c => { delete c[key]; }], [key + ' coercion', c => { c[key] = 'true'; }]
  ])
];
for (const [name, mutate] of consentMutations) test('consent is closed and attempt-consuming: ' + name, () => {
  const { state, query } = fixture(), { coordinator: c } = engine(C), p = c.preview(state, query), review = consent(); mutate(review);
  expectThrow(() => c.confirm(state, p.ticket, query, review), 'CASH_INVALID_CONSENT');
  expectThrow(() => c.confirm(state, p.ticket, query, consent()), 'CASH_REVIEW_USED');
});

test('review protocol hides all supported values until confirm and rejects replay', () => {
  const { state, query } = fixture(), { coordinator: c } = engine(C);
  const catalog = c.inspect(state, { asOfDate: DAY }), p = c.preview(state, query);
  assert.equal(catalog.reviewStatus, 'unreviewed'); assert.equal(p.report.reviewStatus, 'pending');
  assert.equal(support(p.report), null); assert.equal(p.report.totals.knownSupportedIncludedCents, null); assert.ok(p.report.accounts.every(a => a.supportedBasisCents === null));
  assert.equal(p.report.accounts[0].arithmeticCandidateCents, 90000);
  const report = c.confirm(state, p.ticket, query, consent()); assert.equal(report.reviewStatus, 'confirmed'); assert.equal(report.reviewedAt, NOW); assert.equal(report.todayAtReview, DAY); assert.equal(support(report), 90000);
  expectThrow(() => c.confirm(state, p.ticket, query, consent()), 'CASH_REVIEW_USED');
  assert.equal(c.isCurrent(state, report, query), true);
});

test('forged/cross-coordinator tickets neither authorize nor consume the genuine owner ticket', () => {
  const { state, query } = fixture(), { coordinator: a } = engine(C), { coordinator: b } = engine(C);
  const p = a.preview(state, query), other = b.preview(state, query);
  for (const ticket of [copy(p.ticket), {}, p.report, null, undefined, other.ticket]) expectThrow(() => a.confirm(state, ticket, query, consent()), 'CASH_REVIEW_USED');
  assert.equal(support(a.confirm(state, p.ticket, query, consent())), 90000);
  assert.equal(support(b.confirm(state, other.ticket, query, consent())), 90000);
});

test('new preview retires old tickets and confirmed reports even when replacement preview fails', () => {
  for (const fails of [false, true]) {
    const data = confirmed(C), { coordinator: c, state, query, report } = data;
    if (fails) expectThrow(() => c.preview(state, { ...query, unknown: true }), 'CASH_INVALID_QUERY'); else c.preview(state, query);
    assert.equal(c.isCurrent(state, report, query), false);
    const first = c.preview(state, query);
    if (fails) expectThrow(() => c.preview(state, { ...query, unknown: true }), 'CASH_INVALID_QUERY'); else c.preview(state, query);
    expectThrow(() => c.confirm(state, first.ticket, query, consent()), 'CASH_REVIEW_USED');
  }
});

test('cancel reports exact ownership and does not revoke unrelated live tickets or reports', () => {
  const { state, query } = fixture(), { coordinator: a } = engine(C), { coordinator: b } = engine(C);
  const live = a.preview(state, query), foreign = b.preview(state, query);
  for (const ticket of [null, {}, copy(live.ticket), foreign.ticket]) { const result = a.cancel(ticket); assert.deepEqual(result, { cancelled: false }); f.assertFrozen(result); }
  assert.deepEqual(a.cancel(live.ticket), { cancelled: true }); assert.deepEqual(a.cancel(live.ticket), { cancelled: false });
  expectThrow(() => a.confirm(state, live.ticket, query, consent()), 'CASH_REVIEW_USED');
  const report = b.confirm(state, foreign.ticket, query, consent()); assert.equal(b.isCurrent(state, report, query), true);
  assert.deepEqual(b.cancel(foreign.ticket), { cancelled: false }); assert.equal(b.isCurrent(state, report, query), true);
});

test('invalidateAll retires ticket and report generations permanently', () => {
  const data = confirmed(C), { coordinator: c, state, query, report } = data;
  assert.equal(c.invalidateAll(), undefined); assert.equal(c.isCurrent(state, report, query), false);
  const p = c.preview(state, query); c.invalidateAll(); expectThrow(() => c.confirm(state, p.ticket, query, consent()), 'CASH_REVIEW_USED');
  const next = c.preview(state, query), nextReport = c.confirm(state, next.ticket, query, consent()); assert.equal(c.isCurrent(state, nextReport, query), true); assert.equal(c.isCurrent(state, report, query), false);
});

test('inspect is observation only and does not invalidate a live same-day review', () => {
  const { state, query } = fixture(), { coordinator: c } = engine(C), p = c.preview(state, query);
  c.inspect(state, { asOfDate: DAY }); const report = c.confirm(state, p.ticket, query, consent());
  c.inspect(state, { asOfDate: DAY }); assert.equal(c.isCurrent(state, report, query), true);
});

test('canonical key order and normalized decision order are equivalent, raw array ordering is still state', () => {
  const { state, query } = fixture({ twoAccounts: true }), { coordinator: c } = engine(C);
  const p = c.preview(state, query), reordered = f.reverseKeys(query); reordered.accounts.reverse(); reordered.sources.reverse();
  const report = c.confirm(f.reverseKeys(state), p.ticket, reordered, f.reverseKeys(consent()));
  assert.equal(support(report), 110000); assert.equal(c.isCurrent(f.reverseKeys(state), report, reordered), true);
  const p2 = c.preview(state, query), changed = copy(state); changed.categories.reverse();
  expectThrow(() => c.confirm(changed, p2.ticket, query, consent()), 'CASH_STALE_REVIEW');
});

const staleStateChanges = [
  ['transaction note', s => { s.transactions[0].note = 'Synthetic corrected note'; }],
  ['transaction category', s => { s.transactions[0].categoryId = 'expense-food'; }],
  ['date with equal movement total', s => { s.transactions[0].date = '2026-10-13'; }],
  ['account display name', s => { s.accounts[0].name = 'Synthetic renamed account'; }],
  ['unrelated simulation extension', s => { s.simulation = S.defaultSettings(); }],
  ['legacy-tolerated root data', s => { s.legacyExtra = { retained: 'Synthetic boundary data' }; }]
];
for (const [name, mutate] of staleStateChanges) test('full-state ticket equality rejects ' + name + ' even if arithmetic agrees', () => {
  const { state, query } = fixture(), { coordinator: c } = engine(C), p = c.preview(state, query), changed = copy(state); mutate(changed); L.validateState(changed);
  expectThrow(() => c.confirm(changed, p.ticket, query, consent()), 'CASH_STALE_REVIEW'); expectThrow(() => c.confirm(state, p.ticket, query, consent()), 'CASH_REVIEW_USED');
});
for (const [name, mutate] of [
  ['account reason', q => { q.accounts[0].reason = 'Different review reason'; }],
  ['source reason', q => { q.sources[0].reason = 'Different source reason'; }],
  ['manual reason', q => { q.sources[0].manualCoverage.reason = 'Different coverage reason'; }],
  ['source decision', q => { q.sources[0].decision = 'unreviewed'; }],
  ['cutoff', q => { q.asOfDate = '2026-10-13'; }]
]) test('full normalized query equality rejects changed ' + name, () => {
  const { state, query } = fixture(), { coordinator: c } = engine(C), p = c.preview(state, query), changed = copy(query); mutate(changed);
  expectThrow(() => c.confirm(state, p.ticket, changed, consent()), 'CASH_STALE_REVIEW'); expectThrow(() => c.confirm(state, p.ticket, query, consent()), 'CASH_REVIEW_USED');
});

test('isCurrent is permanently one-way after valid-but-different state or query', () => {
  for (const kind of ['state', 'query']) {
    const { state, query, report, coordinator: c } = confirmed(C), s = copy(state), q = copy(query);
    if (kind === 'state') s.transactions[0].note = 'Changed'; else q.accounts[0].reason = 'Changed';
    assert.equal(c.isCurrent(s, report, q), false); assert.equal(c.isCurrent(state, report, query), false);
  }
});

test('forged reports cannot provide freshness and do not retire an owned valid report', () => {
  const { state, query, report, coordinator: c } = confirmed(C);
  for (const forged of [copy(report), {}, null, undefined, { totals: { supportedSelectedCents: 999999 } }]) assert.equal(c.isCurrent(state, forged, query), false);
  assert.equal(c.isCurrent(state, report, query), true);
});

for (const name of ['state getter', 'query getter', 'revoked proxy', 'sparse array', 'NaN', 'negative zero']) test('isCurrent hostile ' + name + ' returns false and permanently retires owned report', () => {
  const { state, query, report, coordinator: c } = confirmed(C); let s = copy(state), q = copy(query), calls = 0;
  if (name === 'state getter') Object.defineProperty(s.accounts[0], 'name', { enumerable: true, get() { calls++; return 'No'; } });
  if (name === 'query getter') Object.defineProperty(q, 'asOfDate', { enumerable: true, get() { calls++; return DAY; } });
  if (name === 'revoked proxy') { const proxy = Proxy.revocable(s, {}); proxy.revoke(); s = proxy.proxy; }
  if (name === 'sparse array') delete s.transactions[0];
  if (name === 'NaN') s.accounts[0].openingBalanceCents = NaN;
  if (name === 'negative zero') s.accounts[0].openingBalanceCents = -0;
  assert.equal(c.isCurrent(s, report, q), false); assert.equal(calls, 0); assert.equal(c.isCurrent(state, report, query), false);
});

test('unchanged clock is permitted; greatest observed clock is enforced across inspect, preview, confirm, currentness', () => {
  const { state, query } = fixture(), { coordinator: c, clock } = engine(C);
  const p = c.preview(state, query), report = c.confirm(state, p.ticket, query, consent()); assert.equal(c.isCurrent(state, report, query), true);
  clock.now = '2026-10-14T12:00:01.000Z'; c.inspect(state, { asOfDate: DAY });
  clock.now = '2026-10-14T12:00:00.999Z'; assert.equal(c.isCurrent(state, report, query), false);
  clock.now = '2026-10-14T12:00:02.000Z'; assert.equal(c.isCurrent(state, report, query), false);
});
test('one-millisecond rollback consumes confirm ticket', () => {
  const { state, query } = fixture(), { coordinator: c, clock } = engine(C), p = c.preview(state, query);
  clock.now = '2026-10-14T11:59:59.999Z'; expectThrow(() => c.confirm(state, p.ticket, query, consent()), 'CASH_CLOCK_ROLLBACK');
  clock.now = NOW; expectThrow(() => c.confirm(state, p.ticket, query, consent()), 'CASH_REVIEW_USED');
});
test('rollback detected during inspect invalidates a live ticket', () => {
  const { state, query } = fixture(), { coordinator: c, clock } = engine(C), p = c.preview(state, query);
  clock.now = '2026-10-14T11:59:59.999Z'; expectThrow(() => c.inspect(state, { asOfDate: DAY }), 'CASH_CLOCK_ROLLBACK');
  clock.now = NOW; expectThrow(() => c.confirm(state, p.ticket, query, consent()), 'CASH_REVIEW_USED');
});
for (const day of ['2026-10-15', '2026-10-13']) test('calendar change to ' + day + ' stales review without deriving local day from UTC now', () => {
  const { state, query } = fixture(), { coordinator: c, clock } = engine(C), p = c.preview(state, query);
  clock.today = day; expectThrow(() => c.confirm(state, p.ticket, query, consent()), 'CASH_STALE_REVIEW');
  clock.today = DAY; expectThrow(() => c.confirm(state, p.ticket, query, consent()), 'CASH_REVIEW_USED');
});
for (const [name, change] of [
  ['now throws', clock => { clock.nowError = new Error('clock unavailable'); }], ['today throws', clock => { clock.todayError = new Error('calendar unavailable'); }],
  ['now malformed', clock => { clock.now = 'bad'; }], ['today malformed', clock => { clock.today = '2026-02-30'; }],
  ['midnight forward', clock => { clock.today = '2026-10-15'; }], ['today backward', clock => { clock.today = '2026-10-13'; }]
]) test('currentness ' + name + ' is false and cannot resurrect', () => {
  const { state, query, report, coordinator: c, clock } = confirmed(C); change(clock);
  assert.equal(c.isCurrent(state, report, query), false);
  Object.assign(clock, { now: NOW, today: DAY, nowError: null, todayError: null }); assert.equal(c.isCurrent(state, report, query), false);
});

test('all read APIs preserve original state/export/old financial projection and deeply freeze detached results', () => {
  const { api, counts } = f.loadInstrumented(), data = fixture(), { coordinator: c } = engine(api);
  const state = f.deepFreeze(data.state), query = f.deepFreeze(data.query), review = f.deepFreeze(data.consent);
  const before = stateBytes(state), qBefore = stateBytes(query), consentBefore = stateBytes(review), exported = f.exportsOf(state), actuals = stateBytes(R.calculate(state));
  const observed = c.inspect(state, { asOfDate: DAY }), p = c.preview(state, query), report = c.confirm(state, p.ticket, query, review);
  assert.equal(c.isCurrent(state, report, query), true); c.cancel(p.ticket); c.invalidateAll(); assert.equal(c.isCurrent(state, report, query), false);
  for (const result of [observed, p, report]) { f.assertFrozen(result); f.assertDetached(result, state, query, review); }
  assert.equal(stateBytes(state), before); assert.equal(stateBytes(query), qBefore); assert.equal(stateBytes(review), consentBefore);
  assert.equal(f.exportsOf(state), exported); assert.equal(stateBytes(R.calculate(state)), actuals);
  assert.equal(counts.storageWrites, 0); assert.equal(counts.network, 0);
});

test('preview proof and query remain unchanged when caller later mutates raw input', () => {
  const { state, query } = fixture(), { coordinator: c } = engine(C), p = c.preview(state, query), original = stateBytes(p.report);
  state.transactions[0].note = 'Changed after capture'; query.sources[0].manualCoverage.reason = 'Changed after capture';
  assert.equal(stateBytes(p.report), original); expectThrow(() => c.confirm(state, p.ticket, query, consent()), 'CASH_STALE_REVIEW');
});

test('ordinary-data depth cap fails without recursive stack overflow or partial report', () => {
  const state = legacy(1); let nested = {}; state.extra = nested;
  for (let i = 0; i < 140; i++) { nested.child = {}; nested = nested.child; }
  const { coordinator: c } = engine(C); expectThrow(() => c.inspect(state, { asOfDate: DAY }), 'CASH_INPUT_LIMIT');
});

test('32 MiB canonical raw input boundary preserves legacy-tolerated data and rejects plus one', () => {
  const { coordinator: c } = engine(C), state = f.stateAtBytes(EXPECTED_LIMITS.inputBytes);
  const report = c.inspect(state, { asOfDate: DAY }); assert.equal(report.accounts.length, 1); assert.equal(bytes(state), EXPECTED_LIMITS.inputBytes);
  state.legacyRetainedText += 'x'; expectThrow(() => c.inspect(state, { asOfDate: DAY }), 'CASH_INPUT_LIMIT');
});

test('8 MiB valid canonical query passes query boundary; plus one fails before financial work', () => {
  const state = legacy(1), query = f.queryAtBytes(EXPECTED_LIMITS.queryBytes), { coordinator: c } = engine(C);
  // This exact legal query cannot fit twice into the complete result (query + source rows).
  expectThrow(() => c.preview(state, query), 'CASH_RESULT_LIMIT');
  const { api, counts } = f.loadInstrumented(), { coordinator: instrumented } = engine(api);
  const extra = f.queryAtBytes(EXPECTED_LIMITS.queryBytes + 1);
  expectThrow(() => instrumented.preview(state, extra), 'CASH_QUERY_LIMIT'); assert.equal(counts.calculate, 0); assert.equal(counts.reconciliation, 0);
});

test('10,001 distinct import source identities fail the source ceiling atomically', () => {
  const state = legacy(1), query = queryFor(state); query.sources.push(...Array.from({ length: 10001 }, (_, i) => f.importDecision(i)));
  const { coordinator: c } = engine(C); expectThrow(() => c.preview(state, query), 'CASH_SOURCE_LIMIT');
});


test('exact 8 MiB complete result seam counts preview ticket envelope and confirmed consent/time', () => {
  const { seams } = f.loadInstrumented({ seams: true });
  const makeExact = value => { value.report.padding = 'x'.repeat(EXPECTED_LIMITS.resultBytes - bytes(value)); assert.equal(bytes(value), EXPECTED_LIMITS.resultBytes); return value; };
  const envelope = makeExact({ ticket: {}, report: { padding: '' } });
  assert.equal(seams.resultLimit(envelope), envelope); f.assertFrozen(envelope);
  const plus = { ticket: {}, report: { padding: envelope.report.padding + 'x' } };
  expectThrow(() => seams.resultLimit(plus), 'CASH_RESULT_LIMIT');
  const report = { reviewedAt: NOW, consent: consent(), padding: '' };
  report.padding = 'x'.repeat(EXPECTED_LIMITS.resultBytes - bytes(report)); assert.equal(bytes(report), EXPECTED_LIMITS.resultBytes);
  assert.equal(seams.resultLimit(report), report); f.assertFrozen(report);
  expectThrow(() => seams.resultLimit({ ...report, padding: report.padding + 'x' }), 'CASH_RESULT_LIMIT');
});

test('actual preview/confirm enforce whole-envelope cap atomically at exact and plus-one test seams', () => {
  const { state, query } = fixture(), { coordinator: c } = engine(C), review = consent({ reason: '界'.repeat(500) });
  const p = c.preview(state, query), report = c.confirm(state, p.ticket, query, review), previewBytes = bytes(p), confirmedBytes = bytes(report);
  assert.ok(confirmedBytes > previewBytes, 'consent and timestamp must be included in final size');
  // Only the VM copy has a smaller result cap; the actual public methods and
  // limit algorithm are unchanged. Exact 8 MiB UTF-8 is checked above.
  for (const limit of [previewBytes, previewBytes - 1]) {
    const { api } = f.loadInstrumented({ resultBytes: limit }), { coordinator: testCoordinator } = engine(api);
    if (limit === previewBytes) assert.equal(bytes(testCoordinator.preview(state, query)), limit);
    else expectThrow(() => testCoordinator.preview(state, query), 'CASH_RESULT_LIMIT');
  }
  const { api: capped } = f.loadInstrumented({ resultBytes: confirmedBytes - 1 }), { coordinator: failed } = engine(capped);
  const ticket = failed.preview(state, query).ticket;
  expectThrow(() => failed.confirm(state, ticket, query, review), 'CASH_RESULT_LIMIT');
  expectThrow(() => failed.confirm(state, ticket, query, review), 'CASH_REVIEW_USED');
  const { api: exact } = f.loadInstrumented({ resultBytes: confirmedBytes }), { coordinator: successful } = engine(exact);
  const exactTicket = successful.preview(state, query).ticket;
  assert.equal(bytes(successful.confirm(state, exactTicket, query, review)), confirmedBytes);
});

test('pure checked reductions reject overflow before cancellation and retain signed endpoints', () => {
  const { seams } = f.loadInstrumented({ seams: true });
  assert.equal(seams.safe(BigInt(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  assert.equal(seams.safe(BigInt(Number.MIN_SAFE_INTEGER)), Number.MIN_SAFE_INTEGER);
  assert.equal(seams.sum([Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]), 0);
  expectThrow(() => seams.safe(BigInt(Number.MAX_SAFE_INTEGER) + 1n), 'CASH_AMOUNT_OVERFLOW');
  expectThrow(() => seams.safe(BigInt(Number.MIN_SAFE_INTEGER) - 1n), 'CASH_AMOUNT_OVERFLOW');
  expectThrow(() => seams.sum([Number.MAX_SAFE_INTEGER, 1, -1]), 'CASH_AMOUNT_OVERFLOW');
  expectThrow(() => seams.sum([Number.MIN_SAFE_INTEGER, -1, 1]), 'CASH_AMOUNT_OVERFLOW');
});

test('currentness performs no legacy validation or direct financial calculation', () => {
  const { api, counts } = f.loadInstrumented(), { state, query } = fixture(), { coordinator: c } = engine(api);
  const p = c.preview(state, query), report = c.confirm(state, p.ticket, query, consent()), before = { ...counts };
  assert.equal(c.isCurrent(copy(state), report, copy(query)), true); assert.deepEqual(counts, before);
  const changed = copy(state); changed.transactions[0].note = 'Changed';
  assert.equal(c.isCurrent(changed, report, query), false); assert.deepEqual(counts, before);
});

for (const payloadKind of ['revoked', 'throwing-prototype', 'code-accessor']) {
  test('thrown hostile payload is sanitized across every boundary: ' + payloadKind, () => {
    let payloadReads = 0;
    let payload;
    if (payloadKind === 'revoked') { const r = Proxy.revocable({}, {}); r.revoke(); payload = r.proxy; }
    else if (payloadKind === 'throwing-prototype') payload = new Proxy({}, { getPrototypeOf() { payloadReads++; throw new Error('Nested untrusted trap'); } });
    else payload = Object.defineProperty({}, 'code', { get() { payloadReads++; throw new Error('Do not read exception getter'); } });
    const traps = value => new Proxy(value, { ownKeys() { throw payload; } });
    const data = fixture(), { coordinator: c } = engine(C);
    expectThrow(() => c.inspect(traps(data.state), { asOfDate: DAY }), 'CASH_INVALID_DATA');
    expectThrow(() => c.inspect(data.state, traps({ asOfDate: DAY })), 'CASH_INVALID_QUERY');
    expectThrow(() => c.preview(data.state, traps(data.query)), 'CASH_INVALID_QUERY');
    const ticket = c.preview(data.state, data.query).ticket;
    expectThrow(() => c.confirm(data.state, ticket, data.query, traps(data.consent)), 'CASH_INVALID_CONSENT');
    expectThrow(() => c.confirm(data.state, ticket, data.query, data.consent), 'CASH_REVIEW_USED');
    expectThrow(() => C.createCoordinator(traps({ now: () => NOW, today: () => DAY })), 'CASH_INVALID_DATA');
    expectThrow(() => C.createCoordinator({ now() { throw payload; }, today: () => DAY }), 'CASH_INVALID_DATA');
    const reviewed = confirmed(C);
    assert.equal(reviewed.coordinator.isCurrent(traps(reviewed.state), reviewed.report, reviewed.query), false);
    assert.equal(reviewed.coordinator.isCurrent(reviewed.state, reviewed.report, reviewed.query), false);
    assert.equal(payloadReads, 0, 'catch paths must not inspect thrown payload prototype or code getter');
  });
}

test('replayed mutated cash error is reconstructed only from private original metadata', () => {
  const { coordinator: c } = engine(C), state = legacy(1);
  let prior; try { c.inspect(null, { asOfDate: DAY }); } catch (error) { prior = error; }
  assert.equal(prior.code, 'CASH_INVALID_DATA');
  prior.financialPartialResult = state; prior.name = 'Attacker';
  Object.defineProperty(prior, 'code', { get() { throw new Error('Mutated error getter'); } });
  Object.defineProperty(prior, 'message', { get() { throw new Error('Mutated message getter'); } });
  expectThrow(() => c.inspect(new Proxy(state, { ownKeys() { throw prior; } }), { asOfDate: DAY }), 'CASH_INVALID_DATA');
});

test('legacy catch contains hostile thrown payloads without reading code accessors', () => {
  const filename = path.join(f.root, 'dist/cash-basis.js');
  for (const kind of ['revoked', 'descriptor-trap', 'code-getter', 'overflow']) {
    let getterCalls = 0, payload;
    if (kind === 'revoked') { const r = Proxy.revocable({}, {}); r.revoke(); payload = r.proxy; }
    else if (kind === 'descriptor-trap') payload = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('Nested descriptor failure'); } });
    else if (kind === 'code-getter') payload = Object.defineProperty({}, 'code', { get() { getterCalls++; throw new Error('Untrusted getter'); } });
    else payload = { code: 'AMOUNT_OVERFLOW' };
    const sandbox = { module: { exports: {} }, require(name) { if (name === './ledger.js') return { ...L, validateState() { throw payload; } }; throw new Error('Unexpected dependency'); } };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
    const api = sandbox.module.exports, c = api.createCoordinator({ now: () => NOW, today: () => DAY });
    expectThrow(() => c.inspect(legacy(1), { asOfDate: DAY }), kind === 'overflow' ? 'CASH_AMOUNT_OVERFLOW' : 'CASH_INVALID_DATA');
    assert.equal(getterCalls, 0);
  }
});
