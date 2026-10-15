'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../dist/backup-safety.js');
const L = require('../dist/ledger.js');
const C = require('../dist/obligations.js');
const T = '2026-10-14T12:00:00.000Z', MS = Date.parse(T), DAY = 86400000;
const NOTE_FIELDS = ['kind', 'version', 'completedAt', 'backupVersion', 'verifierRevision'];
const copy = value => JSON.parse(JSON.stringify(value));
const note = patch => ({ kind: 'moneygo-backup-verification-note', version: 1, completedAt: T, backupVersion: 6, verifierRevision: 1, ...patch });
const rawNote = patch => JSON.stringify(note(patch));
const failure = () => { throw new Error('Synthetic denied adapter containing PRIVATE ERROR'); };
function storage(raw = null) {
  return {
    raw, calls: [],
    getItem(key) { assert.equal(key, B.NOTE_KEY); this.calls.push(['get', key]); return this.raw; },
    setItem(key, value) { assert.equal(key, B.NOTE_KEY); this.calls.push(['set', key, value]); this.raw = value; },
    removeItem(key) { assert.equal(key, B.NOTE_KEY); this.calls.push(['remove', key]); this.raw = null; }
  };
}
function controller(s = storage(), extras = {}) {
  return B.create({ verifyBackup: L.verifyBackup.bind(L), metadataStorage: s, now: () => MS, ...extras });
}
function diagnosticResult(time = T, version = 6) { return { verifiedAt: time, state: { version } }; }
function diagnosticController(s = storage(), result = diagnosticResult(), extras = {}) {
  return controller(s, { verifyBackup: () => result, ...extras });
}
function realV6() {
  let state = L.putTransaction(L.createEmpty(), { type: 'expense', date: '2026-10-01', amountCents: 12345, accountId: 'account-cash', categoryId: 'expense-other', note: 'PRIVATE_SYNTHETIC_NOTE' });
  state = C.putProfile(state, { accountId: 'account-cash', role: 'cash', creditLimitCents: null, note: 'PRIVATE_PROFILE_NOTE' }, { confirmed: true, expectedRevision: 0, reason: 'Synthetic explicit review' });
  return state;
}
function event(target, operation, outcome, extras = {}) { return { target, operation, outcome, ...extras }; }

test('backup safety exports frozen UMD and CommonJS without DOM or optional browser APIs', () => {
  assert.ok(Object.isFrozen(B)); assert.deepEqual(Object.keys(B), ['NOTE_KEY', 'create']);
  const source = fs.readFileSync(path.join(__dirname, '../dist/backup-safety.js'), 'utf8');
  const window = {};
  vm.runInNewContext(source, { window });
  assert.equal(window.MoneygoBackupSafety.NOTE_KEY, B.NOTE_KEY);
  const api = window.MoneygoBackupSafety.create({ verifyBackup: L.verifyBackup.bind(L), metadataStorage: storage() });
  assert.ok(Object.isFrozen(api)); assert.equal(api.view().sessionVerification.status, 'absent');
  const global = {}; vm.runInNewContext(source, global); assert.equal(global.MoneygoBackupSafety.NOTE_KEY, B.NOTE_KEY);
  assert.doesNotMatch(source, /moneygo\.ledger|beforeRestore|\blocalStorage\b|\bnavigator\b|\bcrypto\b|TextEncoder|\.save\s*\(/);
});

test('real current v6 verification returns exact independent result and writes only bounded diagnostic fields', () => {
  const state = realV6(), before = JSON.stringify(state), text = L.backup(state), s = storage();
  let count = 0, returned;
  const c = controller(s, { verifyBackup: text => { count++; returned = L.verifyBackup(text); return returned; } });
  const result = c.verifySelectedBackup(text);
  assert.equal(count, 1); assert.equal(result.verification, returned); assert.equal(result.notePersistence, 'recorded');
  assert.deepEqual(returned.state, state); assert.notEqual(returned.state, state);
  assert.equal(returned.balances['account-cash'], -12345); assert.equal(JSON.stringify(state), before);
  const persisted = JSON.parse(s.raw);
  assert.deepEqual(Object.keys(persisted), NOTE_FIELDS);
  assert.equal(persisted.completedAt, returned.verifiedAt); assert.equal(persisted.backupVersion, 6);
  assert.ok(s.raw.length <= 512); assert.match(s.raw, /^[\x00-\x7f]*$/);
  assert.doesNotMatch(s.raw, /PRIVATE|counts|balances|account|transaction|exportedAt|filename|path|hash|12345/);
  assert.deepEqual(s.calls.map(call => call[0]), ['get', 'set', 'get']);
  const view = c.view({ ledgerRead: 'present', blocked: true, stale: true });
  assert.equal(view.sessionVerification.status, 'session-passed'); assert.equal(view.storedNote.status, 'recorded-only');
  assert.equal(view.blocked, true); assert.equal(view.stale, true);
  assert.equal(view.currentLedgerCoverage, 'not-assessed'); assert.equal(view.fileRetention, 'not-assessed');
  assert.equal(view.capacity, 'unknown'); assert.equal(view.scope, 'selected-file-only');
  returned.verifiedAt = 'forged'; returned.state.version = 999; returned.state.accounts[0].name = 'mutated';
  assert.equal(c.view().sessionVerification.completedAt, persisted.completedAt);
  assert.equal(c.view().sessionVerification.backupVersion, 6);
  assert.equal(JSON.stringify(state), before);
});

const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/legacy-outer-v1-v5.json'), 'utf8'));
for (const fixture of legacy) test(`real frozen outer-v${fixture.version} backup verifies without upgrading its provenance`, () => {
  const s = storage(), c = controller(s), text = JSON.stringify(fixture), expected = L.parseBackup(text);
  const result = c.verifySelectedBackup(text);
  assert.deepEqual(result.verification.state, expected); assert.equal(result.notePersistence, 'recorded');
  assert.equal(JSON.parse(s.raw).backupVersion, fixture.version);
  assert.deepEqual(result.verification.balances, L.balances(expected));
  assert.equal(c.view().sessionVerification.status, 'session-passed');
});

test('real invalid file rejection preserves the exact error and earlier success/history without note I/O', () => {
  const s = storage(), c = controller(s); c.verifySelectedBackup(L.backup(realV6()));
  const before = copy(c.view()), raw = s.raw, calls = s.calls.length;
  assert.throws(() => c.verifySelectedBackup('{bad'), error => error instanceof L.LedgerError);
  assert.equal(s.raw, raw); assert.equal(s.calls.length, calls); assert.deepEqual(c.view(), before);
  const original = new Error('original verifier failure'), d = controller(storage(), { verifyBackup: () => { throw original; } });
  assert.throws(() => d.verifySelectedBackup('raw private input'), error => error === original);
  assert.equal(d.view().sessionVerification.status, 'absent');
});

test('real malformed current backups never create a success or metadata write', () => {
  for (const corrupt of [b => b.version = 99, b => b.data.transactions[0].amountCents = 0.5,
    b => b.data.obligations.audit[0].after.accountId = 'missing', b => b.data.obligations.revision++]) {
    const backup = JSON.parse(L.backup(realV6())); corrupt(backup);
    const s = storage(), c = controller(s);
    assert.throws(() => c.verifySelectedBackup(JSON.stringify(backup)));
    assert.equal(c.view().sessionVerification.status, 'absent');
    assert.deepEqual(s.calls.map(call => call[0]), ['get']);
  }
});

test('startup and refresh are read-only and fabricated metadata never becomes live provenance', () => {
  const s = storage(rawNote()), c = controller(s);
  for (let i = 0; i < 3; i++) {
    const h = c.refreshHistory(), v = c.view();
    assert.equal(h.status, 'recorded-only'); assert.equal(v.sessionVerification.status, 'absent');
    assert.equal(v.notePersistence, 'not-attempted'); assert.equal(v.currentLedgerCoverage, 'not-assessed');
  }
  assert.ok(s.calls.every(call => call[0] === 'get'));
  assert.equal(controller(s).view().sessionVerification.status, 'absent');
});

test('equal timestamps and independent returned file results never merge session and recorded provenance', () => {
  const s = storage(), c = diagnosticController(s); c.verifySelectedBackup('selected A');
  s.raw = rawNote({ backupVersion: 5 }); c.refreshHistory();
  const v = c.view();
  assert.equal(v.sessionVerification.status, 'session-passed'); assert.equal(v.sessionVerification.backupVersion, 6);
  assert.equal(v.storedNote.status, 'recorded-only'); assert.equal(v.storedNote.backupVersion, 5);
  assert.equal(v.notePersistence, 'not-confirmed');
  assert.equal(controller(s).view().sessionVerification.status, 'absent');
});

const malformedNotes = [null, [], {}, 1, true, 'text', { ...note(), extra: 'x' },
  { ...note(), version: 2 }, { ...note(), version: '1' }, { ...note(), verifierRevision: 2 },
  { ...note(), kind: 'unknown' }, { ...note(), backupVersion: 0 }, { ...note(), backupVersion: -1 },
  { ...note(), backupVersion: 65536 }, { ...note(), backupVersion: '6' }, { ...note(), backupVersion: 1.1 },
  { ...note(), completedAt: '2026-02-29T12:00:00.000Z' }, { ...note(), completedAt: '2026-04-31T12:00:00.000Z' },
  { ...note(), completedAt: '2026-10-14T12:00:00Z' }, { ...note(), completedAt: '2026-10-14T12:00:00.000+00:00' },
  { ...note(), completedAt: '2026-10-14' }, { ...note(), completedAt: MS }, { ...note(), completedAt: '<script>x()</script>' }];
for (let i = 0; i < malformedNotes.length; i++) test(`strict note schema rejects malformed fixture ${i}`, () => {
  const s = storage(JSON.stringify(malformedNotes[i])), c = controller(s);
  assert.equal(c.view().storedNote.status, 'invalid'); assert.equal(c.view().sessionVerification.status, 'absent');
  assert.deepEqual(s.calls.map(call => call[0]), ['get']);
});

test('missing fields, prototype properties, truncated JSON and non-string storage results are rejected', () => {
  const bad = NOTE_FIELDS.map(key => { const value = note(); delete value[key]; return JSON.stringify(value); });
  bad.push('', '{', rawNote().slice(0, -1), rawNote().replace('"version":1', '"__proto__":{},"version":1'), undefined, 0, {}, []);
  for (const raw of bad) { const s = storage(); s.raw = raw; assert.equal(controller(s).view().storedNote.status, 'invalid'); assert.equal(s.calls.length, 1); }
});

test('pre-parse length cap rejects oversized strings without parsing, repairing or executing them', () => {
  let parses = 0;
  const context = { window: {}, JSON: { parse(text) { parses++; return JSON.parse(text); }, stringify: JSON.stringify } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/backup-safety.js'), 'utf8'), context);
  const s = storage(' '.repeat(513));
  const c = context.window.MoneygoBackupSafety.create({ verifyBackup: L.verifyBackup.bind(L), metadataStorage: s });
  assert.equal(c.view().storedNote.status, 'invalid'); assert.equal(parses, 0);
  assert.deepEqual(s.calls.map(call => call[0]), ['get']);
});

test('canonical leap-day, ancient dates and maximum bounded future version are informational only', () => {
  for (const completedAt of ['0000-01-01T00:00:00.000Z', '1900-01-01T00:00:00.000Z', '2028-02-29T00:00:00.000Z', '9999-12-31T23:59:59.999Z']) {
    const v = controller(storage(rawNote({ completedAt, backupVersion: 65535 }))).view();
    assert.equal(v.storedNote.status, 'recorded-only'); assert.equal(v.sessionVerification.status, 'absent');
  }
});

for (const [name, offset, status, days] of [
  ['future', -1, 'clock-anomaly', null], ['exact', 0, 'recent', 0], ['just below 30 days', 30 * DAY - 1, 'recent', 29],
  ['exactly 30 days', 30 * DAY, 'old', 30], ['above 30 days', 30 * DAY + 1, 'old', 30]
]) test(`age semantics: ${name}`, () => {
  const c = controller(storage(rawNote()), { now: () => MS + offset });
  assert.deepEqual(c.view().storedNote.age, { status, elapsedDays: days });
});

for (const [name, clock] of [['throwing', failure], ['NaN', () => NaN], ['infinity', () => Infinity], ['string', () => String(MS)],
  ['object', () => new Date(MS)], ['undefined result', () => undefined], ['null result', () => null], ['out of date range', () => 9e15], ['invalid callable', null]]) {
  test(`unknown age for ${name} clock does not change a real successful verification`, () => {
    const s = storage(), c = controller(s, { now: clock });
    const result = c.verifySelectedBackup(L.backup(realV6()));
    assert.equal(result.notePersistence, 'recorded'); assert.equal(c.view().sessionVerification.status, 'session-passed');
    assert.equal(c.view().storedNote.age.status, 'unknown');
  });
}

test('age is recomputed from one clock sample per view and backward time is not clamped', () => {
  let time = MS, calls = 0;
  const c = diagnosticController(storage(), diagnosticResult(), { now: () => { calls++; return time; } });
  c.verifySelectedBackup('diagnostic-only'); const before = calls;
  assert.equal(c.view().sessionVerification.age.status, 'recent'); assert.equal(calls, before + 1);
  time--; const v = c.view(); assert.equal(v.sessionVerification.age.status, 'clock-anomaly'); assert.equal(v.storedNote.age.status, 'clock-anomaly');
});

for (const time of [undefined, null, '', MS, '2026-02-29T00:00:00.000Z', '2026-10-14T12:00:00Z']) test(`invalid verifier completion time ${String(time)} skips note without inventing now`, () => {
  const s = storage(rawNote({ completedAt: '2026-10-01T00:00:00.000Z' }));
  const result = { verifiedAt: time, state: { version: 6 } }, c = diagnosticController(s, result);
  assert.equal(c.verifySelectedBackup('diagnostic-only').verification, result);
  const v = c.view(); assert.equal(v.notePersistence, 'skipped-invalid-time');
  assert.equal(v.sessionVerification.status, 'session-passed'); assert.equal(v.sessionVerification.completedAt, null);
  assert.equal(v.storedNote.completedAt, '2026-10-01T00:00:00.000Z'); assert.equal(s.calls.length, 1);
});

test('throwing diagnostic result accessors cannot invalidate returned verifier result', () => {
  const result = { get verifiedAt() { failure(); }, get state() { failure(); } }, s = storage(), c = diagnosticController(s, result);
  assert.equal(c.verifySelectedBackup('diagnostic-only').verification, result);
  assert.equal(c.view().sessionVerification.status, 'session-passed'); assert.equal(c.view().sessionVerification.completedAt, null);
  assert.equal(s.calls.length, 1);
});

test('diagnostic fields are captured once rather than rereading unstable getters', () => {
  let times = 0, versions = 0;
  const result = { get verifiedAt() { return ++times === 1 ? T : 'untrusted'; }, state: { get version() { return ++versions === 1 ? 6 : 'untrusted'; } } };
  const s = storage(), c = diagnosticController(s, result); c.verifySelectedBackup('diagnostic-only');
  assert.equal(times, 1); assert.equal(versions, 1); assert.equal(JSON.parse(s.raw).completedAt, T); assert.equal(JSON.parse(s.raw).backupVersion, 6);
});

test('invalid diagnostic version skips recording while preserving successful verification', () => {
  for (const version of [undefined, null, 0, -1, 65536, '6', 1.5, Infinity]) {
    const s = storage(), c = diagnosticController(s, { verifiedAt: T, state: { version } });
    c.verifySelectedBackup('diagnostic-only');
    assert.equal(c.view().sessionVerification.status, 'session-passed'); assert.equal(c.view().notePersistence, 'skipped-invalid-version'); assert.equal(s.calls.length, 1);
  }
});

test('the completion time comes from the verifier, not export metadata or age clock', () => {
  const s = storage(), result = diagnosticResult(T), c = diagnosticController(s, result, { now: () => MS + 9 * DAY });
  c.verifySelectedBackup('{"exportedAt":"1900-01-01T00:00:00.000Z"}');
  assert.equal(JSON.parse(s.raw).completedAt, T); assert.equal(c.view().sessionVerification.age.elapsedDays, 9);
});

for (const [name, adapter] of [['missing', undefined], ['null', null], ['empty', {}], ['read throws', { getItem: failure }],
  ['method getters throw', Object.defineProperties({}, { getItem: { get: failure }, setItem: { get: failure }, removeItem: { get: failure } })]]) {
  test(`unavailable metadata: ${name} cannot invalidate a real file pass`, () => {
    const c = controller(storage(), { metadataStorage: adapter }); assert.equal(c.view().storedNote.status, 'unreadable');
    const result = c.verifySelectedBackup(L.backup(realV6()));
    assert.equal(result.notePersistence, 'failed'); assert.equal(c.view().sessionVerification.status, 'session-passed');
    assert.doesNotThrow(() => c.refreshHistory()); assert.equal(c.releaseHistoryForWrite().status, 'failed');
  });
}

test('failed note write preserves old valid history and successful real verifier output', () => {
  const old = rawNote({ completedAt: '2026-01-01T00:00:00.000Z' }), s = storage(old), c = controller(s);
  s.setItem = function (key) { this.calls.push(['set', key]); failure(); };
  const result = c.verifySelectedBackup(L.backup(realV6()));
  assert.equal(result.notePersistence, 'failed'); assert.equal(result.verification.state.version, 6);
  assert.equal(s.raw, old); assert.equal(c.view().storedNote.completedAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(s.calls.map(call => call[0]), ['get', 'set']);
});

for (const mode of ['throwing', 'mismatch', 'silent-set']) test(`note readback ${mode} never rolls back or reverses verification`, () => {
  const s = storage(), c = controller(s);
  if (mode === 'throwing') s.getItem = function (key) { this.calls.push(['get', key]); failure(); };
  else if (mode === 'mismatch') s.getItem = function (key) { this.calls.push(['get', key]); return rawNote({ backupVersion: 5 }); };
  else s.setItem = function (key, value) { this.calls.push(['set', key, value]); };
  const result = c.verifySelectedBackup(L.backup(realV6()));
  assert.equal(result.notePersistence, 'not-confirmed'); assert.equal(c.view().sessionVerification.status, 'session-passed');
  assert.deepEqual(s.calls.map(call => call[0]), ['get', 'set', 'get']);
});

test('refresh mismatch, removal or unreadable history invalidates prior persistence confirmation without creating new success', () => {
  for (const next of [null, rawNote({ backupVersion: 5 }), '{bad', failure]) {
    const s = storage(), c = diagnosticController(s); c.verifySelectedBackup('diagnostic-only');
    if (typeof next === 'function') s.getItem = next; else s.raw = next;
    c.refreshHistory(); assert.equal(c.view().notePersistence, 'not-confirmed'); assert.equal(c.view().sessionVerification.status, 'session-passed');
  }
});

test('last-write wins history accepts backward completion times without timestamp-max inference', () => {
  const s = storage(), result = diagnosticResult(), c = diagnosticController(s, result);
  c.verifySelectedBackup('first'); result.verifiedAt = '2026-01-01T00:00:00.000Z'; c.verifySelectedBackup('second');
  assert.equal(JSON.parse(s.raw).completedAt, result.verifiedAt); assert.equal(c.view().sessionVerification.completedAt, result.verifiedAt);
});

for (const raw of ['', '{broken', rawNote(), ' '.repeat(513)]) test(`release removes any present note string (${raw.length} characters) only after confirming absence`, () => {
  const s = storage(raw), c = controller(s); s.calls = [];
  assert.deepEqual(c.releaseHistoryForWrite(), { status: 'removed' });
  assert.deepEqual(s.calls, [['get', B.NOTE_KEY], ['remove', B.NOTE_KEY], ['get', B.NOTE_KEY]]);
  assert.equal(c.view().storedNote.status, 'missing'); assert.equal(c.view().notePersistence, 'released');
});

test('absent release does not remove or give a blind-retry signal', () => {
  const s = storage(), c = controller(s); s.calls = [];
  assert.deepEqual(c.releaseHistoryForWrite(), { status: 'absent' }); assert.deepEqual(s.calls, [['get', B.NOTE_KEY]]);
});

for (const mode of ['initial-read', 'remove-getter', 'remove-throw', 'readback-throw', 'silent-remove', 'recreated', 'invalid-result']) {
  test(`release failure ${mode} is contained and never confirms removal`, () => {
    const s = storage(), c = diagnosticController(s); c.verifySelectedBackup('diagnostic-only'); s.calls = [];
    if (mode === 'initial-read') s.getItem = function (key) { this.calls.push(['get', key]); failure(); };
    if (mode === 'remove-getter') Object.defineProperty(s, 'removeItem', { get: failure });
    if (mode === 'remove-throw') s.removeItem = function (key) { this.calls.push(['remove', key]); failure(); };
    if (mode === 'readback-throw') s.removeItem = function (key) { this.calls.push(['remove', key]); this.raw = null; this.getItem = failure; };
    if (mode === 'silent-remove') s.removeItem = function (key) { this.calls.push(['remove', key]); };
    if (mode === 'recreated') s.removeItem = function (key) { this.calls.push(['remove', key]); this.raw = rawNote({ backupVersion: 5 }); };
    if (mode === 'invalid-result') s.getItem = function (key) { this.calls.push(['get', key]); return undefined; };
    assert.deepEqual(c.releaseHistoryForWrite(), { status: 'failed' });
    assert.notEqual(c.view().notePersistence, 'recorded'); assert.equal(c.view().sessionVerification.status, 'session-passed');
    assert.ok(s.calls.filter(call => call[0] === 'remove').length <= 1);
  });
}

test('accepted note removal preserves live pass without rewrites or financial key access', () => {
  const s = storage(), c = diagnosticController(s); c.verifySelectedBackup('diagnostic-only');
  const session = c.view().sessionVerification; s.calls = []; c.releaseHistoryForWrite();
  assert.deepEqual(c.view().sessionVerification, session); assert.equal(c.view().storedNote.status, 'missing');
  c.view(); c.observeStorage(event('ledger', 'write', 'accepted'));
  assert.deepEqual(s.calls.map(call => call[0]), ['get', 'remove', 'get']);
  assert.ok(s.calls.every(call => call[1] === B.NOTE_KEY));
});

test('storage observation is closed, immutable, pure and accepts only coherent phase/cause combinations', () => {
  const s = storage(), c = controller(s), before = s.calls.length;
  const good = [event('ledger', 'read', 'accepted'), event('ledger', 'read', 'failed', { cause: 'read-failed' }),
    event('ledger', 'write', 'failed', { cause: 'quota-reported' }), event('ledger', 'write', 'accepted'),
    event('recovery-copy', 'write', 'accepted', { phase: 'staging' }),
    event('recovery-copy', 'read', 'failed', { phase: 'readback', cause: 'copy-mismatch' }),
    event('recovery-copy', 'write', 'failed', { phase: 'compensation', cause: 'write-failed' })];
  for (const input of good) { c.observeStorage(input); assert.ok(Object.isFrozen(c.view()[input.target === 'ledger' ? input.operation === 'write' ? 'lastLedgerWrite' : 'lastLedgerRead' : 'lastRecoveryCopy'])); }
  const snapshot = c.view();
  const bad = [null, undefined, [], {}, 'error', { ...good[0], cause: 'read-failed' }, { ...good[0], phase: 'readback' },
    { ...good[0], extra: 1 }, { ...good[0], [Symbol('extra')]: 1 }, { ...good[0], operation: 'delete' },
    { ...good[0], target: 'note' }, { ...good[0], outcome: 'maybe' }, { ...good[1], cause: 'quota-reported' },
    { ...good[2], cause: 'Error text' }, { ...good[4], phase: 'readback' }, { ...good[5], phase: 'compensation' },
    { ...good[5], operation: 'write' }, { ...good[6], cause: 'copy-mismatch' },
    new Proxy({}, { get: failure }), new Proxy(good[0], { ownKeys: failure })];
  for (const input of bad) { assert.doesNotThrow(() => c.observeStorage(input)); assert.deepEqual(c.view(), snapshot); }
  assert.equal(s.calls.length, before);
});

test('only accepted actual ledger writes clear unresolved ledger write failure', () => {
  const s = storage(rawNote()), c = diagnosticController(s), failed = event('ledger', 'write', 'failed', { cause: 'quota-reported' });
  c.observeStorage(failed); failed.cause = 'unavailable';
  const expected = event('ledger', 'write', 'failed', { cause: 'quota-reported' });
  for (const action of [() => c.refreshHistory(), () => c.verifySelectedBackup('diagnostic-only'), () => c.releaseHistoryForWrite(),
    () => c.observeStorage(event('ledger', 'read', 'accepted')),
    () => c.observeStorage(event('recovery-copy', 'write', 'accepted', { phase: 'staging' })),
    () => c.observeStorage(event('recovery-copy', 'write', 'accepted', { phase: 'compensation' }))]) {
    action(); assert.deepEqual(c.view().ledgerWriteFailure, expected);
  }
  c.observeStorage(event('ledger', 'write', 'accepted')); assert.equal(c.view().ledgerWriteFailure, null);
});

test('recovery readback and compensation failures retain their distinct phase and compensation success does not erase cause', () => {
  const c = controller();
  c.observeStorage(event('recovery-copy', 'read', 'failed', { phase: 'readback', cause: 'copy-mismatch' }));
  c.observeStorage(event('recovery-copy', 'write', 'accepted', { phase: 'compensation' }));
  assert.equal(c.view().recoveryCopyFailure.phase, 'readback');
  c.observeStorage(event('recovery-copy', 'write', 'failed', { phase: 'compensation', cause: 'unavailable' }));
  assert.equal(c.view().recoveryCopyFailure.phase, 'compensation');
  c.observeStorage(event('ledger', 'write', 'accepted')); assert.equal(c.view().recoveryCopyFailure.phase, 'compensation');
  c.observeStorage(event('recovery-copy', 'write', 'accepted', { phase: 'staging' })); assert.equal(c.view().recoveryCopyFailure, null);
});

test('view and returned history snapshots cannot be used to mutate controller provenance or stored bytes', () => {
  const s = storage(rawNote()), c = controller(s), raw = s.raw, calls = s.calls.length;
  const v = c.view({ ledgerRead: 'absent', blocked: true, stale: true });
  assert.throws(() => { v.sessionVerification.status = 'session-passed'; }, TypeError);
  assert.throws(() => { v.storedNote.completedAt = 'forged'; }, TypeError);
  assert.throws(() => { v.storedNote.age.status = 'recent'; }, TypeError);
  assert.equal(c.view().sessionVerification.status, 'absent'); assert.equal(s.raw, raw); assert.equal(s.calls.length, calls);
  assert.doesNotThrow(() => c.view(new Proxy({}, { get: failure })));
  assert.equal(c.view(new Proxy({}, { get: failure })).ledgerRead, 'unknown');
  assert.equal(c.view({ ledgerRead: 'lie', blocked: 'yes', stale: 1 }).blocked, false);
});

test('malformed option getters are contained without retaining an application options object', () => {
  const options = { verifyBackup: L.verifyBackup.bind(L), get metadataStorage() { failure(); }, get now() { failure(); } };
  const c = B.create(options); assert.equal(c.view().storedNote.status, 'unreadable');
  assert.equal(c.verifySelectedBackup(L.backup(realV6())).notePersistence, 'failed');
  assert.equal(c.view().sessionVerification.age.status, 'unknown');
});

test('no selected file contents, counts, balances or exception data escape through diagnostics', () => {
  const s = storage(), result = { ...diagnosticResult(), state: { version: 6, private: 'PRIVATE_STATE' }, counts: { private: 'PRIVATE_COUNTS' }, balances: { private: 'PRIVATE_BALANCES' } };
  const c = diagnosticController(s, result); c.verifySelectedBackup('PRIVATE_SELECTED_FILE_PATH_AND_TEXT');
  c.observeStorage({ ...event('ledger', 'write', 'failed', { cause: 'write-failed' }), error: 'PRIVATE_ERROR' });
  assert.doesNotMatch(JSON.stringify(c.view()) + s.raw, /PRIVATE/);
  assert.deepEqual(Object.keys(JSON.parse(s.raw)), NOTE_FIELDS);
});
