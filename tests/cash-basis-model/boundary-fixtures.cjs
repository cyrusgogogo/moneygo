'use strict';
// Synthetic-only fixtures for the read-only v0.18 boundary and lifecycle tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const L = require('../../dist/ledger.js');
const R = require('../../dist/relations.js');
const O = require('../../dist/obligations.js');
const G = require('../../dist/organizer.js');
const S = require('../../dist/scenario.js');
const DAY = '2026-10-14';
const NOW = '2026-10-14T12:00:00.000Z';
const copy = value => JSON.parse(JSON.stringify(value));
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const extensions = ['simulation', 'imports', 'bookkeeping', 'organizer', 'obligations', 'incomePlanning', 'spendingPlanning'];
const ERROR_CODES = ['CASH_INVALID_DATA', 'CASH_INVALID_QUERY', 'CASH_INVALID_DATE', 'CASH_CUTOFF_IN_FUTURE', 'CASH_INPUT_LIMIT', 'CASH_QUERY_LIMIT', 'CASH_RESULT_LIMIT', 'CASH_SOURCE_LIMIT', 'CASH_AMOUNT_OVERFLOW', 'CASH_STALE_REVIEW', 'CASH_REVIEW_USED', 'CASH_INVALID_CONSENT', 'CASH_CLOCK_ROLLBACK', 'CASH_INVARIANT'];

function legacy(version) {
  const state = L.createEmpty();
  state.version = version;
  if (version === 2) state.simulation = S.defaultSettings();
  if (version === 3) state.imports = { version: 2, revision: 0, templates: [], evidence: [], batches: [], quarantine: [], coverage: [], audit: [] };
  if (version === 4) state.bookkeeping = R.defaultState();
  if (version === 5) state.organizer = G.defaultState();
  if (version === 6) state.obligations = O.defaultState();
  if (version === 7) state.incomePlanning = { version: 1, revision: 0, plans: [], receipts: [], audit: [] };
  if (version === 8) state.spendingPlanning = { version: 1, revision: 0, plans: [], payments: [], audit: [] };
  assert.equal(L.validateState(state).version, version);
  return state;
}
function profile(state, accountId = 'account-cash') {
  return O.putProfile(state, { accountId, role: 'cash', creditLimitCents: null, note: '' }, {
    confirmed: true, expectedRevision: state.obligations?.revision || 0, reason: 'Synthetic cash role review'
  });
}
function fixture({ anchorDate = '2026-10-10', cutoff = DAY, twoAccounts = false, transaction = true } = {}) {
  let state = L.putAccount(L.createEmpty(), { name: 'Synthetic cash', openingBalanceCents: 100000 }, 'account-cash');
  if (twoAccounts) state = L.putAccount(state, { name: 'Synthetic second account', openingBalanceCents: 20000 });
  for (const account of state.accounts) state = profile(state, account.id);
  for (const account of state.accounts) state = R.addSnapshot(state, {
    accountId: account.id, date: anchorDate, actualBalanceCents: account.openingBalanceCents, note: 'Synthetic day-end anchor'
  });
  if (transaction) state = L.putTransaction(state, { type: 'expense', date: '2026-10-12', amountCents: 10000, accountId: 'account-cash', categoryId: 'expense-other', note: 'Synthetic movement' });
  return { state, query: queryFor(state, { asOfDate: cutoff, anchorDate }), consent: consent() };
}
function queryFor(state, { asOfDate = DAY, anchorDate = '2026-10-10' } = {}) {
  return {
    asOfDate,
    accounts: state.accounts.map(account => ({ accountId: account.id, decision: 'include', reason: '' })),
    sources: state.accounts.map(account => ({
      source: { kind: 'manual', accountId: account.id, sourceKey: null }, decision: 'include', reason: '',
      manualCoverage: anchorDate === asOfDate ? null : { start: '2026-10-11', end: asOfDate, allUnimportedMovementsRecorded: true, reason: 'Synthetic review of all unimported movements' }
    }))
  };
}
function consent(patch = {}) {
  return { accountUniverseReviewed: true, sourceUniverseReviewed: true, userDeclarationsNotBankVerification: true, dayEndNotRealtime: true, reason: 'Synthetic review of all displayed accounts and sources', ...patch };
}
function engine(api, at = NOW, day = DAY) {
  const clock = { now: at, today: day, nowError: null, todayError: null };
  const coordinator = api.createCoordinator({
    now() { if (clock.nowError) throw clock.nowError; return clock.now; },
    today() { if (clock.todayError) throw clock.todayError; return clock.today; }
  });
  return { coordinator, clock };
}
function confirmed(api, options = {}) {
  const data = fixture(options), { coordinator, clock } = engine(api);
  const preview = coordinator.preview(data.state, data.query);
  const report = coordinator.confirm(data.state, preview.ticket, data.query, data.consent);
  return { ...data, coordinator, clock, ticket: preview.ticket, report };
}
function deepFreeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
  return value;
}
function assertFrozen(value) {
  if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) assertFrozen(child); }
}
function assertDetached(output, ...inputs) {
  const refs = new WeakSet();
  function add(value) { if (value && typeof value === 'object' && !refs.has(value)) { refs.add(value); Object.values(value).forEach(add); } }
  inputs.forEach(add);
  const seen = new WeakSet();
  function check(value) { if (value && typeof value === 'object' && !seen.has(value)) { seen.add(value); assert.equal(refs.has(value), false, 'output must not share any input object'); Object.values(value).forEach(check); } }
  check(output);
}
function cashError(code) {
  return error => {
    assert.equal(error.name, 'CashBasisError');
    assert.ok(ERROR_CODES.includes(error.code), error.code);
    if (code) assert.equal(error.code, code);
    assert.equal(typeof error.message, 'string'); assert.ok(error.message.trim());
    for (const key of Reflect.ownKeys(error)) assert.ok(['name', 'code', 'message', 'stack'].includes(key), 'no partial financial output on error: ' + String(key));
    return true;
  };
}
function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).reverse().map(key => [key, reverseKeys(value[key])]));
  return value;
}
function crossRealm(value) { return vm.runInNewContext('JSON.parse(raw)', { raw: JSON.stringify(value) }); }
function exportsOf(state) { return JSON.stringify(JSON.parse(L.backup(state)).data); }
function importDecision(index, reason = '') {
  return { source: { kind: 'import', accountId: 'account-cash', sourceKey: 's' + String(index).padStart(5, '0') }, decision: 'include', reason, manualCoverage: null };
}
function stateAtBytes(target) {
  const state = legacy(1); state.legacyRetainedText = '';
  const padding = target - bytes(state); assert.ok(padding >= 0);
  state.legacyRetainedText = 'x'.repeat(padding);
  assert.equal(bytes(state), target); return state;
}
function queryAtBytes(target) {
  const query = { asOfDate: DAY, accounts: [{ accountId: 'account-cash', decision: 'include', reason: '' }], sources: Array.from({ length: 6000 }, (_, i) => importDecision(i)) };
  let remaining = target - bytes(query); assert.ok(remaining >= 0);
  for (const row of query.sources) {
    const unicodeCount = Math.min(500, Math.floor(remaining / 3));
    row.reason = '界'.repeat(unicodeCount); remaining -= unicodeCount * 3;
    const asciiCount = Math.min(500 - unicodeCount, remaining); row.reason += 'x'.repeat(asciiCount); remaining -= asciiCount;
    if (!remaining) break;
  }
  assert.equal(remaining, 0, 'query padding must fit legal reason lengths');
  assert.equal(bytes(query), target); return query;
}
function loadInstrumented(options = {}) {
  const filename = path.join(root, 'dist/cash-basis.js'), localRequire = createRequire(filename);
  const counts = { validation: 0, calculate: 0, reconciliation: 0, storageWrites: 0, network: 0 };
  const validated = [];
  // The instrumented coordinator runs in a VM while the pinned modules run in
  // this test realm. Marshal its already-detached snapshot at that artificial
  // boundary; production modules all share one realm. The public cross-realm
  // test exercises real CJS capture without this instrumentation.
  const ledger = { ...L, validateState(value) { counts.validation++; validated.push(value); return L.validateState(copy(value)); } };
  const relations = { ...R, calculate(...args) { counts.calculate++; return R.calculate(...args); }, reconciliation(...args) { counts.reconciliation++; return R.reconciliation(...args); } };
  const storage = { getItem() { throw new Error('Storage is not a capability'); }, setItem() { counts.storageWrites++; throw new Error('Storage write forbidden'); }, removeItem() { counts.storageWrites++; throw new Error('Storage write forbidden'); }, clear() { counts.storageWrites++; throw new Error('Storage write forbidden'); } };
  const sandbox = { module: { exports: {} }, exports: {}, Buffer, TextEncoder, console,
    require(name) { if (/\/(?:ledger)(?:\.js)?$/.test(name)) return ledger; if (/\/(?:relations)(?:\.js)?$/.test(name)) return relations; return localRequire(name); },
    localStorage: storage, sessionStorage: storage, fetch() { counts.network++; throw new Error('Network forbidden'); }
  };
  let source = fs.readFileSync(filename, 'utf8');
  if (options.resultBytes !== undefined) {
    assert.ok(Number.isSafeInteger(options.resultBytes) && options.resultBytes > 0);
    const changed = source.replace(/resultBytes\s*:\s*8388608/, 'resultBytes:' + options.resultBytes);
    assert.notEqual(changed, source, 'test-only cap seam must match exactly'); source = changed;
  }
  if (options.seams) {
    const marker = /return Object\.freeze\(\{VERSION,LIMITS,createCoordinator\}\);/;
    assert.ok(marker.test(source), 'test-only pure seam must match exactly');
    source = source.replace(marker, 'root.__cashBoundarySeams = Object.freeze({detach,resultLimit,canonical,utf8,safe,sum,gaps}); return Object.freeze({VERSION,LIMITS,createCoordinator});');
  }
  vm.runInNewContext(source, sandbox, { filename });
  return { api: sandbox.module.exports, counts, validated, sandbox, seams: sandbox.__cashBoundarySeams };
}
module.exports = { root, L, R, O, G, S, DAY, NOW, copy, bytes, extensions, ERROR_CODES, legacy, profile, fixture, queryFor, consent, engine, confirmed, deepFreeze, assertFrozen, assertDetached, cashError, reverseKeys, crossRealm, exportsOf, importDecision, stateAtBytes, queryAtBytes, loadInstrumented };
