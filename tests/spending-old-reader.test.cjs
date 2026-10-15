'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const folder = path.join(__dirname, 'fixtures/spending-readers-v016');
const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'SHA256.json'), 'utf8'));
const { L, base, spending } = require('./spending-boundary-helpers.cjs');
const old = require(path.join(folder, 'ledger.js'));
test('frozen actual v0.16 reader dependency closure is complete and hash-verified', () => {
  assert.equal(manifest.sourceRelease, '0.16.0'); const names = new Set(manifest.files.map(row => row.file)); assert.equal(names.size, 10);
  for (const row of manifest.files) {
    const bytes = fs.readFileSync(path.join(folder, row.file)); assert.equal(bytes.length, row.bytes); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.sha256);
    for (const match of bytes.toString('utf8').matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)) assert.ok(names.has(match[1]), row.file + ' -> ' + match[1]);
    assert.doesNotMatch(bytes.toString('utf8'), /spendingPlanning|spending-core|SPENDING_PLANNING_VERSION/);
  }
});
test('actual old reader accepts old v6/v7 without writes and never depends on candidate source', () => {
  const oldStates = [L.parseBackup(fs.readFileSync(path.join(__dirname, 'fixtures/all-extensions-v6.json'), 'utf8')), require('./income-root-fixture.cjs').combined().state];
  for (const state of oldStates) { assert.deepEqual(old.parseBackup(L.backup(state)), state); const writes = []; const loaded = old.load({ getItem: () => JSON.stringify(state), setItem: (...args) => writes.push(args) }); assert.equal(loaded.error, null); assert.deepEqual(loaded.state, state); assert.deepEqual(writes, []); }
  for (const filename of Object.keys(require.cache).filter(name => name.startsWith(folder + path.sep))) for (const child of require.cache[filename].children) assert.ok(child.filename.startsWith(folder + path.sep));
});
for (const both of [false, true]) for (const status of ['active', 'cancelled', 'retired']) test('actual v0.16 rejects ' + status + (both ? ' both-planning' : ' spending-only') + ' v8 export/load without writes', () => {
  const state = spending(base(), { both, cancelled: status === 'cancelled', retired: status === 'retired' });
  assert.equal(state.version, 8); assert.deepEqual(L.parseBackup(L.backup(state)), state);
  assert.throws(() => old.validateState(state), { code: 'INVALID_VERSION' }); assert.throws(() => old.parseBackup(L.backup(state)), { code: 'INVALID_VERSION' });
  const saved = JSON.stringify(state), writes = []; const storage = { getItem: () => saved, setItem: (...args) => writes.push(args) }; const loaded = old.load(storage);
  assert.equal(loaded.error.code, 'INVALID_VERSION'); assert.deepEqual(loaded.state, old.createEmpty()); assert.deepEqual(writes, []); assert.equal(storage.getItem(old.STORAGE_KEY), saved);
});
